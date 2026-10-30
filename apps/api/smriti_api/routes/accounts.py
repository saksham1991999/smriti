"""Accounts (TRD §5.1 "Accounts", auth flow §6.3-6.8): link, merge, deletion and guest erase."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Path, Response
from fastapi.responses import JSONResponse

from smriti_api.core.auth import AuthContext
from smriti_api.core.deps import (
    Client,
    CurrentUser,
    CurrentUserAllowDeletion,
    IdempotencyKey,
    Services,
    rate_limited,
    signed_in,
)
from smriti_api.core.errors import ApiError
from smriti_api.routes._idempotent import idempotent
from smriti_api.schemas.api import (
    DeletionResponse,
    LinkedRequest,
    LinkedResponse,
    MergeAccepted,
    MergeIntentRequest,
    MergeIntentResponse,
    MergeRequest,
    MergeStatus,
)
from smriti_api.services import accounts
from smriti_api.services import flags as flag_service
from smriti_api.services.jobs import JobDeps
from smriti_api.services.state import profile_state

router = APIRouter(prefix="/v1", tags=["accounts"])

REAUTH_WINDOW_S = 300


def _deps(services: Services) -> JobDeps:
    return JobDeps(db=services.db, auth_admin=services.auth_admin, analytics=services.analytics)


@router.post(
    "/auth/linked",
    response_model=LinkedResponse,
    summary="Finalise a guest's link to Google or Apple (once per account, idempotent)",
)
async def linked(
    body: LinkedRequest,
    services: Services,
    key: IdempotencyKey,
    auth: Annotated[AuthContext, signed_in("link")],
) -> JSONResponse:
    async def run() -> LinkedResponse:
        result = await accounts.finalise_link(services.db, auth, body.referral_code)
        provider = str(auth.claims.get("app_metadata", {}).get("provider", "unknown"))
        await services.analytics.emit(
            "account_linked", auth.user_id, {"provider": provider, "path": "link"}
        )
        async with services.db.user_tx(auth.claims) as session:
            profile = await profile_state(session, auth)
        return LinkedResponse(profile=profile, **result)

    return await idempotent(
        services, scope="auth_linked", subject=auth.user_id, key=key, body=body, fn=run
    )


@router.post(
    "/account/merge-intents",
    response_model=MergeIntentResponse,
    summary="As the guest, prove control before a merge (10 min, single use)",
)
async def merge_intent(
    body: MergeIntentRequest, services: Services, auth: CurrentUser, client: Client
) -> MergeIntentResponse:
    token, expires = await accounts.create_merge_intent(
        services.redis, auth, client.device_id, body.has_unsent_events
    )
    return MergeIntentResponse(merge_intent=token, expires_at=expires)


@router.post(
    "/account/merges",
    status_code=202,
    response_model=MergeAccepted,
    summary="As the existing account, merge a guest into it",
    dependencies=[rate_limited("merges", "rate_merges_per_day", 86400)],
)
async def start_merge(
    body: MergeRequest,
    services: Services,
    key: IdempotencyKey,
    auth: Annotated[AuthContext, signed_in("merge")],
) -> JSONResponse:
    async def run() -> MergeAccepted:
        merge_id = await accounts.start_merge(
            services.db,
            services.redis,
            auth,
            body.merge_intent,
            body.include_progress,
            body.convert_guardian,
        )
        await services.jobs.enqueue("merge_guest", str(merge_id), job_id=f"merge_guest:{merge_id}")
        return MergeAccepted(merge_id=merge_id, status="queued")

    return await idempotent(
        services, scope="merge", subject=auth.user_id, key=key, body=body, fn=run, status=202
    )


@router.get("/account/merges/{merge_id}", response_model=MergeStatus, summary="Follow a merge")
async def get_merge(
    merge_id: Annotated[uuid.UUID, Path()], services: Services, auth: CurrentUser
) -> MergeStatus:
    row = await accounts.get_merge(services.db, auth.user_id, merge_id)
    return MergeStatus(merge_id=row.pop("id"), **row)


@router.delete("/account", status_code=204, summary="Erase a guest's progress now")
async def erase_guest(services: Services, auth: CurrentUser) -> Response:
    await accounts.erase_guest(_deps(services), auth)
    return Response(status_code=204)


@router.post(
    "/account/deletion",
    response_model=DeletionResponse,
    status_code=202,
    summary="Schedule account deletion after the grace period (needs a sign-in in the last 5 minutes)",
)
async def request_deletion(
    services: Services,
    key: IdempotencyKey,
    auth: Annotated[AuthContext, signed_in("delete_account")],
) -> JSONResponse:
    if not auth.amr_fresh_within(REAUTH_WINDOW_S):
        raise ApiError(401, "reauth_required", "Sign in again to confirm", reason="delete_account")

    async def run() -> DeletionResponse:
        async with services.db.system_tx() as session:
            flags = await flag_service.server_flags(session)
        grace = int(flags.get("auth.deletion_grace_days", 7) or 7)
        when = await accounts.request_deletion(services.db, _deps(services), auth, grace)
        return DeletionResponse(scheduled_for=when)

    return await idempotent(
        services, scope="deletion", subject=auth.user_id, key=key, body=None, fn=run, status=202
    )


@router.delete(
    "/account/deletion", response_model=DeletionResponse, summary="Cancel a scheduled deletion"
)
async def cancel_deletion(services: Services, auth: CurrentUserAllowDeletion) -> DeletionResponse:
    if auth.is_anonymous:
        raise ApiError(409, "not_scheduled", "Nothing to cancel")
    cancelled = await accounts.cancel_deletion(services.db, auth.user_id)
    if not cancelled:
        raise ApiError(409, "not_scheduled", "This account isn't scheduled for deletion")
    return DeletionResponse(scheduled_for=None)
