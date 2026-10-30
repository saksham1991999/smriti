"""Gamification endpoints (TRD §5.1 "Gamification"; me-money flow §3).

Mutations that also exist as sync events (pet care, freeze equip, quest claim) go through the
same ``apply_batch`` path with a server-made event, so the online and offline paths can't
drift. The rest (rest days, the shop) lock the user's sync state, write, recompute and bump.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import text

from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.core.pagination import Page, clamp_limit, decode_cursor, page_from_rows
from smriti_api.schemas import api as a
from smriti_api.schemas import sync as s
from smriti_api.services import flags as flag_service
from smriti_api.services import game_ops
from smriti_api.services.errors import DomainError
from smriti_api.services.gamify import GameRules
from smriti_api.services.recompute import load_user_facts, recompute_game
from smriti_api.services.state import ensure_rolled_up, pet_state, plant_state, streak_state
from smriti_api.services.sync import apply_batch
from smriti_api.services.versioning import bump, lock_state


def event_id_for(user_id: uuid.UUID, scope: str, key: str | None) -> uuid.UUID:
    """With an Idempotency-Key the event id is derived from it, so a retry is the same event."""
    if key is None:
        return uuid.uuid4()
    return game_ops.derived_event_id("api", user_id, scope, key)


async def apply_one(
    db: Database,
    auth: AuthContext,
    *,
    event_type: str,
    payload: dict[str, Any],
    event_id: uuid.UUID,
    device_id: uuid.UUID | None,
    app_variant: str | None,
) -> int:
    now = datetime.now(UTC)
    result = await apply_batch(
        db,
        user_id=auth.user_id,
        device_id=device_id,
        events=[
            s.SyncEventIn(event_id=event_id, type=event_type, occurred_at=now, payload=payload)
        ],
        app_variant=app_variant,
        now=now,
    )
    if result.rejected:
        r = result.rejected[0]
        status = 404 if r.code.endswith("_not_found") else 409
        raise ApiError(status, r.code, r.detail or "Not possible right now")
    return result.state_version


async def _rules(db: Database) -> tuple[GameRules, dict[str, Any]]:
    async with db.system_tx() as session:
        flags = await flag_service.server_flags(session)
    return GameRules.from_flags(flags), flags


async def get_pet(db: Database, auth: AuthContext) -> a.PetResponse:
    await ensure_rolled_up(db, auth.user_id)
    async with db.user_tx(auth.claims) as session:
        facts = await load_user_facts(session, auth.user_id)
        if facts is None:
            raise ApiError(401, "session_ended", "This account no longer exists")
        pet = await pet_state(session, auth.user_id)
        extra = (
            await session.execute(
                text("select outfit_ids, room_theme from game.pets where user_id = :u"),
                {"u": auth.user_id},
            )
        ).one_or_none()
        care = (
            await session.execute(
                text(
                    "select payload ->> 'action' as action, count(*) as n from learn.sync_events"
                    " where user_id = :u and type = 'pet_care' and status = 'applied' and local_day = :d"
                    " group by 1"
                ),
                {"u": auth.user_id, "d": facts.today()},
            )
        ).all()
        treats = (
            await session.execute(
                text(
                    "select coalesce(sum(i.qty), 0) from game.inventory i join game.shop_items si on si.id = i.item_id"
                    " where i.user_id = :u and si.kind = 'treat'"
                ),
                {"u": auth.user_id},
            )
        ).scalar_one()
    return a.PetResponse(
        pet=pet,
        outfit_ids=list(extra.outfit_ids) if extra else [],
        room_theme=extra.room_theme if extra else None,
        care_today={str(r.action): int(r.n) for r in care},
        treats_held=int(treats),
    )


async def get_plant(db: Database, auth: AuthContext) -> s.PlantState:
    await ensure_rolled_up(db, auth.user_id)
    rules, _ = await _rules(db)
    async with db.user_tx(auth.claims) as session:
        return await plant_state(session, auth.user_id, rules)


async def get_streak(db: Database, auth: AuthContext) -> s.StreakState:
    rules, _ = await _rules(db)
    async with db.user_tx(auth.claims) as session:
        facts = await load_user_facts(session, auth.user_id)
        if facts is None:
            raise ApiError(401, "session_ended", "This account no longer exists")
        return await streak_state(session, facts, rules, datetime.now(UTC))


async def change_rest_day(db: Database, auth: AuthContext, day: date, *, on: bool) -> int:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        await lock_state(session, auth.user_id)
        facts = await load_user_facts(session, auth.user_id)
        if facts is None:
            raise ApiError(401, "session_ended", "This account no longer exists")
        flags = await flag_service.server_flags(session)
        rules = GameRules.from_flags(flags)
        try:
            if on:
                await game_ops.set_rest_day(session, facts, day, flags, now)
            else:
                await game_ops.clear_rest_day(session, facts, day, now)
        except DomainError as exc:
            raise exc.to_api() from exc
        _, changed = await recompute_game(session, facts, rules, flags, now=now)
        return await bump(session, auth.user_id, changed | {"streak"})


async def get_shop(db: Database, auth: AuthContext) -> a.ShopResponse:
    async with db.user_tx(auth.claims) as session:
        items = (
            await session.execute(
                text(
                    "select si.id, si.kind, si.price_gems, si.pro_only, coalesce(i.qty, 0) as owned"
                    " from game.shop_items si left join game.inventory i on i.item_id = si.id and i.user_id = :u"
                    " where si.active order by si.kind, si.price_gems, si.id"
                ),
                {"u": auth.user_id},
            )
        ).all()
        gems = (
            await session.execute(
                text("select gems from game.user_stats where user_id = :u"), {"u": auth.user_id}
            )
        ).scalar_one()
        held_freezes = (
            await session.execute(
                text(
                    "select count(*) from game.streak_freezes where user_id = :u and used_on is null"
                ),
                {"u": auth.user_id},
            )
        ).scalar_one()
    return a.ShopResponse(
        gems=int(gems),
        items=[
            a.ShopItemOut(
                id=i.id,
                kind=i.kind,
                price_gems=i.price_gems,
                pro_only=i.pro_only,
                owned=int(held_freezes) if i.kind == "freeze" else int(i.owned),
            )
            for i in items
        ],
    )


async def purchase(db: Database, auth: AuthContext, item_id: str) -> a.PurchaseResponse:
    """Spend gems in the shop. Gems are never bought with money (R36)."""
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        await lock_state(session, auth.user_id)
        facts = await load_user_facts(session, auth.user_id)
        if facts is None:
            raise ApiError(401, "session_ended", "This account no longer exists")
        flags = await flag_service.server_flags(session)
        rules = GameRules.from_flags(flags)
        try:
            balance = await game_ops.purchase(session, facts, item_id, rules, flags, now)
        except DomainError as exc:
            raise exc.to_api() from exc
        version = await bump(session, auth.user_id, {"wallet", "streak", "pet"})
    return a.PurchaseResponse(item_id=item_id, gems=balance, state_version=version)


async def gem_ledger(
    db: Database, auth: AuthContext, cursor: str | None, limit: int | None
) -> Page[a.GemLedgerEntry]:
    n = clamp_limit(limit)
    after = decode_cursor(cursor)
    at: datetime | None = None
    after_id: uuid.UUID | None = None
    if after:
        try:
            at = datetime.fromisoformat(str(after["at"]))
            after_id = uuid.UUID(str(after["id"]))
        except (KeyError, ValueError) as exc:
            raise ApiError(400, "invalid_cursor", "The cursor is not valid") from exc
    async with db.user_tx(auth.claims) as session:
        rows = (
            await session.execute(
                text(
                    "select id, delta, reason, ref, created_at from game.gem_ledger where user_id = :u"
                    " and (cast(:at as timestamptz) is null or (created_at, id) < (cast(:at as timestamptz), cast(:id as uuid)))"
                    " order by created_at desc, id desc limit :n"
                ),
                {
                    "u": auth.user_id,
                    "at": at,
                    "id": after_id,
                    "n": n + 1,
                },
            )
        ).all()
    entries = [
        a.GemLedgerEntry(
            id=r.id, delta=r.delta, reason=r.reason, ref=r.ref, created_at=r.created_at
        )
        for r in rows
    ]
    return page_from_rows(entries, n, lambda e: {"at": e.created_at.isoformat(), "id": str(e.id)})


async def list_quests(db: Database, auth: AuthContext) -> list[a.QuestOut]:
    async with db.user_tx(auth.claims) as session:
        facts = await load_user_facts(session, auth.user_id)
        if facts is None:
            raise ApiError(401, "session_ended", "This account no longer exists")
        today = facts.today()
        quests = (
            await session.execute(
                text(
                    "select id, period, spec, reward, active_from from game.quests"
                    " where active_from <= :t and (active_to is null or active_to >= :t) order by period, id"
                ),
                {"t": today},
            )
        ).all()
        out: list[a.QuestOut] = []
        for q in quests:
            start, end = game_ops.quest_period(q.period, q.active_from, today)
            spec = dict(q.spec)
            target = int(spec.get("target", 1))
            progress = await game_ops.quest_progress(session, auth.user_id, spec, start, end)
            claimed = (
                await session.execute(
                    text(
                        "select claimed_at from game.user_quests where user_id = :u and quest_id = :q"
                        " and period_start = :p"
                    ),
                    {"u": auth.user_id, "q": q.id, "p": start},
                )
            ).scalar_one_or_none()
            out.append(
                a.QuestOut(
                    id=q.id,
                    period=q.period,
                    counter=str(spec.get("counter")) if spec.get("counter") else None,
                    target=target,
                    progress=min(progress, target),
                    reward={
                        k: int(v) for k, v in dict(q.reward).items() if isinstance(v, int | float)
                    },
                    period_start=start,
                    period_end=end,
                    completed=progress >= target,
                    claimed=claimed is not None,
                )
            )
    return out


async def list_badges(db: Database, auth: AuthContext) -> list[a.BadgeOut]:
    async with db.user_tx(auth.claims) as session:
        rows = (
            await session.execute(
                text(
                    "select b.id, b.name, b.description, b.tier, ub.earned_at from game.badges b"
                    " left join game.user_badges ub on ub.badge_id = b.id and ub.user_id = :u"
                    " order by b.tier, b.id"
                ),
                {"u": auth.user_id},
            )
        ).all()
    return [
        a.BadgeOut(
            id=r.id,
            name=dict(r.name),
            description=dict(r.description),
            tier=r.tier,
            earned_at=r.earned_at,
        )
        for r in rows
    ]


async def last_claim_paid(db: Database, auth: AuthContext, quest_id: str) -> tuple[int, int]:
    """What the latest claim of a quest paid out, read back from the gem and XP ledgers."""
    async with db.user_tx(auth.claims) as session:
        start = (
            await session.execute(
                text(
                    "select period_start from game.user_quests where user_id = :u and quest_id = :q"
                    " and claimed_at is not null order by period_start desc limit 1"
                ),
                {"u": auth.user_id, "q": quest_id},
            )
        ).scalar_one_or_none()
        if start is None:
            return 0, 0
        gems = (
            await session.execute(
                text(
                    "select coalesce(sum(delta), 0) from game.gem_ledger"
                    " where user_id = :u and reason = 'quest' and ref = :r"
                ),
                {"u": auth.user_id, "r": f"{quest_id}:{start.isoformat()}"},
            )
        ).scalar_one()
        xp = (
            await session.execute(
                text(
                    "select coalesce(sum(amount), 0) from game.xp_ledger where user_id = :u and event_id = :e"
                ),
                {
                    "u": auth.user_id,
                    "e": game_ops.derived_event_id("quest", auth.user_id, quest_id, start),
                },
            )
        ).scalar_one()
    return int(gems), int(xp)
