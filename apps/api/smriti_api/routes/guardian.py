"""Guardian consent (auth flow §6.10 and §10 "New or changed endpoints"; DPDP s.9)."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path
from fastapi.responses import JSONResponse

from smriti_api.core.auth import AuthContext
from smriti_api.core.deps import Client, CurrentUser, IdempotencyKey, Services, signed_in
from smriti_api.core.errors import ApiError
from smriti_api.integrations import Integrations
from smriti_api.routes._idempotent import idempotent
from smriti_api.schemas import guardian as g
from smriti_api.services import guardian

router = APIRouter(prefix="/v1/guardian", tags=["guardian"])

# Lookups by code are rate-limited per caller (8 characters from 31 is not guessable, and this
# keeps it that way).
CODE_LOOKUPS_PER_MIN = 20

Teen = Annotated[AuthContext, signed_in("guardian_consent")]
Guardian = Annotated[AuthContext, signed_in("guardian_consent")]
Code = Annotated[str, Path(min_length=6, max_length=12, pattern=r"^[A-Za-z0-9]+$")]


def get_integrations(services: Services) -> Integrations:
    if services.integrations is None:
        raise ApiError(503, "integrations_unavailable", "This service is not set up here")
    return services.integrations


Ints = Annotated[Integrations, Depends(get_integrations)]


async def _limit_codes(services: Services, auth: AuthContext) -> None:
    await services.limiter.hit("consent_code", str(auth.user_id), CODE_LOOKUPS_PER_MIN, 60)


@router.post(
    "/consent-requests",
    response_model=g.ConsentRequestCreated,
    status_code=201,
    summary="Ask a guardian: a code and link (AUTH-19/21), optionally emailed",
)
async def create_request(
    body: g.ConsentRequestCreate,
    services: Services,
    ints: Ints,
    auth: Teen,
    client: Client,
    key: IdempotencyKey,
) -> JSONResponse:
    return await idempotent(
        services,
        scope="consent_request",
        subject=auth.user_id,
        key=key,
        body=body,
        status=201,
        fn=lambda: guardian.create_request(services.db, ints, auth, body, client.app_variant),
    )


@router.get(
    "/consent",
    response_model=g.MyConsentOut,
    summary="The caller's own consent: state, scopes, a pending request, when to ask again",
)
async def my_consent(services: Services, auth: CurrentUser) -> g.MyConsentOut:
    return await guardian.my_consent(services.db, auth)


@router.get(
    "/consent-requests/{ref}",
    response_model=g.ConsentRequestStatus | g.ConsentRequestForGuardian,
    summary="By id: the teen's poll (AUTH-21). By code: what the guardian reviews (AUTH-20)",
)
async def read_request(
    ref: Annotated[str, Path(min_length=6, max_length=36)],
    services: Services,
    auth: CurrentUser,
) -> g.ConsentRequestStatus | g.ConsentRequestForGuardian:
    try:
        request_id = uuid.UUID(ref)
    except ValueError:
        request_id = None
    if request_id is not None:
        return await guardian.request_status(services.db, auth, request_id)
    if auth.is_anonymous:
        raise ApiError(401, "login_required", "Sign in to continue", reason="guardian_consent")
    await _limit_codes(services, auth)
    return await guardian.request_for_guardian(services.db, auth, ref)


@router.post(
    "/consent-requests/{code}/confirm",
    response_model=g.ConsentDecision,
    summary="The guardian agrees (AUTH-20 [I agree]): consent stored with its evidence",
)
async def confirm(
    code: Code,
    body: g.ConsentConfirm,
    services: Services,
    ints: Ints,
    auth: Guardian,
    key: IdempotencyKey,
) -> JSONResponse:
    await _limit_codes(services, auth)
    return await idempotent(
        services,
        scope="consent_confirm",
        subject=auth.user_id,
        key=key,
        body={"code": code.upper(), **body.model_dump(mode="json")},
        fn=lambda: guardian.confirm(services.db, ints, auth, code, body),
    )


@router.post(
    "/consent-requests/{code}/decline",
    response_model=g.ConsentDecision,
    summary="The guardian says no for now (AUTH-20 [No thanks])",
)
async def decline(
    code: Code, services: Services, auth: Guardian, key: IdempotencyKey
) -> JSONResponse:
    await _limit_codes(services, auth)
    return await idempotent(
        services,
        scope="consent_decline",
        subject=auth.user_id,
        key=key,
        body={"code": code.upper()},
        fn=lambda: guardian.decline(services.db, auth, code),
    )


@router.delete(
    "/consents/{consent_id}/scopes/{scope}",
    response_model=g.ConsentOut,
    summary="Withdraw one scope (SET-17); `account` withdraws the whole consent",
)
async def withdraw_scope(
    consent_id: uuid.UUID,
    scope: g.Scope,
    services: Services,
    auth: Guardian,
    key: IdempotencyKey,
) -> JSONResponse:
    return await idempotent(
        services,
        scope="consent_withdraw",
        subject=auth.user_id,
        key=key,
        body={"consent_id": str(consent_id), "scope": scope},
        fn=lambda: guardian.withdraw_scope(services.db, auth, consent_id, scope),
    )


@router.get(
    "/learners",
    response_model=g.LearnersOut,
    summary="Teens and managed children linked to the calling guardian (SET-14)",
)
async def learners(services: Services, auth: Guardian) -> g.LearnersOut:
    return await guardian.learners(services.db, auth)
