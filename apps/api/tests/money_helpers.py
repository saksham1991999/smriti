"""Helpers for the billing, guardian and notification tests (wave 2, Agent A)."""

from __future__ import annotations

import hashlib
import hmac
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from smriti_api.integrations import DEV_RAZORPAY_WEBHOOK_SECRET, DEV_REVENUECAT_WEBHOOK_AUTH
from smriti_api.services import billing
from tests.helpers import Session, google

FIXTURES = Path(__file__).parent / "fixtures"


def email() -> str:
    return f"learner-{uuid.uuid4().hex[:10]}@example.com"


async def signed_in(client: httpx.AsyncClient, address: str | None = None) -> Session:
    r = await google(client, address or email())
    assert r.status_code == 200, r.text
    body = r.json()
    return Session(
        token=body["access_token"], user_id=uuid.UUID(body["user"]["id"]), device_id=uuid.uuid4()
    )


async def set_profile(services: AppServices, user_id: uuid.UUID, **cols: Any) -> None:
    sets = ", ".join(f"{k} = :{k}" for k in cols)
    async with services.db.admin_tx() as session:
        await session.execute(
            text(f"update app.profiles set {sets} where user_id = :u"), {"u": user_id, **cols}
        )


async def grant_pro(services: AppServices, user_id: uuid.UUID, days: int = 30) -> None:
    """Pro for tests, through the real billing path: a promo grant (billing.promo_grants), which
    recomputes billing.entitlements and bumps the entitlement sync section like any other grant."""
    async with services.db.system_tx() as session:
        await billing.grant_promo_week(
            session, user_id, ref=f"test-pro-{uuid.uuid4().hex}", days=days
        )


def fill(template: str, **values: Any) -> bytes:
    out = template
    for k, v in values.items():
        out = out.replace("{{" + k + "}}", str(v))
    return out.encode()


def razorpay_body(
    event: str,
    *,
    user_id: uuid.UUID,
    sub_id: str,
    start: datetime,
    end: datetime,
    created: datetime,
    paid_count: int = 1,
    intro: bool = True,
    payment_id: str | None = None,
    amount: int = 100,
) -> bytes:
    template = (FIXTURES / "billing" / "razorpay_subscription.json.tmpl").read_text()
    status = event.split(".", 1)[1]
    return fill(
        template,
        EVENT=event,
        SUB_ID=sub_id,
        SUB_STATUS=status,
        CURRENT_START=int(start.timestamp()),
        CURRENT_END=int(end.timestamp()),
        USER_ID=user_id,
        INTRO="1" if intro else "0",
        PAID_COUNT=paid_count,
        OFFER_ID='"offer_FixtureIntro"' if intro else "null",
        PAYMENT_ID=payment_id or f"pay_{uuid.uuid4().hex[:14]}",
        AMOUNT=amount,
        CREATED_AT=int(created.timestamp()),
    )


def razorpay_refund_body(*, payment_id: str, created: datetime, amount: int = 9900) -> bytes:
    template = (FIXTURES / "billing" / "razorpay_refund.json.tmpl").read_text()
    return fill(template, PAYMENT_ID=payment_id, CREATED_AT=int(created.timestamp()), AMOUNT=amount)


def razorpay_headers(body: bytes, event_id: str | None = None) -> dict[str, str]:
    sig = hmac.new(DEV_RAZORPAY_WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    return {
        "X-Razorpay-Signature": sig,
        "X-Razorpay-Event-Id": event_id or f"evt_{uuid.uuid4().hex[:14]}",
        "Content-Type": "application/json",
    }


def ms(at: datetime | None) -> str:
    return "null" if at is None else str(int(at.timestamp() * 1000))


def revenuecat_body(
    type_: str,
    *,
    user_id: uuid.UUID,
    at: datetime,
    purchased: datetime,
    expires: datetime,
    period_type: str = "NORMAL",
    grace: datetime | None = None,
    cancel_reason: str | None = None,
    expiration_reason: str | None = None,
    event_id: str | None = None,
) -> bytes:
    template = (FIXTURES / "billing" / "revenuecat_event.json.tmpl").read_text()
    return fill(
        template,
        EVENT_ID=event_id or str(uuid.uuid4()).upper(),
        TYPE=type_,
        EVENT_MS=ms(at),
        USER_ID=user_id,
        PERIOD_TYPE=period_type,
        PURCHASED_MS=ms(purchased),
        EXPIRES_MS=ms(expires),
        GRACE_MS=ms(grace),
        CANCEL_REASON=json.dumps(cancel_reason),
        EXPIRATION_REASON=json.dumps(expiration_reason),
        TXN=f"GPA.{user_id.hex[:20]}",
    )


REVENUECAT_HEADERS = {
    "Authorization": DEV_REVENUECAT_WEBHOOK_AUTH,
    "Content-Type": "application/json",
}
