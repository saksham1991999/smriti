"""PAY-17 "Send to my parent" (me-money §5.12): a short-lived link a 13 to 17 year old sends to
a parent, who opens it without signing in and pays for the teen's account with Razorpay.

- The teen creates it (``pay.child_link.enabled`` for their platform; off in the store apps by
  default, Q7). One open link at a time; a new one cancels the old. It lasts
  ``pay.child_link_ttl_h`` hours (48, the doc's value). Only the token's sha256 is stored.
- The parent's page shows the teen's first name and pet and the price from the teen's own
  eligibility. Paying starts a web subscription on the teen's account with
  ``payer = guardian_declared`` (nobody signed in, so no guardian account manages it; the teen's
  Manage plan can still cancel, and the parent can stop the UPI mandate in their UPI app).
- Pro still follows the Razorpay webhook, as for any web checkout. Logs carry no token or name.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any, Literal, cast

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.core.logging import hash_user_id
from smriti_api.integrations import Integrations
from smriti_api.schemas import billing as b
from smriti_api.services import billing, billing_checkout
from smriti_api.services.usage import load_flags

log = structlog.get_logger(__name__)

PRODUCTS: dict[str, str] = {"monthly": "pro_monthly_web", "yearly": "pro_yearly_web"}
PLANS = {v: k for k, v in PRODUCTS.items()}
DEFAULT_TTL_H = 48
PayLinkStatus = Literal["open", "paid", "expired", "cancelled", "already_pro"]


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _plan(product_id: str) -> Literal["monthly", "yearly"]:
    return "yearly" if PLANS.get(product_id) == "yearly" else "monthly"


async def create(
    db: Database,
    ints: Integrations,
    auth: AuthContext,
    body: b.ChildPayLinkCreate,
    platform: str | None,
) -> b.ChildPayLinkCreated:
    now = datetime.now(UTC)
    token = secrets.token_urlsafe(32)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        enabled = flags.get("pay.child_link.enabled")
        on = (
            enabled.get(platform or "web") is True if isinstance(enabled, dict) else enabled is True
        )
        if not on:
            raise ApiError(403, "child_link_disabled", "Ask your parent to pay on this device")
        p = (
            await session.execute(
                text("select age_band, account_kind from app.profiles where user_id = :u"),
                {"u": auth.user_id},
            )
        ).one_or_none()
        if p is None or p.account_kind == "managed" or p.age_band != "13_17":
            # Under 13 a parent buys in Parent mode; adults pay for themselves (PAY-03).
            raise ApiError(403, "child_link_not_for_age", "This link is for 13 to 17 year olds")
        ent = await billing.compute_entitlement(session, auth.user_id, now)
        if ent.active and ent.source != "promo":
            raise ApiError(409, "already_pro", "Pro is already on for this account")
        await session.execute(
            text(
                "update billing.payment_links set status = 'cancelled'"
                " where learner_user_id = :u and status = 'open'"
            ),
            {"u": auth.user_id},
        )
        ttl = flags.int_or("pay.child_link_ttl_h", DEFAULT_TTL_H)
        expires = now + timedelta(hours=ttl)
        link_id = (
            await session.execute(
                text(
                    "insert into billing.payment_links (learner_user_id, token_hash, product_id,"
                    " expires_at) values (:u, :h, :p, :e) returning id"
                ),
                {"u": auth.user_id, "h": token_hash(token), "p": PRODUCTS[body.plan], "e": expires},
            )
        ).scalar_one()
    log.info("child_pay_link_created", user=hash_user_id(auth.user_id), plan=body.plan)
    base = ints.settings.child_pay_link_base.rstrip("/")
    return b.ChildPayLinkCreated(
        id=link_id, token=token, url=f"{base}/{token}", plan=body.plan, expires_at=expires
    )


async def cancel(db: Database, auth: AuthContext, link_id: uuid.UUID) -> None:
    async with db.system_tx() as session:
        status = (
            await session.execute(
                text(
                    "select status from billing.payment_links where id = :id and learner_user_id = :u"
                    " for update"
                ),
                {"id": link_id, "u": auth.user_id},
            )
        ).scalar_one_or_none()
        if status is None:
            raise ApiError(404, "not_found", "No such link")
        if status == "open":
            await session.execute(
                text("update billing.payment_links set status = 'cancelled' where id = :id"),
                {"id": link_id},
            )


async def _by_token(session: AsyncSession, token: str, now: datetime) -> Any:
    row = (
        await session.execute(
            text(
                "select id, learner_user_id, product_id, status, expires_at"
                " from billing.payment_links where token_hash = :h for update"
            ),
            {"h": token_hash(token)},
        )
    ).one_or_none()
    if row is None:
        raise ApiError(404, "not_found", "No such link")
    link = SimpleNamespace(**row._mapping)
    if link.status == "open" and link.expires_at <= now:
        await session.execute(
            text("update billing.payment_links set status = 'expired' where id = :id"),
            {"id": link.id},
        )
        link.status = "expired"
    return link


async def _price(
    session: AsyncSession, ints: Integrations, child: uuid.UUID, product_id: str
) -> tuple[bool, int | None, int | None]:
    elig = await billing.intro_eligibility(
        session, child, is_anonymous=False, pepper=ints.identity_pepper
    )
    intro = bool(elig.eligible) and _plan(product_id) == "monthly"
    shown = "pro_monthly_intro_web" if intro else product_id
    product = (
        await session.execute(
            text(
                "select price_paise, intro_price_paise from billing.products"
                " where id = :p and active"
            ),
            {"p": shown},
        )
    ).one_or_none()
    if product is None:
        return False, None, None
    today = product.intro_price_paise if intro else product.price_paise
    return intro, int(today) if today is not None else None, int(product.price_paise)


async def view(db: Database, ints: Integrations, token: str) -> b.ChildPayLinkOut:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        row = await _by_token(session, token, now)
        child: uuid.UUID = row.learner_user_id
        status: str = row.status
        if status == "open":
            ent = await billing.compute_entitlement(session, child, now)
            if ent.active and ent.source != "promo":
                status = "already_pro"
        name = (
            await session.execute(
                text("select display_name from app.profiles where user_id = :u"), {"u": child}
            )
        ).scalar_one_or_none()
        pet = (
            await session.execute(
                text("select species, name from game.pets where user_id = :u"), {"u": child}
            )
        ).one_or_none()
        intro, today, then = await _price(session, ints, child, row.product_id)
    first = (name or "").split(" ")[0] or None
    return b.ChildPayLinkOut(
        status=cast(PayLinkStatus, status),
        child_first_name=first,
        pet=b.PayLinkPet(species=pet.species, name=pet.name) if pet else None,
        plan=_plan(row.product_id),
        intro=intro,
        amount_today_paise=today,
        then_paise=then,
        expires_at=row.expires_at,
    )


async def _open(db: Database, token: str) -> Any:
    async with db.system_tx() as session:
        row = await _by_token(session, token, datetime.now(UTC))
    if row.status == "expired":
        raise ApiError(410, "link_expired", "This link has expired")
    if row.status != "open":
        raise ApiError(409, "link_used", "This link was already used")
    return row


async def start(
    db: Database, ints: Integrations, token: str, variant: str | None
) -> b.RazorpaySubscriptionOut:
    """[Continue to pay]: a web subscription on the teen's account (already_pro is a 409)."""
    row = await _open(db, token)
    out = await billing_checkout._start(
        db, ints, row.learner_user_id, _plan(row.product_id), "guardian_declared", variant
    )
    async with db.system_tx() as session:
        await session.execute(
            text(
                "update billing.payment_links set subscription_id = ("
                " select id from billing.subscriptions where source = 'razorpay'"
                " and external_id = :e and user_id = :u) where id = :id"
            ),
            {"e": out.subscription_id, "u": row.learner_user_id, "id": row.id},
        )
    log.info("child_pay_link_checkout", user=hash_user_id(row.learner_user_id))
    return out


async def verify(
    db: Database, ints: Integrations, token: str, body: b.RazorpayVerifyRequest
) -> b.ChildPayLinkOut:
    """The Checkout signature for the link's subscription: the link is used. Pro follows the
    webhook; the parent's page shows "Done! {child} has Pro." once it lands."""
    row = await _open(db, token)
    async with db.system_tx() as session:
        linked = (
            await session.execute(
                text(
                    "select 1 from billing.subscriptions s join billing.payment_links l"
                    " on l.subscription_id = s.id where l.id = :id and s.external_id = :e"
                ),
                {"id": row.id, "e": body.razorpay_subscription_id},
            )
        ).first()
    if linked is None:
        raise ApiError(404, "subscription_not_found", "This payment isn't for this link")
    await billing_checkout.verify_razorpay(db, ints, row.learner_user_id, body)
    async with db.system_tx() as session:
        await session.execute(
            text(
                "update billing.payment_links set status = 'paid', paid_at = now()"
                " where id = :id and status = 'open'"
            ),
            {"id": row.id},
        )
    return await view(db, ints, token)
