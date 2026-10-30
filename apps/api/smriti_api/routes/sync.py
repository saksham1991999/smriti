"""``POST /v1/sync/events`` and ``GET /v1/sync/state`` (docs/contracts/sync.md)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from smriti_api.core.deps import (
    Client,
    CurrentUser,
    Proof,
    Services,
    check_attestation,
    rate_limited,
)
from smriti_api.schemas.sync import SyncEventsRequest, SyncEventsResponse, SyncStateResponse
from smriti_api.services.errors import DomainError
from smriti_api.services.state import build_state
from smriti_api.services.sync import apply_batch
from smriti_api.services.xp import XP_HEAVY_TYPES

router = APIRouter(prefix="/v1/sync", tags=["sync"])


@router.post(
    "/events",
    response_model=SyncEventsResponse,
    summary="Upload a batch of outbox events",
    dependencies=[rate_limited("sync", "rate_sync_per_min", 60)],
)
async def post_events(
    body: SyncEventsRequest, services: Services, auth: CurrentUser, client: Client, proof: Proof
) -> SyncEventsResponse:
    """Idempotent by ``event_id``: a repeated event is accepted again with no effect. A batch
    with XP-heavy events needs a device check when ``security.attestation_required`` is on."""
    if any(e.type in XP_HEAVY_TYPES for e in body.events):
        await check_attestation(services, auth, client, proof, "sync_xp")
    try:
        result = await apply_batch(
            services.db,
            user_id=auth.user_id,
            device_id=body.device_id or client.device_id,
            events=body.events,
            app_variant=client.app_variant,
        )
    except DomainError as exc:
        raise exc.to_api() from exc
    return SyncEventsResponse(
        accepted=result.accepted, rejected=result.rejected, state_version=result.state_version
    )


@router.get(
    "/state",
    response_model=SyncStateResponse,
    summary="Authoritative state, or the sections changed since a version",
)
async def get_state(
    services: Services,
    auth: CurrentUser,
    since: Annotated[int | None, Query(ge=0)] = None,
) -> JSONResponse:
    state = await build_state(services.db, auth, since)
    full = state.model_dump(mode="json")
    # Unchanged sections are left out. Nested nulls (``rest_day``, ``pro_until``) stay, and in a
    # full read ``pet`` is null (not missing) while the student has no pet yet.
    body = {k: v for k, v in full.items() if v is not None or (k == "pet" and since is None)}
    return JSONResponse(body, headers={"Cache-Control": "no-store"})
