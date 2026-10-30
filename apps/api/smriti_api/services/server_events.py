"""Server-made learning events. Practice answers checked online, the daily challenge and mock
sections go through the same sync path as the client's outbox (``services/sync.apply_batch``), so
mastery, XP, activity days, the streak and the plant are recomputed in one place."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text

from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.schemas import sync as s
from smriti_api.services.recompute import DEFAULT_TZ, zone
from smriti_api.services.sync import apply_batch


@dataclass(frozen=True)
class ServerEvent:
    event_id: uuid.UUID
    type: str
    payload: dict[str, Any]


async def apply_events(
    db: Database,
    auth: AuthContext,
    events: list[ServerEvent],
    *,
    tz: str | None = None,
    device_id: uuid.UUID | None = None,
    app_variant: str | None = None,
    now: datetime | None = None,
) -> int:
    """Applies events at ``now`` on the local day of ``tz`` (the device's zone when the client
    sent one, R23), else the profile's zone. A repeated event id is a no-op."""
    now = now or datetime.now(UTC)
    zone_name = tz if tz and zone(tz).key == tz else None
    if zone_name is None:
        async with db.system_tx() as session:
            zone_name = (
                await session.execute(
                    text("select timezone from app.profiles where user_id = :u"),
                    {"u": auth.user_id},
                )
            ).scalar_one_or_none() or DEFAULT_TZ
    result = await apply_batch(
        db,
        user_id=auth.user_id,
        device_id=device_id,
        events=[
            s.SyncEventIn(
                event_id=e.event_id, type=e.type, occurred_at=now, tz=zone_name, payload=e.payload
            )
            for e in events
        ],
        app_variant=app_variant,
        now=now,
    )
    if result.rejected:
        r = result.rejected[0]
        raise ApiError(409, r.code, r.detail or "Not possible right now")
    return result.state_version
