"""Billing (TRD §5.1 "Billing", §11; me-money §5): entitlement, ₹1 eligibility, web checkout,
manage, cancel, restore, and the Razorpay and RevenueCat webhooks."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request, Response
from fastapi.responses import JSONResponse

from smriti_api.core.auth import AuthContext
from smriti_api.core.deps import (
    Client,
    CurrentUser,
    IdempotencyKey,
    Services,
    require_attestation,
    signed_in,
)
from smriti_api.core.errors import ApiError
from smriti_api.integrations import Integrations
from smriti_api.integrations.billing import BillingError
from smriti_api.routes._idempotent import idempotent
from smriti_api.schemas import billing as b
from smriti_api.services import billing, billing_checkout, billing_family

router = APIRouter(prefix="/v1", tags=["billing"])


def get_integrations(services: Services) -> Integrations:
    if services.integrations is None:
        raise ApiError(503, "integrations_unavailable", "This service is not set up here")
    return services.integrations


Ints = Annotated[Integrations, Depends(get_integrations)]
SignedInBuyer = Annotated[AuthContext, signed_in("start_trial")]


@router.get(
    "/billing/entitlement",
    response_model=b.EntitlementOut,
    summary="Pro or free, with status, source, grace and renewal (PAY-08 polls this)",
)
async def entitlement(services: Services, auth: CurrentUser) -> b.EntitlementOut:
    return await billing_checkout.get_entitlement(services.db, auth.user_id)


@router.get(
    "/billing/intro-eligibility",
    response_model=b.IntroEligibilityOut,
    summary="Whether the ₹1 first month may be offered (auth flow §8, R38)",
)
async def intro_eligibility(
    services: Services, ints: Ints, auth: CurrentUser
) -> b.IntroEligibilityOut:
    return await billing_checkout.intro_eligibility(services.db, ints, auth)


@router.get(
    "/billing/subscription",
    response_model=b.SubscriptionDetailsOut,
    summary="Manage plan details: source, status, next charge or end date (PAY-12)",
)
async def subscription(services: Services, auth: CurrentUser) -> b.SubscriptionDetailsOut:
    return await billing_checkout.details(services.db, auth.user_id)


@router.post(
    "/billing/razorpay/subscription",
    response_model=b.RazorpaySubscriptionOut,
    summary="Start a web subscription: ₹1 first month when eligible, then ₹99/month",
)
async def razorpay_subscription(
    body: b.RazorpaySubscriptionRequest,
    services: Services,
    ints: Ints,
    auth: SignedInBuyer,
    client: Client,
    key: IdempotencyKey,
) -> JSONResponse:
    return await idempotent(
        services,
        scope="razorpay_subscription",
        subject=auth.user_id,
        key=key,
        body=body,
        required=True,
        fn=lambda: billing_checkout.start_razorpay(
            services.db, ints, auth, body, client.app_variant
        ),
    )


@router.post(
    "/billing/razorpay/verify",
    response_model=b.EntitlementOut,
    summary="Check the Checkout handler's signature; Pro follows the webhook",
    dependencies=[require_attestation("billing_verify")],
)
async def razorpay_verify(
    body: b.RazorpayVerifyRequest,
    services: Services,
    ints: Ints,
    auth: SignedInBuyer,
    key: IdempotencyKey,
) -> JSONResponse:
    return await idempotent(
        services,
        scope="razorpay_verify",
        subject=auth.user_id,
        key=key,
        body=body,
        fn=lambda: billing_checkout.verify_razorpay(services.db, ints, auth.user_id, body),
    )


@router.post(
    "/billing/razorpay/cancel",
    response_model=b.EntitlementOut,
    summary="Cancel the web subscription at the end of the paid period (PAY-13)",
)
async def razorpay_cancel(
    body: b.RazorpayCancelRequest,
    services: Services,
    ints: Ints,
    auth: SignedInBuyer,
    key: IdempotencyKey,
) -> JSONResponse:
    return await idempotent(
        services,
        scope="razorpay_cancel",
        subject=auth.user_id,
        key=key,
        body=body,
        required=True,
        fn=lambda: billing_checkout.cancel_razorpay(services.db, ints, auth.user_id, body.reason),
    )


@router.post(
    "/billing/restore",
    response_model=b.RestoreOut,
    summary="Re-read store purchases from RevenueCat and apply them (PAY-14 Restore)",
    dependencies=[require_attestation("billing_restore")],
)
async def restore(
    services: Services, ints: Ints, auth: SignedInBuyer, key: IdempotencyKey
) -> JSONResponse:
    return await idempotent(
        services,
        scope="billing_restore",
        subject=auth.user_id,
        key=key,
        body=None,
        fn=lambda: billing_checkout.sync_revenuecat(services.db, ints, auth.user_id),
    )


# --- webhooks ------------------------------------------------------------------------------------


@router.post(
    "/webhooks/razorpay",
    response_model=b.WebhookAck,
    tags=["webhooks"],
    summary="Razorpay subscription and refund events (HMAC-checked, idempotent)",
)
async def razorpay_webhook(request: Request, services: Services, ints: Ints) -> b.WebhookAck:
    body = await request.body()
    headers = {k.lower(): v for k, v in request.headers.items()}
    if not ints.razorpay.verify_webhook(body, headers):
        raise ApiError(401, "invalid_signature", "Webhook signature does not match")
    try:
        event = ints.razorpay.parse_webhook(body, headers)
    except BillingError as exc:
        raise ApiError(400, exc.code, exc.detail) from exc
    outcome = await billing.handle_webhook(services.db, ints, event)
    return b.WebhookAck(status=outcome.status)


@router.post(
    "/webhooks/revenuecat",
    response_model=b.WebhookAck,
    tags=["webhooks"],
    summary="RevenueCat store events, confirmed against RevenueCat's REST API",
)
async def revenuecat_webhook(request: Request, services: Services, ints: Ints) -> b.WebhookAck:
    body = await request.body()
    headers = {k.lower(): v for k, v in request.headers.items()}
    if not ints.revenuecat.verify_webhook(body, headers):
        raise ApiError(401, "invalid_signature", "Webhook authorization does not match")
    try:
        event = await ints.revenuecat.confirm(ints.revenuecat.parse_webhook(body, headers))
    except BillingError as exc:
        status = 400 if exc.code == "invalid_payload" else 503
        raise ApiError(status, exc.code, exc.detail) from exc
    outcome = await billing.handle_webhook(services.db, ints, event)
    return b.WebhookAck(status=outcome.status)


# --- family plan (PRD §11.2, Phase 3) ------------------------------------------------------------

FamilyUser = Annotated[AuthContext, signed_in("family_plan")]
InviteCode = Annotated[str, Path(min_length=6, max_length=12, pattern=r"^[A-Za-z0-9]+$")]
# Code lookups per caller per minute, as for guardian consent codes.
FAMILY_CODE_LOOKUPS_PER_MIN = 20


@router.get(
    "/billing/family",
    response_model=b.FamilyOut,
    summary="The family plan: seats, members and open invites (the payer), or membership",
)
async def family(services: Services, auth: FamilyUser) -> b.FamilyOut:
    return await billing_family.view(services.db, auth)


@router.post(
    "/billing/family/members",
    response_model=b.FamilyOut,
    summary="The payer adds a child they are the linked guardian of",
)
async def family_add_child(
    body: b.FamilyAddChild, services: Services, auth: FamilyUser, key: IdempotencyKey
) -> JSONResponse:
    return await idempotent(
        services,
        scope="family_add_child",
        subject=auth.user_id,
        key=key,
        body=body,
        fn=lambda: billing_family.add_child(services.db, auth, body),
    )


@router.delete(
    "/billing/family/members/{user_id}",
    status_code=204,
    summary="The payer removes someone, or a member leaves",
)
async def family_remove(user_id: uuid.UUID, services: Services, auth: FamilyUser) -> Response:
    await billing_family.remove_member(services.db, auth, user_id)
    return Response(status_code=204)


@router.post(
    "/billing/family/invites",
    response_model=b.FamilyInviteOut,
    status_code=201,
    summary="A code an adult uses to join (shown once; only its hash is kept)",
)
async def family_invite(services: Services, auth: FamilyUser) -> b.FamilyInviteOut:
    return await billing_family.create_invite(services.db, auth)


@router.delete(
    "/billing/family/invites/{invite_id}",
    status_code=204,
    summary="Withdraw an unused invite",
)
async def family_revoke_invite(
    invite_id: uuid.UUID, services: Services, auth: FamilyUser
) -> Response:
    await billing_family.revoke_invite(services.db, auth, invite_id)
    return Response(status_code=204)


@router.post(
    "/billing/family/invites/{code}/accept",
    response_model=b.FamilyOut,
    summary="An adult joins a family plan with a code (children join through Parent mode)",
)
async def family_accept(
    code: InviteCode, services: Services, auth: FamilyUser, key: IdempotencyKey
) -> JSONResponse:
    await services.limiter.hit("family_code", str(auth.user_id), FAMILY_CODE_LOOKUPS_PER_MIN, 60)
    return await idempotent(
        services,
        scope="family_accept",
        subject=auth.user_id,
        key=key,
        body={"code": code.upper()},
        fn=lambda: billing_family.accept_invite(services.db, auth, code),
    )


# --- PAY-17: a parent pays for a child (me-money §5.4 "Parent mode") ------------------------------

ParentUser = Annotated[AuthContext, signed_in("parent_mode")]


@router.get(
    "/guardian/learners/{learner_id}/pro",
    response_model=b.SubscriptionDetailsOut,
    summary="PAY-17 and SET-14: the child's plan, as the guardian who manages it sees it",
)
async def child_pro(
    learner_id: uuid.UUID, services: Services, auth: ParentUser
) -> b.SubscriptionDetailsOut:
    return await billing_checkout.details_for_child(services.db, auth, learner_id)


@router.post(
    "/guardian/learners/{learner_id}/pro",
    response_model=b.RazorpaySubscriptionOut,
    summary="PAY-17 [Continue to pay]: a web subscription on the child's account, payer guardian",
)
async def child_pro_start(
    learner_id: uuid.UUID,
    body: b.ChildProRequest,
    services: Services,
    ints: Ints,
    auth: ParentUser,
    client: Client,
    key: IdempotencyKey,
) -> JSONResponse:
    return await idempotent(
        services,
        scope="child_pro_start",
        subject=auth.user_id,
        key=key,
        body={"learner_id": str(learner_id), **body.model_dump(mode="json")},
        required=True,
        fn=lambda: billing_checkout.start_for_child(
            services.db, ints, auth, learner_id, body, client.app_variant
        ),
    )


@router.post(
    "/guardian/learners/{learner_id}/pro/verify",
    response_model=b.EntitlementOut,
    summary="Check the Checkout signature for the child's plan; Pro follows the webhook",
)
async def child_pro_verify(
    learner_id: uuid.UUID,
    body: b.RazorpayVerifyRequest,
    services: Services,
    ints: Ints,
    auth: ParentUser,
    key: IdempotencyKey,
) -> JSONResponse:
    return await idempotent(
        services,
        scope="child_pro_verify",
        subject=auth.user_id,
        key=key,
        body={"learner_id": str(learner_id), **body.model_dump(mode="json")},
        fn=lambda: billing_checkout.verify_for_child(services.db, ints, auth, learner_id, body),
    )


@router.post(
    "/guardian/learners/{learner_id}/pro/cancel",
    response_model=b.EntitlementOut,
    summary="Cancel the plan the guardian pays for, at the end of the paid period",
)
async def child_pro_cancel(
    learner_id: uuid.UUID,
    body: b.RazorpayCancelRequest,
    services: Services,
    ints: Ints,
    auth: ParentUser,
    key: IdempotencyKey,
) -> JSONResponse:
    return await idempotent(
        services,
        scope="child_pro_cancel",
        subject=auth.user_id,
        key=key,
        body={"learner_id": str(learner_id), **body.model_dump(mode="json")},
        required=True,
        fn=lambda: billing_checkout.cancel_for_child(
            services.db, ints, auth, learner_id, body.reason
        ),
    )
