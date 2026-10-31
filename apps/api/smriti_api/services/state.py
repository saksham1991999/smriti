"""``GET /v1/sync/state`` and ``GET /v1/me/summary``: the authoritative state the device copies.

Reads run as the student (RLS on). Before reading, ``ensure_rolled_up`` closes any local days
that ended since the last recompute, so the streak and plant are right even if the nightly
roll-up has not run yet for this timezone.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.schemas import sync as s
from smriti_api.services import flags as flag_service
from smriti_api.services import game_ops
from smriti_api.services.gamify import GameRules, stage_for
from smriti_api.services.recompute import (
    UserFacts,
    load_user_facts,
    recompute_game,
    refresh_week_xp,
    zone,
)
from smriti_api.services.versioning import bump, lock_state


async def ensure_rolled_up(db: Database, user_id: uuid.UUID, now: datetime | None = None) -> int:
    """Recompute once per local day (idempotent). Returns the current state_version."""
    now = now or datetime.now(UTC)
    async with db.system_tx() as session:
        row = (
            await session.execute(
                text(
                    "select st.updated_at, p.timezone, ss.version from game.user_stats st"
                    " join app.profiles p on p.user_id = st.user_id"
                    " left join app.sync_state ss on ss.user_id = st.user_id where st.user_id = :u"
                ),
                {"u": user_id},
            )
        ).one_or_none()
        if row is None:
            return 0
        tz = zone(row.timezone)
        if row.updated_at.astimezone(tz).date() >= now.astimezone(tz).date():
            return int(row.version or 0)
        return await rollup_user(session, user_id, now)


async def rollup_user(session: AsyncSession, user_id: uuid.UUID, now: datetime) -> int:
    """The nightly roll-up for one user (also used by the worker cron)."""
    await lock_state(session, user_id)
    facts = await load_user_facts(session, user_id)
    if facts is None:
        return 0
    flags = await flag_service.server_flags(session)
    rules = GameRules.from_flags(flags)
    _, changed = await recompute_game(session, facts, rules, flags, now=now)
    await refresh_week_xp(session, facts, now)
    # A new local day resets today's numbers, so these sections always change.
    return await bump(session, user_id, changed | {"streak", "wallet", "pet"})


async def profile_state(session: AsyncSession, auth: AuthContext) -> s.ProfileState:
    p = (
        await session.execute(
            text(
                "select display_name, locale, age_band, daily_goal_minutes, timezone, primary_exam_profile_id,"
                " settings, onboarding_completed_at from app.profiles where user_id = :u"
            ),
            {"u": auth.user_id},
        )
    ).one()
    exams = (
        (
            await session.execute(
                text(
                    "select exam_profile_id from app.user_exams where user_id = :u order by is_primary desc, created_at"
                ),
                {"u": auth.user_id},
            )
        )
        .scalars()
        .all()
    )
    return s.ProfileState(
        id=auth.user_id,
        display_name=p.display_name,
        locale=p.locale,
        is_guest=auth.is_anonymous,
        age_band=p.age_band,
        exam_profile_ids=list(exams),
        daily_goal_minutes=p.daily_goal_minutes,
        timezone=p.timezone,
        primary_exam_profile_id=p.primary_exam_profile_id,
        settings=dict(p.settings or {}),
        onboarding_completed=p.onboarding_completed_at is not None,
    )


async def streak_state(
    session: AsyncSession, facts: UserFacts, rules: GameRules, now: datetime
) -> s.StreakState:
    stats = (
        await session.execute(
            text("select current_streak, longest_streak from game.user_stats where user_id = :u"),
            {"u": facts.user_id},
        )
    ).one()
    today = facts.today(now)
    day = (
        await session.execute(
            text(
                "select qualified, rest_day from learn.activity_days where user_id = :u and day = :d"
            ),
            {"u": facts.user_id, "d": today},
        )
    ).one_or_none()
    freezes = (
        await session.execute(
            text(
                "select count(*) filter (where equipped_at is not null) as eq,"
                " count(*) filter (where equipped_at is null) as reserve"
                " from game.streak_freezes where user_id = :u and used_on is null"
            ),
            {"u": facts.user_id},
        )
    ).one()
    qualified = bool(day.qualified) if day else False
    rest_today = bool(day.rest_day) if day else False
    current = int(stats.current_streak)
    return s.StreakState(
        current=current,
        longest=int(stats.longest_streak),
        today_qualified=qualified,
        freezes_equipped=min(int(freezes.eq), rules.freeze_slots),
        freezes_available=int(freezes.reserve),
        rest_day=await game_ops.next_rest_day(session, facts, now),
        at_risk=current > 0 and not qualified and not rest_today and not rules.is_incident(today),
    )


async def plant_state(session: AsyncSession, user_id: uuid.UUID, rules: GameRules) -> s.PlantState:
    p = (
        await session.execute(
            text(
                "select species, growth_points, stage, health, revival_progress from game.plants where user_id = :u"
            ),
            {"u": user_id},
        )
    ).one()
    _, next_at = stage_for(int(p.growth_points), rules.stage_days)
    target = None if p.health == "thriving" else int(rules.revival_days.get(p.health, 1))
    return s.PlantState(
        stage=p.stage,
        health=p.health,
        study_days=int(p.growth_points),
        next_stage_at=next_at,
        revival_progress=int(p.revival_progress),
        revival_target=target,
        revival_days=target,
        species=p.species,
    )


async def pet_state(session: AsyncSession, user_id: uuid.UUID) -> s.PetState | None:
    p = (
        await session.execute(
            text("select species, name, mood, energy, state from game.pets where user_id = :u"),
            {"u": user_id},
        )
    ).one_or_none()
    if p is None:
        return None
    return s.PetState(species=p.species, name=p.name, mood=p.mood, energy=p.energy, state=p.state)


async def wallet_state(session: AsyncSession, facts: UserFacts, now: datetime) -> s.WalletState:
    stats = (
        await session.execute(
            text("select xp_total, gems from game.user_stats where user_id = :u"),
            {"u": facts.user_id},
        )
    ).one()
    xp_today = (
        await session.execute(
            text("select coalesce(xp, 0) from learn.activity_days where user_id = :u and day = :d"),
            {"u": facts.user_id, "d": facts.today(now)},
        )
    ).scalar_one_or_none()
    return s.WalletState(
        xp_total=int(stats.xp_total), xp_today=int(xp_today or 0), gems=int(stats.gems)
    )


async def entitlement_state(session: AsyncSession, user_id: uuid.UUID) -> s.EntitlementState:
    """Computed from subscriptions and promo grants at read time, so an expiry or the end of a
    grace period shows even before the next webhook or roll-up rewrites the stored row."""
    from smriti_api.services.billing import compute_entitlement

    ent = await compute_entitlement(session, user_id, datetime.now(UTC))
    return s.EntitlementState(
        plan="pro" if ent.active else "free",
        pro_until=(ent.grace_until or ent.expires_at) if ent.active else None,
        status=ent.status,
        grace_until=ent.grace_until,
        cancel_at_period_end=ent.cancel_at_period_end,
        is_intro=ent.is_intro,
        source=ent.source,
        managed_in=ent.managed_in,
    )


async def _srs(session: AsyncSession, user_id: uuid.UUID, since: int | None) -> s.SrsState:
    cards = (
        await session.execute(
            text(
                "select card_ref, due_at, stability, difficulty, state, reps, lapses, last_review_at"
                " from learn.srs_cards where user_id = :u and not suspended"
                " and (cast(:since as bigint) is null or sync_version > :since) order by card_ref"
            ),
            {"u": user_id, "since": since},
        )
    ).all()
    deleted = (
        (
            await session.execute(
                text(
                    "select card_ref from learn.srs_tombstones where user_id = :u"
                    " and (cast(:since as bigint) is not null and sync_version > :since) order by card_ref"
                ),
                {"u": user_id, "since": since},
            )
        )
        .scalars()
        .all()
    )
    return s.SrsState(
        cards=[
            s.SrsCardState(
                card_ref=c.card_ref,
                due=c.due_at,
                stability=c.stability,
                difficulty=c.difficulty,
                state=c.state,
                reps=c.reps,
                lapses=c.lapses,
                last_review=c.last_review_at,
            )
            for c in cards
        ],
        deleted=list(deleted),
    )


async def _topics(
    session: AsyncSession, user_id: uuid.UUID, since: int | None
) -> list[s.TopicProgressState]:
    rows = (
        await session.execute(
            text(
                """
                select t.topic_id, t.status,
                       coalesce(max(lp.cards_seen), 0) as seen,
                       coalesce(max(b.card_count), 0) as total
                  from learn.topic_status t
                  left join learn.lesson_progress lp on lp.user_id = t.user_id and lp.topic_id = t.topic_id
                  left join content.bundles b on b.topic_id = t.topic_id and b.mode = lp.mode
                 where t.user_id = :u and (cast(:since as bigint) is null or t.sync_version > :since)
                 group by t.topic_id, t.status
                 order by t.topic_id
                """
            ),
            {"u": user_id, "since": since},
        )
    ).all()
    out = []
    for r in rows:
        if r.status == "learned":
            percent = 100
        elif r.total:
            percent = min(99, int(100 * r.seen / r.total))
        else:
            percent = 0
        out.append(s.TopicProgressState(topic_id=r.topic_id, status=r.status, percent=percent))
    return out


async def build_state(db: Database, auth: AuthContext, since: int | None) -> s.SyncStateResponse:
    now = datetime.now(UTC)
    await ensure_rolled_up(db, auth.user_id, now)
    async with db.system_tx() as sys_session:
        rules = GameRules.from_flags(await flag_service.server_flags(sys_session))
    async with db.user_tx(auth.claims) as session:
        row = (
            await session.execute(
                text("select version, section_versions from app.sync_state where user_id = :u"),
                {"u": auth.user_id},
            )
        ).one_or_none()
        version = int(row.version) if row else 0
        versions: dict[str, Any] = dict(row.section_versions) if row else {}

        def want(section: str) -> bool:
            return since is None or int(versions.get(section, 0)) > since

        facts = await load_user_facts(session, auth.user_id)
        if facts is None:
            return s.SyncStateResponse(state_version=version)
        resp = s.SyncStateResponse(state_version=version)
        if want("profile"):
            resp.profile = await profile_state(session, auth)
        if want("streak"):
            resp.streak = await streak_state(session, facts, rules, now)
        if want("plant"):
            resp.plant = await plant_state(session, auth.user_id, rules)
        if want("pet"):
            resp.pet = await pet_state(session, auth.user_id)
        if want("wallet"):
            resp.wallet = await wallet_state(session, facts, now)
        if want("srs"):
            resp.srs = await _srs(session, auth.user_id, since)
        if want("topic_progress"):
            resp.topic_progress = await _topics(session, auth.user_id, since)
        if want("entitlement"):
            resp.entitlement = await entitlement_state(session, auth.user_id)
        return resp


async def build_summary(db: Database, auth: AuthContext) -> dict[str, Any]:
    now = datetime.now(UTC)
    await ensure_rolled_up(db, auth.user_id, now)
    async with db.system_tx() as sys_session:
        flags = await flag_service.server_flags(sys_session)
    rules = GameRules.from_flags(flags)
    async with db.user_tx(auth.claims) as session:
        facts = await load_user_facts(session, auth.user_id)
        if facts is None:
            return {}
        today = facts.today(now)
        day = (
            await session.execute(
                text(
                    "select minutes, lessons_completed, cards_reviewed, qualified, goal_met"
                    " from learn.activity_days where user_id = :u and day = :d"
                ),
                {"u": auth.user_id, "d": today},
            )
        ).one_or_none()
        version = (
            await session.execute(
                text("select version from app.sync_state where user_id = :u"), {"u": auth.user_id}
            )
        ).scalar_one_or_none()
        return {
            "state_version": int(version or 0),
            "today": {
                "date": today,
                "minutes": int(day.minutes) if day else 0,
                "goal_minutes": facts.daily_goal_minutes,
                "goal_met": bool(day.goal_met) if day else False,
                "lessons_completed": int(day.lessons_completed) if day else 0,
                "cards_reviewed": int(day.cards_reviewed) if day else 0,
                "reviews_to_qualify": rules.reviews_to_qualify,
                "qualified": bool(day.qualified) if day else False,
            },
            "streak": await streak_state(session, facts, rules, now),
            "plant": await plant_state(session, auth.user_id, rules),
            "pet": await pet_state(session, auth.user_id),
            "wallet": await wallet_state(session, facts, now),
            "entitlement": await entitlement_state(session, auth.user_id),
            "limits": {
                "tutor_messages_per_day": flags.get("free.tutor_messages_per_day"),
                "practice_questions_per_day": flags.get("free.practice_questions_per_day"),
                "sectional_mocks_per_week": flags.get("free.sectional_mocks_per_week"),
            },
        }


def today_for(tz_name: str, now: datetime | None = None) -> date:
    return (now or datetime.now(UTC)).astimezone(zone(tz_name)).date()
