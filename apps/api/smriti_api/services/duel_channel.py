"""The realtime side of duels, behind one interface (tutor-social B10, TRD §5).

The server is the only writer: every duel change (start, answered, reveal, finished, rematch)
is published on the duel's channel. Clients read it by polling ``GET /v1/duels/{id}/events``
or by the SSE stream; a Supabase Realtime implementation (broadcast on ``duel:{id}``, the same
participants-only rule) can replace :class:`LocalDuelChannel` later without touching the duel
service, because callers only use :class:`DuelChannel`.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(frozen=True)
class DuelEvent:
    id: int
    kind: str
    payload: dict[str, Any]
    created_at: datetime


class DuelChannel(Protocol):
    async def publish(
        self, session: AsyncSession, duel_id: uuid.UUID, kind: str, payload: Mapping[str, Any]
    ) -> int: ...

    async def since(
        self, session: AsyncSession, duel_id: uuid.UUID, after: int, limit: int = 200
    ) -> Sequence[DuelEvent]: ...


class LocalDuelChannel:
    """Events go to ``social.duel_events`` in the same transaction as the change they describe,
    so a reader never sees an event for a change that rolled back."""

    async def publish(
        self, session: AsyncSession, duel_id: uuid.UUID, kind: str, payload: Mapping[str, Any]
    ) -> int:
        return int(
            (
                await session.execute(
                    text(
                        "insert into social.duel_events (duel_id, kind, payload)"
                        " values (:d, :k, cast(:p as jsonb)) returning id"
                    ),
                    {"d": duel_id, "k": kind, "p": json.dumps(dict(payload), default=str)},
                )
            ).scalar_one()
        )

    async def since(
        self, session: AsyncSession, duel_id: uuid.UUID, after: int, limit: int = 200
    ) -> Sequence[DuelEvent]:
        rows = (
            await session.execute(
                text(
                    "select id, kind, payload, created_at from social.duel_events"
                    " where duel_id = :d and id > :a order by id limit :n"
                ),
                {"d": duel_id, "a": after, "n": limit},
            )
        ).all()
        return [DuelEvent(int(r.id), r.kind, dict(r.payload), r.created_at) for r in rows]


_channel: DuelChannel = LocalDuelChannel()


def channel() -> DuelChannel:
    return _channel
