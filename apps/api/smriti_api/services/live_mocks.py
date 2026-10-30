"""Live mocks (Phase 3, practice §6.11, PRD §17).

A live mock is a ``content.mocks`` row of kind ``live`` with a window. The attempt itself is the
ordinary mock attempt (``services.mocks.start`` already applies the live policy: start inside the
window, deadline capped at ``window_end``, server clock only). This module adds what is live-only:

- registration (Pro), which queues the ``mock_reminder`` push for when the room opens;
- the room (MOCK-03): status, server time and the deadline a start now would get;
- the worker tick: the start signal and the clock on channel ``mock:{id}``, and, once
  ``results_at`` (or ``window_end``) has passed and every attempt in the window is settled, ranks
  and percentiles frozen onto the first attempts started inside the window (R26);
- the leaderboard (MOCK-24, R31).
"""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.integrations.realtime import RealtimePublisher, RedisRealtime
from smriti_api.schemas import live as lv
from smriti_api.services import consent, mocks, notify
from smriti_api.services import mock_paper as mp
from smriti_api.services.usage import Flags, load_flags, load_learner

if TYPE_CHECKING:
    from smriti_api.services.jobs import JobDeps

log = structlog.get_logger(__name__)

HEARTBEAT_S = 15


def channel(mock_id: str) -> str:
    return f"mock:{mock_id}"


async def _mock(session: AsyncSession, mock_id: str) -> Any:
    row = (
        await session.execute(
            text(
                "select m.id, m.title, m.blueprint_id, m.window_start, m.window_end, m.results_at,"
                " r.start_signal_at, r.ranks_published_at, r.ranked, r.unranked_reason"
                " from content.mocks m left join ops.live_mock_runs r on r.mock_id = m.id"
                " where m.id = :id and m.kind = 'live' and m.status in ('scheduled', 'open', 'closed')"
                " and m.window_start is not null and m.window_end is not null"
            ),
            {"id": mock_id},
        )
    ).one_or_none()
    if row is None:
        raise ApiError(404, "not_found", "This live mock isn't available", detail=mock_id[:200])
    return row


def _room_opens(row: Any, flags: Flags) -> datetime:
    lead = flags.int_or_none("live.room_lead_min")
    start: datetime = row.window_start
    return start - timedelta(minutes=lead) if lead else start


def _status(row: Any, flags: Flags, now: datetime) -> lv.LiveStatus:
    if row.ranks_published_at is not None:
        return "results"
    if now >= row.window_end:
        return "closed"
    if now >= row.window_start:
        return "live"
    return "room_open" if now >= _room_opens(row, flags) else "scheduled"


async def _duration_s(session: AsyncSession, blueprint_id: uuid.UUID) -> int | None:
    bp = await mp.blueprint_by_id(session, blueprint_id)
    minutes = bp.spec.get("duration_min") if bp is not None else None
    return int(minutes) * 60 if isinstance(minutes, int | float) and minutes > 0 else None


def _enabled(flags: Flags) -> None:
    if not flags.bool("live.enabled"):
        raise ApiError(404, "not_found", "Live mocks aren't available here")


# --- the room and registration ---------------------------------------------------------------------


async def room(db: Database, auth: AuthContext, mock_id: str) -> lv.LiveRoom:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        _enabled(flags)
        row = await _mock(session, mock_id)
        duration = await _duration_s(session, row.blueprint_id)
        registered = (
            await session.execute(
                text("select 1 from learn.mock_registrations where mock_id = :m and user_id = :u"),
                {"m": mock_id, "u": auth.user_id},
            )
        ).first() is not None
        registrations = int(
            (
                await session.execute(
                    text("select count(*) from learn.mock_registrations where mock_id = :m"),
                    {"m": mock_id},
                )
            ).scalar_one()
        )
        attempt = (
            await session.execute(
                text(
                    "select id, status from learn.mock_attempts where user_id = :u and mock_id = :m"
                    " order by started_at desc limit 1"
                ),
                {"u": auth.user_id, "m": mock_id},
            )
        ).one_or_none()
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
    status = _status(row, flags, now)
    open_now = status == "live"
    deadline = None
    if open_now and duration is not None:
        deadline = min(now + timedelta(seconds=duration), row.window_end)
    return lv.LiveRoom(
        mock_id=row.id,
        title=dict(row.title),
        status=status,
        server_time=now,
        window_start=row.window_start,
        window_end=row.window_end,
        results_at=row.results_at,
        room_opens_at=_room_opens(row, flags),
        duration_s=duration,
        full_duration_until=(
            row.window_end - timedelta(seconds=duration) if duration is not None else None
        ),
        deadline_if_started_now=deadline,
        can_start=open_now and learner.is_pro and attempt is None,
        registered=registered,
        registrations=registrations,
        attempt_id=attempt.id if attempt is not None else None,
        attempt_status=attempt.status if attempt is not None else None,
        ranks_published=row.ranks_published_at is not None,
        channel=channel(row.id),
        events_url=f"/v1/live/mocks/{row.id}/events",
    )


def _reminder_key(mock_id: str, user_id: uuid.UUID) -> str:
    return f"mock_reminder:{mock_id}:{user_id}"


async def register(db: Database, auth: AuthContext, mock_id: str) -> lv.Registration:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        _enabled(flags)
        row = await _mock(session, mock_id)
        if now >= row.window_end:
            raise ApiError(409, "window_closed", "This live mock has ended")
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        if not learner.is_pro:
            raise ApiError(
                403,
                "pro_required",
                "Live mocks are part of Pro",
                paywall_trigger="mock_limit",
                paywall_source="live_mock",
            )
        await session.execute(
            text(
                "insert into learn.mock_registrations (mock_id, user_id) values (:m, :u)"
                " on conflict do nothing"
            ),
            {"m": mock_id, "u": auth.user_id},
        )
        at = _room_opens(row, flags)
        reminder_at: datetime | None = None
        if at > now:
            await notify.enqueue(
                session,
                user_id=auth.user_id,
                kind="mock_reminder",
                payload={"mock_id": mock_id},
                dedupe_key=_reminder_key(mock_id, auth.user_id),
                not_before=at,
            )
            reminder_at = at
    return lv.Registration(mock_id=mock_id, registered=True, reminder_at=reminder_at)


async def unregister(db: Database, auth: AuthContext, mock_id: str) -> lv.Registration:
    async with db.system_tx() as session:
        await session.execute(
            text("delete from learn.mock_registrations where mock_id = :m and user_id = :u"),
            {"m": mock_id, "u": auth.user_id},
        )
        await session.execute(
            text(
                "delete from notify.outbox where dedupe_key = :k and status in ('queued', 'held')"
            ),
            {"k": _reminder_key(mock_id, auth.user_id)},
        )
    return lv.Registration(mock_id=mock_id, registered=False, reminder_at=None)


# --- the worker tick: start signal, clock, ranks ------------------------------------------------------


async def tick(
    db: Database, realtime: RealtimePublisher | None, now: datetime | None = None
) -> dict[str, int]:
    """Every minute: fan out the start signal and the clock for open windows, and freeze ranks for
    windows whose results time has passed."""
    now = now or datetime.now(UTC)
    counts = {"started": 0, "clocks": 0, "published": 0}
    async with db.system_tx() as session:
        rows = (
            await session.execute(
                text(
                    "select m.id, m.window_start, m.window_end, m.results_at, r.start_signal_at,"
                    " r.last_clock_at"
                    " from content.mocks m left join ops.live_mock_runs r on r.mock_id = m.id"
                    " where m.kind = 'live' and m.status in ('scheduled', 'open', 'closed')"
                    " and m.window_start is not null and m.window_end is not null"
                    " and m.window_start <= :now and r.ranks_published_at is null"
                ),
                {"now": now},
            )
        ).all()
    for row in rows:
        ch = channel(row.id)
        if now < row.window_end:
            if row.start_signal_at is None:
                if realtime is not None:
                    await realtime.publish(
                        ch,
                        "start",
                        {
                            "server_time": now.isoformat(),
                            "window_start": row.window_start.isoformat(),
                            "window_end": row.window_end.isoformat(),
                        },
                    )
                counts["started"] += 1
            if realtime is not None:
                await realtime.publish(
                    ch,
                    "clock",
                    {
                        "server_time": now.isoformat(),
                        "window_end": row.window_end.isoformat(),
                        "remaining_s": int((row.window_end - now).total_seconds()),
                    },
                )
            counts["clocks"] += 1
            await _mark(db, row.id, start=row.start_signal_at is None, clock=now)
            continue
        if row.last_clock_at is None or row.last_clock_at < row.window_end:
            if realtime is not None:
                await realtime.publish(ch, "closed", {"server_time": now.isoformat()})
            await _mark(db, row.id, start=False, clock=now)
        if now >= (row.results_at or row.window_end) and await publish_ranks(db, row.id, now):
            counts["published"] += 1
            if realtime is not None:
                await realtime.publish(ch, "results", {"server_time": now.isoformat()})
    return counts


async def _mark(db: Database, mock_id: str, *, start: bool, clock: datetime) -> None:
    async with db.system_tx() as session:
        await session.execute(
            text(
                """
                insert into ops.live_mock_runs (mock_id, start_signal_at, last_clock_at)
                values (:m, case when :start then cast(:at as timestamptz) end, :at)
                on conflict (mock_id) do update set
                  start_signal_at = coalesce(ops.live_mock_runs.start_signal_at,
                                             case when :start then cast(:at as timestamptz) end),
                  last_clock_at = :at
                """
            ),
            {"m": mock_id, "start": start, "at": clock},
        )


_IN_WINDOW = """
      from learn.mock_attempts a
     where a.mock_id = :m and a.kind = 'live' and a.attempt_no = 1 and a.score is not null
       and a.status in ('submitted', 'auto_submitted')
       and a.started_at >= :ws and a.started_at < :we
"""


async def publish_ranks(db: Database, mock_id: str, now: datetime) -> bool:
    """Freezes rank and percentile on the first attempts started inside the window (R26). Waits
    while any attempt of the window is still open: the mock's own sweep settles those first."""
    await mocks.auto_submit_expired(db, now)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        row = await _mock(session, mock_id)
        if row.ranks_published_at is not None:
            return False
        open_attempts = (
            await session.execute(
                text(
                    "select count(*) from learn.mock_attempts where mock_id = :m"
                    " and status = 'in_progress'"
                ),
                {"m": mock_id},
            )
        ).scalar_one()
        if open_attempts:
            return False
        window = {"m": mock_id, "ws": row.window_start, "we": row.window_end}
        counted = int(
            (await session.execute(text("select count(*)" + _IN_WINDOW), window)).scalar_one()
        )
        needed = flags.int_or_none("mock.min_attempts_for_percentile")
        reason = None
        if needed is None:
            reason = "threshold_unset"
        elif counted < needed:
            reason = "below_threshold"
        ranked = 0
        if reason is None:
            ranked = len(
                (
                    await session.execute(
                        text(_RANK_SQL),
                        window,
                    )
                ).all()
            )
        await session.execute(
            text(
                """
                insert into ops.live_mock_runs (mock_id, ranks_published_at, ranked, unranked_reason)
                values (:m, :at, :n, :r)
                on conflict (mock_id) do update set
                  ranks_published_at = :at, ranked = :n, unranked_reason = :r
                """
            ),
            {"m": mock_id, "at": now, "n": ranked, "r": reason},
        )
    log.info("live_mock_ranks_published", ranked=ranked, reason=reason)
    return True


_RANK_HEAD = """
    with ranked as (
      select a.id,
             rank() over (order by a.score desc) as r,
             cume_dist() over (order by a.score) as cd
    """
_RANK_TAIL = """
    )
    update learn.mock_attempts t
       set rank = ranked.r, percentile = round((100 * ranked.cd)::numeric, 2)
      from ranked
     where t.id = ranked.id
    returning t.id
    """
_RANK_SQL = _RANK_HEAD + _IN_WINDOW + _RANK_TAIL


async def tick_job(deps: JobDeps) -> dict[str, int]:
    return await tick(deps.db, deps.realtime)


# --- the leaderboard ---------------------------------------------------------------------------------


async def leaderboard(
    db: Database, auth: AuthContext, mock_id: str, limit: int
) -> lv.LiveLeaderboard:
    """R31: adults by display name; under-18s only with guardian consent for social, by the pet
    avatar and the auto nickname. Guests are never listed. Everyone sees their own row."""
    async with db.system_tx() as session:
        flags = await load_flags(session)
        _enabled(flags)
        row = await _mock(session, mock_id)
        if row.ranks_published_at is None or row.unranked_reason is not None:
            return lv.LiveLeaderboard(
                mock_id=mock_id,
                published=row.ranks_published_at is not None,
                reason=row.unranked_reason or "results_pending",
                ranked=0,
                rows=[],
                you=None,
            )
        rows = (
            await session.execute(
                text(
                    """
                    select a.user_id, a.rank, a.score, a.percentile, pr.display_name, pr.is_minor,
                           pr.nickname_word_ids, pr.nickname_number, u.is_anonymous, pet.species
                      from learn.mock_attempts a
                      join app.profiles pr on pr.user_id = a.user_id
                      join auth.users u on u.id = a.user_id
                      left join game.pets pet on pet.user_id = a.user_id
                     where a.mock_id = :m and a.rank is not null
                     order by a.rank, a.started_at
                    """
                ),
                {"m": mock_id},
            )
        ).all()
        shown: list[lv.LiveLeaderboardRow] = []
        you: lv.LiveLeaderboardRow | None = None
        for r in rows:
            out = _row_out(r, auth.user_id)
            if r.user_id == auth.user_id:
                you = out
            if len(shown) < limit and await _visible(session, r):
                shown.append(out)
    return lv.LiveLeaderboard(
        mock_id=mock_id, published=True, ranked=int(row.ranked), rows=shown, you=you
    )


async def _visible(session: AsyncSession, r: Any) -> bool:
    if r.is_anonymous:
        return False
    if not r.is_minor:
        return True
    return await consent.has_social_consent(session, r.user_id)


def _row_out(r: Any, me: uuid.UUID) -> lv.LiveLeaderboardRow:
    if r.is_minor:
        words = "-".join(r.nickname_word_ids or [])
        name = f"{words}:{r.nickname_number}" if words else None
        avatar = f"pet:{r.species}" if r.species else None
    else:
        name, avatar = r.display_name, None
    return lv.LiveLeaderboardRow(
        rank=int(r.rank),
        name=name,
        avatar=avatar,
        is_you=r.user_id == me,
        score=float(r.score),
        percentile=float(r.percentile) if r.percentile is not None else None,
    )


# --- Server-Sent Events (the local path, and a fallback) ---------------------------------------------


def sse(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, default=str)}\n\n"


async def event_stream(
    rt: RedisRealtime, mock_id: str, *, heartbeat_s: float = HEARTBEAT_S
) -> AsyncIterator[str]:
    """``hello`` with the server time, then every event on ``mock:{id}``, with comment heartbeats."""
    yield sse("hello", {"server_time": datetime.now(UTC).isoformat(), "channel": channel(mock_id)})
    loop = asyncio.get_running_loop()
    last = loop.time()
    async for msg in rt.subscribe(channel(mock_id)):
        if msg:
            yield sse(str(msg.get("event", "message")), dict(msg.get("payload") or {}))
            last = loop.time()
        elif loop.time() - last >= heartbeat_s:
            yield ": ping\n\n"
            last = loop.time()
