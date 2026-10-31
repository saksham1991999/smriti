"""``/v1/dev/auth/*``: mounted only when APP_ENV is local or test (see ``main.create_app``)."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from smriti_api.core.deps import OptionalUser, Services, rate_limited
from smriti_api.schemas.api import DevGoogleRequest, DevRefreshRequest, DevSession
from smriti_api.services import dev_auth

router = APIRouter(
    prefix="/v1/dev/auth",
    tags=["dev-auth"],
    dependencies=[rate_limited("dev_auth", "rate_dev_auth_per_min", 60, by="ip")],
)


@router.post(
    "/anonymous", response_model=DevSession, summary="Dev stand-in for Supabase anonymous sign-in"
)
async def anonymous(services: Services) -> DevSession:
    return await dev_auth.sign_in_anonymously(services.db, services.verifier)


@router.post(
    "/google",
    response_model=DevSession,
    summary="Dev stand-in for Google sign-in, or linkIdentity on a guest with link=true",
    responses={
        409: {
            "description": "identity_already_exists: the Google account has another user (merge path)"
        }
    },
)
async def google(body: DevGoogleRequest, services: Services, guest: OptionalUser) -> DevSession:
    return await dev_auth.sign_in_with_google(services.db, services.verifier, body, guest)


@router.post(
    "/refresh",
    response_model=DevSession,
    summary="Dev stand-in for Supabase's refresh_token grant",
    responses={401: {"description": "invalid_grant or session_ended"}},
)
async def refresh(body: DevRefreshRequest, services: Services) -> DevSession:
    return await dev_auth.refresh(services.db, services.verifier, body.refresh_token)


class DevVerifyOtpRequest(BaseModel):
    token_hash: Annotated[str, Field(min_length=16, max_length=256)]
    type: Literal["email"] = "email"


@router.post(
    "/verify-otp",
    response_model=DevSession,
    summary="Dev stand-in for verifyOtp with a token hash (a managed child's session)",
    responses={401: {"description": "otp_expired: used, unknown or older than 5 minutes"}},
)
async def verify_otp(body: DevVerifyOtpRequest, services: Services) -> DevSession:
    return await dev_auth.verify_token_hash(
        services.db, services.verifier, services.auth_admin, body.token_hash
    )
