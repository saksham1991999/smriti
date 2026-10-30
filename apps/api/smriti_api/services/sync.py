"""``POST /v1/sync/events`` (docs/contracts/sync.md).

One batch is one service-role transaction, serialised per user by a row lock on
``app.sync_state``. Each new event is validated, applied inside a savepoint (a bad event is
rejected without touching the rest), and recorded in ``learn.sync_events`` under its
``event_id``, which makes a repeated event a no-op. After the batch the server rebuilds the
affected activity days and recomputes streak, freezes, plant and pet, then bumps
``state_version`` for the sections that changed.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import structlog
from pydantic import BaseModel, ValidationError
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.db import Database
from smriti_api.core.logging import hash_user_id
from smriti_api.schemas import sync as s
from smriti_api.services import flags as flag_service
from smriti_api.services import game_ops, profile_rules
from smriti_api.services.badges import award_badges
from smriti_api.services.errors import DomainError
from smriti_api.services.gamify import GameRules
from smriti_api.services.recompute import (
    UserFacts,
    load_user_facts,
    recompute_activity_days,
    recompute_game,
    refresh_week_xp,
    zone,
)
from smriti_api.services.srs import ReviewInput, make_scheduler, replay
from smriti_api.services.versioning import bump, lock_state
from smriti_api.services.xp import XpRules, xp_for_event

log = structlog.get_logger(__name__)

MAX_FUTURE = timedelta(minutes=10)
MAX_AGE = timedelta(days=400)
CONFIDENCE_DB = {"sure": "sure", "fifty_fifty": "fifty", "guess": "guess"}
ANSWER_CONTEXT_DB = {
    "lesson": "lesson",
    "practice": "practice",
    "review": "practice",
    "challenge": "daily",
    "chapter_test": "chapter_test",
    "mock": "mock",
}
SECTIONS_BY_TYPE: dict[str, set[str]] = {
    "lesson_started": {"topic_progress"},
    "lesson_card_viewed": {"topic_progress"},
    "lesson_completed": {"topic_progress", "wallet"},
    "review_rated": {"srs", "wallet"},
    "practice_session_completed": {"wallet"},
    "daily_challenge_completed": {"wallet"},
    "mock_section_submitted": {"wallet"},
    "pet_care": {"pet"},
    "pet_named": {"pet"},
    "plant_seeded": {"plant"},
    "onboarding_answer": {"profile"},
    "settings_changed": {"profile"},
    "deck_card_upserted": set(),
    "deck_card_deleted": {"srs"},
    "focus_session_completed": set(),
    "quest_claimed": {"wallet"},
    "freeze_equipped": {"streak"},
    "rescue_completed": {"plant"},
    "cards_queued": {"srs"},
    "comeback_plan_started": set(),
}


class EventRejected(Exception):
    def __init__(self, code: str, detail: str | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.detail = detail


@dataclass
class BatchContext:
    session: AsyncSession
    facts: UserFacts
    flags: dict[str, Any]
    rules: GameRules
    xp_rules: XpRules
    now: datetime
    days: set[date] = field(default_factory=set)
    sections: set[str] = field(default_factory=set)
    srs_changed: set[str] = field(default_factory=set)
    srs_deleted: set[str] = field(default_factory=set)
    topics_changed: set[str] = field(default_factory=set)


@dataclass
class BatchResult:
    accepted: list[uuid.UUID]
    rejected: list[s.RejectedEvent]
    state_version: int
    sections: set[str]


def _validation_detail(exc: ValidationError) -> str:
    # Field locations and error types only: never the submitted values.
    parts = [
        f"{'.'.join(str(p) for p in e['loc']) or 'payload'}: {e['type']}" for e in exc.errors()[:5]
    ]
    return "; ".join(parts)


async def apply_batch(
    db: Database,
    *,
    user_id: uuid.UUID,
    device_id: uuid.UUID | None,
    events: list[s.SyncEventIn],
    app_variant: str | None = None,
    now: datetime | None = None,
) -> BatchResult:
    now = now or datetime.now(UTC)
    async with db.system_tx() as session:
        await lock_state(session, user_id)
        facts = await load_user_facts(session, user_id)
        if facts is None:
            raise DomainError("user_not_found", "The account no longer exists", 401)
        flags = await flag_service.server_flags(session)
        ctx = BatchContext(
            session=session,
            facts=facts,
            flags=flags,
            rules=GameRules.from_flags(flags),
            xp_rules=XpRules.from_flags(flags),
            now=now,
        )
        await _first_sync(ctx, events, app_variant)

        ids = [e.event_id for e in events]
        existing = {
            r.event_id: r
            for r in (
                await session.execute(
                    text(
                        "select event_id, user_id, status, reject_code from learn.sync_events"
                        " where event_id = any(:ids)"
                    ),
                    {"ids": ids},
                )
            ).all()
        }
        accepted: list[uuid.UUID] = []
        rejected: list[s.RejectedEvent] = []
        seen: set[uuid.UUID] = set()
        applied_any = False

        for event in events:
            prior = existing.get(event.event_id)
            if prior is not None or event.event_id in seen:
                if prior is not None and prior.user_id != user_id:
                    rejected.append(
                        s.RejectedEvent(event_id=event.event_id, code="duplicate_event_id")
                    )
                elif prior is not None and prior.status == "rejected":
                    rejected.append(
                        s.RejectedEvent(
                            event_id=event.event_id, code=prior.reject_code or "rejected"
                        )
                    )
                else:
                    accepted.append(event.event_id)
                continue
            seen.add(event.event_id)
            # Until the zone is checked, a rejected event is filed under the profile's day.
            day = event.occurred_at.astimezone(facts.tz).date()
            code: str | None = None
            detail: str | None = None
            try:
                day = event_local_day(event)
                payload = _validate(event, now)
                async with session.begin_nested():
                    await _apply(ctx, event, payload, day)
            except EventRejected as exc:
                code, detail = exc.code, exc.detail
            except DomainError as exc:
                code, detail = exc.code, exc.detail
            except (IntegrityError, DBAPIError) as exc:
                log.warning(
                    "sync_event_apply_failed", type=event.type, error_type=type(exc).__name__
                )
                code, detail = "apply_failed", "The event could not be applied"
            await session.execute(
                text(
                    """
                    insert into learn.sync_events
                      (event_id, user_id, device_id, type, occurred_at, tz, local_day, payload, status, reject_code)
                    values (:e, :u, :dev, :t, :at, :tz, :day, cast(:p as jsonb), :st, :code)
                    """
                ),
                {
                    "e": event.event_id,
                    "u": user_id,
                    "dev": device_id,
                    "t": event.type[:64],
                    "at": event.occurred_at,
                    "tz": event.tz,
                    "day": day,
                    "p": json.dumps(event.payload if code is None else {}, default=str),
                    "st": "applied" if code is None else "rejected",
                    "code": code,
                },
            )
            if code is None:
                accepted.append(event.event_id)
                applied_any = True
                ctx.days.add(day)
                ctx.sections |= SECTIONS_BY_TYPE.get(event.type, set())
            else:
                rejected.append(s.RejectedEvent(event_id=event.event_id, code=code, detail=detail))

        if applied_any:
            await recompute_activity_days(session, facts, ctx.days, ctx.rules)
            _, changed = await recompute_game(session, facts, ctx.rules, flags, now=now)
            ctx.sections |= changed
            if ctx.days:
                ctx.sections.add("streak")
                await refresh_week_xp(session, facts, now)
            await award_badges(session, user_id)
        version = await bump(session, user_id, ctx.sections)
        if ctx.srs_changed:
            await session.execute(
                text(
                    "update learn.srs_cards set sync_version = :v where user_id = :u and card_ref = any(:refs)"
                ),
                {"v": version, "u": user_id, "refs": sorted(ctx.srs_changed)},
            )
        for ref in sorted(ctx.srs_deleted):
            await session.execute(
                text(
                    "insert into learn.srs_tombstones (user_id, card_ref, sync_version) values (:u, :r, :v)"
                    " on conflict (user_id, card_ref) do update set sync_version = :v, deleted_at = now()"
                ),
                {"u": user_id, "r": ref, "v": version},
            )
        if ctx.topics_changed:
            await session.execute(
                text(
                    "update learn.topic_status set sync_version = :v where user_id = :u and topic_id = any(:t)"
                ),
                {"v": version, "u": user_id, "t": sorted(ctx.topics_changed)},
            )
        await session.execute(
            text(
                "update learn.sync_events set state_version = :v where event_id = any(:ids) and user_id = :u"
            ),
            {"v": version, "ids": list(seen), "u": user_id},
        )
    log.info(
        "sync_batch",
        user=hash_user_id(user_id),
        events=len(events),
        accepted=len(accepted),
        rejected=len(rejected),
        state_version=version,
    )
    return BatchResult(
        accepted=accepted, rejected=rejected, state_version=version, sections=ctx.sections
    )


async def _first_sync(
    ctx: BatchContext, events: list[s.SyncEventIn], app_variant: str | None
) -> None:
    """The first sync records the app variant and adopts the device timezone (onboarding §8)."""
    if ctx.facts.first_variant is not None:
        return
    tz_name = next((e.tz for e in events if e.tz and zone(e.tz).key == e.tz), None)
    await ctx.session.execute(
        text(
            "update app.profiles set first_variant = :v,"
            " timezone = coalesce(cast(:tz as text), timezone) where user_id = :u"
        ),
        {"v": (app_variant or "unknown")[:32], "tz": tz_name, "u": ctx.facts.user_id},
    )
    ctx.facts.first_variant = app_variant or "unknown"
    if tz_name:
        ctx.facts.tz = zone(tz_name)
        ctx.facts.tz_name = tz_name
    ctx.sections.add("profile")


def event_zone(name: str) -> ZoneInfo:
    """The event's own IANA zone (sync contract v1.1: ``tz`` is required on every event)."""
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise EventRejected("invalid_tz", "tz is not an IANA time zone") from exc


def event_local_day(event: s.SyncEventIn) -> date:
    """The student's local day for this event, from the zone the device reported (R1, R23)."""
    return event.occurred_at.astimezone(event_zone(event.tz)).date()


def _validate(event: s.SyncEventIn, now: datetime) -> BaseModel:
    model = s.PAYLOAD_MODELS.get(event.type)
    if model is None:
        raise EventRejected("unknown_type", f"Unknown event type {event.type[:64]}")
    if event.occurred_at > now + MAX_FUTURE:
        raise EventRejected("clock_skew", "occurred_at is in the future")
    if event.occurred_at < now - MAX_AGE:
        raise EventRejected("too_old", "occurred_at is too far in the past")
    try:
        return model.model_validate(event.payload)
    except ValidationError as exc:
        raise EventRejected("invalid_payload", _validation_detail(exc)) from exc


async def _apply(ctx: BatchContext, event: s.SyncEventIn, payload: BaseModel, day: date) -> None:
    handler = _HANDLERS[event.type]
    await handler(ctx, event, payload)
    award = xp_for_event(event.type, payload.model_dump(), ctx.xp_rules)
    if award is not None:
        amount, source = award
        ref = getattr(payload, "topic_id", None) or getattr(payload, "card_ref", None)
        await game_ops.add_xp(
            ctx.session,
            ctx.facts.user_id,
            event.event_id,
            amount,
            source,
            str(ref) if ref else None,
            event.occurred_at,
            ctx.xp_rules.hourly_cap,
        )


# --- handlers ---------------------------------------------------------------------------------


def _progress_mode(mode: str) -> str | None:
    if mode in ("deep_dive", "quick_revision"):
        return mode
    if mode == "onboarding":
        return "deep_dive"
    return None  # quick_check: a check, not a lesson position


async def _topic_status(ctx: BatchContext, topic_id: str, status: str, via: str | None) -> None:
    await ctx.session.execute(
        text(
            """
            insert into learn.topic_status as t (user_id, topic_id, status, learned_via)
            values (:u, :t, :s, :via)
            on conflict (user_id, topic_id) do update set
              status = case when t.status = 'learned' then t.status else excluded.status end,
              learned_via = case when t.status = 'learned' then t.learned_via else excluded.learned_via end
            """
        ),
        {"u": ctx.facts.user_id, "t": topic_id, "s": status, "via": via},
    )
    ctx.topics_changed.add(topic_id)


async def _lesson_started(ctx: BatchContext, event: s.SyncEventIn, p: BaseModel) -> None:
    assert isinstance(p, s.LessonStarted)
    mode = _progress_mode(p.mode)
    if mode is not None:
        await ctx.session.execute(
            text(
                """
                insert into learn.lesson_progress (user_id, topic_id, mode, bundle_hash)
                values (:u, :t, :m, :h)
                on conflict (user_id, topic_id, mode) do update set bundle_hash = excluded.bundle_hash
                """
            ),
            {"u": ctx.facts.user_id, "t": p.topic_id, "m": mode, "h": p.bundle_version},
        )
    await _topic_status(ctx, p.topic_id, "in_progress", None)


async def _lesson_card_viewed(ctx: BatchContext, event: s.SyncEventIn, p: BaseModel) -> None:
    assert isinstance(p, s.LessonCardViewed)
    updated = (
        await ctx.session.execute(
            text(
                """
                update learn.lesson_progress
                   set last_card_index = greatest(last_card_index, :i),
                       cards_seen = greatest(cards_seen, least(:i + 1, 32767))
                 where user_id = :u and topic_id = :t
                """
            ),
            {"u": ctx.facts.user_id, "t": p.topic_id, "i": p.index},
        )
    ).rowcount  # type: ignore[attr-defined]
    if not updated:
        await ctx.session.execute(
            text(
                "insert into learn.lesson_progress (user_id, topic_id, mode, bundle_hash, last_card_index, cards_seen)"
                " values (:u, :t, 'deep_dive', '', :i, least(:i + 1, 32767)) on conflict do nothing"
            ),
            {"u": ctx.facts.user_id, "t": p.topic_id, "i": p.index},
        )
    await _topic_status(ctx, p.topic_id, "in_progress", None)


async def _lesson_completed(ctx: BatchContext, event: s.SyncEventIn, p: BaseModel) -> None:
    assert isinstance(p, s.LessonCompleted)
    if p.correct > p.total:
        raise EventRejected("invalid_payload", "correct is greater than total")
    mode = _progress_mode(p.mode)
    score = round(100 * p.correct / p.total) if p.total else None
    if mode is not None:
        await ctx.session.execute(
            text(
                """
                insert into learn.lesson_progress as l
                  (user_id, topic_id, mode, bundle_hash, cards_seen, best_score, completed_at)
                values (:u, :t, :m, '', least(:seen, 32767), :score, :at)
                on conflict (user_id, topic_id, mode) do update set
                  cards_seen = greatest(l.cards_seen, excluded.cards_seen),
                  best_score = greatest(l.best_score, excluded.best_score),
                  completed_at = coalesce(l.completed_at, excluded.completed_at)
                """
            ),
            {
                "u": ctx.facts.user_id,
                "t": p.topic_id,
                "m": mode,
                "seen": p.cards_seen,
                "score": score,
                "at": event.occurred_at,
            },
        )
        await _topic_status(ctx, p.topic_id, "learned", "lesson")


async def _answer_submitted(ctx: BatchContext, event: s.SyncEventIn, p: BaseModel) -> None:
    assert isinstance(p, s.AnswerSubmitted)
    if not p.question_id:
        return  # a lesson-card check: kept in sync_events (and analytics) only
    if p.context == "mock":
        await _check_mock_answer(ctx, p)
    conf = CONFIDENCE_DB.get(p.confidence) if p.confidence else None
    await ctx.session.execute(
        text(
            """
            insert into learn.question_attempts
              (id, user_id, question_id, context, session_id, attempt_no, answer, is_correct, time_ms,
               confidence, answered_at)
            values (:id, :u, :q, :ctx, :sid, :n, cast(:ans as jsonb), :ok, :ms, :conf, :at)
            on conflict do nothing
            """
        ),
        {
            "id": event.event_id,
            "u": ctx.facts.user_id,
            "q": p.question_id,
            "sid": p.attempt_id if p.context == "mock" else None,
            "ctx": ANSWER_CONTEXT_DB[p.context],
            "n": p.attempt,
            "ans": json.dumps({"response": p.response}),
            "ok": p.correct,
            "ms": min(p.ms_to_answer, 2_000_000_000),
            "conf": conf,
            "at": event.occurred_at,
        },
    )
    concepts = (
        (
            await ctx.session.execute(
                text("select concept_id from content.question_concepts where question_id = :q"),
                {"q": p.question_id},
            )
        )
        .scalars()
        .all()
    )
    first_try_correct = p.correct and p.attempt == 1
    for concept_id in concepts:
        await ctx.session.execute(
            text(
                """
                insert into learn.concept_mastery as m
                  (user_id, concept_id, attempts, correct, avg_time_ms, mastery, last_practiced_at,
                   sure_total, sure_correct, fifty_total, fifty_correct, guess_total, guess_correct)
                values (:u, :c, 1, :ok, :ms, (:ok + 1)::real / 3, :at,
                        :st, :sc, :ft, :fc, :gt, :gc)
                on conflict (user_id, concept_id) do update set
                  attempts = m.attempts + 1,
                  correct = m.correct + :ok,
                  avg_time_ms = ((coalesce(m.avg_time_ms, 0)::bigint * m.attempts + :ms) / (m.attempts + 1))::integer,
                  mastery = ((m.correct + :ok + 1)::real / (m.attempts + 3)),
                  last_practiced_at = greatest(m.last_practiced_at, :at),
                  sure_total = m.sure_total + :st, sure_correct = m.sure_correct + :sc,
                  fifty_total = m.fifty_total + :ft, fifty_correct = m.fifty_correct + :fc,
                  guess_total = m.guess_total + :gt, guess_correct = m.guess_correct + :gc
                """
            ),
            {
                "u": ctx.facts.user_id,
                "c": concept_id,
                "ok": 1 if first_try_correct else 0,
                "ms": min(p.ms_to_answer, 2_000_000_000),
                "at": event.occurred_at,
                "st": int(conf == "sure"),
                "sc": int(conf == "sure" and p.correct),
                "ft": int(conf == "fifty"),
                "fc": int(conf == "fifty" and p.correct),
                "gt": int(conf == "guess"),
                "gc": int(conf == "guess" and p.correct),
            },
        )


async def _check_mock_answer(ctx: BatchContext, p: s.AnswerSubmitted) -> None:
    """Mock answers count for mastery once, and only from a submitted attempt that held the
    question (the server sends them when the attempt is submitted, ``services/mocks``)."""
    row = (
        await ctx.session.execute(
            text(
                """
                select exists (select 1 from learn.mock_attempts m
                                 join learn.mock_answers a on a.attempt_id = m.id
                                where m.id = :a and m.user_id = :u and a.question_id = :q
                                  and m.status in ('submitted', 'auto_submitted')) as held,
                       exists (select 1 from learn.question_attempts
                                where user_id = :u and session_id = :a and question_id = :q
                                  and context = 'mock') as seen
                """
            ),
            {"a": p.attempt_id, "u": ctx.facts.user_id, "q": p.question_id},
        )
    ).one()
    if not row.held:
        raise EventRejected("invalid_payload", "No submitted mock attempt holds this question")
    if row.seen:
        raise EventRejected("already_recorded", "This mock answer is already recorded")


async def _review_rated(ctx: BatchContext, event: s.SyncEventIn, p: BaseModel) -> None:
    assert isinstance(p, s.ReviewRated)
    uid = ctx.facts.user_id
    await ctx.session.execute(
        text(
            """
            insert into learn.srs_reviews
              (id, user_id, card_ref, rating, confidence, state_before, elapsed_days, scheduled_days,
               stability_after, difficulty_after, duration_ms, context, reviewed_at)
            values (:id, :u, :ref, :r, :conf, 0, 0, 0, 0, 0, :ms, 'review', :at)
            """
        ),
        {
            "id": event.event_id,
            "u": uid,
            "ref": p.card_ref,
            "r": p.rating,
            "conf": CONFIDENCE_DB.get(p.confidence) if p.confidence else None,
            "ms": min(p.ms_to_answer, 2_000_000_000),
            "at": event.occurred_at,
        },
    )
    await rebuild_card(ctx.session, uid, p.card_ref)
    ctx.srs_changed.add(p.card_ref)
    ctx.srs_deleted.discard(p.card_ref)


def _uuid_or_none(value: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


async def rebuild_card(session: AsyncSession, user_id: uuid.UUID, card_ref: str) -> None:
    """Replay every review of one card through FSRS and store the schedule (server wins)."""
    rows = (
        await session.execute(
            text(
                "select id, rating, reviewed_at, duration_ms from learn.srs_reviews"
                " where user_id = :u and card_ref = :ref order by reviewed_at, id"
            ),
            {"u": user_id, "ref": card_ref},
        )
    ).all()
    if not rows:
        return
    params = (
        await session.execute(
            text("select weights, desired_retention from learn.fsrs_params where user_id = :u"),
            {"u": user_id},
        )
    ).one_or_none()
    scheduler = make_scheduler(
        params.weights if params else None, params.desired_retention if params else None
    )
    schedule, outcomes = replay(
        [ReviewInput(str(r.id), int(r.rating), r.reviewed_at, r.duration_ms) for r in rows],
        scheduler,
    )
    for o in outcomes:
        await session.execute(
            text(
                """
                update learn.srs_reviews set state_before = :sb, elapsed_days = :el, scheduled_days = :sd,
                       stability_after = :st, difficulty_after = :df
                 where user_id = :u and id = cast(:id as uuid)
                """
            ),
            {
                "sb": o.state_before,
                "el": o.elapsed_days,
                "sd": o.scheduled_days,
                "st": o.stability_after,
                "df": o.difficulty_after,
                "u": user_id,
                "id": o.review_id,
            },
        )
    deck_id = None
    card_uuid = _uuid_or_none(card_ref[2:]) if card_ref.startswith("d:") else None
    if card_uuid is not None:
        deck_id = (
            await session.execute(
                text("select deck_id from learn.cards where id = :id and owner_user_id = :u"),
                {"id": card_uuid, "u": user_id},
            )
        ).scalar_one_or_none()
    await session.execute(
        text(
            """
            insert into learn.srs_cards as c
              (user_id, card_ref, deck_id, state, due_at, stability, difficulty, reps, lapses, last_review_at)
            values (:u, :ref, :deck, :state, :due, :st, :df, :reps, :lapses, :last)
            on conflict (user_id, card_ref) do update set
              deck_id = coalesce(excluded.deck_id, c.deck_id), state = excluded.state, due_at = excluded.due_at,
              stability = excluded.stability, difficulty = excluded.difficulty, reps = excluded.reps,
              lapses = excluded.lapses, last_review_at = excluded.last_review_at
            """
        ),
        {
            "u": user_id,
            "ref": card_ref,
            "deck": deck_id,
            "state": schedule.state,
            "due": schedule.due_at,
            "st": schedule.stability,
            "df": schedule.difficulty,
            "reps": min(schedule.reps, 32767),
            "lapses": min(schedule.lapses, 32767),
            "last": schedule.last_review_at,
        },
    )
    await session.execute(
        text("delete from learn.srs_tombstones where user_id = :u and card_ref = :ref"),
        {"u": user_id, "ref": card_ref},
    )


async def _practice_completed(ctx: BatchContext, event: s.SyncEventIn, p: BaseModel) -> None:
    assert isinstance(p, s.PracticeSessionCompleted)
    if p.correct > p.answered:
        raise EventRejected("invalid_payload", "correct is greater than answered")
    # A session earns XP once, whether the device's outbox or the server's online session
    # (``services/practice``) recorded its completion first.
    seen = (
        await ctx.session.execute(
            text(
                "select 1 from learn.sync_events where user_id = :u"
                " and type = 'practice_session_completed' and status = 'applied'"
                " and payload ->> 'session_id' = :s limit 1"
            ),
            {"u": ctx.facts.user_id, "s": str(p.session_id)},
        )
    ).first()
    if seen is not None:
        raise EventRejected("already_recorded", "This practice session is already recorded")
    started = event.occurred_at - timedelta(milliseconds=p.ms_total)
    await ctx.session.execute(
        text(
            """
            insert into learn.practice_sessions as ps (id, user_id, kind, spec, started_at, ended_at, answered, correct)
            values (:id, :u, :k, '{}'::jsonb, :start, :end, least(:a, 32767), least(:c, 32767))
            on conflict (id) do update set ended_at = excluded.ended_at, answered = excluded.answered,
              correct = excluded.correct
             where ps.user_id = :u
            """
        ),
        {
            "id": p.session_id,
            "u": ctx.facts.user_id,
            "k": p.kind,
            "start": started,
            "end": event.occurred_at,
            "a": p.answered,
            "c": p.correct,
        },
    )


async def _noop(ctx: BatchContext, event: s.SyncEventIn, p: BaseModel) -> None:
    return None


async def _mock_section_submitted(ctx: BatchContext, event: s.SyncEventIn, p: BaseModel) -> None:
    """A section qualifies the day and earns XP once, whether the device's outbox or the server's
    mock runner (``services/mocks``) recorded it first."""
    assert isinstance(p, s.MockSectionSubmitted)
    seen = (
        await ctx.session.execute(
            text(
                "select 1 from learn.sync_events where user_id = :u and type = 'mock_section_submitted'"
                " and status = 'applied' and payload ->> 'attempt_id' = :a"
                " and payload ->> 'section_code' = :c limit 1"
            ),
            {"u": ctx.facts.user_id, "a": str(p.attempt_id), "c": p.section_code},
        )
    ).first()
    if seen is not None:
        raise EventRejected("already_recorded", "This mock section is already recorded")


async def _pet_care(ctx: BatchContext, event: s.SyncEventIn, p: BaseModel) -> None:
    assert isinstance(p, s.PetCare)
    uid = ctx.facts.user_id
    has_pet = (
        await ctx.session.execute(text("select 1 from game.pets where user_id = :u"), {"u": uid})
    ).first()
    if not has_pet:
        raise EventRejected("no_pet", "Pick a buddy first")
    day = event_local_day(event)
    done_today = (
        await ctx.session.execute(
            text(
                "select count(*) from learn.sync_events where user_id = :u and type = 'pet_care'"
                " and status = 'applied' and local_day = :d and payload ->> 'action' = :a"
            ),
            {"u": uid, "d": day, "a": p.action},
        )
    ).scalar_one()
    if p.action == "play" and int(done_today) >= ctx.rules.care_play_per_day:
        raise EventRejected("care_limit_reached", "That's enough play for today")
    if p.action == "feed":
        if int(done_today) >= ctx.rules.care_treat_per_day:
            raise EventRejected("care_limit_reached", "One treat a day")
        item = (
            await ctx.session.execute(
                text(
                    """
                    select i.item_id from game.inventory i join game.shop_items s on s.id = i.item_id
                     where i.user_id = :u and s.kind = 'treat' and i.qty > 0
                       and (cast(:item as text) is null or i.item_id = :item)
                     order by i.acquired_at limit 1
                    """
                ),
                {"u": uid, "item": p.item_id},
            )
        ).scalar_one_or_none()
        if item is None:
            raise EventRejected("no_treat", "No treats left. Get one in the shop")
        await ctx.session.execute(
            text("update game.inventory set qty = qty - 1 where user_id = :u and item_id = :i"),
            {"u": uid, "i": item},
        )
        await ctx.session.execute(
            text("delete from game.inventory where user_id = :u and item_id = :i and qty <= 0"),
            {"u": uid, "i": item},
        )
    await ctx.session.execute(
        text(
            "update game.pets set last_cared_at = greatest(last_cared_at, :at) where user_id = :u"
        ),
        {"u": uid, "at": event.occurred_at},
    )


async def _pet_named(ctx: BatchContext, event: s.SyncEventIn, p: BaseModel) -> None:
    assert isinstance(p, s.PetNamed)
    await ctx.session.execute(
        text(
            """
            insert into game.pets (user_id, species, name, mood, energy, state)
            values (:u, :sp, :n, :mood, :energy, 'happy')
            on conflict (user_id) do update set species = excluded.species, name = excluded.name
            """
        ),
        {
            "u": ctx.facts.user_id,
            "sp": p.species,
            "n": p.name,
            "mood": ctx.rules.pet_start_mood,
            "energy": ctx.rules.pet_start_energy,
        },
    )


async def _onboarding_answer(ctx: BatchContext, event: s.SyncEventIn, p: BaseModel) -> None:
    assert isinstance(p, s.OnboardingAnswer)
    try:
        await profile_rules.apply_onboarding_answer(
            ctx.session, ctx.facts, p.step, p.value, ctx.now
        )
    except profile_rules.ProfileValueError as exc:
        raise EventRejected("invalid_payload", str(exc)) from exc


async def _settings_changed(ctx: BatchContext, event: s.SyncEventIn, p: BaseModel) -> None:
    assert isinstance(p, s.SettingsChanged)
    if p.key in ("content_locale", "tutor_locale") and p.value not in ("en", "hi", None):
        raise EventRejected("invalid_payload", "value must be en or hi")
    await ctx.session.execute(
        text(
            "update app.profiles set settings = settings || jsonb_build_object(cast(:k as text), cast(:v as jsonb))"
            " where user_id = :u"
        ),
        {"u": ctx.facts.user_id, "k": p.key, "v": json.dumps(p.value)},
    )


def _card_side(value: str | dict[str, Any]) -> str:
    return json.dumps({"text": value} if isinstance(value, str) else value)


async def _deck_card_upserted(ctx: BatchContext, event: s.SyncEventIn, p: BaseModel) -> None:
    assert isinstance(p, s.DeckCardUpserted)
    uid = ctx.facts.user_id
    owner = (
        await ctx.session.execute(
            text("select owner_user_id from learn.decks where id = :d"), {"d": p.deck_id}
        )
    ).one_or_none()
    if owner is None:
        # The contract has no deck_created event yet; the deck appears with its first card.
        await ctx.session.execute(
            text(
                "insert into learn.decks (id, owner_user_id, source, title) values (:d, :u, 'user', '')"
            ),
            {"d": p.deck_id, "u": uid},
        )
    elif owner.owner_user_id != uid:
        raise EventRejected("not_owner", "That deck belongs to someone else")
    card_owner = (
        await ctx.session.execute(
            text("select owner_user_id from learn.cards where id = :c"), {"c": p.user_card_id}
        )
    ).one_or_none()
    if card_owner is not None and card_owner.owner_user_id != uid:
        raise EventRejected("not_owner", "That card belongs to someone else")
    await ctx.session.execute(
        text(
            """
            insert into learn.cards (id, deck_id, owner_user_id, front, back)
            values (:c, :d, :u, cast(:f as jsonb), cast(:b as jsonb))
            on conflict (id) do update set deck_id = excluded.deck_id, front = excluded.front,
              back = excluded.back, deleted_at = null
            """
        ),
        {
            "c": p.user_card_id,
            "d": p.deck_id,
            "u": uid,
            "f": _card_side(p.front),
            "b": _card_side(p.back),
        },
    )


async def _deck_card_deleted(ctx: BatchContext, event: s.SyncEventIn, p: BaseModel) -> None:
    assert isinstance(p, s.DeckCardDeleted)
    uid = ctx.facts.user_id
    await ctx.session.execute(
        text(
            "update learn.cards set deleted_at = :at where id = :c and owner_user_id = :u and deleted_at is null"
        ),
        {"c": p.user_card_id, "u": uid, "at": event.occurred_at},
    )
    ref = f"d:{p.user_card_id}"
    await ctx.session.execute(
        text("delete from learn.srs_cards where user_id = :u and card_ref = :r"),
        {"u": uid, "r": ref},
    )
    ctx.srs_deleted.add(ref)
    ctx.srs_changed.discard(ref)


async def _quest_claimed(ctx: BatchContext, event: s.SyncEventIn, p: BaseModel) -> None:
    assert isinstance(p, s.QuestClaimed)
    await game_ops.claim_quest(
        ctx.session, ctx.facts, p.quest_id, event.occurred_at, ctx.xp_rules.hourly_cap
    )


async def _freeze_equipped(ctx: BatchContext, event: s.SyncEventIn, p: BaseModel) -> None:
    await game_ops.equip_freeze(ctx.session, ctx.facts.user_id, ctx.rules, ctx.now)


async def _cards_queued(ctx: BatchContext, event: s.SyncEventIn, p: BaseModel) -> None:
    """Mirror the client's queue (memory-labs §5.14): a card it started is a new card due now
    (state 0, as in ts-fsrs); a started card is pulled into the queue (due no later than now).
    Suspended cards are left alone. ``concept_ids`` alone queue nothing: cards live in bundles,
    so the client resolves concepts to cards."""
    assert isinstance(p, s.CardsQueued)
    if not p.card_refs:
        return
    uid = ctx.facts.user_id
    refs = sorted(set(p.card_refs))
    changed = (
        (
            await ctx.session.execute(
                text(
                    """
                insert into learn.srs_cards as c (user_id, card_ref, state, due_at, stability, difficulty)
                select :u, ref, 0, :due, 0, 0 from unnest(cast(:refs as text[])) as ref
                on conflict (user_id, card_ref) do update set due_at = least(c.due_at, excluded.due_at)
                  where not c.suspended and c.due_at > excluded.due_at
                returning card_ref
                """
                ),
                {"u": uid, "due": event.occurred_at, "refs": refs},
            )
        )
        .scalars()
        .all()
    )
    inserted = [str(r) for r in changed]
    if inserted:
        await ctx.session.execute(
            text("delete from learn.srs_tombstones where user_id = :u and card_ref = any(:refs)"),
            {"u": uid, "refs": inserted},
        )
    ctx.srs_changed.update(inserted)
    ctx.srs_deleted.difference_update(inserted)


_HANDLERS = {
    "lesson_started": _lesson_started,
    "lesson_card_viewed": _lesson_card_viewed,
    "answer_submitted": _answer_submitted,
    "lesson_completed": _lesson_completed,
    "review_rated": _review_rated,
    "practice_session_completed": _practice_completed,
    "daily_challenge_completed": _noop,
    "mock_section_submitted": _mock_section_submitted,
    "pet_care": _pet_care,
    "pet_named": _pet_named,
    "plant_seeded": _noop,
    "onboarding_answer": _onboarding_answer,
    "settings_changed": _settings_changed,
    "deck_card_upserted": _deck_card_upserted,
    "deck_card_deleted": _deck_card_deleted,
    "focus_session_completed": _noop,
    "quest_claimed": _quest_claimed,
    "freeze_equipped": _freeze_equipped,
    # The rescue's plant credit comes from recompute_activity_days (rescue_done).
    "rescue_completed": _noop,
    "cards_queued": _cards_queued,
    "comeback_plan_started": _noop,
}
assert set(_HANDLERS) == set(s.PAYLOAD_MODELS)
