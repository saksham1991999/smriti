"""FastAPI dependencies: app services, the verified caller and the common headers."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Annotated, Any

import httpx
import structlog
from fastapi import Depends, Header, Request
from redis.asyncio import Redis
from sqlalchemy import text

from smriti_api.ai.gateway import AIGateway
from smriti_api.core.auth import AuthContext, JwtVerifier
from smriti_api.core.config import Settings
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError, login_required
from smriti_api.core.idempotency import IdempotencyStore
from smriti_api.core.logging import hash_user_id
from smriti_api.core.ratelimit import RateLimiter
from smriti_api.integrations import Integrations
from smriti_api.integrations.realtime import RealtimePublisher
from smriti_api.services.analytics import AnalyticsSink
from smriti_api.services.auth_admin import AuthAdmin
from smriti_api.services.jobs import JobQueue


@dataclass
class AppServices:
    settings: Settings
    db: Database
    redis: Redis
    http: httpx.AsyncClient
    verifier: JwtVerifier
    limiter: RateLimiter
    idempotency: IdempotencyStore
    jobs: JobQueue
    auth_admin: AuthAdmin
    analytics: AnalyticsSink
    ai: AIGateway
    # Billing, mail, push and storage providers (Agent A, wave 2). Built in build_services.
    integrations: Integrations | None = None
    # Live mock fan-out (practice §6.11). Built in build_services.
    realtime: RealtimePublisher | None = None


def get_services(request: Request) -> AppServices:
    services: AppServices = request.app.state.services
    return services


Services = Annotated[AppServices, Depends(get_services)]


@dataclass(frozen=True)
class ClientInfo:
    app_variant: str | None
    device_id: uuid.UUID | None
    platform: str | None
    app_version: str | None


def client_info(
    x_app_variant: Annotated[str | None, Header(max_length=32)] = None,
    x_device_id: Annotated[str | None, Header(max_length=64)] = None,
    x_platform: Annotated[str | None, Header(max_length=16)] = None,
    x_app_version: Annotated[str | None, Header(max_length=32)] = None,
) -> ClientInfo:
    device: uuid.UUID | None = None
    if x_device_id:
        try:
            device = uuid.UUID(x_device_id)
        except ValueError as exc:
            raise ApiError(400, "invalid_device_id", "X-Device-Id must be a UUID") from exc
    platform = x_platform if x_platform in ("ios", "android", "web") else None
    return ClientInfo(
        app_variant=x_app_variant, device_id=device, platform=platform, app_version=x_app_version
    )


Client = Annotated[ClientInfo, Depends(client_info)]


def _bearer(request: Request) -> str | None:
    header = request.headers.get("authorization")
    if not header:
        return None
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise ApiError(401, "invalid_token", "Use a Bearer token")
    return token.strip()


async def optional_auth(request: Request, services: Services) -> AuthContext | None:
    token = _bearer(request)
    if token is None:
        return None
    ctx = await services.verifier.verify(token)
    structlog.contextvars.bind_contextvars(user=hash_user_id(ctx.user_id))
    return ctx


async def _authenticated(request: Request, services: Services) -> AuthContext:
    ctx = await optional_auth(request, services)
    if ctx is None:
        raise ApiError(401, "unauthorized", "Sign-in token required")
    return ctx


async def _account_status(services: AppServices, user_id: uuid.UUID) -> Any:
    async with services.db.system_tx() as session:
        return (
            await session.execute(
                text(
                    "select deletion_scheduled_for, account_kind from app.profiles where user_id = :u"
                ),
                {"u": user_id},
            )
        ).one_or_none()


async def current_user(
    services: Services, auth: Annotated[AuthContext, Depends(_authenticated)]
) -> AuthContext:
    """The caller, guest or signed in. Accounts scheduled for deletion get 409 (auth flow §6.8)."""
    row = await _account_status(services, auth.user_id)
    if row is None:
        raise ApiError(401, "session_ended", "This account no longer exists")
    if row.deletion_scheduled_for is not None:
        raise ApiError(
            409,
            "account_deletion_scheduled",
            "This account is scheduled for deletion",
            scheduled_for=row.deletion_scheduled_for.isoformat(),
        )
    return auth


async def current_user_allow_deletion(
    services: Services, auth: Annotated[AuthContext, Depends(_authenticated)]
) -> AuthContext:
    row = await _account_status(services, auth.user_id)
    if row is None:
        raise ApiError(401, "session_ended", "This account no longer exists")
    return auth


CurrentUser = Annotated[AuthContext, Depends(current_user)]
CurrentUserAllowDeletion = Annotated[AuthContext, Depends(current_user_allow_deletion)]
OptionalUser = Annotated[AuthContext | None, Depends(optional_auth)]


def signed_in(reason: str) -> Any:
    """Hard-login endpoints: a guest token gets the RFC 7807 ``login_required`` problem."""

    async def dep(auth: CurrentUser) -> AuthContext:
        if auth.is_anonymous:
            raise login_required(reason)
        return auth

    return Depends(dep)


def rate_limited(name: str, limit_attr: str, window_s: int, by: str = "user") -> Any:
    async def dep(request: Request, services: Services) -> None:
        limit = int(getattr(services.settings, limit_attr))
        subject = request.client.host if request.client else "unknown"
        if by == "user":
            token = _bearer(request)
            if token:
                try:
                    ctx = await services.verifier.verify(token)
                    subject = str(ctx.user_id)
                except ApiError:
                    pass
        await services.limiter.hit(name, subject, limit, window_s)

    return Depends(dep)


def idempotency_key(
    key: Annotated[str | None, Header(alias="Idempotency-Key", max_length=128)] = None,
) -> str | None:
    """The optional ``Idempotency-Key`` header; endpoints decide whether it is required."""
    return key


IdempotencyKey = Annotated[str | None, Depends(idempotency_key)]


@dataclass(frozen=True)
class IntegrityProof:
    token: str | None
    nonce: str | None
    key_id: str | None


def integrity_proof(
    x_integrity_token: Annotated[str | None, Header(max_length=16_384)] = None,
    x_integrity_nonce: Annotated[str | None, Header(max_length=128)] = None,
    x_integrity_key_id: Annotated[str | None, Header(max_length=64)] = None,
) -> IntegrityProof:
    """Play Integrity token or App Attest assertion, the challenge nonce, and the iOS key id."""
    return IntegrityProof(x_integrity_token, x_integrity_nonce, x_integrity_key_id)


Proof = Annotated[IntegrityProof, Depends(integrity_proof)]


async def check_attestation(
    services: AppServices, auth: AuthContext, client: ClientInfo, proof: IntegrityProof, action: str
) -> None:
    """Device attestation when ``security.attestation_required`` is on (G-10, TRD §14)."""
    from smriti_api.services import integrity

    ints = services.integrations
    await integrity.enforce(
        services.db,
        services.redis,
        ints.attestation if ints is not None else None,
        user_id=auth.user_id,
        platform=client.platform,
        variant=client.app_variant,
        action=action,
        token=proof.token,
        nonce=proof.nonce,
        key_id=proof.key_id,
    )


def require_attestation(action: str) -> Any:
    """For sensitive endpoints: billing, duel submit and the like. Off until the flag is on."""

    async def dep(services: Services, auth: CurrentUser, client: Client, proof: Proof) -> None:
        await check_attestation(services, auth, client, proof, action)

    return Depends(dep)
