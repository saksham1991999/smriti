"""Device attestation (G-10, TRD §14): the challenge and iOS App Attest key registration."""

from __future__ import annotations

from fastapi import APIRouter

from smriti_api.core.deps import Client, CurrentUser, Services, rate_limited
from smriti_api.integrations.settings import get_integration_settings
from smriti_api.schemas import integrity as i
from smriti_api.services import integrity

router = APIRouter(prefix="/v1/integrity", tags=["integrity"])


@router.post(
    "/challenge",
    response_model=i.ChallengeOut,
    summary="A one-time nonce for Play Integrity or App Attest",
    dependencies=[rate_limited("integrity_challenge", "rate_sync_per_min", 60)],
)
async def challenge(services: Services, auth: CurrentUser) -> i.ChallengeOut:
    ttl = get_integration_settings().attestation_nonce_ttl_s
    return await integrity.issue_challenge(services.redis, auth.user_id, ttl)


@router.post(
    "/app-attest/keys",
    response_model=i.AppAttestKeyOut,
    status_code=201,
    summary="Register this install's App Attest key (once per key)",
    dependencies=[rate_limited("integrity_attest", "rate_sync_per_min", 60)],
)
async def register_key(
    body: i.AppAttestKeyIn, services: Services, auth: CurrentUser, client: Client
) -> i.AppAttestKeyOut:
    ints = services.integrations
    return await integrity.register_app_attest_key(
        services.db,
        services.redis,
        ints.attestation if ints is not None else None,
        user_id=auth.user_id,
        device_id=client.device_id,
        variant=client.app_variant,
        body=body,
    )
