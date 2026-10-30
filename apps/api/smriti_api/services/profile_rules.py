"""Profile rules shared by onboarding events and ``PATCH /v1/me`` (onboarding flow §8, R5, R6).

Age bands: under 10, 10-12, 13-17, 18 and over. A class is mapped to a band only when the
student gave no birth year (R5): class n is taken as about n + 5 years old, so classes 1-4 are
under 10, 5-7 are 10-12 and 8-12 are 13-17. This is an approximation for defaults only; the
birth year, when given, always wins.
"""

from __future__ import annotations

import re
from datetime import UTC, date, datetime, time
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.services.recompute import UserFacts

DAILY_GOAL_OPTIONS = (5, 10, 20, 30)
LEVELS = ("starting", "basics", "revising")
STRONG_AGE_SOURCES = ("birth_year", "guardian", "self_declared")


class ProfileValueError(ValueError):
    pass


def band_for_age(age: int) -> str:
    if age < 10:
        return "u10"
    if age < 13:
        return "10_12"
    if age < 18:
        return "13_17"
    return "18p"


def band_for_class(grade: int) -> str:
    if grade <= 4:
        return "u10"
    if grade <= 7:
        return "10_12"
    return "13_17"


def age_on(birth: date, today: date) -> int:
    years = today.year - birth.year
    if (today.month, today.day) < (birth.month, birth.day):
        years -= 1
    return years


def parse_birth(value: Any, today: date) -> date:
    year: Any
    month: Any = 1
    if isinstance(value, dict):
        year, month = value.get("year"), value.get("month", 1)
    else:
        year = value
    if not isinstance(year, int) or not isinstance(month, int) or not 1 <= month <= 12:
        raise ProfileValueError("birth_year must be a year or {year, month}")
    if not today.year - 100 <= year <= today.year:
        raise ProfileValueError("birth_year is out of range")
    return date(year, month, 1)


def parse_target_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, str):
        if re.fullmatch(r"\d{4}-\d{2}", value):
            return date.fromisoformat(f"{value}-01")
        try:
            return date.fromisoformat(value)
        except ValueError as exc:
            raise ProfileValueError("exam_date must be YYYY-MM or YYYY-MM-DD") from exc
    raise ProfileValueError("exam_date must be YYYY-MM or YYYY-MM-DD")


def parse_reminder(value: Any) -> time | None:
    if value is None:
        return None
    if isinstance(value, str) and re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", value):
        return time.fromisoformat(value)
    raise ProfileValueError("reminder must be HH:MM or null")


async def set_exams(
    session: AsyncSession, user_id: Any, exam_ids: list[str], primary: str | None
) -> None:
    exam_ids = list(dict.fromkeys(exam_ids))
    if exam_ids:
        known = set(
            (
                await session.execute(
                    text("select id from content.exam_profiles where id = any(:ids)"),
                    {"ids": exam_ids},
                )
            ).scalars()
        )
        unknown = [e for e in exam_ids if e not in known]
        if unknown:
            raise ProfileValueError("unknown exam profile")
    primary = primary if primary in exam_ids else (exam_ids[0] if exam_ids else None)
    await session.execute(
        text("delete from app.user_exams where user_id = :u and not (exam_profile_id = any(:ids))"),
        {"u": user_id, "ids": exam_ids},
    )
    await session.execute(
        text("update app.user_exams set is_primary = false where user_id = :u"), {"u": user_id}
    )
    for exam_id in exam_ids:
        await session.execute(
            text(
                "insert into app.user_exams (user_id, exam_profile_id, is_primary) values (:u, :e, :p)"
                " on conflict (user_id, exam_profile_id) do update set is_primary = excluded.is_primary"
            ),
            {"u": user_id, "e": exam_id, "p": exam_id == primary},
        )
    await session.execute(
        text("update app.profiles set primary_exam_profile_id = :p where user_id = :u"),
        {"u": user_id, "p": primary},
    )


async def apply_onboarding_answer(
    session: AsyncSession, facts: UserFacts, step: str, value: Any, now: datetime
) -> None:
    uid = facts.user_id
    today = facts.today(now)
    if step == "goal":
        if value in (None, "curious", "just_curious"):
            return
        ids = [value] if isinstance(value, str) else value
        if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
            raise ProfileValueError("goal must be an exam profile id or a list of them")
        await set_exams(session, uid, ids, ids[0] if ids else None)
    elif step == "class":
        if not isinstance(value, int) or not 1 <= value <= 12:
            raise ProfileValueError("class must be 1 to 12")
        await session.execute(
            text(
                "update app.profiles set age_band = :b, age_source = 'class'"
                " where user_id = :u and (age_source is null or not (age_source = any(:strong)))"
            ),
            {"u": uid, "b": band_for_class(value), "strong": list(STRONG_AGE_SOURCES)},
        )
    elif step == "birth_year":
        if value is None:
            await session.execute(
                text(
                    "update app.profiles set age_source = 'declined' where user_id = :u and age_source is null"
                ),
                {"u": uid},
            )
            return
        birth = parse_birth(value, today)
        await session.execute(
            text(
                "update app.profiles set birth_ym = :b, age_band = :band, age_source = 'birth_year' where user_id = :u"
            ),
            {"u": uid, "b": birth, "band": band_for_age(age_on(birth, today))},
        )
        facts.age_band = band_for_age(age_on(birth, today))
    elif step == "exam_date":
        await session.execute(
            text("update app.user_exams set target_date = :d where user_id = :u and is_primary"),
            {"u": uid, "d": parse_target_date(value)},
        )
    elif step == "level":
        if value not in LEVELS:
            raise ProfileValueError("level must be starting, basics or revising")
        await session.execute(
            text("update app.user_exams set self_level = :l where user_id = :u and is_primary"),
            {"u": uid, "l": value},
        )
    elif step == "daily_goal":
        if value not in DAILY_GOAL_OPTIONS:
            raise ProfileValueError("daily_goal must be 5, 10, 20 or 30")
        await session.execute(
            text("update app.profiles set daily_goal_minutes = :g where user_id = :u"),
            {"u": uid, "g": value},
        )
        facts.daily_goal_minutes = int(value)
    elif step == "reminder":
        at = parse_reminder(value)
        await session.execute(
            text(
                "update notify.prefs set daily_reminder_at = :t, reminder_enabled = :on where user_id = :u"
            ),
            {"u": uid, "t": at, "on": at is not None},
        )


def utcnow() -> datetime:
    return datetime.now(UTC)
