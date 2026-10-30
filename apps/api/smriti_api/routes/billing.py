"""Billing (TRD §5.1 "Billing", §11; me-money §5): entitlement, ₹1 eligibility, web checkout,
manage, cancel, restore, and the Razorpay and RevenueCat webhooks."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request
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
from smriti_api.services import billing, billing_checkout

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
