"""Device attestation on sensitive endpoints and the anti-cheat flags (G-10, TRD §10, §14).

The flow, on Android and iOS:

1. ``POST /v1/integrity/challenge`` gives a one-time nonce (Redis, a few minutes).
2. Android asks Play Integrity for a token with that nonce. iOS registers its App Attest key once
   (``POST /v1/integrity/app-attest/keys``) and then signs an assertion over a fresh nonce.
3. The sensitive call carries ``X-Integrity-Token``, ``X-Integrity-Nonce`` and, on iOS,
   ``X-Integrity-Key-Id``.

``security.attestation_required`` (off by default) turns enforcement on. While it is off the
headers are ignored. The web app has no platform attestation; it keeps its rate limits and
Turnstile. A failed check is a 403 and an ``ops.integrity_flags`` row; nothing else is logged
about the device.
"""

from __future__ import annotations

import base64
import binascii
import json
import secrets
import uuid
from collections.abc import Iterable
from typing import Any, Literal

import structlog
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.core.logging import hash_user_id
from smriti_api.integrations.attestation import AppAttestKey, AttestationError, AttestationVerifier
from smriti_api.schemas import integrity as i
from smriti_api.services.usage import load_flags

log = structlog.get_logger(__name__)

NONCE_PREFIX = "integrity:nonce:"
HEADERS = ["X-Integrity-Token", "X-Integrity-Nonce", "X-Integrity-Key-Id"]
Source = Literal["sync", "attestation", "duel", "mock"]
UNAVAILABLE = {"not_configured", "provider_unavailable"}
MAX_EVENT_IDS = 20


async def record_flag(
    session: AsyncSession,
    user_id: uuid.UUID | None,
    *,
    source: Source,
    kind: str,
    events: int = 1,
    event_ids: Iterable[uuid.UUID] = (),
    detail: dict[str, Any] | None = None,
) -> None:
    """One row for the anti-cheat review. Event ids and numbers only, never content."""
    await session.execute(
        text(
            "insert into ops.integrity_flags (user_id, source, kind, events, event_ids, detail)"
            " values (:u, :src, :k, :n, :ids, cast(:d as jsonb))"
        ),
        {
            "u": user_id,
            "src": source,
            "k": kind,
            "n": max(1, events),
            "ids": list(event_ids)[:MAX_EVENT_IDS],
            "d": json.dumps(detail or {}),
        },
    )
    log.info(
        "integrity_flag",
        user=hash_user_id(user_id) if user_id else None,
        source=source,
        kind=kind,
        events=events,
    )


# --- nonces ----------------------------------------------------------------------------------------


async def issue_challenge(redis: Redis, user_id: uuid.UUID, ttl_s: int) -> i.ChallengeOut:
    nonce = secrets.token_urlsafe(32)
    await redis.set(f"{NONCE_PREFIX}{nonce}", str(user_id), ex=ttl_s)
    return i.ChallengeOut(nonce=nonce, expires_in_s=ttl_s, headers=HEADERS)


async def consume_nonce(redis: Redis, nonce: str, user_id: uuid.UUID) -> bool:
    owner = await redis.getdel(f"{NONCE_PREFIX}{nonce[:128]}")
    if owner is None:
        return False
    value = owner.decode() if isinstance(owner, bytes) else str(owner)
    return value == str(user_id)


def _b64(value: str) -> bytes:
    try:
        return base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_")
    except (binascii.Error, ValueError) as exc:
        raise ApiError(422, "invalid_base64", "The attestation is not base64") from exc


# --- App Attest keys -------------------------------------------------------------------------------


async def register_app_attest_key(
    db: Database,
    redis: Redis,
    verifier: AttestationVerifier | None,
    *,
    user_id: uuid.UUID,
    device_id: uuid.UUID | None,
    variant: str | None,
    body: i.AppAttestKeyIn,
) -> i.AppAttestKeyOut:
    if verifier is None or not verifier.configured("ios"):
        raise ApiError(503, "attestation_unavailable", "App Attest is not set up on this server")
    if not await consume_nonce(redis, body.nonce, user_id):
        raise ApiError(403, "attestation_nonce_invalid", "Ask for a new challenge and try again")
    try:
        key = verifier.verify_app_attestation(
            key_id=body.key_id,
            attestation=_b64(body.attestation),
            nonce=body.nonce,
            variant=variant,
        )
    except AttestationError as exc:
        if exc.reason in UNAVAILABLE:
            raise ApiError(503, "attestation_unavailable", "Try again later") from exc
        async with db.system_tx() as session:
            await record_flag(
                session, user_id, source="attestation", kind="attest_failed",
                detail={"reason": exc.reason, "platform": "ios"},
            )  # fmt: skip
        raise ApiError(403, "attestation_failed", "This device could not be verified") from exc
    async with db.system_tx() as session:
        inserted = (
            await session.execute(
                text(
                    """
                    insert into app.attest_keys
                      (key_id, user_id, device_id, app_id, environment, public_key, sign_count, receipt)
                    values (:k, :u, :d, :app, :env, :pk, 0, :r)
                    on conflict (key_id) do nothing
                    returning key_id
                    """
                ),
                {
                    "k": key.key_id,
                    "u": user_id,
                    "d": device_id,
                    "app": key.app_id,
                    "env": key.environment,
                    "pk": key.public_key_der,
                    "r": key.receipt,
                },
            )
        ).one_or_none()
    if inserted is None:
        raise ApiError(409, "key_exists", "This key is already registered")
    env: Literal["production", "development"] = (
        "development" if key.environment == "development" else "production"
    )
    return i.AppAttestKeyOut(key_id=key.key_id, environment=env)


# --- enforcement -----------------------------------------------------------------------------------


async def attestation_required(db: Database) -> bool:
    async with db.system_tx() as session:
        return (await load_flags(session)).bool("security.attestation_required")


async def enforce(
    db: Database,
    redis: Redis,
    verifier: AttestationVerifier | None,
    *,
    user_id: uuid.UUID,
    platform: str | None,
    variant: str | None,
    action: str,
    token: str | None,
    nonce: str | None,
    key_id: str | None,
) -> None:
    """Raises unless the call carries a good attestation, when the flag asks for one."""
    if platform not in ("ios", "android"):
        return  # web: rate limits and Turnstile; there is no platform attestation
    if not await attestation_required(db):
        return
    if verifier is None or not verifier.configured(platform):
        raise ApiError(503, "attestation_unavailable", "Device checks are not set up; try later")
    if not token or not nonce or (platform == "ios" and not key_id):
        raise ApiError(
            403,
            "attestation_required",
            "This action needs a device check",
            detail="Ask POST /v1/integrity/challenge, then send " + ", ".join(HEADERS),
        )
    reason: str | None = None
    if not await consume_nonce(redis, nonce, user_id):
        reason = "nonce_invalid"
    else:
        try:
            if platform == "android":
                await verifier.verify_play_integrity(token=token, nonce=nonce, variant=variant)
            else:
                reason = await _assert_ios(db, verifier, key_id or "", token, nonce)
        except AttestationError as exc:
            if exc.reason in UNAVAILABLE:
                raise ApiError(503, "attestation_unavailable", "Try again later") from exc
            reason = exc.reason
    if reason is None:
        return
    async with db.system_tx() as session:
        await record_flag(
            session, user_id, source="attestation", kind="attestation_failed",
            detail={"reason": reason, "platform": platform, "action": action},
        )  # fmt: skip
    raise ApiError(403, "attestation_failed", "This device could not be verified")


async def _assert_ios(
    db: Database, verifier: AttestationVerifier, key_id: str, token: str, nonce: str
) -> str | None:
    async with db.system_tx() as session:
        row = (
            await session.execute(
                text(
                    "select key_id, app_id, environment, public_key, sign_count from app.attest_keys"
                    " where key_id = :k and revoked_at is null for update"
                ),
                {"k": key_id[:64]},
            )
        ).one_or_none()
        if row is None:
            return "unknown_key"
        key = AppAttestKey(
            row.key_id, row.app_id, row.environment, bytes(row.public_key), int(row.sign_count)
        )
        counter = verifier.verify_app_assertion(key=key, assertion=_b64(token), nonce=nonce)
        await session.execute(
            text(
                "update app.attest_keys set sign_count = :c, last_used_at = now() where key_id = :k"
            ),
            {"c": counter, "k": key.key_id},
        )
    return None
