"""Challenge duels (tutor-social B10). The server picks the questions, holds the keys, keeps the
clock and scores; clients only send answers and read state.

- **Friend duels** start as a live invite (``duel.invite_live_seconds``). If the friend doesn't
  accept in time the challenger can send it as an async challenge, which the friend plays on
  their own clock within ``duel.async_ttl_hours``.
- **Random duels** match through ``social.duel_queue`` by exam, age group (adults with adults,
  13-17 with 13-17) and the nearest league tier. After ``duel.match_timeout_seconds`` the app
  offers Keep looking, Practise solo or Challenge a friend. There are never bots.
- **Solo rounds** are labelled, unranked and earn no win XP.
- **Live clock:** one shared question at a time, ``duel.question_seconds`` each (or
  ``duel.question_seconds_u13`` when a 10-12 year old plays). A question is revealed when both
  have answered or its time is up; the server advances lazily on every request and in the
  ``duel_sweep`` job. A player away longer than ``duel.disconnect_grace_seconds`` keeps
  scoring 0; when both are away the duel expires with no result and no XP.
- **Scoring:** a correct answer scores 1 plus a speed bonus of up to ``duel.speed_bonus_max``
  (none while unset). XP is ``xp.duel_per_correct`` per correct answer plus ``xp.duel_win`` for
  the winner (none while unset), credited once per duel as ``source = 'duel'``,
  ``ref = 'duel:{id}'``. Answers faster than ``duel.min_answer_ms`` flag the player
  (``flagged_fast``); the result stands but leagues and boards leave that XP out (A36).
- **Quits:** [Leave] in a live duel gives the other player the win; quitting ``duel.quit_limit``
  random duels within ``duel.quit_window_hours`` pauses random matching for
  ``duel.quit_cooldown_minutes``. Each of these is off while its flag is unset.

Every change is published on the duel's channel (:mod:`smriti_api.services.duel_channel`).
"""

from __future__ import annotations

import json
import secrets
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

import structlog
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError, conflict, not_found
from smriti_api.schemas import social as so
from smriti_api.services import game_ops, integrity
from smriti_api.services import question_bank as bank
from smriti_api.services import social_people as sp
from smriti_api.services.answers import AnswerFormatError, OptionsAnswer, check_answer
from smriti_api.services.duel_channel import channel
from smriti_api.services.practice import PRACTICE_USES, SERVER_ONLY_USES
from smriti_api.services.usage import Flags, load_flags

if TYPE_CHECKING:
    from smriti_api.services.jobs import JobDeps

log = structlog.get_logger(__name__)

# The synced 3-2-1 (B10 sequence: "start_at (server time + 3 s)").
COUNTDOWN = timedelta(seconds=3)
QUEUE_STALE = timedelta(hours=1)  # housekeeping: an unmatched queue entry nobody came back to
MEDIA_KEYS = frozenset({"media", "image", "images", "figure", "passage"})
FINAL = ("finished", "expired", "declined", "abandoned")


@dataclass(frozen=True)
class Settings:
    """What a duel was created with, so a flag change mid-duel changes nothing."""

    count: int
    seconds: int
    bonus_max: int
    xp_correct: int
    xp_win: int
    min_ms: int | None

    def as_json(self) -> dict[str, Any]:
        return {
            "count": self.count,
            "seconds": self.seconds,
            "bonus_max": self.bonus_max,
            "xp_correct": self.xp_correct,
            "xp_win": self.xp_win,
            "min_ms": self.min_ms,
        }

    @classmethod
    def of(cls, raw: Mapping[str, Any]) -> Settings:
        return cls(
            count=int(raw["count"]),
            seconds=int(raw["seconds"]),
            bonus_max=int(raw.get("bonus_max") or 0),
            xp_correct=int(raw.get("xp_correct") or 0),
            xp_win=int(raw.get("xp_win") or 0),
            min_ms=raw.get("min_ms"),
        )

    @property
    def window(self) -> timedelta:
        return timedelta(seconds=self.seconds)


def _settings(flags: Flags, *, young: bool) -> Settings:
    seconds = flags.int_or_none("duel.question_seconds")
    if young:
        seconds = flags.int_or_none("duel.question_seconds_u13") or seconds
    if seconds is None:
        raise conflict("duel_unavailable", "Duels aren't switched on yet", reason="not_configured")
    return Settings(
        count=flags.int_or("duel.question_count", 10),
        seconds=seconds,
        bonus_max=flags.int_or("duel.speed_bonus_max", 0),
        xp_correct=flags.int_or("xp.duel_per_correct", 0),
        xp_win=flags.int_or("xp.duel_win", 0),
        min_ms=flags.int_or_none("duel.min_answer_ms"),
    )


# --- questions --------------------------------------------------------------------------------


def _has_media(node: Any) -> bool:
    if isinstance(node, Mapping):
        return any((k in MEDIA_KEYS and v) or _has_media(v) for k, v in node.items())
    if isinstance(node, list):
        return any(_has_media(v) for v in node)
    return False


async def _pick_questions(
    session: AsyncSession, exam: str, subject: str | None, count: int, other_exam: str | None
) -> list[str]:
    """Published single-answer MCQs for practice use, without images or passages, from the exam
    (and, across exams, only those in both). Random order; never generated."""
    found = await bank.pool(
        session,
        exam=exam,
        subject=subject,
        uses=list(PRACTICE_USES),
        exclude_uses=list(SERVER_ONLY_USES),
        types=["mcq_single"],
    )
    ids = [q.id for q in found]
    if other_exam is not None and other_exam != exam:
        both = {
            q.id
            for q in await bank.pool(
                session,
                exam=other_exam,
                subject=subject,
                uses=list(PRACTICE_USES),
                exclude_uses=list(SERVER_ONLY_USES),
                types=["mcq_single"],
            )
        }
        ids = [i for i in ids if i in both]
    bodies = await bank.bodies(session, ids)
    usable = [i for i in ids if i in bodies and not _has_media(bodies[i])]
    if len(usable) < count:
        raise conflict(
            "duel_unavailable",
            "Not enough duel questions for this subject yet",
            reason="not_enough_questions",
        )
    rng = secrets.SystemRandom()
    rng.shuffle(usable)
    return usable[:count]


# --- loading ----------------------------------------------------------------------------------


async def _duel(session: AsyncSession, duel_id: uuid.UUID, *, lock: bool = True) -> Any:
    row = (
        await session.execute(
            text("select * from social.duels where id = :d" + (" for update" if lock else "")),  # noqa: S608 - fixed SQL fragments, values are bound
            {"d": duel_id},
        )
    ).one_or_none()
    if row is None:
        raise not_found("duel_not_found", "No such duel")
    return row


async def _mine(session: AsyncSession, duel_id: uuid.UUID, user_id: uuid.UUID) -> Any:
    row = await _duel(session, duel_id)
    if user_id not in (row.challenger_id, row.opponent_id):
        raise not_found("duel_not_found", "No such duel")
    return row


async def _players(session: AsyncSession, duel_id: uuid.UUID) -> dict[uuid.UUID, Any]:
    rows = (
        await session.execute(
            text("select * from social.duel_players where duel_id = :d order by role"),
            {"d": duel_id},
        )
    ).all()
    return {r.user_id: r for r in rows}


async def _answers(session: AsyncSession, duel_id: uuid.UUID) -> list[Any]:
    return list(
        (
            await session.execute(
                text(
                    "select user_id, question_id, answer, is_correct, time_ms, answered_at"
                    " from social.duel_answers where duel_id = :d"
                ),
                {"d": duel_id},
            )
        ).all()
    )


def _role(duel: Any, user_id: uuid.UUID) -> str:
    return "challenger" if user_id == duel.challenger_id else "opponent"


async def _publish(
    session: AsyncSession, duel_id: uuid.UUID, kind: str, payload: Mapping[str, Any]
) -> int:
    return await channel().publish(session, duel_id, kind, payload)


# --- creating ---------------------------------------------------------------------------------


async def _new_code(session: AsyncSession) -> str:
    for _ in range(10):
        code = sp.new_code(8)
        taken = (
            await session.execute(text("select 1 from social.duels where code = :c"), {"c": code})
        ).scalar_one_or_none()
        if taken is None:
            return code
    raise ApiError(503, "code_unavailable", "Try again")


async def _create(
    session: AsyncSession,
    *,
    challenger: uuid.UUID,
    opponent: uuid.UUID | None,
    relation: str,
    mode: str,
    status: str,
    exam: str,
    subject: str | None,
    settings: Settings,
    question_ids: Sequence[str],
    now: datetime,
    expires_at: datetime | None,
    rematch_of: uuid.UUID | None = None,
) -> uuid.UUID:
    start_at = now + COUNTDOWN if status == "live" and mode == "live" else None
    duel_id = (
        await session.execute(
            text(
                """
                insert into social.duels
                  (challenger_id, opponent_id, exam_profile_id, question_ids, mode, status, code,
                   subject_id, relation, settings, start_at, question_opened_at, started_at,
                   expires_at, rematch_of)
                values (:c, :o, :e, :q, :m, :s, :code, :subj, :rel, cast(:set as jsonb), :st, :st,
                        :started, :exp, :re)
                returning id
                """
            ),
            {
                "c": challenger,
                "o": opponent,
                "e": exam,
                "q": list(question_ids),
                "m": mode,
                "s": status,
                "code": await _new_code(session),
                "subj": subject,
                "rel": relation,
                "set": _json(settings.as_json()),
                "st": start_at,
                "started": now if status == "live" else None,
                "exp": expires_at,
                "re": rematch_of,
            },
        )
    ).scalar_one()
    players = [(challenger, "challenger")] + ([(opponent, "opponent")] if opponent else [])
    for uid, role in players:
        await session.execute(
            text(
                "insert into social.duel_players (duel_id, user_id, role, joined_at, last_seen_at)"
                " values (:d, :u, :r, :j, :j)"
            ),
            {
                "d": duel_id,
                "u": uid,
                "r": role,
                "j": now if (uid == challenger or status == "live") else None,
            },
        )
    if start_at is not None:
        await _publish(session, duel_id, "started", {"start_at": start_at.isoformat()})
    return uuid.UUID(str(duel_id))


def _json(value: Any) -> str:
    return json.dumps(value)


async def _exam_for(m: sp.Member, requested: str | None) -> str:
    exam = requested or m.primary_exam
    if exam is None:
        raise ApiError(422, "exam_required", "Pick an exam first")
    return exam


async def create(db: Database, auth: AuthContext, body: so.DuelCreate) -> so.DuelState:
    now = datetime.now(UTC)
    if body.solo == (body.opponent_id is not None):
        raise ApiError(422, "invalid_duel", "Pick a friend, or a solo round")
    async with db.system_tx() as session:
        flags = await load_flags(session)
        if body.solo:
            m = await sp.gate(session, auth, flags)
            exam = await _exam_for(m, body.exam_profile_id)
            settings = _settings(flags, young=m.age_band == sp.CHILD)
            qids = await _pick_questions(session, exam, body.subject_id, settings.count, None)
            duel_id = await _create(
                session,
                challenger=m.user_id,
                opponent=None,
                relation="solo",
                mode="solo",
                status="live",
                exam=exam,
                subject=body.subject_id,
                settings=settings,
                question_ids=qids,
                now=now,
                expires_at=None,
            )
            await _start_clock(session, duel_id, m.user_id, now)
            return await _state(session, await _duel(session, duel_id), m, flags, now)
        m = await sp.gate(session, auth, flags, "friend_duel")
        assert body.opponent_id is not None
        other_id = body.opponent_id
        if other_id == m.user_id or not await sp.are_friends(session, m.user_id, other_id):
            raise ApiError(403, "not_friends", "You can duel friends, or a random opponent")
        other = await sp.load_member(session, other_id)
        if await sp.gate_state(session, other) != "ok" or "friend_duel" not in sp.features(
            other, "ok"
        ):
            raise ApiError(403, "friend_unavailable", "This friend can't duel right now")
        exam = await _exam_for(m, body.exam_profile_id)
        if other.primary_exam and other.primary_exam != exam and body.subject_id is None:
            raise ApiError(422, "subject_required", "Pick a subject you both study")
        young = sp.CHILD in (m.age_band, other.age_band)
        settings = _settings(flags, young=young)
        qids = await _pick_questions(
            session, exam, body.subject_id, settings.count, other.primary_exam
        )
        duel_id = await _create(
            session,
            challenger=m.user_id,
            opponent=other_id,
            relation="friend",
            mode="live",
            status="pending",
            exam=exam,
            subject=body.subject_id,
            settings=settings,
            question_ids=qids,
            now=now,
            expires_at=now + timedelta(seconds=flags.int_or("duel.invite_live_seconds", 60)),
        )
        duel = await _duel(session, duel_id)
        await sp.push(
            session,
            to=other_id,
            kind="duel_challenge",
            sender=m.user_id,
            flags=flags,
            payload={"code": duel.code},
            dedupe_key=f"duel_challenge:{duel_id}",
        )
        return await _state(session, duel, m, flags, now)


async def accept(db: Database, auth: AuthContext, duel_id: uuid.UUID) -> so.DuelState:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "friend_duel")
        duel = await _mine(session, duel_id, m.user_id)
        if duel.opponent_id != m.user_id or duel.status != "pending":
            raise conflict("duel_not_pending", "This duel can't be accepted now")
        if duel.expires_at is not None and duel.expires_at <= now:
            raise conflict("invite_timed_out", "This invite has run out")
        if not await sp.are_friends(session, duel.challenger_id, m.user_id):
            raise conflict("duel_not_pending", "This duel can't be accepted now")
        if duel.mode == "live":
            start_at = now + COUNTDOWN
            await session.execute(
                text(
                    "update social.duels set status = 'live', start_at = :s, question_opened_at = :s,"
                    " started_at = :n where id = :d"
                ),
                {"s": start_at, "n": now, "d": duel_id},
            )
            await session.execute(
                text(
                    "update social.duel_players set joined_at = :n, last_seen_at = :n"
                    " where duel_id = :d"
                ),
                {"n": now, "d": duel_id},
            )
            await _publish(session, duel_id, "started", {"start_at": start_at.isoformat()})
        else:  # async: the friend plays now, on their own clock
            await session.execute(
                text("update social.duels set status = 'live', started_at = :n where id = :d"),
                {"n": now, "d": duel_id},
            )
            await _start_clock(session, duel_id, m.user_id, now)
            await _publish(session, duel_id, "accepted", {"role": "opponent"})
        return await _state(session, await _duel(session, duel_id), m, flags, now)


async def decline(db: Database, auth: AuthContext, duel_id: uuid.UUID) -> None:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags)
        duel = await _mine(session, duel_id, m.user_id)
        if duel.opponent_id != m.user_id or duel.status != "pending":
            raise conflict("duel_not_pending", "This duel can't be declined now")
        await session.execute(
            text("update social.duels set status = 'declined', finished_at = :n where id = :d"),
            {"n": now, "d": duel_id},
        )
        await _publish(session, duel_id, "declined", {})


async def send_async(db: Database, auth: AuthContext, duel_id: uuid.UUID) -> so.DuelState:
    """ "{name} isn't free right now. Send it as a challenge?" The challenger plays now."""
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "friend_duel")
        duel = await _mine(session, duel_id, m.user_id)
        if duel.challenger_id != m.user_id or duel.status != "pending" or duel.mode != "live":
            raise conflict("duel_not_pending", "This duel can't be sent as a challenge now")
        ttl = timedelta(hours=flags.int_or("duel.async_ttl_hours", 24))
        await session.execute(
            text("update social.duels set mode = 'async', expires_at = :e where id = :d"),
            {"e": now + ttl, "d": duel_id},
        )
        await _start_clock(session, duel_id, m.user_id, now)
        return await _state(session, await _duel(session, duel_id), m, flags, now)


# --- random matching --------------------------------------------------------------------------


async def _paused_until(
    session: AsyncSession, flags: Flags, user_id: uuid.UUID, now: datetime
) -> datetime | None:
    limit = flags.int_or_none("duel.quit_limit")
    window = flags.int_or_none("duel.quit_window_hours")
    cooldown = flags.int_or_none("duel.quit_cooldown_minutes")
    if not (limit and window and cooldown):
        return None
    quits = list(
        (
            await session.execute(
                text(
                    "select finished_at from social.duels where abandoned_by = :u and relation = 'random'"
                    " and finished_at >= :since order by finished_at desc"
                ),
                {"u": user_id, "since": now - timedelta(hours=window)},
            )
        ).scalars()
    )
    if len(quits) < limit:
        return None
    until: datetime = quits[0] + timedelta(minutes=cooldown)
    return until if until > now else None


async def _queue_view(
    session: AsyncSession, m: sp.Member, flags: Flags, now: datetime
) -> so.QueueState:
    row = (
        await session.execute(
            text("select * from social.duel_queue where user_id = :u"), {"u": m.user_id}
        )
    ).one_or_none()
    if row is None:
        return so.QueueState(
            state="idle", paused_until=await _paused_until(session, flags, m.user_id, now)
        )
    if row.matched_duel_id is not None:
        duel = await _duel(session, row.matched_duel_id, lock=False)
        return so.QueueState(
            state="matched",
            enqueued_at=row.enqueued_at,
            duel=await _state(session, duel, m, flags, now),
        )
    timeout = timedelta(seconds=flags.int_or("duel.match_timeout_seconds", 10))
    return so.QueueState(
        state="waiting", enqueued_at=row.enqueued_at, timed_out=now - row.enqueued_at >= timeout
    )


async def _try_match(session: AsyncSession, m: sp.Member, flags: Flags, now: datetime) -> bool:
    me = (
        await session.execute(
            text("select * from social.duel_queue where user_id = :u for update"), {"u": m.user_id}
        )
    ).one_or_none()
    if me is None or me.matched_duel_id is not None:
        return False
    other = (
        await session.execute(
            text(
                """
                select q.* from social.duel_queue q
                 where q.user_id <> :u and q.matched_duel_id is null
                   and q.exam_profile_id = :e and q.age_group = :g
                   and (q.subject_id is null or cast(:s as text) is null or q.subject_id = :s)
                   and not exists (select 1 from social.friendships f where f.status = 'blocked'
                         and f.user_a = least(q.user_id, :u) and f.user_b = greatest(q.user_id, :u))
                 order by abs(q.tier - :t), q.enqueued_at
                 limit 1 for update skip locked
                """
            ),
            {
                "u": m.user_id,
                "e": me.exam_profile_id,
                "g": me.age_group,
                "s": me.subject_id,
                "t": me.tier,
            },
        )
    ).one_or_none()
    if other is None:
        return False
    subject = me.subject_id or other.subject_id
    settings = _settings(flags, young=False)
    qids = await _pick_questions(session, me.exam_profile_id, subject, settings.count, None)
    duel_id = await _create(
        session,
        challenger=other.user_id,
        opponent=m.user_id,
        relation="random",
        mode="live",
        status="live",
        exam=me.exam_profile_id,
        subject=subject,
        settings=settings,
        question_ids=qids,
        now=now,
        expires_at=None,
    )
    await session.execute(
        text("update social.duel_queue set matched_duel_id = :d where user_id = any(:ids)"),
        {"d": duel_id, "ids": [m.user_id, other.user_id]},
    )
    return True


async def find_random(db: Database, auth: AuthContext, body: so.RandomIn) -> so.QueueState:
    """Join (or rejoin, for [Keep looking]) the random queue and try to match at once."""
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "random_duel")
        paused = await _paused_until(session, flags, m.user_id, now)
        if paused is not None:
            raise conflict(
                "duel_paused", "Random duels are paused for a while", until=paused.isoformat()
            )
        exam = await _exam_for(m, body.exam_profile_id)
        _settings(flags, young=False)
        tier = (
            await session.execute(
                text("select tier from game.league_players where user_id = :u"), {"u": m.user_id}
            )
        ).scalar_one_or_none() or 1
        await session.execute(
            text(
                """
                insert into social.duel_queue (user_id, exam_profile_id, subject_id, age_group, tier, enqueued_at)
                values (:u, :e, :s, :g, :t, :n)
                on conflict (user_id) do update set exam_profile_id = excluded.exam_profile_id,
                  subject_id = excluded.subject_id, age_group = excluded.age_group,
                  tier = excluded.tier, enqueued_at = excluded.enqueued_at, matched_duel_id = null
                """
            ),
            {
                "u": m.user_id,
                "e": exam,
                "s": body.subject_id,
                "g": m.age_group(),
                "t": tier,
                "n": now,
            },
        )
        await _try_match(session, m, flags, now)
        return await _queue_view(session, m, flags, now)


async def queue_state(db: Database, auth: AuthContext) -> so.QueueState:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "random_duel")
        await _try_match(session, m, flags, now)
        return await _queue_view(session, m, flags, now)


async def leave_queue(db: Database, auth: AuthContext) -> None:
    async with db.system_tx() as session:
        await session.execute(
            text("delete from social.duel_queue where user_id = :u and matched_duel_id is null"),
            {"u": auth.user_id},
        )


# --- the clock --------------------------------------------------------------------------------


async def _start_clock(
    session: AsyncSession, duel_id: uuid.UUID, user_id: uuid.UUID, now: datetime
) -> None:
    await session.execute(
        text(
            "update social.duel_players set joined_at = coalesce(joined_at, :n), last_seen_at = :n,"
            " question_opened_at = coalesce(question_opened_at, :n) where duel_id = :d and user_id = :u"
        ),
        {"n": now, "d": duel_id, "u": user_id},
    )


def _answer_index(duel: Any, question_id: str) -> int | None:
    ids = list(duel.question_ids)
    return ids.index(question_id) if question_id in ids else None


async def _reveal(session: AsyncSession, duel: Any, index: int, settings: Settings) -> None:
    qid = duel.question_ids[index]
    body = (await bank.bodies(session, [qid])).get(qid) or {}
    players = await _players(session, duel.id)
    await _publish(
        session,
        duel.id,
        "reveal",
        {
            "index": index,
            "question_id": qid,
            "key": body.get("answer"),
            "scores": {p.role: int(p.score) for p in players.values()},
        },
    )


async def _tick_live(session: AsyncSession, duel: Any, now: datetime) -> Any:
    """Advance the shared question while it is answered by both or out of time."""
    settings = Settings.of(duel.settings)
    if duel.status != "live" or duel.start_at is None or now < duel.start_at:
        return duel
    index = int(duel.current_index)
    opened: datetime = duel.question_opened_at or duel.start_at
    changed = False
    while index < settings.count:
        deadline = opened + settings.window
        qid = duel.question_ids[index]
        answered = (
            await session.execute(
                text(
                    "select count(*) from social.duel_answers where duel_id = :d and question_id = :q"
                ),
                {"d": duel.id, "q": qid},
            )
        ).scalar_one()
        if answered < 2 and now < deadline:
            break
        await _reveal(session, duel, index, settings)
        index += 1
        opened = min(now, deadline)
        changed = True
        if index < settings.count:
            await _publish(
                session,
                duel.id,
                "question",
                {
                    "index": index,
                    "opens_at": opened.isoformat(),
                    "closes_at": (opened + settings.window).isoformat(),
                },
            )
    if changed:
        await session.execute(
            text(
                "update social.duels set current_index = :i, question_opened_at = :o where id = :d"
            ),
            {"i": index, "o": opened, "d": duel.id},
        )
        duel = await _duel(session, duel.id)
    if index >= settings.count:
        await _finish(session, duel, now)
        duel = await _duel(session, duel.id)
    return duel


async def _tick_player(session: AsyncSession, duel: Any, player: Any, now: datetime) -> bool:
    """Async and solo: move one player's own clock past unanswered, timed-out questions.
    Returns True when that player has finished."""
    settings = Settings.of(duel.settings)
    if player.finished_at is not None:
        return True
    if player.question_opened_at is None:
        return False
    index, opened = int(player.current_index), player.question_opened_at
    while index < settings.count and now >= opened + settings.window:
        opened = opened + settings.window
        index += 1
    done = index >= settings.count
    if index != player.current_index or done:
        await session.execute(
            text(
                "update social.duel_players set current_index = :i, question_opened_at = :o,"
                " finished_at = case when :f then coalesce(finished_at, :n) else finished_at end"
                " where duel_id = :d and user_id = :u"
            ),
            {"i": index, "o": opened, "f": done, "n": now, "d": duel.id, "u": player.user_id},
        )
    return done


async def tick(session: AsyncSession, duel: Any, now: datetime) -> Any:
    if duel.status in FINAL:
        return duel
    if duel.mode == "live":
        return await _tick_live(session, duel, now)
    players = await _players(session, duel.id)
    finished = {uid: await _tick_player(session, duel, p, now) for uid, p in players.items()}
    expired = duel.expires_at is not None and now >= duel.expires_at
    if duel.mode == "solo" and all(finished.values()):
        await _finish(session, await _duel(session, duel.id), now)
    elif duel.mode == "async":
        if duel.status == "pending" and expired:
            await _expire(session, duel, now)
        elif duel.status == "live" and all(finished.values()):
            await _finish(session, await _duel(session, duel.id), now)
    return await _duel(session, duel.id)


async def _expire(session: AsyncSession, duel: Any, now: datetime) -> None:
    await session.execute(
        text("update social.duels set status = 'expired', finished_at = :n where id = :d"),
        {"n": now, "d": duel.id},
    )
    await session.execute(
        text("delete from social.duel_queue where matched_duel_id = :d"), {"d": duel.id}
    )
    await _publish(session, duel.id, "expired", {})


async def _finish(
    session: AsyncSession, duel: Any, now: datetime, abandoned_by: uuid.UUID | None = None
) -> None:
    if duel.status in FINAL:
        return
    settings = Settings.of(duel.settings)
    players = await _players(session, duel.id)
    scores = {uid: int(p.score) for uid, p in players.items()}
    winner: uuid.UUID | None = None
    if abandoned_by is not None:
        winner = next((u for u in players if u != abandoned_by), None)
    elif duel.relation != "solo" and len(scores) == 2:
        (a, sa), (b, sb) = scores.items()
        winner = a if sa > sb else b if sb > sa else None
    flagged = any(p.flagged_fast for p in players.values())
    await session.execute(
        text(
            "update social.duels set status = :s, finished_at = :n, winner_id = :w,"
            " abandoned_by = :ab, flagged_fast = :f, scores = cast(:sc as jsonb) where id = :d"
        ),
        {
            "s": "abandoned" if abandoned_by else "finished",
            "n": now,
            "w": winner,
            "ab": abandoned_by,
            "f": flagged,
            "sc": _json({str(u): s for u, s in scores.items()}),
            "d": duel.id,
        },
    )
    await session.execute(
        text(
            "update social.duel_players set finished_at = coalesce(finished_at, :n) where duel_id = :d"
        ),
        {"n": now, "d": duel.id},
    )
    for uid, p in players.items():
        amount = int(p.correct) * settings.xp_correct
        if uid == winner and duel.relation != "solo":
            amount += settings.xp_win
        await game_ops.add_xp(
            session,
            uid,
            game_ops.derived_event_id("duel_xp", duel.id, uid),
            amount,
            "duel",
            f"duel:{duel.id}",
            now,
        )
    await session.execute(
        text("delete from social.duel_queue where matched_duel_id = :d"), {"d": duel.id}
    )
    await _publish(
        session,
        duel.id,
        "finished",
        {
            "scores": {p.role: int(p.score) for p in players.values()},
            "winner": players[winner].role if winner in players else None,
            "abandoned_by": players[abandoned_by].role if abandoned_by in players else None,
        },
    )
    if duel.mode == "async":
        flags = await load_flags(session)
        for uid in players:
            other = next((u for u in players if u != uid), None)
            await sp.push(
                session,
                to=uid,
                kind="duel_result",
                sender=other,
                flags=flags,
                payload={"code": duel.code},
                dedupe_key=f"duel_result:{duel.id}:{uid}",
            )


# --- answering --------------------------------------------------------------------------------


def _speed_bonus(settings: Settings, time_ms: int) -> int:
    if settings.bonus_max <= 0:
        return 0
    total = settings.seconds * 1000
    left = max(0, total - time_ms)
    return round(settings.bonus_max * left / total)


async def answer(
    db: Database, auth: AuthContext, duel_id: uuid.UUID, body: so.DuelAnswerIn
) -> so.DuelAnswerOut:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags)
        duel = await _mine(session, duel_id, m.user_id)
        await _seen(session, duel_id, m.user_id, now)
        index = _answer_index(duel, body.question_id)
        if index is None:
            raise ApiError(422, "not_in_duel", "That question isn't part of this duel")
        settings = Settings.of(duel.settings)
        existing = (
            await session.execute(
                text(
                    "select answer, is_correct from social.duel_answers"
                    " where duel_id = :d and user_id = :u and question_id = :q"
                ),
                {"d": duel_id, "u": m.user_id, "q": body.question_id},
            )
        ).one_or_none()
        if existing is not None:
            duel = await tick(session, duel, now)
            return await _answer_out(session, duel, m, flags, now, index, existing)
        duel = await tick(session, duel, now)
        if not (duel.status == "live" or (duel.status == "pending" and duel.mode == "async")):
            raise conflict("duel_not_live", "This duel isn't running")
        player = (await _players(session, duel_id))[m.user_id]
        if duel.mode == "live":
            if now < (duel.start_at or now) or int(duel.current_index) != index:
                raise conflict("question_closed", "That question isn't open")
            opened = duel.question_opened_at or duel.start_at
        else:
            if player.question_opened_at is None or int(player.current_index) != index:
                raise conflict("question_closed", "That question isn't open")
            opened = player.question_opened_at
        time_ms = max(0, int((now - opened).total_seconds() * 1000))
        qbody = (await bank.bodies(session, [body.question_id])).get(body.question_id)
        if qbody is None:
            raise not_found("question_not_found", "The question is missing")
        correct = False
        if body.option_ids is not None:
            try:
                result = check_answer(qbody, OptionsAnswer(list(body.option_ids)))
            except AnswerFormatError as exc:
                raise ApiError(
                    422, "invalid_answer", "The answer doesn't fit the question"
                ) from exc
            correct = bool(result.correct)
        points = (1 + _speed_bonus(settings, time_ms)) if correct else 0
        fast = (
            settings.min_ms is not None
            and body.option_ids is not None
            and time_ms < settings.min_ms
        )
        try:
            async with session.begin_nested():
                await session.execute(
                    text(
                        "insert into social.duel_answers (duel_id, user_id, question_id, answer,"
                        " is_correct, time_ms, answered_at)"
                        " values (:d, :u, :q, cast(:a as jsonb), :c, :t, :n)"
                    ),
                    {
                        "d": duel_id,
                        "u": m.user_id,
                        "q": body.question_id,
                        "a": _json(
                            {
                                "option_ids": body.option_ids,
                                "index": index,
                                "points": points,
                                "client_ms": body.client_ms,
                            }
                        ),
                        "c": correct,
                        "t": time_ms,
                        "n": now,
                    },
                )
        except IntegrityError:
            existing = (
                await session.execute(
                    text(
                        "select answer, is_correct from social.duel_answers"
                        " where duel_id = :d and user_id = :u and question_id = :q"
                    ),
                    {"d": duel_id, "u": m.user_id, "q": body.question_id},
                )
            ).one()
            return await _answer_out(session, duel, m, flags, now, index, existing)
        await session.execute(
            text(
                "update social.duel_players set score = score + :p, correct = correct + :c,"
                " flagged_fast = flagged_fast or :f where duel_id = :d and user_id = :u"
            ),
            {"p": points, "c": int(correct), "f": fast, "d": duel_id, "u": m.user_id},
        )
        if fast and not player.flagged_fast:
            # The first too-fast answer in a duel goes to the anti-cheat review (TRD §10, A36).
            await integrity.record_flag(
                session,
                m.user_id,
                source="duel",
                kind="fast_duel_answer",
                event_ids=[duel_id],
                detail={"threshold": settings.min_ms, "min_ms": time_ms},
            )
        if duel.mode == "live":
            await _publish(
                session, duel_id, "answered", {"role": _role(duel, m.user_id), "index": index}
            )
        else:
            nxt = index + 1
            await session.execute(
                text(
                    "update social.duel_players set current_index = :i, question_opened_at = :n,"
                    " finished_at = case when :f then :n else finished_at end"
                    " where duel_id = :d and user_id = :u"
                ),
                {"i": nxt, "n": now, "f": nxt >= settings.count, "d": duel_id, "u": m.user_id},
            )
        duel = await tick(session, await _duel(session, duel_id), now)
        row = (
            await session.execute(
                text(
                    "select answer, is_correct from social.duel_answers"
                    " where duel_id = :d and user_id = :u and question_id = :q"
                ),
                {"d": duel_id, "u": m.user_id, "q": body.question_id},
            )
        ).one()
        return await _answer_out(session, duel, m, flags, now, index, row)


def _revealed(duel: Any, index: int) -> bool:
    return duel.mode != "live" or duel.status in FINAL or index < int(duel.current_index)


async def _answer_out(
    session: AsyncSession,
    duel: Any,
    m: sp.Member,
    flags: Flags,
    now: datetime,
    index: int,
    row: Any,
) -> so.DuelAnswerOut:
    key = None
    if _revealed(duel, index):
        qid = duel.question_ids[index]
        key = ((await bank.bodies(session, [qid])).get(qid) or {}).get("answer")
    return so.DuelAnswerOut(
        index=index,
        correct=bool(row.is_correct),
        points=int((row.answer or {}).get("points") or 0),
        key=key,
        duel=await _state(session, duel, m, flags, now),
    )


# --- leaving, rematch -------------------------------------------------------------------------


async def leave(db: Database, auth: AuthContext, duel_id: uuid.UUID) -> so.DuelState:
    """[Leave], confirmed. A live duel goes to the other player; no XP is taken away."""
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags)
        duel = await tick(session, await _mine(session, duel_id, m.user_id), now)
        if duel.status == "pending" and duel.challenger_id == m.user_id and duel.mode == "live":
            await session.execute(
                text(
                    "update social.duels set status = 'abandoned', abandoned_by = :u, finished_at = :n"
                    " where id = :d"
                ),
                {"u": m.user_id, "n": now, "d": duel_id},
            )
            await _publish(session, duel_id, "cancelled", {})
        elif duel.status == "live" and duel.mode == "live":
            await _publish(session, duel_id, "left", {"role": _role(duel, m.user_id)})
            await _finish(session, duel, now, abandoned_by=m.user_id)
        elif duel.status in ("live", "pending") and duel.mode in ("async", "solo"):
            # Stopping early on your own clock: the rest score 0.
            await session.execute(
                text(
                    "update social.duel_players set finished_at = coalesce(finished_at, :n),"
                    " current_index = :c where duel_id = :d and user_id = :u"
                ),
                {"n": now, "c": Settings.of(duel.settings).count, "d": duel_id, "u": m.user_id},
            )
            await tick(session, await _duel(session, duel_id), now)
        else:
            raise conflict("duel_not_live", "This duel isn't running")
        return await _state(session, await _duel(session, duel_id), m, flags, now)


async def rematch(db: Database, auth: AuthContext, duel_id: uuid.UUID) -> so.DuelState:
    """Both tap [Rematch] within ``duel.rematch_wait_seconds``; the second tap starts it."""
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags)
        duel = await _mine(session, duel_id, m.user_id)
        wait = flags.int_or_none("duel.rematch_wait_seconds")
        if duel.status != "finished" or duel.finished_at is None:
            raise conflict("rematch_unavailable", "Rematch isn't available")
        if duel.relation != "solo" and (
            wait is None or now > duel.finished_at + timedelta(seconds=wait)
        ):
            raise conflict("rematch_unavailable", "Rematch isn't available")
        existing = (
            await session.execute(
                text("select id from social.duels where rematch_of = :d"), {"d": duel_id}
            )
        ).scalar_one_or_none()
        if existing is not None:
            return await _state(session, await _duel(session, existing), m, flags, now)
        other = duel.opponent_id if m.user_id == duel.challenger_id else duel.challenger_id
        if duel.relation != "solo" and (
            duel.rematch_requested_by is None or duel.rematch_requested_by == m.user_id
        ):
            await session.execute(
                text(
                    "update social.duels set rematch_requested_by = :u, rematch_requested_at = :n"
                    " where id = :d"
                ),
                {"u": m.user_id, "n": now, "d": duel_id},
            )
            await _publish(session, duel_id, "rematch_requested", {"role": _role(duel, m.user_id)})
            return await _state(session, await _duel(session, duel_id), m, flags, now)
        if other is not None and other in await sp.blocked_ids(session, m.user_id):
            raise conflict("rematch_unavailable", "Rematch isn't available")
        settings = Settings.of(duel.settings)
        qids = await _pick_questions(
            session, duel.exam_profile_id, duel.subject_id, settings.count, None
        )
        new_id = await _create(
            session,
            challenger=duel.challenger_id,
            opponent=duel.opponent_id,
            relation=duel.relation,
            mode="solo" if duel.relation == "solo" else "live",
            status="live",
            exam=duel.exam_profile_id,
            subject=duel.subject_id,
            settings=settings,
            question_ids=qids,
            now=now,
            expires_at=None,
            rematch_of=duel_id,
        )
        if duel.relation == "solo":
            await _start_clock(session, new_id, m.user_id, now)
        await _publish(session, duel_id, "rematch", {"duel_id": str(new_id)})
        return await _state(session, await _duel(session, new_id), m, flags, now)


# --- reading ----------------------------------------------------------------------------------


async def _seen(
    session: AsyncSession, duel_id: uuid.UUID, user_id: uuid.UUID, now: datetime
) -> None:
    await session.execute(
        text(
            "update social.duel_players set last_seen_at = :n where duel_id = :d and user_id = :u"
        ),
        {"n": now, "d": duel_id, "u": user_id},
    )


def _outcome(duel: Any, user_id: uuid.UUID) -> str:
    if duel.status not in ("finished", "abandoned") or duel.relation == "solo":
        return "none"
    if duel.winner_id is None:
        return "draw"
    return "me" if duel.winner_id == user_id else "them"


async def _state(
    session: AsyncSession, duel: Any, m: sp.Member, flags: Flags, now: datetime
) -> so.DuelState:
    settings = Settings.of(duel.settings)
    players = await _players(session, duel.id)
    answers = await _answers(session, duel.id)
    shown = await sp.people(session, m, list(players), flags)
    grace = timedelta(seconds=flags.int_or("duel.disconnect_grace_seconds", 15))
    final = duel.status in FINAL
    index_of = {q: i for i, q in enumerate(duel.question_ids)}
    revealed_scores: dict[uuid.UUID, int] = {}
    for a in answers:
        i = index_of.get(a.question_id, 0)
        if _revealed(duel, i):
            revealed_scores[a.user_id] = revealed_scores.get(a.user_id, 0) + int(
                (a.answer or {}).get("points") or 0
            )
    current_qid = (
        duel.question_ids[int(duel.current_index)]
        if duel.mode == "live" and int(duel.current_index) < settings.count
        else None
    )
    out_players: list[so.DuelPlayer] = []
    for uid, p in players.items():
        is_me = uid == m.user_id
        score: int | None
        if duel.mode == "live":
            score = int(p.score) if final else revealed_scores.get(uid, 0)
        else:
            score = int(p.score) if (is_me or final) else None
        out_players.append(
            so.DuelPlayer(
                person=shown[uid],
                role=p.role,
                is_me=is_me,
                score=score,
                correct=int(p.correct) if (final or is_me) else None,
                answered_current=current_qid is not None
                and any(a.user_id == uid and a.question_id == current_qid for a in answers),
                away=duel.status == "live"
                and duel.mode == "live"
                and p.last_seen_at is not None
                and now - p.last_seen_at > grace,
                finished=p.finished_at is not None,
            )
        )
    me = players.get(m.user_id)
    current: so.DuelQuestion | None = None
    if duel.status == "live" or (duel.status == "pending" and duel.mode == "async"):
        index: int | None = None
        opens: datetime | None = None
        if (
            duel.mode == "live"
            and duel.start_at is not None
            and int(duel.current_index) < settings.count
        ):
            index, opens = int(duel.current_index), duel.question_opened_at or duel.start_at
        elif (
            duel.mode != "live"
            and me is not None
            and me.question_opened_at is not None
            and me.finished_at is None
        ):
            index, opens = int(me.current_index), me.question_opened_at
        if index is not None and opens is not None and index < settings.count:
            qid = duel.question_ids[index]
            body = (await bank.bodies(session, [qid])).get(qid) or {}
            current = so.DuelQuestion(
                index=index,
                question_id=qid,
                body=bank.public_body(body),
                opens_at=opens,
                closes_at=opens + settings.window,
                answered=any(a.user_id == m.user_id and a.question_id == qid for a in answers),
            )
    mine = [a for a in answers if a.user_id == m.user_id]
    keys_needed = [a.question_id for a in mine if _revealed(duel, index_of.get(a.question_id, 0))]
    keys = await bank.bodies(session, keys_needed)
    my_answers = sorted(
        (
            so.DuelMyAnswer(
                index=index_of.get(a.question_id, 0),
                question_id=a.question_id,
                correct=bool(a.is_correct),
                points=int((a.answer or {}).get("points") or 0),
                key=(keys.get(a.question_id) or {}).get("answer")
                if a.question_id in keys
                else None,
            )
            for a in mine
        ),
        key=lambda x: x.index,
    )
    result: so.DuelResult | None = None
    rematch: so.DuelRematch | None = None
    if duel.status in ("finished", "abandoned") and me is not None:
        earned = (
            await session.execute(
                text(
                    "select coalesce(sum(amount), 0) from game.xp_ledger where user_id = :u"
                    " and source = 'duel' and ref = :r"
                ),
                {"u": m.user_id, "r": f"duel:{duel.id}"},
            )
        ).scalar_one()
        result = so.DuelResult(
            winner=_outcome(duel, m.user_id),
            xp_earned=int(earned),
            not_counted=bool(me.flagged_fast),
            abandoned_by_me=duel.abandoned_by == m.user_id,
            abandoned_by_them=duel.abandoned_by is not None and duel.abandoned_by != m.user_id,
        )
    if duel.status == "finished":
        wait = flags.int_or_none("duel.rematch_wait_seconds")
        new_id = (
            await session.execute(
                text("select id from social.duels where rematch_of = :d"), {"d": duel.id}
            )
        ).scalar_one_or_none()
        until = duel.finished_at + timedelta(seconds=wait) if wait and duel.finished_at else None
        rematch = so.DuelRematch(
            available=duel.relation == "solo" or (until is not None and now <= until),
            requested_by_me=duel.rematch_requested_by == m.user_id,
            requested_by_them=duel.rematch_requested_by is not None
            and duel.rematch_requested_by != m.user_id,
            open_until=until,
            duel_id=new_id,
        )
    last_event = (
        await session.execute(
            text("select coalesce(max(id), 0) from social.duel_events where duel_id = :d"),
            {"d": duel.id},
        )
    ).scalar_one()
    return so.DuelState(
        id=duel.id,
        code=duel.code,
        mode=duel.mode,
        relation=duel.relation,
        status=duel.status,
        exam_profile_id=duel.exam_profile_id,
        subject_id=duel.subject_id,
        question_count=settings.count,
        question_seconds=settings.seconds,
        start_at=duel.start_at,
        expires_at=duel.expires_at,
        server_time=now,
        invite_timed_out=duel.status == "pending"
        and duel.mode == "live"
        and duel.expires_at is not None
        and now >= duel.expires_at,
        players=out_players,
        current=current,
        my_answers=my_answers,
        result=result,
        rematch=rematch,
        last_event_id=int(last_event),
    )


async def get(db: Database, auth: AuthContext, duel_id: uuid.UUID) -> so.DuelState:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags)
        duel = await _mine(session, duel_id, m.user_id)
        await _seen(session, duel_id, m.user_id, now)
        duel = await tick(session, duel, now)
        return await _state(session, duel, m, flags, now)


async def by_code(db: Database, auth: AuthContext, code: str) -> so.DuelState:
    async with db.system_tx() as session:
        duel_id = (
            await session.execute(text("select id from social.duels where code = :c"), {"c": code})
        ).scalar_one_or_none()
    if duel_id is None:
        raise not_found("duel_not_found", "No such duel")
    return await get(db, auth, duel_id)


async def events(
    db: Database, auth: AuthContext, duel_id: uuid.UUID, after: int
) -> tuple[so.DuelEvents, bool]:
    """The channel since ``after`` (polling); also returns whether the duel has ended."""
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags)
        duel = await _mine(session, duel_id, m.user_id)
        await _seen(session, duel_id, m.user_id, now)
        duel = await tick(session, duel, now)
        found = await channel().since(session, duel_id, after)
    items = [
        so.DuelEventOut(id=e.id, kind=e.kind, payload=e.payload, created_at=e.created_at)
        for e in found
    ]
    last = items[-1].id if items else after
    return so.DuelEvents(events=items, last_event_id=last), duel.status in FINAL


async def list_duels(db: Database, auth: AuthContext) -> list[so.DuelListItem]:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags)
        rows = (
            await session.execute(
                text(
                    "select d.*, p.finished_at as my_finished, p.question_opened_at as my_opened"
                    " from social.duels d join social.duel_players p on p.duel_id = d.id and p.user_id = :u"
                    " order by d.created_at desc limit 30"
                ),
                {"u": m.user_id},
            )
        ).all()
        others = {
            r.id: (r.opponent_id if r.challenger_id == m.user_id else r.challenger_id) for r in rows
        }
        shown = await sp.people(session, m, [o for o in others.values() if o is not None], flags)
        out: list[so.DuelListItem] = []
        for r in rows:
            other = others[r.id]
            pending_for_me = (
                r.status == "pending"
                and r.opponent_id == m.user_id
                and (r.expires_at is None or r.expires_at > now)
            )
            playing = (
                r.status in ("live", "pending")
                and r.mode == "async"
                and r.my_finished is None
                and r.my_opened is not None
            )
            out.append(
                so.DuelListItem(
                    id=r.id,
                    code=r.code,
                    mode=r.mode,
                    relation=r.relation,
                    status=r.status,
                    opponent=shown.get(other) if other is not None else None,
                    created_at=r.created_at,
                    winner=_outcome(r, m.user_id)
                    if r.status in ("finished", "abandoned")
                    else None,
                    my_turn=pending_for_me or playing,
                )
            )
        return out


# --- the sweep job ----------------------------------------------------------------------------


async def sweep(db: Database, now: datetime | None = None) -> int:
    """Every minute: advance clocks nobody is polling, expire duels both players left, async
    challenges past their time and stale invites, and drop stale queue entries."""
    now = now or datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        grace = timedelta(seconds=flags.int_or("duel.disconnect_grace_seconds", 15))
        ttl = timedelta(hours=flags.int_or("duel.async_ttl_hours", 24))
        ids = list(
            (
                await session.execute(
                    text(
                        "select id from social.duels where status in ('pending', 'live')"
                        " and settings ? 'count'"  # made by this service (see Settings)
                        " order by created_at limit 500"
                    )
                )
            ).scalars()
        )
        await session.execute(
            text(
                "delete from social.duel_queue where matched_duel_id is null and enqueued_at < :t"
            ),
            {"t": now - QUEUE_STALE},
        )
    touched = 0
    for duel_id in ids:
        async with db.system_tx() as session:
            duel = (
                await session.execute(
                    text("select * from social.duels where id = :d for update skip locked"),
                    {"d": duel_id},
                )
            ).one_or_none()
            if duel is None or duel.status in FINAL:
                continue
            if duel.status == "pending" and duel.mode == "live":
                if duel.expires_at is not None and now >= duel.expires_at + ttl:
                    await _expire(session, duel, now)
                    touched += 1
                continue
            if duel.mode == "live" and duel.start_at is not None and now >= duel.start_at + grace:
                players = await _players(session, duel_id)
                gone = all(
                    p.last_seen_at is None or now - p.last_seen_at > grace for p in players.values()
                )
                if gone:
                    await _expire(session, duel, now)
                    touched += 1
                    continue
            after = await tick(session, duel, now)
            touched += int(after.status != duel.status)
    return touched


async def sweep_job(deps: JobDeps) -> int:
    return await sweep(deps.db)
