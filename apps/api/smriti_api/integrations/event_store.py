"""Where accepted product and learning events go (DB_SCHEMA §14 ``events``), behind an interface.

- :class:`ClickHouseEventStore` inserts into ClickHouse's ``events`` table when ``CLICKHOUSE_URL``
  is set (the same HTTP client the data jobs use).
- :class:`FileEventStore` appends JSON lines to a local file: the local and test stand-in
  (``ANALYTICS_EVENTS_FILE``, default ``.dev/analytics/events.jsonl``). Never used in production.
- :class:`MemoryEventStore` keeps rows in memory, for tests.

Rows hold only what the ingest kept: catalogue names, ids, tokens, numbers and booleans.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any, Protocol

from smriti_api.integrations.analytics_store import ClickHouseClient

EVENTS_TABLE = "events"


class EventStore(Protocol):
    async def write(self, rows: Sequence[dict[str, Any]]) -> None: ...


class ClickHouseEventStore:
    def __init__(self, client: ClickHouseClient) -> None:
        self._client = client

    async def write(self, rows: Sequence[dict[str, Any]]) -> None:
        await self._client.insert(EVENTS_TABLE, rows)


class FileEventStore:
    """Local development: one JSON object per line."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = asyncio.Lock()

    def _append(self, text: str) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as f:
            f.write(text)

    async def write(self, rows: Sequence[dict[str, Any]]) -> None:
        if not rows:
            return
        text = "".join(json.dumps(r, default=str, sort_keys=True) + "\n" for r in rows)
        async with self._lock:
            await asyncio.to_thread(self._append, text)


class MemoryEventStore:
    """Tests: the rows written, in order."""

    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = []

    async def write(self, rows: Sequence[dict[str, Any]]) -> None:
        self.rows.extend(dict(r) for r in rows)
