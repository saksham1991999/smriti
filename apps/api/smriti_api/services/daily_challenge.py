"""The daily challenge (practice §5.5, R23): one shared question per exam profile per IST date,
scored on the server so the leaderboard is fair. It qualifies a streak day on the student's local
date at submit and never uses the free practice count.

The question is picked from published questions whose use includes ``daily`` (their keys never
ship to devices), the same one for everyone, deterministically by exam and day. When an exam has
no such question the challenge is unavailable: nothing is invented.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError, conflict, not_found
from smriti_api.schemas import practice as p
from smriti_api.services import game_ops
from smriti_api.services import question_bank as bank
from smriti_api.services.answers import (
    AnswerFormatError,
    check_answer,
    event_response,
    parse_answer,
)
from smriti_api.services.recompute import zone
from smriti_api.services.server_events import ServerEvent, apply_events
from smriti_api.services.usage import IST, Flags, Learner, load_flags, load_learner

CONFIDENCE_DB = {"sure": "sure", "fifty_fifty": "fifty", "guess": "guess"}
REPEAT_WINDOW_DAYS = 365  # a question is not reused within a year while others remain


def ist_day(now: datetime) -> date:
    return now.astimezone(IST).date()


def window(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, IST)
    return start.astimezone(UTC), (start + timedelta(days=1)).astimezone(UTC)


async def _ensure(session: AsyncSession, exam: str, day: date) -> Any:
    row = (
        await session.execute(
            text(
                "select id, exam_profile_id, day, question_id from game.daily_challenges"
                " where exam_profile_id = :e and day = :d"
            ),
            {"e": exam, "d": day},
        )
    ).one_or_none()
    if row is not None:
        return row
    candidates = await bank.pool(session, exam=exam, uses=["daily"])
    if not candidates:
        return None
    used = set(
        (
            await session.execute(
                text(
                    "select question_id from game.daily_challenges where exam_profile_id = :e"
                    " and day > :since and day < :d"
                ),
                {"e": exam, "d": day, "since": day - timedelta(days=REPEAT_WINDOW_DAYS)},
            )
        ).scalars()
    )
    fresh = [q for q in candidates if q.id not in used] or candidates
    pick = min(fresh, key=lambda q: bank.stable_rank(f"daily:{exam}:{day.isoformat()}", q.id))
    await session.execute(
        text(
            "insert into game.daily_challenges (exam_profile_id, day, question_id) values (:e, :d, :q)"
            " on conflict (exam_profile_id, day) do nothing"
        ),
        {"e": exam, "d": day, "q": pick.id},
    )
    return (
        await session.execute(
            text(
                "select id, exam_profile_id, day, question_id from game.daily_challenges"
                " where exam_profile_id = :e and day = :d"
            ),
            {"e": exam, "d": day},
        )
    ).one()


async def card(
    session: AsyncSession, learner: Learner, exam: str, now: datetime
) -> p.DailyChallengeCard:
    day = ist_day(now)
    row = await _ensure(session, exam, day)
    if row is None:
        return p.DailyChallengeCard(challenge_id=None, day=day, state="unavailable")
    state = (
        await session.execute(
            text(
                "select (select true from game.daily_challenge_results r where r.challenge_id = :c and r.user_id = :u) as played,"
                " (select true from game.daily_challenge_starts s where s.challenge_id = :c and s.user_id = :u) as started"
            ),
            {"c": row.id, "u": learner.user_id},
        )
    ).one()
    return p.DailyChallengeCard(
        challenge_id=row.id,
        day=day,
        state="played" if state.played else "started" if state.started else "not_played",
    )


async def _result(
    session: AsyncSession, challenge_id: uuid.UUID, user_id: uuid.UUID, flags: Flags
) -> p.DailyChallengeResult | None:
    mine = (
        await session.execute(
            text(
                "select correct, time_ms, client_time_ms, submitted_at from game.daily_challenge_results"
                " where challenge_id = :c and user_id = :u"
            ),
            {"c": challenge_id, "u": user_id},
        )
    ).one_or_none()
    if mine is None:
        return None
    standing = (
        await session.execute(
            text(
                "select count(*) as players,"
                " count(*) filter (where (not :ok and correct) or (correct = :ok and"
                "   (time_ms < :t or (time_ms = :t and submitted_at < :at)))) as ahead"
                " from game.daily_challenge_results where challenge_id = :c"
            ),
            {"c": challenge_id, "ok": mine.correct, "t": mine.time_ms, "at": mine.submitted_at},
        )
    ).one()
    min_players = flags.int_or_none("daily.min_players_for_rank")
    ranked = min_players is not None and standing.players >= min_players
    players = int(standing.players)
    beaten = players - int(standing.ahead) - 1
    return p.DailyChallengeResult(
        correct=mine.correct,
        time_ms=int(mine.client_time_ms if mine.client_time_ms is not None else mine.time_ms),
        submitted_at=mine.submitted_at,
        rank=int(standing.ahead) + 1 if ranked else None,
        players=players,
        beat_pct=round(100 * beaten / (players - 1)) if ranked and players > 1 else None,
        min_players_for_rank=min_players,
    )


async def _view(
    session: AsyncSession, learner: Learner, row: Any, flags: Flags, locale: str
) -> p.DailyChallenge:
    opens, closes = window(row.day)
    started_at = (
        await session.execute(
            text(
                "select started_at from game.daily_challenge_starts where challenge_id = :c and user_id = :u"
            ),
            {"c": row.id, "u": learner.user_id},
        )
    ).scalar_one_or_none()
    result = await _result(session, row.id, learner.user_id, flags)
    body = await bank.find_body(session, row.question_id) if started_at is not None else None
    return p.DailyChallenge(
        id=row.id,
        exam=row.exam_profile_id,
        day=row.day,
        opens_at=opens,
        closes_at=closes,
        question=bank.public_body(body) if body is not None else None,
        started_at=started_at,
        result=result,
        solution=bank.solution_view(body, locale)
        if body is not None and result is not None
        else None,
    )


async def today(db: Database, auth: AuthContext, exam: str | None) -> p.DailyChallenge:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        flags = await load_flags(session)
        chosen = learner.exam_or_primary(exam)
        row = await _ensure(session, chosen, ist_day(now))
        if row is None:
            raise not_found("no_daily_challenge", "No daily challenge for this exam yet")
        return await _view(session, learner, row, flags, learner.locale)


async def _challenge(session: AsyncSession, challenge_id: uuid.UUID) -> Any:
    row = (
        await session.execute(
            text(
                "select id, exam_profile_id, day, question_id from game.daily_challenges where id = :c"
            ),
            {"c": challenge_id},
        )
    ).one_or_none()
    if row is None:
        raise not_found("challenge_not_found", "No such challenge")
    return row


async def start(db: Database, auth: AuthContext, challenge_id: uuid.UUID) -> p.DailyChallenge:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        flags = await load_flags(session)
        row = await _challenge(session, challenge_id)
        _, closes = window(row.day)
        if now >= closes:
            raise conflict("challenge_closed", "This challenge has closed")
        # One attempt: starting again keeps the first start time (practice §5.5 "One attempt").
        await session.execute(
            text(
                "insert into game.daily_challenge_starts (challenge_id, user_id, started_at)"
                " values (:c, :u, :at) on conflict do nothing"
            ),
            {"c": challenge_id, "u": auth.user_id, "at": now},
        )
        return await _view(session, learner, row, flags, learner.locale)


async def answer(
    db: Database,
    auth: AuthContext,
    challenge_id: uuid.UUID,
    body: p.DailyChallengeAnswer,
    *,
    device_id: uuid.UUID | None,
    app_variant: str | None,
) -> p.DailyChallenge:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        flags = await load_flags(session)
        row = await _challenge(session, challenge_id)
        started_at = (
            await session.execute(
                text(
                    "select started_at from game.daily_challenge_starts where challenge_id = :c and user_id = :u"
                ),
                {"c": challenge_id, "u": auth.user_id},
            )
        ).scalar_one_or_none()
        if started_at is None:
            raise conflict("challenge_not_started", "Start the challenge first")
        done = (
            await session.execute(
                text(
                    "select 1 from game.daily_challenge_results where challenge_id = :c and user_id = :u"
                ),
                {"c": challenge_id, "u": auth.user_id},
            )
        ).scalar_one_or_none()
        if done:
            return await _view(session, learner, row, flags, learner.locale)
        _, closes = window(row.day)
        if now >= closes:
            raise conflict("challenge_closed", "This challenge has closed")
        question = await bank.find_body(session, row.question_id)
        if question is None:
            raise not_found("question_not_found", "The challenge question is missing")
    try:
        parsed = parse_answer(body.answer.model_dump()) if body.answer is not None else None
    except AnswerFormatError as exc:
        raise ApiError(
            422, "invalid_answer", "The answer doesn't fit the question", detail=str(exc)
        ) from exc
    result = check_answer(question, parsed) if parsed is not None else None
    correct = bool(result and result.correct)
    server_ms = int((now - started_at).total_seconds() * 1000)
    # Rank uses the server's clock (start to receipt); the student sees their own measured time.
    async with db.system_tx() as session:
        inserted = (
            await session.execute(
                text(
                    """
                    insert into game.daily_challenge_results
                      (challenge_id, user_id, correct, time_ms, submitted_at, answer, confidence, client_time_ms)
                    values (:c, :u, :ok, :t, :at, cast(:ans as jsonb), :conf, :ct)
                    on conflict do nothing returning 1
                    """
                ),
                {
                    "c": challenge_id,
                    "u": auth.user_id,
                    "ok": correct,
                    "t": max(0, min(server_ms, 2_000_000_000)),
                    "at": now,
                    "ans": json.dumps({"response": result.response if result else None}),
                    "conf": CONFIDENCE_DB.get(body.confidence) if body.confidence else None,
                    "ct": body.client_time_ms,
                },
            )
        ).scalar_one_or_none()
    if inserted:
        topic = next(iter(await _topics(db, row.question_id)), None)
        await apply_events(
            db,
            auth,
            [
                ServerEvent(
                    game_ops.derived_event_id("daily_answer", auth.user_id, challenge_id),
                    "answer_submitted",
                    {
                        "topic_id": topic,
                        "question_id": row.question_id,
                        "context": "challenge",
                        "response": event_response(result.response if result else None),
                        "correct": correct,
                        "attempt": 1,
                        "confidence": body.confidence,
                        "ms_to_answer": min(body.client_time_ms, 24 * 3600 * 1000),
                    },
                ),
                ServerEvent(
                    game_ops.derived_event_id("daily_done", auth.user_id, challenge_id),
                    "daily_challenge_completed",
                    {
                        "challenge_date": row.day.isoformat(),
                        "score": 1 if correct else 0,
                        "ms_total": min(body.client_time_ms, 24 * 3600 * 1000),
                    },
                ),
            ],
            tz=body.tz,
            device_id=device_id,
            app_variant=app_variant,
            now=now,
        )
        tz = zone(body.tz) if body.tz and zone(body.tz).key == body.tz else learner.tz
        async with db.system_tx() as session:
            await session.execute(
                text(
                    "update game.daily_challenge_results set local_day = :d"
                    " where challenge_id = :c and user_id = :u"
                ),
                {"d": now.astimezone(tz).date(), "c": challenge_id, "u": auth.user_id},
            )
    async with db.system_tx() as session:
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        return await _view(session, learner, row, await load_flags(session), learner.locale)


async def _topics(db: Database, question_id: str) -> list[str]:
    async with db.system_tx() as session:
        found = await bank.pool(session, ids=[question_id])
    return [found[0].topic_id] if found else []


async def leaderboard(
    db: Database, auth: AuthContext, challenge_id: uuid.UUID, limit: int
) -> p.DailyLeaderboard:
    """R31: adults by display name; under-18s only with guardian consent, by pet avatar and the
    auto nickname, never a typed name. Guests and minors without consent see only their own row."""
    async with db.system_tx() as session:
        flags = await load_flags(session)
        await _challenge(session, challenge_id)
        rows = (
            await session.execute(
                text(
                    """
                    select r.user_id, r.correct, r.time_ms, r.client_time_ms,
                           rank() over (order by r.correct desc, r.time_ms, r.submitted_at) as rank,
                           pr.display_name, pr.is_minor, pr.nickname_word_ids, pr.nickname_number,
                           pr.guardian_consent_state, u.is_anonymous, pet.species
                      from game.daily_challenge_results r
                      join app.profiles pr on pr.user_id = r.user_id
                      join auth.users u on u.id = r.user_id
                      left join game.pets pet on pet.user_id = r.user_id
                     where r.challenge_id = :c
                     order by rank
                    """
                ),
                {"c": challenge_id},
            )
        ).all()
    min_players = flags.int_or_none("daily.min_players_for_rank")
    ranked = min_players is not None and len(rows) >= min_players

    def visible(r: Any) -> bool:
        if r.is_anonymous:
            return False
        return not r.is_minor or r.guardian_consent_state == "granted"

    def row_out(r: Any) -> p.LeaderboardRow:
        if r.is_minor:
            words = "-".join(r.nickname_word_ids or [])
            name = f"{words}:{r.nickname_number}" if words else None
            avatar = f"pet:{r.species}" if r.species else None
        else:
            name, avatar = r.display_name, None
        return p.LeaderboardRow(
            rank=int(r.rank),
            name=name,
            avatar=avatar,
            is_you=r.user_id == auth.user_id,
            correct=r.correct,
            time_ms=int(r.time_ms),
        )

    you = next((row_out(r) for r in rows if r.user_id == auth.user_id), None)
    shown = [row_out(r) for r in rows if visible(r)][:limit] if ranked else []
    return p.DailyLeaderboard(
        challenge_id=challenge_id,
        players=len(rows),
        ranked=ranked,
        min_players_for_rank=min_players,
        rows=shown,
        you=you if ranked else None,
    )
