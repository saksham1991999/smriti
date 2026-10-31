"""Accounts (auth flow §6.3, §6.4, §6.7, §6.8; TRD §6).

* ``finalise_link``: ``POST /v1/auth/linked``, once per account after a guest links Google/Apple.
* Merge: a guest (A) proves control with a short-lived intent; the existing account (B) then
  asks for the merge; ``merge_guest_job`` unions A into B, recomputes, and deletes A.
* Deletion: guests are erased at once; accounts get a grace period and the worker purges them.
"""

from __future__ import annotations

import json
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.core.logging import hash_user_id
from smriti_api.services import flags as flag_service
from smriti_api.services.errors import DomainError
from smriti_api.services.gamify import GameRules
from smriti_api.services.jobs import JobDeps
from smriti_api.services.recompute import (
    load_user_facts,
    recompute_activity_days,
    recompute_game,
    refresh_week_xp,
)
from smriti_api.services.sync import rebuild_card
from smriti_api.services.versioning import SECTIONS, bump, lock_state

log = structlog.get_logger(__name__)

MERGE_INTENT_TTL_S = 600
MINOR_BANDS = ("u10", "10_12", "13_17")
TOMBSTONE_NS = uuid.UUID("2f1b6c4e-8a77-4f0e-9a51-0c2b9f5d7e31")


# --- link -------------------------------------------------------------------------------------


def first_name(meta: dict[str, Any]) -> str | None:
    for key in ("given_name", "full_name", "name"):
        value = meta.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip().split()[0][:24]
    return None


async def _unique_handle(session: AsyncSession) -> str:
    for _ in range(10):
        handle = f"learner_{secrets.token_hex(4)}"
        taken = (
            await session.execute(
                text("select 1 from app.profiles where handle = :h"), {"h": handle}
            )
        ).first()
        if not taken:
            return handle
    raise ApiError(500, "handle_generation_failed", "Could not create a username")


async def finalise_link(
    db: Database, auth: AuthContext, referral_code: str | None
) -> dict[str, Any]:
    """Idempotent: fields already set are kept (auth flow §6.3)."""
    async with db.system_tx() as session:
        await lock_state(session, auth.user_id)
        p = (
            await session.execute(
                text(
                    "select signed_up_at, display_name, handle, age_band, guardian_consent_state, referred_by"
                    " from app.profiles where user_id = :u for update"
                ),
                {"u": auth.user_id},
            )
        ).one()
        flags = await flag_service.server_flags(session)
        updates: dict[str, Any] = {}
        if p.signed_up_at is None:
            updates["signed_up_at"] = datetime.now(UTC)
        name = first_name(auth.user_metadata)
        minor = p.age_band in MINOR_BANDS
        if p.display_name is None and name:
            updates["display_name"] = name  # minors: first name only, private (DPDP s.6(1))
        if not minor and p.handle is None:
            updates["handle"] = await _unique_handle(session)
            updates["discoverable"] = True
        if minor:
            words = flags.get("social.nickname_words")
            if isinstance(words, dict) and words.get("first") and words.get("second"):
                first = secrets.choice(list(words["first"]))
                second = secrets.choice(list(words["second"]))
                updates["nickname_word_ids"] = [
                    str(first.get("id", first)),
                    str(second.get("id", second)),
                ]
                updates["nickname_number"] = secrets.randbelow(99) + 1
        if referral_code and p.referred_by is None:
            referrer = (
                await session.execute(
                    text("select user_id from app.profiles where referral_code = :c"),
                    {"c": referral_code},
                )
            ).scalar_one_or_none()
            if referrer is not None and referrer != auth.user_id:
                updates["referred_by"] = referrer
        for key, value in updates.items():
            await session.execute(
                text(f"update app.profiles set {key} = :v where user_id = :u"),  # noqa: S608 - fixed column names
                {"v": value, "u": auth.user_id},
            )
        if updates:
            await bump(session, auth.user_id, {"profile"})
        gate = flags.get("auth.guardian_consent_gate", "features")
        consent_needed = (
            p.age_band == "13_17" and gate == "signin" and p.guardian_consent_state != "granted"
        )
    return {"consent_needed": consent_needed, "show_shared_phone_check": False}


# --- merge ------------------------------------------------------------------------------------


async def create_merge_intent(
    redis: Redis, auth: AuthContext, device_id: uuid.UUID | None, has_unsent_events: bool
) -> tuple[str, datetime]:
    if not auth.is_anonymous:
        raise ApiError(409, "not_a_guest", "Only a guest session can start a merge")
    token = secrets.token_urlsafe(32)
    expires = datetime.now(UTC) + timedelta(seconds=MERGE_INTENT_TTL_S)
    record = {
        "source_user_id": str(auth.user_id),
        "device_id": str(device_id) if device_id else None,
        "has_unsent_events": has_unsent_events,
        "is_anonymous": True,
    }
    await redis.set(f"merge_intent:{token}", json.dumps(record), ex=MERGE_INTENT_TTL_S)
    return token, expires


async def start_merge(
    db: Database,
    redis: Redis,
    auth: AuthContext,
    intent_token: str,
    include_progress: bool,
    convert_guardian: bool,
) -> uuid.UUID:
    raw = await redis.getdel(f"merge_intent:{intent_token}")
    if raw is None:
        raise ApiError(
            410, "merge_intent_invalid", "The merge link expired. Sign in again to retry."
        )
    intent = json.loads(raw)
    source = uuid.UUID(intent["source_user_id"])
    if source == auth.user_id:
        raise ApiError(409, "same_account", "This is already your account")
    async with db.system_tx() as session:
        target = (
            await session.execute(
                text(
                    "select account_kind, exists (select 1 from app.guardian_links g where g.guardian_user_id = :u"
                    " and g.revoked_at is null) as has_learners from app.profiles where user_id = :u"
                ),
                {"u": auth.user_id},
            )
        ).one()
        if target.account_kind == "managed":
            raise ApiError(409, "account_is_managed", "A child profile can't take a merge")
        if target.account_kind == "guardian" and target.has_learners:
            if not convert_guardian:
                # Give the intent back so AUTH-09 [It's me, I want to learn too] can retry.
                await redis.set(f"merge_intent:{intent_token}", raw, ex=MERGE_INTENT_TTL_S)
                raise ApiError(
                    409, "account_is_guardian", "This Google account belongs to a parent account"
                )
            await session.execute(
                text("update app.profiles set account_kind = 'learner' where user_id = :u"),
                {"u": auth.user_id},
            )
        source_exists = (
            await session.execute(
                text("select signed_up_at from app.profiles where user_id = :u"), {"u": source}
            )
        ).one_or_none()
        if source_exists is None:
            raise ApiError(
                410, "merge_source_missing", "The guest progress is no longer on the server"
            )
        merge_id = (
            await session.execute(
                text(
                    "insert into app.account_merges (source_user_id, target_user_id, status, include_progress)"
                    " values (:s, :t, 'queued', :inc) returning id"
                ),
                {"s": source, "t": auth.user_id, "inc": include_progress},
            )
        ).scalar_one()
    return uuid.UUID(str(merge_id))


async def get_merge(db: Database, user_id: uuid.UUID, merge_id: uuid.UUID) -> dict[str, Any]:
    async with db.system_tx() as session:
        row = (
            await session.execute(
                text(
                    "select id, status, include_progress, attempts, failure_code, stats, created_at, finished_at"
                    " from app.account_merges where id = :m and target_user_id = :u"
                ),
                {"m": merge_id, "u": user_id},
            )
        ).one_or_none()
    if row is None:
        raise ApiError(404, "merge_not_found", "Merge not found")
    return dict(row._mapping)


# Tables whose rows simply change owner (no user-scoped primary key to collide on).
_MOVE_USER_ID = [
    "learn.sync_events",
    "learn.srs_reviews",
    "learn.question_attempts",
    "learn.mock_attempts",
    "learn.practice_sessions",
    "learn.notes",
    "learn.mind_maps",
    "learn.palaces",
    "learn.bookmarks",
    "learn.user_mnemonics",
    "learn.content_reports",
    "game.xp_ledger",
    "game.gem_ledger",
    "game.streak_freezes",
    "game.plant_history",
    "ai.tutor_sessions",
    "ai.tutor_messages",
    "ai.generated_stories",
    "ai.feynman_scores",
    "ai.voice_sessions",
    "ai.generations",
    "app.devices",
    "app.exports",
]

_MERGE_UPSERTS = [
    # lesson position: the furthest progress wins
    """
    insert into learn.lesson_progress as l
      (user_id, topic_id, mode, bundle_hash, last_card_index, cards_seen, bites_completed, best_score, completed_at)
    select :b, topic_id, mode, bundle_hash, last_card_index, cards_seen, bites_completed, best_score, completed_at
      from learn.lesson_progress where user_id = :a
    on conflict (user_id, topic_id, mode) do update set
      last_card_index = greatest(l.last_card_index, excluded.last_card_index),
      cards_seen = greatest(l.cards_seen, excluded.cards_seen),
      bites_completed = array(select distinct unnest(l.bites_completed || excluded.bites_completed)),
      best_score = greatest(l.best_score, excluded.best_score),
      completed_at = least(l.completed_at, excluded.completed_at)
    """,
    # mastery: counts add up
    """
    insert into learn.concept_mastery as m
      (user_id, concept_id, mastery, attempts, correct, avg_time_ms, sure_total, sure_correct, fifty_total,
       fifty_correct, guess_total, guess_correct, self_confidence, last_practiced_at)
    select :b, concept_id, mastery, attempts, correct, avg_time_ms, sure_total, sure_correct, fifty_total,
           fifty_correct, guess_total, guess_correct, self_confidence, last_practiced_at
      from learn.concept_mastery where user_id = :a
    on conflict (user_id, concept_id) do update set
      attempts = m.attempts + excluded.attempts,
      correct = m.correct + excluded.correct,
      mastery = ((m.correct + excluded.correct + 1)::real / (m.attempts + excluded.attempts + 3)),
      sure_total = m.sure_total + excluded.sure_total, sure_correct = m.sure_correct + excluded.sure_correct,
      fifty_total = m.fifty_total + excluded.fifty_total, fifty_correct = m.fifty_correct + excluded.fifty_correct,
      guess_total = m.guess_total + excluded.guess_total, guess_correct = m.guess_correct + excluded.guess_correct,
      last_practiced_at = greatest(m.last_practiced_at, excluded.last_practiced_at)
    """,
    # topic status: learned wins
    """
    insert into learn.topic_status as t (user_id, topic_id, status, learned_via)
    select :b, topic_id, status, learned_via from learn.topic_status where user_id = :a
    on conflict (user_id, topic_id) do update set
      status = case when t.status = 'learned' or excluded.status = 'learned' then 'learned'
                    when t.status = 'in_progress' or excluded.status = 'in_progress' then 'in_progress'
                    else t.status end,
      learned_via = coalesce(case when t.status = 'learned' then t.learned_via end, excluded.learned_via, t.learned_via)
    """,
    # activity days: union of dates; protections carry over; counters are rebuilt from events
    """
    insert into learn.activity_days as d (user_id, day, rest_day, freeze_used, rescue_done)
    select :b, day, rest_day, freeze_used, rescue_done from learn.activity_days where user_id = :a
    on conflict (user_id, day) do update set
      rest_day = d.rest_day or excluded.rest_day,
      freeze_used = d.freeze_used or excluded.freeze_used,
      rescue_done = d.rescue_done or excluded.rescue_done
    """,
    # schedules for cards only the guest had (shared cards are replayed below)
    """
    insert into learn.srs_cards (user_id, card_ref, deck_id, state, due_at, stability, difficulty, reps, lapses,
                                 last_review_at, suspended, flags, buried_until)
    select :b, card_ref, deck_id, state, due_at, stability, difficulty, reps, lapses, last_review_at, suspended,
           flags, buried_until
      from learn.srs_cards where user_id = :a
    on conflict (user_id, card_ref) do nothing
    """,
    "insert into learn.emotion_tags (user_id, item_ref, emoji, feeling, note, created_at)"
    " select :b, item_ref, emoji, feeling, note, created_at from learn.emotion_tags where user_id = :a"
    " on conflict do nothing",
    """
    insert into learn.lab_progress as l (user_id, item_id, last_opened_at, tasks, readings, completed_at)
    select :b, item_id, last_opened_at, tasks, readings, completed_at from learn.lab_progress where user_id = :a
    on conflict (user_id, item_id) do update set
      last_opened_at = greatest(l.last_opened_at, excluded.last_opened_at),
      tasks = excluded.tasks || l.tasks, readings = excluded.readings || l.readings,
      completed_at = least(l.completed_at, excluded.completed_at)
    """,
    "insert into learn.daily_plans (user_id, day, items, done_items, generated_at)"
    " select :b, day, items, done_items, generated_at from learn.daily_plans where user_id = :a"
    " on conflict do nothing",
    "insert into learn.mock_registrations (mock_id, user_id, registered_at, reminded_at)"
    " select mock_id, :b, registered_at, reminded_at from learn.mock_registrations where user_id = :a"
    " on conflict do nothing",
    # exams: union, B's primary stays
    "insert into app.user_exams (user_id, exam_profile_id, target_date, is_primary, self_level, question_language)"
    " select :b, exam_profile_id, target_date, false, self_level, question_language from app.user_exams"
    " where user_id = :a on conflict do nothing",
    # inventory adds up, badges and album cards keep the earliest date
    """
    insert into game.inventory as i (user_id, item_id, qty, acquired_at)
    select :b, item_id, qty, acquired_at from game.inventory where user_id = :a
    on conflict (user_id, item_id) do update set qty = least(i.qty + excluded.qty, 32767)
    """,
    """
    insert into game.user_badges as ub (user_id, badge_id, earned_at)
    select :b, badge_id, earned_at from game.user_badges where user_id = :a
    on conflict (user_id, badge_id) do update set earned_at = least(ub.earned_at, excluded.earned_at)
    """,
    """
    insert into game.user_collection_items as c (user_id, collection_id, item_id, earned_at)
    select :b, collection_id, item_id, earned_at from game.user_collection_items where user_id = :a
    on conflict (user_id, collection_id, item_id) do update set earned_at = least(c.earned_at, excluded.earned_at)
    """,
    """
    insert into game.user_quests as q (user_id, quest_id, period_start, progress, target, completed_at, claimed_at)
    select :b, quest_id, period_start, progress, target, completed_at, claimed_at from game.user_quests where user_id = :a
    on conflict (user_id, quest_id, period_start) do update set
      progress = q.progress + excluded.progress,
      completed_at = least(q.completed_at, excluded.completed_at),
      claimed_at = coalesce(q.claimed_at, excluded.claimed_at)
    """,
    # today's AI usage adds up, so signing in never resets a daily quota
    """
    insert into ai.usage_daily as u (user_id, day, tier, requests, tokens_in, tokens_out, units, cost_micros)
    select :b, day, tier, requests, tokens_in, tokens_out, units, cost_micros from ai.usage_daily where user_id = :a
    on conflict (user_id, day, tier) do update set
      requests = u.requests + excluded.requests, tokens_in = u.tokens_in + excluded.tokens_in,
      tokens_out = u.tokens_out + excluded.tokens_out, units = u.units + excluded.units,
      cost_micros = u.cost_micros + excluded.cost_micros
    """,
    "insert into ai.message_feedback (message_id, user_id, rating, reasons, created_at)"
    " select message_id, :b, rating, reasons, created_at from ai.message_feedback where user_id = :a"
    " on conflict do nothing",
]


async def _scalar(session: AsyncSession, sql: str, **params: Any) -> Any:
    return (await session.execute(text(sql), params)).scalar_one_or_none()


async def merge_guest(
    deps: JobDeps, merge_id: uuid.UUID, now: datetime | None = None
) -> dict[str, Any]:
    """The merge_guest job (auth flow §6.4 server steps). Idempotent by ``merge_id``."""
    now = now or datetime.now(UTC)
    db = deps.db
    async with db.system_tx() as session:
        m = (
            await session.execute(
                text(
                    "update app.account_merges set status = 'running', attempts = attempts + 1"
                    " where id = :m and status in ('queued','running','failed')"
                    " returning source_user_id, target_user_id, include_progress"
                ),
                {"m": merge_id},
            )
        ).one_or_none()
    if m is None:
        return {"status": "skipped"}
    a, b = m.source_user_id, m.target_user_id
    try:
        stats = await _merge_data(db, a, b, bool(m.include_progress), now)
    except DomainError as exc:
        await _finish(db, merge_id, "failed", {}, exc.code)
        return {"status": "failed", "failure_code": exc.code}
    except Exception:
        # Leave A's data in place under A, mark the attempt failed, and let the queue retry.
        await _finish(db, merge_id, "failed", {}, "merge_error")
        raise
    await deps.auth_admin.delete_user(a)
    await deps.analytics.alias(a, b)
    await deps.analytics.emit(
        "account_merged",
        b,
        {"pet_kept": str(stats.get("pet_kept")), "days_added": int(stats.get("days_added", 0))},
    )
    await _finish(db, merge_id, "done", stats, None)
    log.info("merge_done", target=hash_user_id(b))
    return {"status": "done", "stats": stats}


async def _finish(
    db: Database, merge_id: uuid.UUID, status: str, stats: dict[str, Any], code: str | None
) -> None:
    async with db.system_tx() as session:
        await session.execute(
            text(
                "update app.account_merges set status = :s, stats = cast(:st as jsonb), failure_code = :c,"
                " finished_at = case when :s = 'done' then now() else finished_at end where id = :m"
            ),
            {"s": status, "st": json.dumps(stats), "c": code, "m": merge_id},
        )


async def _merge_data(
    db: Database, a: uuid.UUID, b: uuid.UUID, include: bool, now: datetime
) -> dict[str, Any]:
    async with db.system_tx() as session:
        await session.execute(
            text("select pg_advisory_xact_lock(hashtext(cast(:b as text)))"), {"b": str(b)}
        )
        await lock_state(session, b)
        a_profile = (
            await session.execute(
                text("select signed_up_at from app.profiles where user_id = :a"), {"a": a}
            )
        ).one_or_none()
        if a_profile is None:
            return {"note": "guest_already_merged"}
        if a_profile.signed_up_at is not None:
            raise DomainError("source_not_guest")
        b_profile = (
            await session.execute(
                text("select deletion_scheduled_for from app.profiles where user_id = :b"), {"b": b}
            )
        ).one_or_none()
        if b_profile is None or b_profile.deletion_scheduled_for is not None:
            raise DomainError("target_unavailable")
        streak_before_b = int(
            await _scalar(
                session, "select current_streak from game.user_stats where user_id = :u", u=b
            )
            or 0
        )
        streak_a = int(
            await _scalar(
                session, "select current_streak from game.user_stats where user_id = :u", u=a
            )
            or 0
        )
        if not include:
            return {
                "streak_before": streak_before_b,
                "streak_after": streak_before_b,
                "pet_kept": "account",
                "lessons_added": 0,
                "reviews_added": 0,
                "xp_added": 0,
                "days_added": 0,
                "items_moved": 0,
            }

        lessons_added = int(
            await _scalar(
                session,
                "select count(*) from learn.sync_events where user_id = :u"
                " and type in ('lesson_completed', 'activity_completed') and status = 'applied'",
                u=a,
            )
            or 0
        )
        reviews_added = int(
            await _scalar(session, "select count(*) from learn.srs_reviews where user_id = :u", u=a)
            or 0
        )
        xp_added = int(
            await _scalar(
                session,
                "select coalesce(sum(amount), 0) from game.xp_ledger where user_id = :u",
                u=a,
            )
            or 0
        )
        days_added = int(
            await _scalar(
                session,
                "select count(*) from learn.activity_days x where x.user_id = :a and x.qualified"
                " and not exists (select 1 from learn.activity_days y where y.user_id = :b and y.day = x.day and y.qualified)",
                a=a,
                b=b,
            )
            or 0
        )
        shared_refs = list(
            (
                await session.execute(
                    text(
                        "select card_ref from learn.srs_reviews where user_id = :a"
                        " intersect select card_ref from learn.srs_cards where user_id = :b"
                    ),
                    {"a": a, "b": b},
                )
            ).scalars()
        )
        a_refs = list(
            (
                await session.execute(
                    text("select card_ref from learn.srs_cards where user_id = :a"), {"a": a}
                )
            ).scalars()
        )

        for sql in _MERGE_UPSERTS:
            await session.execute(text(sql), {"a": a, "b": b})
        items_moved = 0
        for table in _MOVE_USER_ID:
            res = await session.execute(
                text(f"update {table} set user_id = :b where user_id = :a"),  # noqa: S608 - fixed table list
                {"a": a, "b": b},
            )
            items_moved += int(res.rowcount or 0)  # type: ignore[attr-defined]
        for table, col in (("learn.decks", "owner_user_id"), ("learn.cards", "owner_user_id")):
            res = await session.execute(
                text(f"update {table} set {col} = :b where {col} = :a"),  # noqa: S608 - fixed table list
                {"a": a, "b": b},
            )
            items_moved += int(res.rowcount or 0)  # type: ignore[attr-defined]
        # B keeps one primary exam; if B had none, the guest's primary becomes it.
        await session.execute(
            text(
                "update app.user_exams set is_primary = true where user_id = :b and exam_profile_id = ("
                " select exam_profile_id from app.user_exams where user_id = :a and is_primary)"
                " and not exists (select 1 from app.user_exams where user_id = :b and is_primary)"
            ),
            {"a": a, "b": b},
        )
        # Profile: B's fields win; the guest only fills B's empty fields.
        await session.execute(
            text(
                """
                update app.profiles pb set
                  age_band = coalesce(pb.age_band, pa.age_band), birth_ym = coalesce(pb.birth_ym, pa.birth_ym),
                  age_source = coalesce(pb.age_source, pa.age_source),
                  primary_exam_profile_id = coalesce(pb.primary_exam_profile_id, pa.primary_exam_profile_id),
                  onboarding_completed_at = coalesce(pb.onboarding_completed_at, pa.onboarding_completed_at),
                  first_variant = coalesce(pb.first_variant, pa.first_variant),
                  referred_by = coalesce(pb.referred_by, pa.referred_by),
                  settings = pa.settings || pb.settings
                  from app.profiles pa where pa.user_id = :a and pb.user_id = :b
                """
            ),
            {"a": a, "b": b},
        )
        # Pet: B keeps its buddy; with none, the guest's pet moves; outfits always move.
        b_pet = await _scalar(session, "select species from game.pets where user_id = :u", u=b)
        a_pet = await _scalar(session, "select species from game.pets where user_id = :u", u=a)
        pet_kept = "account"
        if a_pet is not None and b_pet is None:
            await session.execute(
                text(
                    "insert into game.pets (user_id, species, name, mood, energy, state, outfit_ids, room_theme, last_cared_at)"
                    " select :b, species, name, mood, energy, state, outfit_ids, room_theme, last_cared_at"
                    " from game.pets where user_id = :a"
                ),
                {"a": a, "b": b},
            )
            pet_kept = "guest"
        elif a_pet is not None:
            await session.execute(
                text(
                    "update game.pets pb set outfit_ids = array(select distinct unnest(pb.outfit_ids || pa.outfit_ids))"
                    " from game.pets pa where pa.user_id = :a and pb.user_id = :b"
                ),
                {"a": a, "b": b},
            )
            pet_kept = "both"
        # Plant: the higher growth is kept; health is recomputed from the union below.
        await session.execute(
            text(
                "update game.plants pb set growth_points = greatest(pb.growth_points, pa.growth_points)"
                " from game.plants pa where pa.user_id = :a and pb.user_id = :b"
            ),
            {"a": a, "b": b},
        )
        # Totals from the merged ledgers; the longer best streak is kept.
        await session.execute(
            text(
                """
                update game.user_stats sb set
                  xp_total = (select coalesce(sum(amount), 0) from game.xp_ledger where user_id = :b),
                  gems = greatest(0, (select coalesce(sum(delta), 0) from game.gem_ledger where user_id = :b)),
                  longest_streak = greatest(sb.longest_streak, sa.longest_streak)
                  from game.user_stats sa where sa.user_id = :a and sb.user_id = :b
                """
            ),
            {"a": a, "b": b},
        )
        for ref in set(shared_refs) | set(a_refs):
            await rebuild_card(session, b, ref)
        # Equip moved freezes into free slots (up to the cap); the rest stay in reserve.
        flags = await flag_service.server_flags(session)
        rules = GameRules.from_flags(flags)
        await session.execute(
            text(
                """
                with ranked as (
                  select id, row_number() over (order by equipped_at nulls last, granted_at) as n
                    from game.streak_freezes where user_id = :b and used_on is null
                )
                update game.streak_freezes f set equipped_at = case when r.n <= :slots then coalesce(f.equipped_at, now()) else null end
                  from ranked r where r.id = f.id
                """
            ),
            {"b": b, "slots": rules.freeze_slots},
        )
        facts = await load_user_facts(session, b)
        assert facts is not None
        days = set(
            (
                await session.execute(
                    text("select distinct local_day from learn.sync_events where user_id = :b"),
                    {"b": b},
                )
            ).scalars()
        )
        # Events re-keyed from A carry A's local_day; B's timezone decides from now on.
        await recompute_activity_days(session, facts, days, rules)
        state, _ = await recompute_game(session, facts, rules, flags, now=now)
        await refresh_week_xp(session, facts, now)
        if state.current_streak < max(streak_a, streak_before_b):
            log.warning("merge_streak_lower_than_inputs", target=hash_user_id(b))
        await session.execute(
            text("update learn.srs_cards set sync_version = 0 where user_id = :b"), {"b": b}
        )
        version = await bump(session, b, set(SECTIONS))
        await session.execute(
            text("update learn.srs_cards set sync_version = :v where user_id = :b"),
            {"b": b, "v": version},
        )
        await session.execute(
            text("update learn.topic_status set sync_version = :v where user_id = :b"),
            {"b": b, "v": version},
        )
        return {
            "lessons_added": lessons_added,
            "reviews_added": reviews_added,
            "xp_added": xp_added,
            "days_added": days_added,
            "streak_before": streak_before_b,
            "streak_after": state.current_streak,
            "pet_kept": pet_kept,
            "items_moved": items_moved,
        }


async def merge_guest_job(deps: JobDeps, merge_id: str) -> dict[str, Any]:
    return await merge_guest(deps, uuid.UUID(merge_id))


# --- deletion ---------------------------------------------------------------------------------


async def request_deletion(
    db: Database, deps: JobDeps, auth: AuthContext, grace_days: int
) -> datetime:
    """``POST /v1/account/deletion`` steps 1, 2 and 6 (auth flow §6.8). Idempotent."""
    async with db.system_tx() as session:
        current = await _scalar(
            session,
            "select deletion_scheduled_for from app.profiles where user_id = :u for update",
            u=auth.user_id,
        )
        if current is not None:
            return current  # type: ignore[no-any-return]
        when = datetime.now(UTC) + timedelta(days=grace_days)
        await session.execute(
            text(
                "update app.profiles set deletion_scheduled_for = :w, discoverable = false where user_id = :u"
            ),
            {"w": when, "u": auth.user_id},
        )
        await session.execute(
            text(
                "insert into app.data_requests (user_id, kind, status) values (:u, 'erasure', 'open')"
            ),
            {"u": auth.user_id},
        )
        await session.execute(
            text("delete from app.devices where user_id = :u"), {"u": auth.user_id}
        )
    await deps.auth_admin.sign_out_everywhere(auth.user_id, auth.token)
    await deps.analytics.emit(
        "account_delete_requested",
        auth.user_id,
        {"provider": str(auth.claims.get("app_metadata", {}).get("provider", "unknown"))},
    )
    return when


async def cancel_deletion(db: Database, user_id: uuid.UUID) -> bool:
    async with db.system_tx() as session:
        res = await session.execute(
            text(
                "update app.profiles set deletion_scheduled_for = null where user_id = :u"
                " and deletion_scheduled_for is not null"
            ),
            {"u": user_id},
        )
        await session.execute(
            text(
                "update app.data_requests set status = 'rejected', closed_at = now()"
                " where user_id = :u and kind = 'erasure' and status in ('open','in_progress')"
            ),
            {"u": user_id},
        )
        return bool(res.rowcount)  # type: ignore[attr-defined]


async def erase_guest(deps: JobDeps, auth: AuthContext) -> None:
    if not auth.is_anonymous:
        raise ApiError(409, "not_a_guest", "Signed-in accounts use POST /v1/account/deletion")
    await deps.auth_admin.delete_user(auth.user_id)
    await deps.analytics.emit("guest_erase_confirmed", auth.user_id, {})


def tombstone_id(user_id: uuid.UUID) -> uuid.UUID:
    return uuid.uuid5(TOMBSTONE_NS, str(user_id))


async def purge_deleted_accounts(
    deps: JobDeps, now: datetime | None = None, limit: int = 200
) -> int:
    """Erase accounts whose grace period ended (auth flow §6.8 "After 7 days")."""
    now = now or datetime.now(UTC)
    async with deps.db.system_tx() as session:
        due = list(
            (
                await session.execute(
                    text(
                        "select user_id from app.profiles where deletion_scheduled_for <= :now"
                        " order by deletion_scheduled_for limit :n"
                    ),
                    {"now": now, "n": limit},
                )
            ).scalars()
        )
    count = 0
    for user_id in due:
        async with deps.db.system_tx() as session:
            # Billing rows stay for tax with a tombstone id; intro claim keys stay without the user.
            await session.execute(
                text("update billing.subscriptions set user_id = :t where user_id = :u"),
                {"t": tombstone_id(user_id), "u": user_id},
            )
            await session.execute(
                text("update billing.payment_events set user_id = :t where user_id = :u"),
                {"t": tombstone_id(user_id), "u": user_id},
            )
            await session.execute(
                text("update billing.intro_claims set user_id = null where user_id = :u"),
                {"u": user_id},
            )
            await session.execute(
                text(
                    "update app.data_requests set status = 'done', closed_at = now()"
                    " where user_id = :u and kind = 'erasure' and status in ('open','in_progress')"
                ),
                {"u": user_id},
            )
        await deps.auth_admin.delete_user(user_id)
        await deps.analytics.emit("account_deleted", None, {})
        count += 1
    return count


async def purge_deleted_accounts_job(deps: JobDeps) -> int:
    return await purge_deleted_accounts(deps)
