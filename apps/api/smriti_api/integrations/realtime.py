"""Realtime fan-out behind one interface (practice §6.11, DB_SCHEMA §12, TRD §16).

Live mocks broadcast the start signal, the server clock and the results on channel
``mock:{id}``. In production that is a Supabase Realtime broadcast, sent from the server through
the REST endpoint (``/realtime/v1/api/broadcast``) with the service key. Every event also goes to
Redis pub/sub, which feeds the API's Server-Sent Events stream: that is the local path, and a
fallback for clients that can't hold a Realtime socket. Clients never depend on either to run.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx
import structlog
from redis.asyncio import Redis

log = structlog.get_logger(__name__)

REDIS_PREFIX = "rt:"


class RealtimePublisher(Protocol):
    name: str

    async def publish(self, channel: str, event: str, payload: dict[str, Any]) -> None: ...


@dataclass
class RedisRealtime:
    """Redis pub/sub; the source for the SSE stream (and all there is locally)."""

    redis: Redis
    name: str = "redis"

    async def publish(self, channel: str, event: str, payload: dict[str, Any]) -> None:
        message = json.dumps({"event": event, "payload": payload}, default=str)
        await self.redis.publish(f"{REDIS_PREFIX}{channel}", message)

    async def subscribe(self, channel: str) -> AsyncIterator[dict[str, Any]]:
        pubsub = self.redis.pubsub()
        await pubsub.subscribe(f"{REDIS_PREFIX}{channel}")
        try:
            while True:
                msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if msg is None:
                    yield {}
                    continue
                data = msg.get("data")
                raw = data.decode() if isinstance(data, bytes) else str(data)
                try:
                    yield dict(json.loads(raw))
                except (ValueError, TypeError):
                    continue
        finally:
            await pubsub.unsubscribe()
            await pubsub.aclose()  # type: ignore[no-untyped-call]


@dataclass
class SupabaseRealtime:
    """Server-side broadcast through Supabase Realtime's REST endpoint (private channels)."""

    http: httpx.AsyncClient
    url: str
    service_key: str
    name: str = "supabase"

    async def publish(self, channel: str, event: str, payload: dict[str, Any]) -> None:
        body = {
            "messages": [{"topic": channel, "event": event, "payload": payload, "private": True}]
        }
        try:
            r = await self.http.post(
                f"{self.url.rstrip('/')}/realtime/v1/api/broadcast",
                json=body,
                headers={
                    "apikey": self.service_key,
                    "Authorization": f"Bearer {self.service_key}",
                },
                timeout=5,
            )
        except httpx.HTTPError as exc:
            log.warning("realtime_publish_failed", channel=channel, error_type=type(exc).__name__)
            return
        if r.status_code >= 300:
            log.warning("realtime_publish_failed", channel=channel, status=r.status_code)


@dataclass
class FanOut:
    targets: Sequence[RealtimePublisher]
    name: str = "fanout"

    async def publish(self, channel: str, event: str, payload: dict[str, Any]) -> None:
        for target in self.targets:
            await target.publish(channel, event, payload)


@dataclass
class RecordingRealtime:
    """Tests: keeps what was published."""

    name: str = "recording"
    sent: list[tuple[str, str, dict[str, Any]]] = field(default_factory=list)

    async def publish(self, channel: str, event: str, payload: dict[str, Any]) -> None:
        self.sent.append((channel, event, payload))


def build_realtime(
    *,
    provider: str,
    dev: bool,
    http: httpx.AsyncClient,
    redis: Redis,
    supabase_url: str,
    service_key: str,
) -> RealtimePublisher:
    local = RedisRealtime(redis)
    use_supabase = provider.lower() == "supabase" or (
        not provider and not dev and bool(supabase_url and service_key)
    )
    if use_supabase and supabase_url and service_key:
        return FanOut([SupabaseRealtime(http, supabase_url, service_key), local])
    return local
