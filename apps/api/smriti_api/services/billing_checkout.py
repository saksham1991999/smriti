"""Checkout, manage, cancel and restore (me-money §5.4 to §5.9). Webhooks stay the source of truth:
these endpoints start or stop things at the provider and record what we know so far."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import structlog
from sqlalchemy import text

from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.integrations import Integrations
from smriti_api.integrations.billing import BillingError, SubscriptionUpdate, WebhookEvent, _iso
from smriti_api.schemas import billing as b
from smriti_api.services import billing, privacy
from smriti_api.services import flags as flag_service

log = structlog.get_logger(__name__)


def entitlement_out(ent: billing.Entitlement) -> b.EntitlementOut:
    return b.EntitlementOut(
        plan="pro" if ent.active else "free",
        pro_until=(ent.grace_until or ent.expires_at) if ent.active else None,
        status=ent.status,
        source=ent.source,
        grace_until=ent.grace_until,
        cancel_at_period_end=ent.cancel_at_period_end,
        is_intro=ent.is_intro,
    )


def _provider_error(exc: BillingError) -> ApiError:
    if exc.code == "billing_not_configured":
        return ApiError(503, "billing_not_configured", "Payments are not set up here yet")
    return ApiError(
        502, "payment_provider_error", "The payment provider did not answer. Try again."
    )


async def get_entitlement(db: Database, user_id: uuid.UUID) -> b.EntitlementOut:
    async with db.system_tx() as session:
        ent = await billing.compute_entitlement(session, user_id, datetime.now(UTC))
    return entitlement_out(ent)


async def intro_eligibility(
    db: Database, integrations: Integrations, auth: AuthContext
) -> b.IntroEligibilityOut:
    async with db.system_tx() as session:
        e = await billing.intro_eligibility(
            session,
            auth.user_id,
            is_anonymous=auth.is_anonymous,
            pepper=integrations.identity_pepper,
        )
        price = (
            await session.execute(
                text(
                    "select price_paise, intro_price_paise from billing.products"
                    " where id = 'pro_monthly_intro_web'"
                )
            )
        ).first()
    return b.IntroEligibilityOut(
        eligible=e.eligible,
        eligible_hint=e.eligible_hint,
        reason=e.reason,
        intro_price_paise=int(price.intro_price_paise)
        if price and price.intro_price_paise
        else None,
        price_paise=int(price.price_paise) if price else 0,
    )


async def _buyer(session: Any, user_id: uuid.UUID) -> Any:
    return (
        await session.execute(
            text("select age_band, account_kind from app.profiles where user_id = :u"),
            {"u": user_id},
        )
    ).first()


async def start_razorpay(
    db: Database,
    integrations: Integrations,
    auth: AuthContext,
    body: b.RazorpaySubscriptionRequest,
    variant: str | None,
) -> b.RazorpaySubscriptionOut:
    return await _start(db, integrations, auth.user_id, body.plan, body.payer, variant)


async def _guardian_of(db: Database, guardian: AuthContext, learner_id: uuid.UUID) -> str:
    """PAY-17: an adult with a live link and consent for the child; returns the child's name."""
    from smriti_api.services import parent_mode  # parent_mode reads entitlements from here

    async with db.system_tx() as session:
        me = await _buyer(session, guardian.user_id)
        if me is None or me.age_band != "18p":
            raise ApiError(403, "guardian_required", "A grown-up buys Pro for a child")
        child = await parent_mode.child_for(session, guardian.user_id, learner_id)
    return child.first_name or ""


async def start_for_child(
    db: Database,
    integrations: Integrations,
    guardian: AuthContext,
    learner_id: uuid.UUID,
    body: b.ChildProRequest,
    variant: str | None,
) -> b.RazorpaySubscriptionOut:
    """PAY-17 "Get Pro for {child}": the subscription belongs to the child's account with
    ``payer = guardian``, the ₹1 intro follows the child's own eligibility, and only the
    guardian manages or cancels it (me-money §5.4 "Parent mode")."""
    await _guardian_of(db, guardian, learner_id)
    return await _start(db, integrations, learner_id, body.plan, "guardian", variant)


async def _start(
    db: Database,
    integrations: Integrations,
    user_id: uuid.UUID,
    plan: str,
    payer_choice: str,
    variant: str | None,
) -> b.RazorpaySubscriptionOut:
    now = datetime.now(UTC)
    by_guardian = payer_choice == "guardian"
    async with db.system_tx() as session:
        buyer = await _buyer(session, user_id)
        if by_guardian:
            payer = "guardian"
        else:
            if buyer is not None and (
                buyer.account_kind == "managed" or buyer.age_band in ("u10", "10_12")
            ):
                # Under 13: never reaches checkout; a parent buys in Parent mode (me-money §5.4).
                raise ApiError(403, "guardian_required", "A grown-up buys Pro from Parent mode")
            payer = payer_choice if buyer is not None and buyer.age_band == "13_17" else "self"
            if buyer is not None and buyer.age_band == "13_17":
                flags = await flag_service.server_flags(session)
                if flags.get("auth.guardian_consent_gate", "features") == "signin":
                    # With the strict gate, Pro waits for the guardian's consent (auth §6.10).
                    await privacy.require_scope(session, user_id, "account")
        ent = await billing.compute_entitlement(session, user_id, now)
        if ent.active and ent.source != "promo":
            raise ApiError(
                409, "already_pro", "Pro is already on for this account", source=ent.source
            )
        elig = await billing.intro_eligibility(
            session, user_id, is_anonymous=False, pepper=integrations.identity_pepper
        )
        # The ₹1 intro is for the monthly plan only (PRD §11.2).
        intro = bool(elig.eligible) and plan == "monthly"
        if plan == "monthly":
            product_id = "pro_monthly_intro_web" if intro else "pro_monthly_web"
        elif plan == "yearly":
            product_id = "pro_yearly_web"
        else:
            product_id = f"{plan}_web"
        product = (
            await session.execute(
                text(
                    "select price_paise, intro_price_paise, period, plan from billing.products"
                    " where id = :p and active"
                ),
                {"p": product_id},
            )
        ).one_or_none()
        if product is None:
            raise ApiError(404, "plan_unavailable", "This plan isn't offered")
        price = product.price_paise
        if product.plan == "family":
            if buyer is not None and buyer.age_band != "18p":
                raise ApiError(403, "guardian_required", "A grown-up buys the family plan")
            offer = billing.family_offer(await flag_service.server_flags(session))
            price = offer.price_for(product.period) if offer else None
            if price is None:
                raise ApiError(404, "plan_unavailable", "This plan isn't offered")
    try:
        sub = await integrations.razorpay.create_subscription(
            user_id=user_id,
            intro=intro,
            notes={"variant": variant or "web", "product": product_id, "payer": payer},
            product_id=product_id,
            period=str(product.period),
        )
    except BillingError as exc:
        raise _provider_error(exc) from exc
    async with db.system_tx() as session:
        await session.execute(
            text(
                """
                insert into billing.subscriptions
                  (user_id, source, external_id, payer, product_id, status, is_intro, variant_id)
                values (:u, 'razorpay', :e, :payer, :p, 'created', :intro, :v)
                on conflict (source, external_id) do nothing
                """
            ),
            {
                "u": user_id,
                "e": sub["id"],
                "payer": payer,
                "p": product_id,
                "intro": intro,
                "v": variant,
            },
        )
    log.info("razorpay_subscription_created", intro=intro, plan=plan)
    return b.RazorpaySubscriptionOut(
        subscription_id=str(sub["id"]),
        key_id=integrations.razorpay.key_id,
        product_id=product_id,
        intro=intro,
        amount_today_paise=int(product.intro_price_paise if intro else price),
        then_paise=int(price),
        short_url=sub.get("short_url"),
    )


async def verify_razorpay(
    db: Database, integrations: Integrations, user_id: uuid.UUID, body: b.RazorpayVerifyRequest
) -> b.EntitlementOut:
    """The Checkout handler's signature proves the student approved; Pro still waits for the
    webhook (PAY-08 polls the entitlement)."""
    if not integrations.razorpay.verify_payment(
        payment_id=body.razorpay_payment_id,
        subscription_id=body.razorpay_subscription_id,
        signature=body.razorpay_signature,
    ):
        raise ApiError(400, "invalid_signature", "This payment could not be verified")
    async with db.system_tx() as session:
        row = (
            await session.execute(
                text(
                    "select id, status from billing.subscriptions where source = 'razorpay'"
                    " and external_id = :e and user_id = :u for update"
                ),
                {"e": body.razorpay_subscription_id, "u": user_id},
            )
        ).first()
        if row is None:
            raise ApiError(404, "subscription_not_found", "No such subscription on this account")
        if row.status in ("created", "authenticated"):
            await session.execute(
                text(
                    "update billing.subscriptions set status = 'pending', pending_reason = 'bank_confirming'"
                    " where id = :id"
                ),
                {"id": row.id},
            )
        ent, _ = await billing.recompute_entitlement(session, user_id)
    return entitlement_out(ent)


async def cancel_razorpay(
    db: Database,
    integrations: Integrations,
    user_id: uuid.UUID,
    reason: str | None,
    *,
    as_guardian: bool = False,
) -> b.EntitlementOut:
    """PAY-13: cancel at the end of the paid period (two taps, R33). A plan a parent pays for is
    managed in Parent mode only (``as_guardian``); the child's own cancel refuses it."""
    async with db.system_tx() as session:
        row = (
            await session.execute(
                text(
                    "select id, external_id, payer from billing.subscriptions where user_id = :u"
                    " and source = 'razorpay'"
                    " and status in ('trialing','active','grace','authenticated','pending')"
                    " order by updated_at desc limit 1"
                ),
                {"u": user_id},
            )
        ).first()
    if row is None or (as_guardian and row.payer != "guardian"):
        raise ApiError(404, "no_web_subscription", "There is no web subscription to cancel")
    if row.payer == "guardian" and not as_guardian:
        raise ApiError(403, "managed_by_parent", "Your parent manages this plan")
    try:
        await integrations.razorpay.cancel_subscription(str(row.external_id), at_cycle_end=True)
    except BillingError as exc:
        raise _provider_error(exc) from exc
    async with db.system_tx() as session:
        await session.execute(
            text(
                "update billing.subscriptions set cancel_at_period_end = true,"
                " cancel_reason = coalesce(:r, cancel_reason) where id = :id"
            ),
            {"id": row.id, "r": reason},
        )
        ent, _ = await billing.recompute_entitlement(session, user_id)
    return entitlement_out(ent)


async def verify_for_child(
    db: Database,
    integrations: Integrations,
    guardian: AuthContext,
    learner_id: uuid.UUID,
    body: b.RazorpayVerifyRequest,
) -> b.EntitlementOut:
    await _guardian_of(db, guardian, learner_id)
    return await verify_razorpay(db, integrations, learner_id, body)


async def cancel_for_child(
    db: Database,
    integrations: Integrations,
    guardian: AuthContext,
    learner_id: uuid.UUID,
    reason: str | None,
) -> b.EntitlementOut:
    await _guardian_of(db, guardian, learner_id)
    return await cancel_razorpay(db, integrations, learner_id, reason, as_guardian=True)


async def details_for_child(
    db: Database, guardian: AuthContext, learner_id: uuid.UUID
) -> b.SubscriptionDetailsOut:
    await _guardian_of(db, guardian, learner_id)
    return await details(db, learner_id)


async def details(db: Database, user_id: uuid.UUID) -> b.SubscriptionDetailsOut:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        ent = await billing.compute_entitlement(session, user_id, now)
        row = None
        if ent.subscription_id is not None:
            row = (
                await session.execute(
                    text(
                        """
                        select s.*, p.price_paise, p.intro_price_paise, p.period, p.plan
                          from billing.subscriptions s join billing.products p on p.id = s.product_id
                         where s.id = :id and s.user_id = :u
                        """
                    ),
                    # A family member's Pro comes from the payer's subscription, which only the
                    # payer manages.
                    {"id": ent.subscription_id, "u": user_id},
                )
            ).first()
        offer = billing.family_offer(await flag_service.server_flags(session))
        promo = (
            await session.execute(
                text(
                    "select max(ends_at) from billing.promo_grants where user_id = :u and cancelled_at is null"
                    " and ends_at > :now"
                ),
                {"u": user_id, "now": now},
            )
        ).scalar_one_or_none()
    sub = None
    if row is not None:
        ending = bool(row.cancel_at_period_end) or row.status == "cancelled"
        price = row.price_paise
        if price is None and offer is not None:
            price = offer.price_for(str(row.period))
        price = price or 0
        sub = b.SubscriptionOut(
            id=row.id,
            source=row.source,
            status=row.status,
            product_id=row.product_id,
            price_paise=int(price),
            intro_price_paise=row.intro_price_paise,
            is_intro=bool(row.is_intro),
            payer=row.payer,
            current_period_end=row.current_period_end,
            grace_until=row.grace_until,
            cancel_at_period_end=ending,
            next_charge_at=None if ending else row.current_period_end,
            # After the ₹1 month the plan renews at the full price (R33 timeline).
            next_charge_paise=None if ending else int(price),
            ends_at=row.current_period_end if ending else None,
            managed_in={"razorpay": "web", "play": "play", "app_store": "app_store"}.get(
                row.source, "none"
            ),
        )
    return b.SubscriptionDetailsOut(
        entitlement=entitlement_out(ent), subscription=sub, promo_until=promo
    )


async def sync_revenuecat(
    db: Database, integrations: Integrations, user_id: uuid.UUID
) -> b.RestoreOut:
    """PAY-14 Restore and the app's fast path: read RevenueCat's subscriber record and apply it
    as if it were a webhook. Without a RevenueCat key (local, test) nothing changes."""
    try:
        subscriber = await integrations.revenuecat.fetch_subscriber(str(user_id))
    except BillingError as exc:
        raise _provider_error(exc) from exc
    updates: list[SubscriptionUpdate] = []
    now = datetime.now(UTC)
    for product, rec in ((subscriber or {}).get("subscriptions") or {}).items():
        if not isinstance(rec, dict):
            continue
        source = {"play_store": "play", "app_store": "app_store"}.get(str(rec.get("store", "")))
        ext = str(rec.get("store_transaction_id") or rec.get("original_transaction_id") or "")
        if source is None or not ext:
            continue
        expires = _iso(rec.get("expires_date"))
        grace = _iso(rec.get("grace_period_expires_date"))
        refunded = _iso(rec.get("refunded_at"))
        if refunded is not None:
            status = "cancelled"
        elif grace is not None and grace > now and rec.get("billing_issues_detected_at"):
            status = "grace"
        elif expires is not None and expires <= now:
            status = "expired"
        else:
            status = "trialing" if rec.get("period_type") in ("intro", "trial") else "active"
        updates.append(
            SubscriptionUpdate(
                source=source,
                external_id=ext,
                occurred_at=now,
                user_id=user_id,
                store_product_id=str(product),
                status=status,
                is_intro=rec.get("period_type") in ("intro", "trial"),
                period_start=_iso(rec.get("purchase_date")),
                period_end=expires,
                grace_until=grace,
                cancel_at_period_end=bool(rec.get("unsubscribe_detected_at")),
                refunded_at=refunded,
                environment="sandbox" if rec.get("is_sandbox") else "production",
            )
        )
    restored = False
    if updates:
        event = WebhookEvent(
            "revenuecat",
            f"restore:{user_id}:{int(now.timestamp())}",
            "RESTORE",
            user_id,
            updates,
            {
                "restore": True,
                "products": sorted(subscriber.get("subscriptions", {}) if subscriber else []),
            },
        )
        outcome = await billing.handle_webhook(db, integrations, event)
        restored = outcome.status == "applied"
    return b.RestoreOut(restored=restored, entitlement=await get_entitlement(db, user_id))


async def cancel_for_deletion(db: Database, integrations: Integrations, user_id: uuid.UUID) -> int:
    """Account deletion (auth flow §6.8) stops Razorpay renewals at once (cancel at cycle end, so
    the paid time stays if the student keeps the account within the grace days). Store
    subscriptions must be cancelled by the student in the store."""
    async with db.system_tx() as session:
        rows = (
            await session.execute(
                text(
                    "select id, external_id from billing.subscriptions where user_id = :u and source = 'razorpay'"
                    " and status in ('created','authenticated','pending','trialing','active','grace')"
                ),
                {"u": user_id},
            )
        ).all()
    done = 0
    for row in rows:
        try:
            await integrations.razorpay.cancel_subscription(str(row.external_id), at_cycle_end=True)
        except BillingError:
            log.warning("razorpay_cancel_on_delete_failed")
            continue
        async with db.system_tx() as session:
            await session.execute(
                text(
                    "update billing.subscriptions set cancel_at_period_end = true,"
                    " cancel_reason = 'account_deleted' where id = :id"
                ),
                {"id": row.id},
            )
            await billing.recompute_entitlement(session, user_id)
        done += 1
    return done
