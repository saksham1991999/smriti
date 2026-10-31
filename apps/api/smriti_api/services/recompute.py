"""Server recompute of activity days, freezes, streak, plant and pet (TRD §10, DB_SCHEMA §6
"Who writes what"). Runs inside a service-role transaction; every statement filters by user.

Both the sync handler and the nightly roll-up call ``recompute_game``. It is idempotent: it
rebuilds the derived values from ``learn.activity_days``, the equipped freezes and the
applied ``pet_care`` events, then writes them back.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.services.gamify import (
    DayRecord,
    GameRules,
    GameState,
    cap_care,
    compute_game_state,
    is_qualified,
)

DEFAULT_TZ = "Asia/Kolkata"


def zone(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or DEFAULT_TZ)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(DEFAULT_TZ)


def local_day(at: datetime, tz: ZoneInfo) -> date:
    return at.astimezone(tz).date()


def day_bounds(day: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=tz)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=tz)
    return start.astimezone(UTC), end.astimezone(UTC)


def week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


@dataclass
class UserFacts:
    user_id: uuid.UUID
    tz: ZoneInfo
    tz_name: str
    age_band: str | None
    daily_goal_minutes: int
    is_pro: bool
    first_variant: str | None
    deletion_scheduled_for: datetime | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def under10(self) -> bool:
        return self.age_band == "u10"

    def today(self, now: datetime | None = None) -> date:
        return local_day(now or datetime.now(UTC), self.tz)


async def load_user_facts(session: AsyncSession, user_id: uuid.UUID) -> UserFacts | None:
    row = (
        await session.execute(
            text(
                """
                select p.timezone, p.age_band, p.daily_goal_minutes, p.first_variant,
                       p.deletion_scheduled_for,
                       exists (
                         select 1 from billing.entitlements e
                          where e.user_id = p.user_id and e.entitlement = 'pro' and e.active
                            and (e.expires_at is null or e.expires_at > now()
                                 or coalesce(e.grace_until, now()) > now())
                       ) as is_pro
                  from app.profiles p
                 where p.user_id = :u
                """
            ),
            {"u": user_id},
        )
    ).one_or_none()
    if row is None:
        return None
    return UserFacts(
        user_id=user_id,
        tz=zone(row.timezone),
        tz_name=row.timezone,
        age_band=row.age_band,
        daily_goal_minutes=row.daily_goal_minutes,
        is_pro=bool(row.is_pro),
        first_variant=row.first_variant,
        deletion_scheduled_for=row.deletion_scheduled_for,
    )


_AGG_SQL = text(
    """
    select
      -- A little learner's story, song or play counts as a lesson (sync v1.4).
      count(*) filter (where type in ('lesson_completed', 'activity_completed')) as lessons,
      count(*) filter (where type = 'review_rated')              as reviews,
      count(*) filter (where type = 'mock_section_submitted')    as mocks,
      bool_or(type = 'daily_challenge_completed')                as challenge,
      count(*) filter (where type = 'focus_session_completed')   as focus,
      bool_or(type = 'rescue_completed')                         as rescue,
      coalesce(sum(case type
        when 'lesson_completed' then (payload ->> 'ms_total')::bigint
        when 'activity_completed' then (payload ->> 'ms_total')::bigint
        when 'practice_session_completed' then (payload ->> 'ms_total')::bigint
        when 'daily_challenge_completed' then (payload ->> 'ms_total')::bigint
        when 'review_rated' then (payload ->> 'ms_to_answer')::bigint
        else 0 end), 0)                                          as ms,
      min(occurred_at) as first_at,
      max(occurred_at) as last_at
    from learn.sync_events
    where user_id = :u and local_day = :d and status = 'applied'
    """
)


async def recompute_activity_days(
    session: AsyncSession, facts: UserFacts, days: set[date], rules: GameRules
) -> None:
    """Rebuild the counters of each given day from the applied events (and XP from the ledger).
    The rest-day, freeze and rescue flags on the row are kept."""
    for day in sorted(days):
        agg = (await session.execute(_AGG_SQL, {"u": facts.user_id, "d": day})).one()
        start, end = day_bounds(day, facts.tz)
        xp = (
            await session.execute(
                text(
                    "select coalesce(sum(amount), 0) from game.xp_ledger"
                    " where user_id = :u and occurred_at >= :s and occurred_at < :e"
                ),
                {"u": facts.user_id, "s": start, "e": end},
            )
        ).scalar_one()
        lessons = int(agg.lessons)
        reviews = int(agg.reviews)
        mocks = int(agg.mocks)
        challenge = bool(agg.challenge)
        minutes = min(1440, int(agg.ms) // 60000)
        if agg.first_at is None and int(xp) == 0:
            continue
        qualified = is_qualified(
            lessons_completed=lessons,
            cards_reviewed=reviews,
            mock_sections=mocks,
            daily_challenge=challenge,
            reviews_to_qualify=rules.reviews_to_qualify,
        )
        await session.execute(
            text(
                """
                insert into learn.activity_days as a
                  (user_id, day, xp, minutes, focus_sessions, cards_reviewed, lessons_completed,
                   mock_sections, daily_challenge, qualified, goal_met, first_event_at, last_event_at,
                   rescue_done)
                values (:u, :d, :xp, :min, :focus, :reviews, :lessons, :mocks, :challenge, :q, :goal,
                        :first_at, :last_at, :rescue)
                on conflict (user_id, day) do update set
                  xp = excluded.xp, minutes = excluded.minutes, focus_sessions = excluded.focus_sessions,
                  cards_reviewed = excluded.cards_reviewed, lessons_completed = excluded.lessons_completed,
                  mock_sections = excluded.mock_sections, daily_challenge = excluded.daily_challenge,
                  qualified = excluded.qualified, goal_met = excluded.goal_met,
                  first_event_at = excluded.first_event_at, last_event_at = excluded.last_event_at,
                  rescue_done = a.rescue_done or excluded.rescue_done
                """
            ),
            {
                "u": facts.user_id,
                "d": day,
                "xp": int(xp),
                "min": minutes,
                "focus": min(int(agg.focus), 32767),
                "reviews": min(reviews, 32767),
                "lessons": min(lessons, 32767),
                "mocks": min(mocks, 32767),
                "challenge": challenge,
                "q": qualified,
                "goal": minutes >= facts.daily_goal_minutes,
                "first_at": agg.first_at,
                "last_at": agg.last_at,
                "rescue": bool(agg.rescue),
            },
        )


async def ensure_monthly_freezes(
    session: AsyncSession, facts: UserFacts, rules: GameRules, flags: dict[str, Any], now: datetime
) -> None:
    """Grant this month's freezes lazily (R36: free 1, Pro 2). New grants fill empty slots."""
    today = facts.today(now)
    month_start_local = datetime.combine(today.replace(day=1), time.min, tzinfo=facts.tz)
    granted = (
        await session.execute(
            text(
                "select count(*) from game.streak_freezes where user_id = :u"
                " and source in ('monthly','pro_monthly') and granted_at >= :m"
            ),
            {"u": facts.user_id, "m": month_start_local.astimezone(UTC)},
        )
    ).scalar_one()
    monthly = flags.get("streak.monthly_freezes")
    monthly = monthly if isinstance(monthly, dict) else {}
    free_n = int(monthly.get("free", 1) or 0)
    pro_n = int(monthly.get("pro", 2) or 0)
    target = pro_n if facts.is_pro else free_n
    missing = target - int(granted)
    if missing <= 0:
        return
    equipped = await count_equipped(session, facts.user_id)
    for _ in range(missing):
        equip = equipped < rules.freeze_slots
        await session.execute(
            text(
                "insert into game.streak_freezes (user_id, source, granted_at, equipped_at)"
                " values (:u, :s, :now, :eq)"
            ),
            {
                "u": facts.user_id,
                "s": "pro_monthly" if facts.is_pro else "monthly",
                "now": now,
                "eq": now if equip else None,
            },
        )
        equipped += 1 if equip else 0


async def count_equipped(session: AsyncSession, user_id: uuid.UUID) -> int:
    return int(
        (
            await session.execute(
                text(
                    "select count(*) from game.streak_freezes"
                    " where user_id = :u and used_on is null and equipped_at is not null"
                ),
                {"u": user_id},
            )
        ).scalar_one()
    )


async def count_held(session: AsyncSession, user_id: uuid.UUID) -> int:
    return int(
        (
            await session.execute(
                text(
                    "select count(*) from game.streak_freezes where user_id = :u and used_on is null"
                ),
                {"u": user_id},
            )
        ).scalar_one()
    )


@dataclass(frozen=True)
class Snapshot:
    streak: tuple[Any, ...]
    plant: tuple[Any, ...]
    pet: tuple[Any, ...]


async def _snapshot(session: AsyncSession, user_id: uuid.UUID) -> Snapshot:
    stats = (
        await session.execute(
            text(
                "select current_streak, longest_streak, streak_last_day, freezes_available"
                " from game.user_stats where user_id = :u"
            ),
            {"u": user_id},
        )
    ).one_or_none()
    plant = (
        await session.execute(
            text(
                "select growth_points, stage, health, revival_progress from game.plants where user_id = :u"
            ),
            {"u": user_id},
        )
    ).one_or_none()
    pet = (
        await session.execute(
            text("select mood, energy, state, species, name from game.pets where user_id = :u"),
            {"u": user_id},
        )
    ).one_or_none()
    return Snapshot(
        streak=tuple(stats) if stats else (),
        plant=tuple(plant) if plant else (),
        pet=tuple(pet) if pet else (),
    )


async def recompute_game(
    session: AsyncSession,
    facts: UserFacts,
    rules: GameRules,
    flags: dict[str, Any],
    *,
    now: datetime | None = None,
) -> tuple[GameState, set[str]]:
    """Recompute streak, freezes, plant and pet; returns the state and the changed sections."""
    now = now or datetime.now(UTC)
    today = facts.today(now)
    before = await _snapshot(session, facts.user_id)
    await ensure_monthly_freezes(session, facts, rules, flags, now)
    if rules.exam_day_protected:
        # The exam date set in onboarding or ME-03 pauses the streak (me-money §3.5).
        exam_days = (
            (
                await session.execute(
                    text(
                        "select target_date from app.user_exams"
                        " where user_id = :u and target_date is not null"
                    ),
                    {"u": facts.user_id},
                )
            )
            .scalars()
            .all()
        )
        if exam_days:
            rules = replace(rules, exam_days=frozenset(exam_days))

    rows = (
        await session.execute(
            text(
                "select day, qualified, rescue_done, rest_day, freeze_used"
                " from learn.activity_days where user_id = :u and day <= :t"
            ),
            {"u": facts.user_id, "t": today},
        )
    ).all()
    days = {
        r.day: DayRecord(
            qualified=r.qualified,
            rescue_done=r.rescue_done,
            rest_day=r.rest_day,
            freeze_used=r.freeze_used,
        )
        for r in rows
    }
    care_rows = (
        await session.execute(
            text(
                "select local_day, payload ->> 'action' as action from learn.sync_events"
                " where user_id = :u and type = 'pet_care' and status = 'applied' and local_day <= :t"
                " order by occurred_at, event_id"
            ),
            {"u": facts.user_id, "t": today},
        )
    ).all()
    care_actions: dict[date, list[str]] = defaultdict(list)
    for r in care_rows:
        care_actions[r.local_day].append(str(r.action))
    care = {d: cap_care(actions, rules) for d, actions in care_actions.items()}
    has_pet = bool(before.pet)
    stats = (
        await session.execute(
            text("select longest_streak from game.user_stats where user_id = :u"),
            {"u": facts.user_id},
        )
    ).one()
    plant = (
        await session.execute(
            text("select growth_points from game.plants where user_id = :u"), {"u": facts.user_id}
        )
    ).one()

    state = compute_game_state(
        days,
        today,
        rules,
        freezes_equipped=await count_equipped(session, facts.user_id),
        care=care if has_pet else {},
        under10=facts.under10,
        previous_longest=int(stats.longest_streak),
        previous_growth=int(plant.growth_points),
    )

    for day in state.freezes_refunded:
        await session.execute(
            text(
                "update learn.activity_days set freeze_used = false where user_id = :u and day = :d"
            ),
            {"u": facts.user_id, "d": day},
        )
        await session.execute(
            text(
                "update game.streak_freezes set used_on = null where id = ("
                " select id from game.streak_freezes where user_id = :u and used_on = :d limit 1)"
            ),
            {"u": facts.user_id, "d": day},
        )
    for day in state.freezes_consumed:
        await session.execute(
            text(
                "insert into learn.activity_days (user_id, day, freeze_used) values (:u, :d, true)"
                " on conflict (user_id, day) do update set freeze_used = true"
            ),
            {"u": facts.user_id, "d": day},
        )
        await session.execute(
            text(
                "update game.streak_freezes set used_on = :d where id = ("
                " select id from game.streak_freezes where user_id = :u and used_on is null"
                " and equipped_at is not null order by equipped_at, granted_at limit 1)"
            ),
            {"u": facts.user_id, "d": day},
        )

    held = await count_held(session, facts.user_id)
    await session.execute(
        text(
            """
            update game.user_stats set current_streak = :cur, longest_streak = :longest,
                   streak_last_day = :last, freezes_available = :held
             where user_id = :u
            """
        ),
        {
            "u": facts.user_id,
            "cur": state.current_streak,
            "longest": state.longest_streak,
            "last": state.streak_last_day,
            "held": min(held, 32767),
        },
    )
    await session.execute(
        text(
            """
            update game.plants set growth_points = :gp, stage = :stage, health = :health,
                   revival_progress = :rev, last_watered_day = :watered
             where user_id = :u
            """
        ),
        {
            "u": facts.user_id,
            "gp": state.growth_points,
            "stage": state.stage,
            "health": state.health,
            "rev": state.revival_progress,
            "watered": state.last_watered_day,
        },
    )
    if has_pet:
        await session.execute(
            text(
                "update game.pets set mood = :mood, energy = :energy, state = :state,"
                " last_decay_day = :today where user_id = :u"
            ),
            {
                "u": facts.user_id,
                "mood": state.pet_mood,
                "energy": state.pet_energy,
                "state": state.pet_state,
                "today": today,
            },
        )

    after = await _snapshot(session, facts.user_id)
    changed: set[str] = set()
    if after.streak != before.streak:
        changed.add("streak")
    if after.plant != before.plant:
        changed.add("plant")
    if after.pet != before.pet:
        changed.add("pet")
    return state, changed


async def refresh_week_xp(
    session: AsyncSession, facts: UserFacts, now: datetime | None = None
) -> None:
    today = facts.today(now)
    ws = week_start(today)
    start = datetime.combine(ws, time.min, tzinfo=facts.tz).astimezone(UTC)
    await session.execute(
        text(
            """
            update game.user_stats set week_start = :ws,
                   xp_week = (select coalesce(sum(amount), 0) from game.xp_ledger
                               where user_id = :u and occurred_at >= :start)
             where user_id = :u
            """
        ),
        {"u": facts.user_id, "ws": ws, "start": start},
    )
