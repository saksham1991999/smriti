"""Server-side analytics events (auth flow §11 "Server-side events") behind an interface.

The worker owns the ClickHouse writer; the API only emits through this sink. Props are
numbers and enums from the typed catalogue, never free text or personal data.
"""

from __future__ import annotations

import uuid
from typing import Protocol

import structlog

from smriti_api.core.logging import hash_user_id

log = structlog.get_logger("analytics")

Props = dict[str, str | int | float | bool | None]


class AnalyticsSink(Protocol):
    async def emit(self, name: str, user_id: uuid.UUID | None, props: Props) -> None: ...

    async def alias(self, alias_user_id: uuid.UUID, canonical_user_id: uuid.UUID) -> None: ...


class LogAnalyticsSink:
    """Writes events to the structured log (shipped by the log drain). Default until ClickHouse."""

    async def emit(self, name: str, user_id: uuid.UUID | None, props: Props) -> None:
        log.info(
            "analytics_event",
            analytics_event=name,
            user=hash_user_id(user_id) if user_id else None,
            **props,
        )

    async def alias(self, alias_user_id: uuid.UUID, canonical_user_id: uuid.UUID) -> None:
        log.info(
            "analytics_alias",
            alias=hash_user_id(alias_user_id),
            canonical=hash_user_id(canonical_user_id),
        )


class FakeAnalyticsSink:
    """Collects events in memory, for tests."""

    def __init__(self) -> None:
        self.events: list[tuple[str, uuid.UUID | None, Props]] = []
        self.aliases: list[tuple[uuid.UUID, uuid.UUID]] = []

    async def emit(self, name: str, user_id: uuid.UUID | None, props: Props) -> None:
        self.events.append((name, user_id, props))

    async def alias(self, alias_user_id: uuid.UUID, canonical_user_id: uuid.UUID) -> None:
        self.aliases.append((alias_user_id, canonical_user_id))
