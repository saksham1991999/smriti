"""Redis client: cache, rate limits, idempotency keys and the arq queues (TRD §5)."""

from __future__ import annotations

from redis.asyncio import Redis


def create_redis(url: str) -> Redis:
    client: Redis = Redis.from_url(
        url, decode_responses=True, socket_timeout=2, socket_connect_timeout=2
    )
    return client
