"""Who the caller is for practice, mocks and the tutor, and what their free limits leave.

Limits mirror ``packages/app-core/src/entitlements/limits.ts`` (``practiceQuota``,
``tutorQuota``, ``sectionalMockQuota``, ``mockAccess``): the device enforces them offline and the
server enforces them here, with the server's count winning (practice §4.1). Thresholds are
``ops.flags`` keys; an owner flag that is not set turns its limit or feature off rather than
using a guessed number (practice §9.2).
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.errors import ApiError
from smriti_api.services import flags as flag_service
from smriti_api.services.recompute import zone
from smriti_api.services.state import entitlement_state

IST = ZoneInfo("Asia/Kolkata")

# Defaults that packages/config ships (PRD and ruling values). Owner flags have no default.
FLAG_DEFAULTS: dict[str, Any] = {
    "free.practice_questions_per_day": 30,
    "free.sectional_mocks_per_week": 1,
    "free.tutor_messages_per_day": 5,
    "free.pyq_papers_free": [],
    "free.mock_report_sections": [
        "score",
        "accuracy",
        "time_lost_wrong",
        "section_bars",
        "subject_bars",
        "attempt_summary",
        "solutions",
        "fix_next_top",
    ],
    "pro.custom_mocks": True,
    "live.enabled": False,
    "practice.mixed_enabled": False,
    # Server-side defaults from the flow docs.
    "ai.tutor_retention_days": 180,  # tutor-social §A7, §A14
    "ai.tutor_session_reuse_min": 30,  # tutor-social §A5 step 1
}
# Counted toward the daily practice questions (app-core PRACTICE_COUNTED_CONTEXTS).
PRACTICE_COUNTED_CONTEXTS = ("practice", "drill", "pyq", "chapter_test")


class Flags:
    def __init__(self, values: Mapping[str, Any]) -> None:
        self._values = values

    def get(self, key: str) -> Any:
        if key in self._values and self._values[key] is not None:
            return self._values[key]
        return FLAG_DEFAULTS.get(key)

    def int_or_none(self, key: str) -> int | None:
        value = self.get(key)
        if isinstance(value, bool) or not isinstance(value, int | float):
            return None
        return int(value)

    def float_or_none(self, key: str) -> float | None:
        value = self.get(key)
        if isinstance(value, bool) or not isinstance(value, int | float):
            return None
        return float(value)

    def str_list(self, key: str) -> list[str]:
        value = self.get(key)
        return [str(v) for v in value] if isinstance(value, list) else []

    def bool(self, key: str) -> bool:
        return self.get(key) is True


async def load_flags(session: AsyncSession) -> Flags:
    return Flags(await flag_service.server_flags(session))


@dataclass(frozen=True)
class Quota:
    unlimited: bool
    limit: int | None
    used: int
    remaining: int | None
    allowed: bool


def quota(used: int, limit: int | None, is_pro: bool) -> Quota:
    """app-core ``quota``: Pro, or a limit that is not set, is unlimited."""
    if is_pro or limit is None:
        return Quota(True, limit, used, None, True)
    remaining = max(0, limit - used)
    return Quota(False, limit, used, remaining, remaining > 0)


@dataclass(frozen=True)
class Learner:
    user_id: uuid.UUID
    is_guest: bool
    is_pro: bool
    tz: ZoneInfo
    locale: str
    age_band: str | None
    is_minor: bool
    primary_exam: str | None
    exams: tuple[str, ...]
    tutor_locale: str | None

    @property
    def under_13(self) -> bool:
        return self.age_band in ("u10", "10_12")

    def today(self, now: datetime) -> date:
        return now.astimezone(self.tz).date()

    def day_bounds(self, now: datetime) -> tuple[datetime, datetime]:
        """Local midnight to the next local midnight, in UTC (practice §4.1 "Day and week")."""
        day = self.today(now)
        start = datetime.combine(day, time.min, self.tz)
        end = datetime.combine(day + timedelta(days=1), time.min, self.tz)
        return start.astimezone(UTC), end.astimezone(UTC)

    def exam_or_primary(self, exam: str | None) -> str:
        chosen = exam or self.primary_exam or (self.exams[0] if self.exams else None)
        if chosen is None:
            raise ApiError(422, "exam_required", "Pick an exam first", detail="No exam profile")
        return chosen


async def load_learner(session: AsyncSession, user_id: uuid.UUID, is_guest: bool) -> Learner:
    row = (
        await session.execute(
            text(
                "select timezone, locale, age_band, is_minor, primary_exam_profile_id, settings"
                " from app.profiles where user_id = :u"
            ),
            {"u": user_id},
        )
    ).one_or_none()
    if row is None:
        raise ApiError(401, "session_ended", "This account no longer exists")
    exams = (
        await session.execute(
            text(
                "select exam_profile_id from app.user_exams where user_id = :u"
                " order by is_primary desc, created_at"
            ),
            {"u": user_id},
        )
    ).scalars()
    exam_list = tuple(str(e) for e in exams)
    ent = await entitlement_state(session, user_id)
    settings = row.settings or {}
    tutor_locale = settings.get("tutor_locale") if isinstance(settings, dict) else None
    return Learner(
        user_id=user_id,
        is_guest=is_guest,
        is_pro=ent.plan == "pro",
        tz=zone(row.timezone),
        locale=row.locale,
        age_band=row.age_band,
        is_minor=bool(row.is_minor),
        primary_exam=row.primary_exam_profile_id or (exam_list[0] if exam_list else None),
        exams=exam_list,
        tutor_locale=str(tutor_locale) if tutor_locale else None,
    )


async def practice_used_today(session: AsyncSession, learner: Learner, now: datetime) -> int:
    """Practice questions checked today: online answers and synced ones (server count wins)."""
    start, end = learner.day_bounds(now)
    used = (
        await session.execute(
            text(
                "select count(distinct (question_id, coalesce(session_id::text, id::text)))"
                " from learn.question_attempts where user_id = :u and context = any(:ctx)"
                " and attempt_no = 1 and answered_at >= :s and answered_at < :e"
            ),
            {"u": learner.user_id, "ctx": list(PRACTICE_COUNTED_CONTEXTS), "s": start, "e": end},
        )
    ).scalar_one()
    return int(used)


async def practice_quota(
    session: AsyncSession, learner: Learner, flags: Flags, now: datetime
) -> Quota:
    used = await practice_used_today(session, learner, now)
    return quota(used, flags.int_or_none("free.practice_questions_per_day"), learner.is_pro)


def mock_week_bounds(now: datetime) -> tuple[datetime, datetime]:
    """Monday 00:00 to the next Monday 00:00 IST (practice §4.1, app-core ``mockWeekStart``)."""
    today = now.astimezone(IST).date()
    monday = today - timedelta(days=today.weekday())
    start = datetime.combine(monday, time.min, IST)
    return start.astimezone(UTC), (start + timedelta(days=7)).astimezone(UTC)


async def sectional_started_this_week(
    session: AsyncSession, user_id: uuid.UUID, now: datetime, flags: Flags
) -> int:
    """Sectional and timed chapter mocks started this IST week (practice Q15). An attempt left in
    the first ``mock.free_grace_min`` minutes is refunded once a week (practice Q3)."""
    start, end = mock_week_bounds(now)
    rows = (
        await session.execute(
            text(
                "select status, started_at, submitted_at, created_at from learn.mock_attempts"
                " where user_id = :u and kind in ('sectional','chapter')"
                " and started_at >= :s and started_at < :e"
            ),
            {"u": user_id, "s": start, "e": end},
        )
    ).all()
    grace = flags.int_or_none("mock.free_grace_min")
    count = len(rows)
    if grace is not None:
        refundable = [
            r
            for r in rows
            if r.status == "abandoned"
            and r.submitted_at is not None
            and r.submitted_at - r.started_at <= timedelta(minutes=grace)
        ]
        if refundable:
            count -= 1
    return max(0, count)


async def tutor_used_today(session: AsyncSession, learner: Learner, now: datetime) -> int:
    start, end = learner.day_bounds(now)
    used = (
        await session.execute(
            text(
                "select count(*) from ai.tutor_messages where user_id = :u and counted"
                " and created_at >= :s and created_at < :e"
            ),
            {"u": learner.user_id, "s": start, "e": end},
        )
    ).scalar_one()
    return int(used)


def tutor_limit(learner: Learner, flags: Flags) -> int | None:
    key = "pro.tutor_messages_per_day" if learner.is_pro else "free.tutor_messages_per_day"
    return flags.int_or_none(key)


async def tutor_quota(
    session: AsyncSession, learner: Learner, flags: Flags, now: datetime
) -> Quota:
    # app-core tutorQuota: Pro has a fair-use cap too, so isPro is never "unlimited" here.
    return quota(await tutor_used_today(session, learner, now), tutor_limit(learner, flags), False)


def next_local_midnight(learner: Learner, now: datetime) -> datetime:
    return learner.day_bounds(now)[1]
