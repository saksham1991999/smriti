"""Idempotency keys for mutations that touch progress or money (AGENTS.md "API", TRD §5).

The client sends ``Idempotency-Key``. The first request with a key runs and its response is
stored in Redis for 24 hours; a repeat with the same key and body gets the stored response.
The same key with a different body is a 422. DB_SCHEMA has no idempotency table, so Redis is
the store; sync events are idempotent by ``event_id`` in Postgres instead.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Awaitable, Callable
from typing import Any

from redis.asyncio import Redis

from smriti_api.core.errors import ApiError

TTL_S = 24 * 3600
LOCK_TTL_S = 60


def body_fingerprint(body: Any) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest()


def validate_key(key: str | None, *, required: bool = True) -> str | None:
    if key is None:
        if required:
            raise ApiError(400, "idempotency_key_required", "Send an Idempotency-Key header")
        return None
    if not 8 <= len(key) <= 128 or not all(c.isalnum() or c in "-_:." for c in key):
        raise ApiError(
            400, "idempotency_key_invalid", "Idempotency-Key must be 8-128 safe characters"
        )
    return key


class IdempotencyStore:
    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def run(
        self,
        *,
        scope: str,
        subject: str,
        key: str,
        body: Any,
        fn: Callable[[], Awaitable[tuple[int, Any]]],
    ) -> tuple[int, Any]:
        base = f"idem:{scope}:{subject}:{key}"
        fingerprint = body_fingerprint(body)
        stored = await self._redis.get(base)
        if stored is not None:
            return self._replay(stored, fingerprint)
        acquired = await self._redis.set(f"{base}:lock", "1", nx=True, ex=LOCK_TTL_S)
        if not acquired:
            stored = await self._redis.get(base)
            if stored is not None:
                return self._replay(stored, fingerprint)
            raise ApiError(409, "idempotency_in_progress", "The same request is still running")
        try:
            status, result = await fn()
            if status < 500:
                record = json.dumps(
                    {"fp": fingerprint, "status": status, "body": result}, default=str
                )
                await self._redis.set(base, record, ex=TTL_S)
            return status, result
        finally:
            await self._redis.delete(f"{base}:lock")

    @staticmethod
    def _replay(stored: str, fingerprint: str) -> tuple[int, Any]:
        record = json.loads(stored)
        if record["fp"] != fingerprint:
            raise ApiError(
                422,
                "idempotency_key_reused",
                "This Idempotency-Key was used for a different request",
            )
        return int(record["status"]), record["body"]
