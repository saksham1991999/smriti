"""Parent mode, Phase 3 (me-money §4.7 SET-13 to SET-19, PRD §17; tutor-social B13).

A guardian sees each linked child's week and sets that child's controls. Every guardian call
first checks a live link in ``app.guardian_links`` *and* an active guardian consent that grants
``account`` (for a ``consent`` link the consent must be the calling guardian's own). Without
both, the child is "not found", so nothing confirms that an account exists.

What the parent sees comes from the child's own synced rows: ``learn.activity_days`` (minutes,
lessons, reviews), ``learn.question_attempts`` (practice counts), ``learn.topic_status`` (topic
names), ``learn.mock_attempts`` (scores) and ``game.user_stats`` (streak). Never chat text, notes
or anything the child typed (SET-15).

Controls the server enforces (the device also enforces the time limit offline, SET-16):

- ``social_enabled = false``: the social gate answers ``parent_off`` (403 ``parent_turned_off``)
  and the child disappears from everything social (:func:`social_people.socially_visible`).
- ``tutor_enabled = false`` (or, for a little learner, ``tutor_button`` not on): the tutor gate
  answers 403 ``parent_turned_off`` (:func:`check_tutor`).
- The daily limit and allowed hours: the tutor answers 403 ``time_limit_reached`` or
  ``outside_allowed_hours`` (:func:`check_study_time`), using the minutes the device synced.

The weekly digest (:func:`digest_job`) goes through ``notify.outbox`` with class ``parent``,
which skips the caps (me-money §6.2). Logs carry hashed ids only.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.core.logging import hash_user_id
from smriti_api.schemas import parent as p
from smriti_api.services import notify
from smriti_api.services import social_people as sp
from smriti_api.services.recompute import zone
from smriti_api.services.social_friends import end_pair
from smriti_api.services.state import entitlement_state
from smriti_api.services.usage import load_flags
from smriti_api.services.versioning import bump

if TYPE_CHECKING:
    from smriti_api.services.jobs import JobDeps
    from smriti_api.services.usage import Learner

log = structlog.get_logger(__name__)

# SET-19: "Ask for 15 more minutes".
REQUEST_MINUTES = 15
# SET-15 "Sent every Sunday evening"; the send table (me-money §6.7) says Sunday 19:00 local.
DIGEST_AT = time(19, 0)
# Question contexts that count as practice on the parent card (lessons and duels are counted
# elsewhere or not at all).
PRACTICE_CONTEXTS = ("practice", "drill", "daily", "pyq", "chapter_test")


@dataclass(frozen=True)
class Child:
    user_id: uuid.UUID
    kind: str
    age_band: str | None
    first_name: str | None
    tz: ZoneInfo

    def today(self, now: datetime) -> date:
        return now.astimezone(self.tz).date()

    def bounds(self, start: date, days: int) -> tuple[datetime, datetime]:
        """Local midnight of ``start`` to local midnight ``days`` later, as aware datetimes."""
        lo = datetime.combine(start, time(0), self.tz)
        hi = datetime.combine(start + timedelta(days=days), time(0), self.tz)
        return lo, hi


_LINKED = """
select gl.learner_user_id, gl.kind, gl.weekly_report, p.age_band, p.display_name, p.timezone
  from app.guardian_links gl
  join app.profiles p on p.user_id = gl.learner_user_id
 where gl.guardian_user_id = :g and gl.revoked_at is null
   and exists (
     select 1 from app.guardian_consents c
      where c.user_id = gl.learner_user_id and c.revoked_at is null and c.superseded_by is null
        and coalesce((c.scope ->> 'account')::boolean, false)
        and (c.guardian_user_id = gl.guardian_user_id or gl.kind = 'managed'))
"""


def _child(r: Any) -> Child:
    return Child(
        user_id=r.learner_user_id,
        kind=r.kind,
        age_band=r.age_band,
        first_name=(r.display_name or "").split(" ")[0] or None,
        tz=zone(r.timezone),
    )


async def linked_children(session: AsyncSession, guardian_id: uuid.UUID) -> list[Child]:
    rows = (
        await session.execute(text(_LINKED + " order by gl.created_at"), {"g": guardian_id})
    ).all()
    return [_child(r) for r in rows]


async def child_for(session: AsyncSession, guardian_id: uuid.UUID, learner_id: uuid.UUID) -> Child:
    row = (
        await session.execute(
            text(_LINKED + " and gl.learner_user_id = :l"), {"g": guardian_id, "l": learner_id}
        )
    ).one_or_none()
    if row is None:
        raise ApiError(404, "learner_not_found", "This child isn't linked to your account")
    return _child(row)


async def guardians_of(session: AsyncSession, learner_id: uuid.UUID) -> list[uuid.UUID]:
    rows = (
        await session.execute(
            text(
                "select gl.guardian_user_id from app.guardian_links gl"
                " where gl.learner_user_id = :l and gl.revoked_at is null and exists ("
                "  select 1 from app.guardian_consents c where c.user_id = gl.learner_user_id"
                "   and c.revoked_at is null and c.superseded_by is null"
                "   and coalesce((c.scope ->> 'account')::boolean, false)"
                "   and (c.guardian_user_id = gl.guardian_user_id or gl.kind = 'managed'))"
                " order by gl.created_at"
            ),
            {"l": learner_id},
        )
    ).scalars()
    return list(rows)


def week_start(day: date) -> date:
    """Weeks run Monday to Sunday (ME-20 "resets Monday")."""
    return day - timedelta(days=day.weekday())


# --- controls ------------------------------------------------------------------------------------


async def _controls_row(session: AsyncSession, learner_id: uuid.UUID) -> Any:
    return (
        await session.execute(
            text("select * from app.parental_controls where learner_user_id = :l"),
            {"l": learner_id},
        )
    ).one_or_none()


def _controls_out(learner_id: uuid.UUID, row: Any, weekly_report: bool) -> p.ControlsOut:
    if row is None:
        return p.ControlsOut(learner_user_id=learner_id, weekly_report=weekly_report)
    return p.ControlsOut(
        learner_user_id=learner_id,
        daily_limit_min=row.daily_limit_min,
        allowed_from=row.allowed_from,
        allowed_to=row.allowed_to,
        break_reminders=row.break_reminders,
        ask_before_switching=row.ask_before_switching,
        tutor_button=row.tutor_button,
        picture_rhymes=row.picture_rhymes,
        tutor_enabled=row.tutor_enabled,
        social_enabled=row.social_enabled,
        weekly_report=weekly_report,
        updated_at=row.updated_at,
    )


async def _weekly_report_on(
    session: AsyncSession, guardian_id: uuid.UUID, learner_id: uuid.UUID
) -> bool:
    value = (
        await session.execute(
            text(
                "select weekly_report from app.guardian_links"
                " where guardian_user_id = :g and learner_user_id = :l"
            ),
            {"g": guardian_id, "l": learner_id},
        )
    ).scalar_one()
    return bool(value)


async def get_controls(db: Database, auth: AuthContext, learner_id: uuid.UUID) -> p.ControlsOut:
    async with db.system_tx() as session:
        child = await child_for(session, auth.user_id, learner_id)
        row = await _controls_row(session, child.user_id)
        weekly = await _weekly_report_on(session, auth.user_id, child.user_id)
        return _controls_out(child.user_id, row, weekly)


async def put_controls(
    db: Database, auth: AuthContext, learner_id: uuid.UUID, body: p.Controls
) -> p.ControlsOut:
    async with db.system_tx() as session:
        child = await child_for(session, auth.user_id, learner_id)
        row = (
            await session.execute(
                text(
                    """
                    insert into app.parental_controls (learner_user_id, set_by, daily_limit_min,
                      allowed_from, allowed_to, break_reminders, ask_before_switching, tutor_button,
                      picture_rhymes, tutor_enabled, social_enabled)
                    values (:l, :g, :lim, :f, :t, :br, :ask, :tb, :pr, :te, :se)
                    on conflict (learner_user_id) do update set set_by = excluded.set_by,
                      daily_limit_min = excluded.daily_limit_min,
                      allowed_from = excluded.allowed_from, allowed_to = excluded.allowed_to,
                      break_reminders = excluded.break_reminders,
                      ask_before_switching = excluded.ask_before_switching,
                      tutor_button = excluded.tutor_button, picture_rhymes = excluded.picture_rhymes,
                      tutor_enabled = excluded.tutor_enabled, social_enabled = excluded.social_enabled
                    returning *
                    """
                ),
                {
                    "l": child.user_id,
                    "g": auth.user_id,
                    "lim": body.daily_limit_min,
                    "f": body.allowed_from,
                    "t": body.allowed_to,
                    "br": body.break_reminders,
                    "ask": body.ask_before_switching,
                    "tb": body.tutor_button,
                    "pr": body.picture_rhymes,
                    "te": body.tutor_enabled,
                    "se": body.social_enabled,
                },
            )
        ).one()
        await session.execute(
            text(
                "update app.guardian_links set weekly_report = :w"
                " where guardian_user_id = :g and learner_user_id = :l"
            ),
            {"w": body.weekly_report, "g": auth.user_id, "l": child.user_id},
        )
        # The child's device refetches its limits on the next sync.
        await bump(session, child.user_id, {"profile"})
    log.info("parental_controls_set", learner=hash_user_id(child.user_id))
    return _controls_out(child.user_id, row, body.weekly_report)


# --- enforcement ---------------------------------------------------------------------------------


async def check_tutor(session: AsyncSession, learner: Learner) -> None:
    """The tutor gate. Little learners need the parent's "Tutor button" on (R14, off by
    default); anyone else is blocked only when a parent turned the tutor off."""
    row = await _controls_row(session, learner.user_id)
    if learner.age_band == "u10":
        if row is None or not row.tutor_button:
            raise ApiError(403, "parent_turned_off", "A grown-up can turn this on", feature="tutor")
        return
    if row is not None and not row.tutor_enabled:
        raise ApiError(403, "parent_turned_off", "A grown-up turned this off", feature="tutor")


async def _extra_minutes(session: AsyncSession, learner_id: uuid.UUID, day: date) -> int:
    value = (
        await session.execute(
            text(
                "select coalesce(sum(minutes), 0) from app.time_requests"
                " where learner_user_id = :l and for_date = :d and status = 'allowed'"
            ),
            {"l": learner_id, "d": day},
        )
    ).scalar_one()
    return int(value)


async def _minutes_on(session: AsyncSession, learner_id: uuid.UUID, day: date) -> int:
    value = (
        await session.execute(
            text("select minutes from learn.activity_days where user_id = :u and day = :d"),
            {"u": learner_id, "d": day},
        )
    ).scalar_one_or_none()
    return int(value or 0)


def _within(now_local: time, start: time | None, end: time | None) -> bool:
    if start is None or end is None:
        return True
    return notify.in_window(now_local, start, end)


async def _limits(
    session: AsyncSession, learner_id: uuid.UUID, tz: ZoneInfo, now: datetime
) -> p.MyLimits:
    today = now.astimezone(tz).date()
    row = await _controls_row(session, learner_id)
    if row is None:
        return p.MyLimits(controlled=False, today=today)
    used = await _minutes_on(session, learner_id, today)
    extra = await _extra_minutes(session, learner_id, today)
    limit = row.daily_limit_min + extra if row.daily_limit_min is not None else None
    req = (
        await session.execute(
            text(
                "select * from app.time_requests where learner_user_id = :l and for_date = :d"
                " order by created_at desc limit 1"
            ),
            {"l": learner_id, "d": today},
        )
    ).one_or_none()
    return p.MyLimits(
        controlled=True,
        daily_limit_min=row.daily_limit_min,
        allowed_from=row.allowed_from,
        allowed_to=row.allowed_to,
        break_reminders=row.break_reminders,
        ask_before_switching=row.ask_before_switching,
        tutor_button=row.tutor_button,
        picture_rhymes=row.picture_rhymes,
        tutor_enabled=row.tutor_enabled,
        social_enabled=row.social_enabled,
        today=today,
        minutes_today=used,
        extra_minutes=extra,
        limit_today=limit,
        remaining_minutes=max(limit - used, 0) if limit is not None else None,
        within_hours=_within(now.astimezone(tz).time(), row.allowed_from, row.allowed_to),
        request=_request_out(req) if req is not None else None,
    )


async def check_study_time(
    session: AsyncSession, learner: Learner, now: datetime | None = None
) -> None:
    """Server side of SET-16 for server-run features (the tutor). Minutes are the ones the
    device synced to ``learn.activity_days``, so this trails the device's own timer."""
    if not learner.is_minor:
        return
    now = now or datetime.now(UTC)
    limits = await _limits(session, learner.user_id, learner.tz, now)
    if not limits.controlled:
        return
    if not limits.within_hours:
        raise ApiError(
            403,
            "outside_allowed_hours",
            "It isn't study time right now",
            allowed_from=limits.allowed_from.isoformat() if limits.allowed_from else None,
        )
    if limits.remaining_minutes is not None and limits.remaining_minutes <= 0:
        raise ApiError(403, "time_limit_reached", "That's today's study time")


async def my_limits(db: Database, auth: AuthContext) -> p.MyLimits:
    async with db.system_tx() as session:
        tz = (
            await session.execute(
                text("select timezone from app.profiles where user_id = :u"), {"u": auth.user_id}
            )
        ).scalar_one_or_none()
        return await _limits(session, auth.user_id, zone(tz), datetime.now(UTC))


# --- time requests (SET-19) ----------------------------------------------------------------------


def _request_out(r: Any) -> p.TimeRequestOut:
    return p.TimeRequestOut(
        id=r.id,
        learner_user_id=r.learner_user_id,
        minutes=r.minutes,
        status=r.status,
        for_date=r.for_date,
        created_at=r.created_at,
        decided_at=r.decided_at,
    )


async def _expire_old(session: AsyncSession, learner_id: uuid.UUID, today: date) -> None:
    await session.execute(
        text(
            "update app.time_requests set status = 'expired', decided_at = now()"
            " where learner_user_id = :l and status = 'pending' and for_date < :d"
        ),
        {"l": learner_id, "d": today},
    )


async def ask_for_time(db: Database, auth: AuthContext) -> p.TimeRequestOut:
    """[Ask for 15 more minutes]: one open ask at a time, none after a "Not today" the same day."""
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        prof = (
            await session.execute(
                text("select display_name, timezone from app.profiles where user_id = :u"),
                {"u": auth.user_id},
            )
        ).one_or_none()
        if prof is None:
            raise ApiError(404, "profile_not_found", "No profile for this account")
        today = now.astimezone(zone(prof.timezone)).date()
        controls = await _controls_row(session, auth.user_id)
        guardians = await guardians_of(session, auth.user_id)
        if controls is None or controls.daily_limit_min is None or not guardians:
            raise ApiError(409, "no_time_limit", "There is no time limit to extend")
        await _expire_old(session, auth.user_id, today)
        rows = (
            await session.execute(
                text(
                    "select * from app.time_requests where learner_user_id = :l and for_date = :d"
                    " and status in ('pending', 'declined') order by created_at desc"
                ),
                {"l": auth.user_id, "d": today},
            )
        ).all()
        pending = next((r for r in rows if r.status == "pending"), None)
        if pending is not None:
            return _request_out(pending)
        if rows:
            raise ApiError(409, "declined_today", "Not today. See you tomorrow!")
        row = (
            await session.execute(
                text(
                    "insert into app.time_requests (learner_user_id, minutes, for_date)"
                    " values (:l, :m, :d) returning *"
                ),
                {"l": auth.user_id, "m": REQUEST_MINUTES, "d": today},
            )
        ).one()
        first = (prof.display_name or "").split(" ")[0] or None
        for g in guardians:
            await notify.enqueue(
                session,
                user_id=g,
                kind="parent_time_request",
                payload={"child": first or "", "request_id": str(row.id)},
                dedupe_key=f"parent_time_request:{row.id}:{g}",
            )
    log.info("time_request_created", learner=hash_user_id(auth.user_id))
    return _request_out(row)


async def decide_time(
    db: Database, auth: AuthContext, request_id: uuid.UUID, body: p.Decision
) -> p.TimeRequestOut:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        row = (
            await session.execute(
                text("select * from app.time_requests where id = :id for update"),
                {"id": request_id},
            )
        ).one_or_none()
        if row is None:
            raise ApiError(404, "not_found", "This request isn't here")
        child = await child_for(session, auth.user_id, row.learner_user_id)
        if row.status != "pending":
            if row.status in ("allowed", "declined"):
                return _request_out(row)
            raise ApiError(409, "request_expired", "This request was for another day")
        if row.for_date < child.today(now):
            await _expire_old(session, child.user_id, child.today(now))
            raise ApiError(409, "request_expired", "This request was for another day")
        row = (
            await session.execute(
                text(
                    "update app.time_requests set status = :s, decided_at = :t, guardian_user_id = :g"
                    " where id = :id returning *"
                ),
                {
                    "s": "allowed" if body.allow else "declined",
                    "t": now,
                    "g": auth.user_id,
                    "id": request_id,
                },
            )
        ).one()
        await bump(session, child.user_id, {"profile"})
    log.info("time_request_decided", learner=hash_user_id(child.user_id), allowed=body.allow)
    return _request_out(row)


# --- what the parent sees -------------------------------------------------------------------------


async def _week_minutes(session: AsyncSession, child: Child, start: date) -> list[Any]:
    return list(
        (
            await session.execute(
                text(
                    "select day, minutes, lessons_completed, cards_reviewed from learn.activity_days"
                    " where user_id = :u and day >= :a and day < :b order by day"
                ),
                {"u": child.user_id, "a": start, "b": start + timedelta(days=7)},
            )
        ).all()
    )


async def _practice_count(session: AsyncSession, child: Child, start: date) -> int:
    lo, hi = child.bounds(start, 7)
    value = (
        await session.execute(
            text(
                "select count(*) from learn.question_attempts where user_id = :u"
                " and answered_at >= :lo and answered_at < :hi and context = any(:ctx)"
            ),
            {"u": child.user_id, "lo": lo, "hi": hi, "ctx": list(PRACTICE_CONTEXTS)},
        )
    ).scalar_one()
    return int(value)


async def _streak(session: AsyncSession, learner_id: uuid.UUID) -> int:
    value = (
        await session.execute(
            text("select current_streak from game.user_stats where user_id = :u"),
            {"u": learner_id},
        )
    ).scalar_one_or_none()
    return int(value or 0)


def _i18n(value: Any) -> dict[str, str] | None:
    if isinstance(value, dict):
        return {k: str(v) for k, v in value.items() if isinstance(v, str)}
    return None


async def _last_mock(session: AsyncSession, learner_id: uuid.UUID) -> p.LastMock | None:
    r = (
        await session.execute(
            text(
                "select a.id, a.mock_id, a.score, a.max_score, a.submitted_at, m.title"
                " from learn.mock_attempts a left join content.mocks m on m.id = a.mock_id"
                " where a.user_id = :u and a.status in ('submitted', 'auto_submitted')"
                " order by a.submitted_at desc nulls last limit 1"
            ),
            {"u": learner_id},
        )
    ).one_or_none()
    if r is None:
        return None
    return p.LastMock(
        attempt_id=r.id,
        mock_id=r.mock_id,
        title=_i18n(r.title),
        score=float(r.score) if r.score is not None else None,
        max_score=float(r.max_score) if r.max_score is not None else None,
        submitted_at=r.submitted_at,
    )


async def _pending_requests(
    session: AsyncSession, child: Child, now: datetime
) -> list[p.TimeRequestOut]:
    rows = (
        await session.execute(
            text(
                "select * from app.time_requests where learner_user_id = :l and status = 'pending'"
                " and for_date = :d order by created_at"
            ),
            {"l": child.user_id, "d": child.today(now)},
        )
    ).all()
    return [_request_out(r) for r in rows]


async def _consent_pending(session: AsyncSession, learner_id: uuid.UUID, now: datetime) -> bool:
    value = (
        await session.execute(
            text(
                "select exists (select 1 from app.guardian_consent_requests"
                " where learner_user_id = :l and status = 'pending' and expires_at > :now)"
            ),
            {"l": learner_id, "now": now},
        )
    ).scalar_one()
    return bool(value)


async def _pet(session: AsyncSession, learner_id: uuid.UUID) -> p.PetOut | None:
    r = (
        await session.execute(
            text("select name, species, state from game.pets where user_id = :u"),
            {"u": learner_id},
        )
    ).one_or_none()
    return p.PetOut(name=r.name, species=r.species, state=r.state) if r is not None else None


async def dashboard(db: Database, auth: AuthContext) -> p.Dashboard:
    now = datetime.now(UTC)
    out: list[p.ChildCard] = []
    async with db.system_tx() as session:
        for child in await linked_children(session, auth.user_id):
            start = week_start(child.today(now))
            days = await _week_minutes(session, child, start)
            requests = await _pending_requests(session, child, now)
            consent_pending = await _consent_pending(session, child.user_id, now)
            ent = await entitlement_state(session, child.user_id)
            out.append(
                p.ChildCard(
                    user_id=child.user_id,
                    first_name=child.first_name,
                    age_band=child.age_band,
                    kind="managed" if child.kind == "managed" else "consent",
                    pet=await _pet(session, child.user_id),
                    week_minutes=sum(int(d.minutes) for d in days),
                    streak=await _streak(session, child.user_id),
                    practice_questions=await _practice_count(session, child, start),
                    last_mock=await _last_mock(session, child.user_id),
                    is_pro=ent.plan == "pro",
                    needs_you=bool(requests) or consent_pending,
                    time_requests=requests,
                    consent_pending=consent_pending,
                )
            )
    return p.Dashboard(learners=out)


async def _subjects(session: AsyncSession, child: Child, start: date) -> list[p.SubjectWeek]:
    lo, hi = child.bounds(start, 7)
    rows = (
        await session.execute(
            text(
                """
                select s.id as subject_id, s.name as subject_name, s.color_token, s.sort,
                       t.id as topic_id, t.name as topic_name
                  from learn.topic_status ts
                  join content.topics t on t.id = ts.topic_id
                  join content.chapters ch on ch.id = t.chapter_id
                  join content.subjects s on s.id = ch.subject_id
                 where ts.user_id = :u and ts.status in ('in_progress', 'learned')
                   and ts.updated_at >= :lo and ts.updated_at < :hi
                 order by s.sort, ch.sort, t.sort
                """
            ),
            {"u": child.user_id, "lo": lo, "hi": hi},
        )
    ).all()
    subjects: dict[str, p.SubjectWeek] = {}
    for r in rows:
        sw = subjects.get(r.subject_id)
        if sw is None:
            sw = p.SubjectWeek(
                subject_id=r.subject_id,
                name=_i18n(r.subject_name) or {},
                color_token=r.color_token,
                topics=[],
            )
            subjects[r.subject_id] = sw
        sw.topics.append(_i18n(r.topic_name) or {})
    return list(subjects.values())


async def _mocks(session: AsyncSession, child: Child, start: date) -> list[p.MockScore]:
    lo, hi = child.bounds(start, 7)
    rows = (
        await session.execute(
            text(
                "select a.id, a.mock_id, a.score, a.max_score, a.percentile, a.submitted_at, m.title"
                " from learn.mock_attempts a left join content.mocks m on m.id = a.mock_id"
                " where a.user_id = :u and a.status in ('submitted', 'auto_submitted')"
                " and a.submitted_at >= :lo and a.submitted_at < :hi order by a.submitted_at"
            ),
            {"u": child.user_id, "lo": lo, "hi": hi},
        )
    ).all()
    return [
        p.MockScore(
            attempt_id=r.id,
            mock_id=r.mock_id,
            title=_i18n(r.title),
            score=float(r.score) if r.score is not None else None,
            max_score=float(r.max_score) if r.max_score is not None else None,
            percentile=float(r.percentile) if r.percentile is not None else None,
            submitted_at=r.submitted_at,
        )
        for r in rows
    ]


async def _coming_up(session: AsyncSession, child: Child, now: datetime) -> list[p.ComingUp]:
    """Live mocks the child registered for that haven't started yet."""
    rows = (
        await session.execute(
            text(
                "select m.id, m.title, m.window_start from learn.mock_registrations r"
                " join content.mocks m on m.id = r.mock_id"
                " where r.user_id = :u and m.window_start > :now"
                " and m.status in ('scheduled', 'open') order by m.window_start limit 5"
            ),
            {"u": child.user_id, "now": now},
        )
    ).all()
    return [
        p.ComingUp(kind="mock", mock_id=r.id, title=_i18n(r.title) or {}, starts_at=r.window_start)
        for r in rows
    ]


async def _report(session: AsyncSession, child: Child, start: date, now: datetime) -> p.WeekReport:
    rows = {r.day: r for r in await _week_minutes(session, child, start)}
    days = [
        p.DayMinutes(
            day=start + timedelta(days=i),
            minutes=int(rows[start + timedelta(days=i)].minutes)
            if start + timedelta(days=i) in rows
            else 0,
        )
        for i in range(7)
    ]
    return p.WeekReport(
        user_id=child.user_id,
        first_name=child.first_name,
        week_start=start,
        week_end=start + timedelta(days=6),
        days=days,
        minutes=sum(d.minutes for d in days),
        lessons=sum(int(r.lessons_completed) for r in rows.values()),
        reviews=sum(int(r.cards_reviewed) for r in rows.values()),
        practice_questions=await _practice_count(session, child, start),
        streak=await _streak(session, child.user_id),
        subjects=await _subjects(session, child, start),
        mocks=await _mocks(session, child, start),
        coming_up=await _coming_up(session, child, now),
    )


async def report(
    db: Database, auth: AuthContext, learner_id: uuid.UUID, week: date | None
) -> p.WeekReport:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        child = await child_for(session, auth.user_id, learner_id)
        start = week_start(week or child.today(now))
        return await _report(session, child, start, now)


# --- the parent friends list (B13) ---------------------------------------------------------------


async def friends(db: Database, auth: AuthContext, learner_id: uuid.UUID) -> list[p.ParentFriend]:
    async with db.system_tx() as session:
        child = await child_for(session, auth.user_id, learner_id)
        flags = await load_flags(session)
        rows = (
            await session.execute(
                text(
                    "select case when user_a = :u then user_b else user_a end as other, accepted_at"
                    " from social.friendships where status = 'accepted' and :u in (user_a, user_b)"
                    " order by accepted_at"
                ),
                {"u": child.user_id},
            )
        ).all()
        if not rows:
            return []
        viewer = await sp.load_member(session, child.user_id)
        # The parent sees each friend the way the child does, so no more than the child sees.
        shown = await sp.people(session, viewer, [r.other for r in rows], flags, ignore_block=True)
        return [
            p.ParentFriend(person=shown[r.other], since=r.accepted_at)
            for r in rows
            if r.other in shown
        ]


async def remove_friend(
    db: Database, auth: AuthContext, learner_id: uuid.UUID, friend_id: uuid.UUID
) -> None:
    """Like the child's own "Remove friend": silent, and it ends their Duo and open duels."""
    async with db.system_tx() as session:
        child = await child_for(session, auth.user_id, learner_id)
        lo, hi = sp.pair(child.user_id, friend_id)
        await session.execute(
            text(
                "delete from social.friendships where user_a = :a and user_b = :b"
                " and status in ('accepted', 'pending')"
            ),
            {"a": lo, "b": hi},
        )
        await end_pair(session, child.user_id, friend_id, child.user_id)
    log.info("parent_removed_friend", learner=hash_user_id(child.user_id))


# --- the weekly digest ---------------------------------------------------------------------------


async def send_weekly_digests(db: Database, *, now: datetime | None = None) -> int:
    """SET-15's Sunday message to every guardian whose "Weekly email report" switch is on, one per
    child per week (the dedupe key holds it to one). Held until 19:00 in the guardian's zone when
    the job runs earlier on Sunday."""
    now = now or datetime.now(UTC)
    sent = 0
    async with db.system_tx() as session:
        pairs = (
            await session.execute(
                text(
                    "select gl.guardian_user_id, gp.timezone as g_tz from app.guardian_links gl"
                    " join app.profiles gp on gp.user_id = gl.guardian_user_id"
                    " where gl.revoked_at is null and gl.weekly_report"
                    " group by gl.guardian_user_id, gp.timezone"
                )
            )
        ).all()
        for pair in pairs:
            g_now = now.astimezone(zone(pair.g_tz))
            not_before = None
            if g_now.weekday() == 6 and g_now.time() < DIGEST_AT:
                not_before = datetime.combine(g_now.date(), DIGEST_AT, g_now.tzinfo)
            for child in await linked_children(session, pair.guardian_user_id):
                if not await _weekly_report_on(session, pair.guardian_user_id, child.user_id):
                    continue
                start = week_start(child.today(now))
                days = await _week_minutes(session, child, start)
                added = await notify.enqueue(
                    session,
                    user_id=pair.guardian_user_id,
                    kind="parent_weekly_report",
                    payload={
                        "child": child.first_name or "",
                        "min": sum(int(d.minutes) for d in days),
                        "n": sum(int(d.lessons_completed) for d in days),
                        "learner_id": str(child.user_id),
                        "week": start.isoformat(),
                    },
                    dedupe_key=f"parent_weekly:{pair.guardian_user_id}:{child.user_id}:{start.isoformat()}",
                    not_before=not_before,
                )
                sent += int(added)
    log.info("parent_digests_enqueued", count=sent)
    return sent


async def digest_job(deps: JobDeps) -> int:
    return await send_weekly_digests(deps.db)
