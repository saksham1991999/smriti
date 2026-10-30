"""Gamification writes shared by sync events and REST endpoints: freezes, rest days, quests,
the gem shop and pet care limits (me-money flow §3.3-3.7). Gems are never bought with money
(R36): the only way in is a reward, the only way out is the shop."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.services.errors import DomainError
from smriti_api.services.gamify import GameRules
from smriti_api.services.recompute import UserFacts, count_equipped, count_held, week_start

NAMESPACE = uuid.UUID("7d0c3f8e-0f4b-4c5e-9d5d-6b8f3a2e1c10")


def derived_event_id(*parts: object) -> uuid.UUID:
    """Deterministic ids for server-made ledger rows, so a retry never pays twice."""
    return uuid.uuid5(NAMESPACE, ":".join(str(p) for p in parts))


# --- freezes ----------------------------------------------------------------------------------


async def equip_freeze(
    session: AsyncSession, user_id: uuid.UUID, rules: GameRules, now: datetime
) -> None:
    if await count_equipped(session, user_id) >= rules.freeze_slots:
        raise DomainError("freeze_slots_full", "Both freeze slots are already full")
    row = (
        await session.execute(
            text(
                "select id from game.streak_freezes where user_id = :u and used_on is null"
                " and equipped_at is null order by granted_at limit 1 for update"
            ),
            {"u": user_id},
        )
    ).one_or_none()
    if row is None:
        raise DomainError("no_freeze_available", "There is no freeze to equip")
    await session.execute(
        text("update game.streak_freezes set equipped_at = :now where id = :id"),
        {"now": now, "id": row.id},
    )


# --- rest days --------------------------------------------------------------------------------


async def set_rest_day(
    session: AsyncSession, facts: UserFacts, day: date, flags: dict[str, Any], now: datetime
) -> None:
    today = facts.today(now)
    ahead = int(flags.get("streak.rest_day_plan_ahead_days", 30) or 30)
    if day < today or day > today + timedelta(days=ahead):
        raise DomainError(
            "rest_day_out_of_range", f"A rest day can be today or up to {ahead} days ahead", 422
        )
    per_week = int(
        flags.get("game.rest_days_per_week", flags.get("streak.rest_days_per_week", 1)) or 1
    )
    ws = week_start(day)
    taken = (
        await session.execute(
            text(
                "select count(*) from learn.activity_days where user_id = :u and rest_day"
                " and day >= :ws and day < :we and day <> :d"
            ),
            {"u": facts.user_id, "ws": ws, "we": ws + timedelta(days=7), "d": day},
        )
    ).scalar_one()
    if int(taken) >= per_week:
        raise DomainError("rest_day_limit", "This week already has its rest day")
    await session.execute(
        text(
            "insert into learn.activity_days (user_id, day, rest_day) values (:u, :d, true)"
            " on conflict (user_id, day) do update set rest_day = true"
        ),
        {"u": facts.user_id, "d": day},
    )


async def clear_rest_day(session: AsyncSession, facts: UserFacts, day: date, now: datetime) -> None:
    if day < facts.today(now):
        raise DomainError("rest_day_in_past", "Past rest days can't be changed", 422)
    await session.execute(
        text("update learn.activity_days set rest_day = false where user_id = :u and day = :d"),
        {"u": facts.user_id, "d": day},
    )


async def next_rest_day(session: AsyncSession, facts: UserFacts, now: datetime) -> date | None:
    value = (
        await session.execute(
            text(
                "select min(day) from learn.activity_days where user_id = :u and rest_day and day >= :t"
            ),
            {"u": facts.user_id, "t": facts.today(now)},
        )
    ).scalar_one()
    return value if isinstance(value, date) else None


# --- gems -------------------------------------------------------------------------------------


async def add_gems(
    session: AsyncSession, user_id: uuid.UUID, delta: int, reason: str, ref: str | None
) -> int:
    """Write a gem ledger row and update the cached balance. Balance never goes below 0."""
    row = (
        await session.execute(
            text(
                "update game.user_stats set gems = gems + :d where user_id = :u and gems + :d >= 0"
                " returning gems"
            ),
            {"u": user_id, "d": delta},
        )
    ).one_or_none()
    if row is None:
        raise DomainError("not_enough_gems", "Not enough gems")
    await session.execute(
        text("insert into game.gem_ledger (user_id, delta, reason, ref) values (:u, :d, :r, :ref)"),
        {"u": user_id, "d": delta, "r": reason, "ref": ref},
    )
    return int(row.gems)


async def add_xp(
    session: AsyncSession,
    user_id: uuid.UUID,
    event_id: uuid.UUID,
    amount: int,
    source: str,
    ref: str | None,
    occurred_at: datetime,
    hourly_cap: int | None = None,
) -> int:
    """Credit XP once per event id (DB_SCHEMA §6 `xp_ledger`). Returns the amount credited."""
    if amount <= 0:
        return 0
    if hourly_cap:
        hour = occurred_at.astimezone(UTC).replace(minute=0, second=0, microsecond=0)
        used = (
            await session.execute(
                text(
                    "select coalesce(sum(amount), 0) from game.xp_ledger where user_id = :u"
                    " and occurred_at >= :h and occurred_at < :h2"
                ),
                {"u": user_id, "h": hour, "h2": hour + timedelta(hours=1)},
            )
        ).scalar_one()
        amount = min(amount, hourly_cap - int(used))
        if amount <= 0:
            return 0
    inserted = (
        await session.execute(
            text(
                "insert into game.xp_ledger (event_id, user_id, amount, source, ref, occurred_at)"
                " values (:e, :u, :a, :s, :r, :t) on conflict do nothing returning amount"
            ),
            {"e": event_id, "u": user_id, "a": amount, "s": source, "r": ref, "t": occurred_at},
        )
    ).one_or_none()
    if inserted is None:
        return 0
    await session.execute(
        text("update game.user_stats set xp_total = xp_total + :a where user_id = :u"),
        {"u": user_id, "a": int(inserted.amount)},
    )
    return int(inserted.amount)


# --- shop -------------------------------------------------------------------------------------


async def purchase(
    session: AsyncSession,
    facts: UserFacts,
    item_id: str,
    rules: GameRules,
    flags: dict[str, Any],
    now: datetime,
) -> int:
    item = (
        await session.execute(
            text(
                "select id, kind, price_gems, pro_only, active from game.shop_items where id = :i"
            ),
            {"i": item_id},
        )
    ).one_or_none()
    if item is None or not item.active:
        raise DomainError("item_not_found", "That item isn't in the shop", 404)
    if item.pro_only and not facts.is_pro:
        raise DomainError("pro_required", "This item needs Pro", 403)
    if item.kind == "freeze":
        if await count_equipped(session, facts.user_id) >= rules.freeze_slots:
            raise DomainError("freeze_slots_full", "Both freeze slots are already full")
    economy = flags.get("game.economy")
    treat_max = int(economy.get("treat_max_held", 10)) if isinstance(economy, dict) else 10
    if item.kind == "treat":
        held = (
            await session.execute(
                text(
                    "select coalesce(sum(qty), 0) from game.inventory where user_id = :u and item_id = :i"
                ),
                {"u": facts.user_id, "i": item_id},
            )
        ).scalar_one()
        if int(held) >= treat_max:
            raise DomainError("inventory_full", f"You can hold up to {treat_max}")
    balance = await add_gems(
        session, facts.user_id, -int(item.price_gems), "shop_purchase", item_id
    )
    if item.kind == "freeze":
        await session.execute(
            text(
                "insert into game.streak_freezes (user_id, source, granted_at, equipped_at)"
                " values (:u, 'shop', :now, :now)"
            ),
            {"u": facts.user_id, "now": now},
        )
        await session.execute(
            text("update game.user_stats set freezes_available = :h where user_id = :u"),
            {"u": facts.user_id, "h": await count_held(session, facts.user_id)},
        )
    else:
        await session.execute(
            text(
                "insert into game.inventory (user_id, item_id, qty) values (:u, :i, 1)"
                " on conflict (user_id, item_id) do update set qty = game.inventory.qty + 1"
            ),
            {"u": facts.user_id, "i": item_id},
        )
    return balance


# --- quests -----------------------------------------------------------------------------------

QUEST_COUNTERS = {
    "lessons_completed": "lessons_completed",
    "cards_reviewed": "cards_reviewed",
    "minutes": "minutes",
    "xp": "xp",
    "study_days": "case when qualified then 1 else 0 end",
    "focus_sessions": "focus_sessions",
}


def quest_period(period: str, active_from: date, today: date) -> tuple[date, date]:
    if period == "daily":
        return today, today
    if period == "weekly":
        ws = week_start(today)
        return ws, ws + timedelta(days=6)
    return active_from, today


async def quest_progress(
    session: AsyncSession, user_id: uuid.UUID, spec: dict[str, Any], start: date, end: date
) -> int:
    counter = QUEST_COUNTERS.get(str(spec.get("counter")))
    if counter is None:
        return 0
    value = (
        await session.execute(
            text(
                f"select coalesce(sum({counter}), 0) from learn.activity_days"  # noqa: S608 - counter is a whitelisted column expression
                " where user_id = :u and day between :s and :e"
            ),
            {"u": user_id, "s": start, "e": end},
        )
    ).scalar_one()
    return int(value)


async def claim_quest(
    session: AsyncSession, facts: UserFacts, quest_id: str, now: datetime, xp_cap: int | None = None
) -> dict[str, int]:
    quest = (
        await session.execute(
            text(
                "select id, period, spec, reward, active_from, active_to from game.quests where id = :q"
            ),
            {"q": quest_id},
        )
    ).one_or_none()
    today = facts.today(now)
    if (
        quest is None
        or quest.active_from > today
        or (quest.active_to is not None and quest.active_to < today)
    ):
        raise DomainError("quest_not_found", "That quest isn't active", 404)
    start, end = quest_period(quest.period, quest.active_from, today)
    spec = dict(quest.spec)
    target = int(spec.get("target", 1))
    progress = await quest_progress(session, facts.user_id, spec, start, end)
    if progress < target:
        raise DomainError("quest_not_complete", "This quest isn't finished yet")
    row = (
        await session.execute(
            text(
                """
                insert into game.user_quests as q (user_id, quest_id, period_start, progress, target, completed_at, claimed_at)
                values (:u, :q, :p, :prog, :t, :now, :now)
                on conflict (user_id, quest_id, period_start) do update
                   set progress = excluded.progress, claimed_at = :now,
                       completed_at = coalesce(q.completed_at, :now)
                 where q.claimed_at is null
             returning claimed_at
                """
            ),
            {
                "u": facts.user_id,
                "q": quest_id,
                "p": start,
                "prog": progress,
                "t": target,
                "now": now,
            },
        )
    ).one_or_none()
    if row is None:
        raise DomainError("already_claimed", "This reward was already claimed")
    reward = dict(quest.reward)
    gems = int(reward.get("gems", 0) or 0)
    xp = int(reward.get("xp", 0) or 0)
    if gems:
        await add_gems(session, facts.user_id, gems, "quest", f"{quest_id}:{start.isoformat()}")
    credited = 0
    if xp:
        credited = await add_xp(
            session,
            facts.user_id,
            derived_event_id("quest", facts.user_id, quest_id, start),
            xp,
            "quest",
            quest_id,
            now,
            xp_cap,
        )
    return {"gems": gems, "xp": credited}
