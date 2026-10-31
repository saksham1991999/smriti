"""Practice (docs/flows/practice.md §5): drill sessions from the question bank, PYQs, weak spots
and the hub. Answers checked here use the same rules as lesson-core and land in
``learn.question_attempts`` through the sync event path, so mastery, XP and the streak are
recomputed in one place.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError, not_found
from smriti_api.schemas import practice as p
from smriti_api.services import game_ops
from smriti_api.services import question_bank as bank
from smriti_api.services.answers import (
    AnswerFormatError,
    check_answer,
    event_response,
    parse_answer,
)
from smriti_api.services.server_events import ServerEvent, apply_events
from smriti_api.services.usage import (
    Flags,
    Learner,
    Quota,
    load_flags,
    load_learner,
    mock_week_bounds,
    next_local_midnight,
    practice_quota,
    quota,
    sectional_started_this_week,
    tutor_quota,
)

PRACTICE_USES = ("practice", "lesson", "placement")
SERVER_ONLY_USES = ("mock", "daily")
RECENT_WRONG = timedelta(days=7)
# DB context for a session kind (practice §7.2).
ATTEMPT_CONTEXT = {
    "drill": "drill",
    "weak_spots": "drill",
    "pyq": "pyq",
    "chapter_test": "chapter_test",
}


def quota_out(q: Quota, resets_at: datetime | None) -> p.QuotaOut:
    return p.QuotaOut(
        unlimited=q.unlimited,
        limit=q.limit,
        used=q.used,
        remaining=q.remaining,
        resets_at=resets_at,
    )


def free_limit_reached(limit_key: str, q: Quota, resets_at: datetime | None) -> ApiError:
    """The paywall hand-off (practice §4.1): the client opens PRC-17 only on a tap."""
    return ApiError(
        403,
        "free_limit_reached",
        "Today's free questions are used up",
        limit_key=limit_key,
        paywall_trigger="practice_limit",
        used=q.used,
        limit=q.limit,
        resets_at=resets_at.isoformat() if resets_at else None,
    )


# --- limits -------------------------------------------------------------------------------------


async def limits(db: Database, auth: AuthContext, now: datetime | None = None) -> p.Limits:
    now = now or datetime.now(UTC)
    async with db.system_tx() as session:
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        flags = await load_flags(session)
        return await _limits(session, learner, flags, now)


async def _limits(session: AsyncSession, learner: Learner, flags: Flags, now: datetime) -> p.Limits:
    resets = next_local_midnight(learner, now)
    week_end = mock_week_bounds(now)[1]
    sectional = quota(
        await sectional_started_this_week(session, learner.user_id, now, flags),
        flags.int_or_none("free.sectional_mocks_per_week"),
        learner.is_pro,
    )
    return p.Limits(
        is_pro=learner.is_pro,
        day=learner.today(now),
        practice_questions=quota_out(await practice_quota(session, learner, flags, now), resets),
        tutor_messages=quota_out(await tutor_quota(session, learner, flags, now), resets),
        sectional_mocks=quota_out(sectional, week_end),
    )


# --- sessions -----------------------------------------------------------------------------------


@dataclass(frozen=True)
class _History:
    last_at: datetime
    last_correct: bool


async def _history(
    session: AsyncSession, user_id: uuid.UUID, ids: Sequence[str]
) -> dict[str, _History]:
    if not ids:
        return {}
    rows = (
        await session.execute(
            text(
                "select question_id, max(answered_at) as last_at,"
                " (array_agg(is_correct order by answered_at desc))[1] as last_correct"
                " from learn.question_attempts where user_id = :u and question_id = any(:ids)"
                " group by question_id"
            ),
            {"u": user_id, "ids": list(ids)},
        )
    ).all()
    return {r.question_id: _History(r.last_at, bool(r.last_correct)) for r in rows}


async def _mastery(
    session: AsyncSession, user_id: uuid.UUID, concepts: Sequence[str]
) -> float | None:
    if not concepts:
        return None
    value = (
        await session.execute(
            text(
                "select avg(mastery) from learn.concept_mastery where user_id = :u and concept_id = any(:c)"
            ),
            {"u": user_id, "c": list(concepts)},
        )
    ).scalar_one_or_none()
    return float(value) if value is not None else None


def choose(
    candidates: Sequence[bank.BankQuestion],
    history: dict[str, _History],
    *,
    level: str,
    count: int,
    seed: str,
    now: datetime,
) -> list[bank.BankQuestion]:
    """practice §5.3 rules 3 to 5: unseen first, then questions got wrong more than 7 days ago,
    then the rest; the target level first, then the nearest; a stable shuffle within each."""
    order = bank.nearest_levels(level)

    def freshness(q: bank.BankQuestion) -> int:
        h = history.get(q.id)
        if h is None:
            return 0
        if not h.last_correct and now - h.last_at > RECENT_WRONG:
            return 1
        return 2

    def key(q: bank.BankQuestion) -> tuple[int, int, str]:
        lvl = order.index(q.difficulty) if q.difficulty in order else 1
        return freshness(q), lvl, bank.stable_rank(seed, q.id)

    return sorted(candidates, key=key)[:count]


async def _scope_pool(
    session: AsyncSession, learner: Learner, body: p.SessionCreate, exam: str
) -> tuple[str, list[bank.BankQuestion], bool]:
    """Returns (kind, candidates, fixed order)."""
    if body.paper_id:
        ids = (
            await session.execute(
                text(
                    "select question_id from content.pyq_questions where paper_id = :p order by number"
                ),
                {"p": body.paper_id},
            )
        ).scalars()
        id_list = [str(i) for i in ids]
        if not id_list:
            raise not_found("paper_not_found", "No such paper")
        found = {q.id: q for q in await bank.pool(session, ids=id_list, exclude_uses=["daily"])}
        return "pyq", [found[i] for i in id_list if i in found], True
    if body.question_ids:
        found = {
            q.id: q
            for q in await bank.pool(
                session, ids=body.question_ids, exclude_uses=list(SERVER_ONLY_USES)
            )
        }
        missing = [i for i in body.question_ids if i not in found]
        if missing:
            raise ApiError(
                422, "unknown_questions", "Some questions can't be practised", ids=missing[:10]
            )
        kind = "pyq" if all(found[i].source == "pyq" for i in body.question_ids) else "drill"
        return kind, [found[i] for i in dict.fromkeys(body.question_ids)], True
    candidates = await bank.pool(
        session,
        exam=exam,
        uses=list(PRACTICE_USES),
        exclude_uses=list(SERVER_ONLY_USES),
        concepts=body.concepts,
        topic=body.topic_id,
        chapter=body.chapter_id,
    )
    kind = body.mode if body.mode != "drill" else "drill"
    return kind, candidates, False


async def create_session(
    db: Database, auth: AuthContext, body: p.SessionCreate, now: datetime | None = None
) -> p.PracticeSession:
    now = now or datetime.now(UTC)
    session_id = body.session_id or uuid.uuid4()
    async with db.system_tx() as session:
        existing = await _load_session(session, auth.user_id, session_id)
        if existing is not None:
            learner = await load_learner(session, auth.user_id, auth.is_anonymous)
            flags = await load_flags(session)
            return await _session_out(session, learner, flags, existing, now)
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        flags = await load_flags(session)
        exam = learner.exam_or_primary(body.exam)
        q = await practice_quota(session, learner, flags, now)
        if not q.allowed:
            raise free_limit_reached(
                "free.practice_questions_per_day", q, next_local_midnight(learner, now)
            )
        kind, candidates, fixed = await _scope_pool(session, learner, body, exam)
        if not candidates:
            raise ApiError(404, "no_questions", "No published questions for this scope yet")
        requested = len(candidates) if fixed else body.count
        allowed = requested if q.remaining is None else min(requested, q.remaining)
        if fixed:
            chosen = list(candidates)[:allowed]
        else:
            if body.difficulty == "adaptive":
                scope_concepts = sorted({c for qq in candidates for c in qq.concepts})
                level = bank.level_for_mastery(
                    await _mastery(session, auth.user_id, scope_concepts)
                )
            else:
                level = body.difficulty
            history = await _history(session, auth.user_id, [qq.id for qq in candidates])
            chosen = choose(
                candidates, history, level=level, count=allowed, seed=str(session_id), now=now
            )
        spec = {
            "concepts": body.concepts,
            "topic_id": body.topic_id,
            "chapter_id": body.chapter_id,
            "paper_id": body.paper_id,
            "fixed": fixed,
            "difficulty": body.difficulty,
            "requested": requested,
        }
        await session.execute(
            text(
                """
                insert into learn.practice_sessions
                  (id, user_id, kind, spec, started_at, exam_profile_id, source, question_ids, size)
                values (:id, :u, :k, cast(:spec as jsonb), :at, :exam, :src, :qs, :size)
                """
            ),
            {
                "id": session_id,
                "u": auth.user_id,
                "k": kind,
                "spec": json.dumps(spec),
                "at": now,
                "exam": exam,
                "src": body.source,
                "qs": [qq.id for qq in chosen],
                "size": len(chosen),
            },
        )
        row = await _load_session(session, auth.user_id, session_id)
        assert row is not None
        return await _session_out(session, learner, flags, row, now)


async def _load_session(session: AsyncSession, user_id: uuid.UUID, session_id: uuid.UUID) -> Any:
    return (
        await session.execute(
            text(
                "select id, kind, spec, started_at, ended_at, answered, correct, exam_profile_id,"
                " source, question_ids, size from learn.practice_sessions where id = :id and user_id = :u"
            ),
            {"id": session_id, "u": user_id},
        )
    ).one_or_none()


async def _session_out(
    session: AsyncSession, learner: Learner, flags: Flags, row: Any, now: datetime
) -> p.PracticeSession:
    ids = list(row.question_ids or [])
    found = {q.id: q for q in await bank.pool(session, ids=ids)} if ids else {}
    spec = row.spec or {}
    requested = int(spec.get("requested") or len(ids))
    q = await practice_quota(session, learner, flags, now)
    return p.PracticeSession(
        id=row.id,
        kind=row.kind,
        exam=row.exam_profile_id,
        source=row.source,
        started_at=row.started_at,
        ended_at=row.ended_at,
        size=int(row.size if row.size is not None else len(ids)),
        requested=requested,
        capped_by_free_limit=len(ids) < requested,
        answered=row.answered,
        correct=row.correct,
        questions=[
            p.SessionQuestion(
                question_id=i,
                type=found[i].type,
                difficulty=found[i].difficulty,
                topic_id=found[i].topic_id,
                chapter_id=found[i].chapter_id,
                ideal_time_s=found[i].ideal_time_s,
                bundle_ref=found[i].bundle_ref,
                concepts=list(found[i].concepts),
            )
            for i in ids
            if i in found
        ],
        quota=quota_out(q, next_local_midnight(learner, now)),
    )


async def get_session(
    db: Database, auth: AuthContext, session_id: uuid.UUID, now: datetime | None = None
) -> p.PracticeSession:
    now = now or datetime.now(UTC)
    async with db.system_tx() as session:
        row = await _load_session(session, auth.user_id, session_id)
        if row is None:
            raise not_found("session_not_found", "No such practice session")
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        return await _session_out(session, learner, await load_flags(session), row, now)


async def list_sessions(
    db: Database, auth: AuthContext, *, limit: int, before: datetime | None
) -> list[p.SessionSummary]:
    async with db.user_tx(auth.claims) as session:
        rows = (
            await session.execute(
                text(
                    "select id, kind, exam_profile_id, started_at, ended_at, size, answered, correct"
                    " from learn.practice_sessions where user_id = :u"
                    " and (cast(:before as timestamptz) is null or started_at < :before)"
                    " order by started_at desc limit :n"
                ),
                {"u": auth.user_id, "before": before, "n": limit},
            )
        ).all()
    return [
        p.SessionSummary(
            id=r.id,
            kind=r.kind,
            exam=r.exam_profile_id,
            started_at=r.started_at,
            ended_at=r.ended_at,
            size=r.size,
            answered=r.answered,
            correct=r.correct,
        )
        for r in rows
    ]


async def submit_answer(
    db: Database,
    auth: AuthContext,
    session_id: uuid.UUID,
    body: p.AnswerSubmit,
    *,
    device_id: uuid.UUID | None,
    app_variant: str | None,
    now: datetime | None = None,
) -> p.AnswerResult:
    now = now or datetime.now(UTC)
    event_id = game_ops.derived_event_id(
        "practice_answer", auth.user_id, session_id, body.question_id, body.attempt
    )
    async with db.system_tx() as session:
        row = await _load_session(session, auth.user_id, session_id)
        if row is None:
            raise not_found("session_not_found", "No such practice session")
        if body.question_id not in (row.question_ids or []):
            raise ApiError(422, "question_not_in_session", "This question is not in the session")
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        flags = await load_flags(session)
        prior = (
            await session.execute(
                text(
                    "select attempt_no, is_correct from learn.question_attempts"
                    " where user_id = :u and session_id = :s and question_id = :q order by attempt_no"
                ),
                {"u": auth.user_id, "s": session_id, "q": body.question_id},
            )
        ).all()
        already = {r.attempt_no for r in prior}
        if body.attempt == 2 and 1 not in already:
            raise ApiError(422, "first_attempt_missing", "Answer once before trying again")
        if body.attempt == 2 and any(r.attempt_no == 1 and r.is_correct for r in prior):
            raise ApiError(409, "already_correct", "This question was already answered right")
        resets = next_local_midnight(learner, now)
        if body.attempt == 1 and 1 not in already:
            q = await practice_quota(session, learner, flags, now)
            if not q.allowed:
                raise free_limit_reached("free.practice_questions_per_day", q, resets)
        question = await bank.find_body(session, body.question_id)
        if question is None:
            raise not_found("question_not_found", "No such question")
        meta = await bank.pool(session, ids=[body.question_id])
        topic = meta[0].topic_id if meta else None
        difficulty = meta[0].difficulty if meta else None
    try:
        answer = parse_answer(body.answer.model_dump()) if body.answer is not None else None
    except AnswerFormatError as exc:
        raise ApiError(
            422, "invalid_answer", "The answer doesn't fit the question", detail=str(exc)
        ) from exc
    result = check_answer(question, answer) if answer is not None else None
    correct = bool(result and result.correct)
    response = result.response if result else None
    wire_context = "chapter_test" if row.kind == "chapter_test" else "practice"
    await apply_events(
        db,
        auth,
        [
            ServerEvent(
                event_id,
                "answer_submitted",
                {
                    "topic_id": topic,
                    "question_id": body.question_id,
                    "context": wire_context,
                    "response": event_response(response),
                    "correct": correct,
                    "attempt": body.attempt,
                    "confidence": body.confidence,
                    "ms_to_answer": body.time_ms,
                },
            )
        ],
        device_id=device_id,
        app_variant=app_variant,
    )
    async with db.system_tx() as session:
        await session.execute(
            text(
                """
                update learn.question_attempts
                   set session_id = :s, context = :ctx, difficulty_shown = :d,
                       mistake_type = coalesce(:m, mistake_type), answer = cast(:ans as jsonb)
                 where id = :id and user_id = :u
                """
            ),
            {
                "s": session_id,
                "ctx": ATTEMPT_CONTEXT.get(row.kind, "practice"),
                "d": difficulty,
                "m": body.mistake_type,
                "ans": json.dumps(
                    {"response": response, "partial": result.partial if result else 0}
                ),
                "id": event_id,
                "u": auth.user_id,
            },
        )
        counts = (
            await session.execute(
                text(
                    "select count(*) filter (where attempt_no = 1) as answered,"
                    " count(*) filter (where attempt_no = 1 and is_correct) as correct"
                    " from learn.question_attempts where user_id = :u and session_id = :s"
                ),
                {"u": auth.user_id, "s": session_id},
            )
        ).one()
        await session.execute(
            text(
                "update learn.practice_sessions set answered = least(:a, 32767), correct = least(:c, 32767)"
                " where id = :s and user_id = :u"
            ),
            {"a": counts.answered, "c": counts.correct, "s": session_id, "u": auth.user_id},
        )
        q_after = await practice_quota(session, learner, flags, now)
    locale = body.locale or learner.locale
    return p.AnswerResult(
        question_id=body.question_id,
        attempt=body.attempt,
        check=p.CheckOut(
            correct=correct, partial=result.partial if result else 0.0, response=response
        ),
        counted=body.attempt == 1 and 1 not in already,
        solution=bank.solution_view(question, locale),
        session_answered=int(counts.answered),
        session_correct=int(counts.correct),
        quota=quota_out(q_after, resets),
    )


async def complete_session(
    db: Database,
    auth: AuthContext,
    session_id: uuid.UUID,
    body: p.SessionComplete,
    *,
    device_id: uuid.UUID | None,
    app_variant: str | None,
    now: datetime | None = None,
) -> p.PracticeSession:
    now = now or datetime.now(UTC)
    async with db.system_tx() as session:
        row = await _load_session(session, auth.user_id, session_id)
        if row is None:
            raise not_found("session_not_found", "No such practice session")
    if row.ended_at is None:
        wire_kind = {"pyq": "pyq", "weak_spots": "weak_spots"}.get(row.kind, "drill")
        try:
            await apply_events(
                db,
                auth,
                [
                    ServerEvent(
                        game_ops.derived_event_id("practice_done", auth.user_id, session_id),
                        "practice_session_completed",
                        {
                            "session_id": str(session_id),
                            "kind": wire_kind,
                            "answered": row.answered,
                            "correct": row.correct,
                            "ms_total": int(
                                min((now - row.started_at).total_seconds() * 1000, 86_400_000)
                            ),
                        },
                    )
                ],
                device_id=device_id,
                app_variant=app_variant,
            )
        except ApiError as exc:
            # The device's outbox recorded the session first: it already counts once.
            if exc.code != "already_recorded":
                raise
        async with db.system_tx() as session:
            await session.execute(
                text(
                    "update learn.practice_sessions set ended_at = coalesce(ended_at, :at),"
                    " spec = spec || cast(:extra as jsonb) where id = :s and user_id = :u"
                ),
                {
                    "at": now,
                    "extra": json.dumps({"ended_by": body.ended_by}),
                    "s": session_id,
                    "u": auth.user_id,
                },
            )
    return await get_session(db, auth, session_id, now)


async def drill_preview(
    db: Database,
    auth: AuthContext,
    *,
    exam: str | None,
    concepts: list[str] | None,
    topic: str | None,
    count: int,
) -> p.DrillPreview:
    async with db.system_tx() as session:
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        chosen_exam = learner.exam_or_primary(exam)
        candidates = await bank.pool(
            session,
            exam=chosen_exam,
            uses=list(PRACTICE_USES),
            exclude_uses=list(SERVER_ONLY_USES),
            concepts=concepts or None,
            topic=topic,
        )
        history = await _history(session, auth.user_id, [q.id for q in candidates])
        level = bank.level_for_mastery(
            await _mastery(
                session, auth.user_id, sorted({c for q in candidates for c in q.concepts})
            )
        )
    now = datetime.now(UTC)
    seed = f"{auth.user_id}:{now.date()}"
    chosen = choose(candidates, history, level=level, count=count, seed=seed, now=now)
    return p.DrillPreview(exam=chosen_exam, question_ids=[q.id for q in chosen])
