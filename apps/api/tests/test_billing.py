"""Billing (TRD §11, me-money §5): web checkout, Razorpay and RevenueCat webhooks with recorded
payload shapes, the entitlement recompute, the ₹1 intro claim, cancel, refund and promo weeks."""

from __future__ import annotations

import hashlib
import hmac
import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from smriti_api.integrations import DEV_IDENTITY_PEPPER, DEV_RAZORPAY_KEY_SECRET
from smriti_api.integrations.billing import RazorpayProvider, RevenueCatProvider
from smriti_api.services import billing
from tests.helpers import get_state, new_guest
from tests.money_helpers import (
    REVENUECAT_HEADERS,
    razorpay_body,
    razorpay_headers,
    razorpay_refund_body,
    revenuecat_body,
    set_profile,
    signed_in,
)

KEY = {"Idempotency-Key": "billing-test-key-0001"}


def key(n: str) -> dict[str, str]:
    return {"Idempotency-Key": f"billing-{n}-{uuid.uuid4().hex[:8]}"}


async def entitlement(client: httpx.AsyncClient, headers: dict[str, str]) -> dict[str, Any]:
    r = await client.get("/v1/billing/entitlement", headers=headers)
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    return body


async def start_web(client: httpx.AsyncClient, headers: dict[str, str]) -> dict[str, Any]:
    r = await client.post(
        "/v1/billing/razorpay/subscription", json={}, headers={**headers, **key("start")}
    )
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    return body


async def webhook(
    client: httpx.AsyncClient, body: bytes, event_id: str | None = None
) -> httpx.Response:
    return await client.post(
        "/v1/webhooks/razorpay", content=body, headers=razorpay_headers(body, event_id)
    )


async def test_eligibility_for_guests_and_signed_in_users(client: httpx.AsyncClient) -> None:
    guest = await new_guest(client)
    r = await client.get("/v1/billing/intro-eligibility", headers=guest.headers)
    assert r.json() | {} == {
        "eligible": None,
        "eligible_hint": True,
        "reason": "guest",
        "intro_price_paise": 100,
        "price_paise": 9900,
    }
    s = await signed_in(client)
    r = await client.get("/v1/billing/intro-eligibility", headers=s.headers)
    assert (r.json()["eligible"], r.json()["reason"]) == (True, None)
    # Starting checkout is a hard login (R38): a guest gets login_required.
    r = await client.post(
        "/v1/billing/razorpay/subscription", json={}, headers={**guest.headers, **KEY}
    )
    assert r.json()["code"] == "login_required"


async def test_web_checkout_to_pro_through_the_webhooks(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    s = await signed_in(client)
    r = await client.post("/v1/billing/razorpay/subscription", json={}, headers=s.headers)
    assert r.status_code == 400  # an Idempotency-Key is required (money)
    started = await start_web(client, s.headers)
    assert started["intro"] is True
    assert (started["amount_today_paise"], started["then_paise"]) == (100, 9900)
    sub_id = started["subscription_id"]

    # The Checkout handler's signature (HMAC of payment_id|subscription_id with the key secret).
    pay_id = f"pay_{uuid.uuid4().hex[:14]}"
    sig = hmac.new(
        DEV_RAZORPAY_KEY_SECRET.encode(), f"{pay_id}|{sub_id}".encode(), hashlib.sha256
    ).hexdigest()
    bad = await client.post(
        "/v1/billing/razorpay/verify",
        json={
            "razorpay_payment_id": pay_id,
            "razorpay_subscription_id": sub_id,
            "razorpay_signature": "0" * 64,
        },
        headers=s.headers,
    )
    assert bad.json()["code"] == "invalid_signature"
    ok = await client.post(
        "/v1/billing/razorpay/verify",
        json={
            "razorpay_payment_id": pay_id,
            "razorpay_subscription_id": sub_id,
            "razorpay_signature": sig,
        },
        headers=s.headers,
    )
    assert ok.json()["plan"] == "free" and ok.json()["status"] == "pending"

    now = datetime.now(UTC).replace(microsecond=0)
    end = now + timedelta(days=30)
    body = razorpay_body(
        "subscription.activated",
        user_id=s.user_id,
        sub_id=sub_id,
        start=now,
        end=end,
        created=now,
        payment_id=pay_id,
    )
    tampered = await client.post(
        "/v1/webhooks/razorpay",
        content=body,
        headers={**razorpay_headers(body), "X-Razorpay-Signature": "f" * 64},
    )
    assert tampered.status_code == 401
    evt = f"evt_{uuid.uuid4().hex[:14]}"
    r = await webhook(client, body, evt)
    assert r.json() == {"status": "applied"}
    assert (await webhook(client, body, evt)).json() == {"status": "duplicate"}

    ent = await entitlement(client, s.headers)
    assert ent["plan"] == "pro" and ent["status"] == "trialing" and ent["is_intro"] is True
    assert ent["source"] == "razorpay"
    # The ₹1 month is claimed for the account's Google identity, so it is never offered again.
    r = await client.get("/v1/billing/intro-eligibility", headers=s.headers)
    assert r.json()["eligible"] is False
    async with services.db.admin_tx() as session:
        claims = (
            await session.execute(
                text("select count(*) from billing.intro_claims where user_id = :u"),
                {"u": s.user_id},
            )
        ).scalar_one()
    assert claims == 1
    # Already Pro: no second checkout (PAY-16).
    r = await client.post(
        "/v1/billing/razorpay/subscription", json={}, headers={**s.headers, **key("again")}
    )
    assert r.json()["code"] == "already_pro"

    # The sync state carries the optional fields app-core knows.
    state = await get_state(client, s)
    assert state["entitlement"]["status"] == "trialing"
    assert state["entitlement"]["source"] == "razorpay"

    # Month 2 is charged at ₹99: active, no longer intro.
    body2 = razorpay_body(
        "subscription.charged",
        user_id=s.user_id,
        sub_id=sub_id,
        start=end,
        end=end + timedelta(days=30),
        created=now + timedelta(seconds=10),
        paid_count=2,
        amount=9900,
    )
    await webhook(client, body2)
    ent = await entitlement(client, s.headers)
    assert (ent["status"], ent["is_intro"]) == ("active", False)

    # A late, older event never overwrites the newer state.
    stale = razorpay_body(
        "subscription.halted",
        user_id=s.user_id,
        sub_id=sub_id,
        start=now,
        end=end,
        created=now - timedelta(hours=1),
    )
    await webhook(client, stale)
    assert (await entitlement(client, s.headers))["status"] == "active"

    # Payment failed: grace keeps Pro until grace_until, then halted locks it.
    pending = razorpay_body(
        "subscription.pending",
        user_id=s.user_id,
        sub_id=sub_id,
        start=end,
        end=end + timedelta(days=30),
        created=now + timedelta(seconds=20),
        paid_count=2,
    )
    await webhook(client, pending)
    ent = await entitlement(client, s.headers)
    assert ent["plan"] == "pro" and ent["status"] == "grace" and ent["grace_until"] is not None
    halted = razorpay_body(
        "subscription.halted",
        user_id=s.user_id,
        sub_id=sub_id,
        start=end,
        end=end + timedelta(days=30),
        created=now + timedelta(seconds=30),
        paid_count=2,
    )
    await webhook(client, halted)
    ent = await entitlement(client, s.headers)
    assert (ent["plan"], ent["status"]) == ("free", "on_hold")


async def test_cancel_keeps_pro_to_period_end_and_a_refund_ends_it(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    s = await signed_in(client)
    started = await start_web(client, s.headers)
    now = datetime.now(UTC).replace(microsecond=0)
    pay_id = f"pay_{uuid.uuid4().hex[:14]}"
    await webhook(
        client,
        razorpay_body(
            "subscription.activated",
            user_id=s.user_id,
            sub_id=started["subscription_id"],
            start=now,
            end=now + timedelta(days=30),
            created=now,
            payment_id=pay_id,
        ),
    )
    r = await client.post(
        "/v1/billing/razorpay/cancel",
        json={"reason": "too_expensive"},
        headers={**s.headers, **key("cancel")},
    )
    assert r.status_code == 200, r.text
    assert (r.json()["plan"], r.json()["cancel_at_period_end"]) == ("pro", True)
    assert started["subscription_id"] in services.integrations.razorpay.cancelled  # type: ignore[union-attr]
    details = (await client.get("/v1/billing/subscription", headers=s.headers)).json()
    assert details["subscription"]["managed_in"] == "web"
    assert details["subscription"]["next_charge_at"] is None
    assert details["subscription"]["ends_at"] is not None

    await webhook(
        client, razorpay_refund_body(payment_id=pay_id, created=now + timedelta(minutes=1))
    )
    ent = await entitlement(client, s.headers)
    assert ent["plan"] == "free"
    async with services.db.admin_tx() as session:
        refunded = (
            await session.execute(
                text("select status from billing.payments where external_payment_id = :p"),
                {"p": pay_id},
            )
        ).scalar_one()
    assert refunded == "refunded"


async def test_minors_and_managed_children_at_checkout(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    child = await signed_in(client)
    await set_profile(services, child.user_id, age_band="10_12")
    r = await client.post(
        "/v1/billing/razorpay/subscription", json={}, headers={**child.headers, **key("child")}
    )
    assert r.json()["code"] == "guardian_required"

    teen = await signed_in(client)
    await set_profile(services, teen.user_id, age_band="13_17")
    r = await client.post(
        "/v1/billing/razorpay/subscription",
        json={"payer": "guardian_declared"},
        headers={**teen.headers, **key("teen")},
    )
    assert r.status_code == 200, r.text
    async with services.db.admin_tx() as session:
        payer = (
            await session.execute(
                text("select payer from billing.subscriptions where user_id = :u"),
                {"u": teen.user_id},
            )
        ).scalar_one()
    assert payer == "guardian_declared"


async def test_revenuecat_store_lifecycle(client: httpx.AsyncClient) -> None:
    s = await signed_in(client)
    now = datetime.now(UTC).replace(microsecond=0)
    month = now + timedelta(days=30)
    r = await client.post(
        "/v1/webhooks/revenuecat",
        content=revenuecat_body(
            "INITIAL_PURCHASE", user_id=s.user_id, at=now, purchased=now, expires=month
        ),
        headers={**REVENUECAT_HEADERS, "Authorization": "Bearer wrong"},
    )
    assert r.status_code == 401
    initial = revenuecat_body(
        "INITIAL_PURCHASE",
        user_id=s.user_id,
        at=now,
        purchased=now,
        expires=month,
        period_type="INTRO",
    )
    r = await client.post("/v1/webhooks/revenuecat", content=initial, headers=REVENUECAT_HEADERS)
    assert r.json() == {"status": "applied"}
    ent = await entitlement(client, s.headers)
    assert (ent["plan"], ent["status"], ent["source"], ent["is_intro"]) == (
        "pro",
        "trialing",
        "play",
        True,
    )

    # Store grace: still Pro, with grace_until from RevenueCat.
    grace = month + timedelta(days=3)
    issue = revenuecat_body(
        "BILLING_ISSUE",
        user_id=s.user_id,
        at=now + timedelta(seconds=5),
        purchased=now,
        expires=month,
        grace=grace,
    )
    await client.post("/v1/webhooks/revenuecat", content=issue, headers=REVENUECAT_HEADERS)
    ent = await entitlement(client, s.headers)
    assert ent["status"] == "grace" and ent["plan"] == "pro"

    # A refund through store support ends Pro at once.
    refund = revenuecat_body(
        "CANCELLATION",
        user_id=s.user_id,
        at=now + timedelta(seconds=9),
        purchased=now,
        expires=month,
        cancel_reason="CUSTOMER_SUPPORT",
    )
    await client.post("/v1/webhooks/revenuecat", content=refund, headers=REVENUECAT_HEADERS)
    ent = await entitlement(client, s.headers)
    assert ent["plan"] == "free"

    # TEST events from the dashboard are acknowledged and ignored.
    test_event = revenuecat_body("TEST", user_id=s.user_id, at=now, purchased=now, expires=month)
    r = await client.post("/v1/webhooks/revenuecat", content=test_event, headers=REVENUECAT_HEADERS)
    assert r.json() == {"status": "ignored"}


async def test_restore_is_a_no_op_without_revenuecat(client: httpx.AsyncClient) -> None:
    s = await signed_in(client)
    r = await client.post("/v1/billing/restore", headers={**s.headers, **key("restore")})
    assert r.status_code == 200, r.text
    assert r.json()["restored"] is False


async def test_promo_week_waits_for_paid_pro_and_can_be_revoked(services: AppServices) -> None:
    now = datetime(2026, 10, 30, 6, 0, tzinfo=UTC)
    async with services.db.admin_tx() as session:
        uid = (
            await session.execute(
                text("insert into auth.users (is_anonymous) values (false) returning id")
            )
        ).scalar_one()
        start, end = await billing.grant_promo_week(session, uid, ref="ref-1", now=now)
        assert (start, end) == (now, now + timedelta(days=7))
        ent = await billing.compute_entitlement(session, uid, now + timedelta(hours=1))
        assert (ent.active, ent.source) == (True, "promo")
        # The same referral twice is one grant.
        assert await billing.grant_promo_week(session, uid, ref="ref-1", now=now) == (start, end)
        # A paid month: the next week waits until the paid period ends.
        await session.execute(
            text(
                "insert into billing.subscriptions (user_id, source, external_id, product_id, status,"
                " current_period_end) values (:u, 'play', :e, 'pro_monthly_android_all', 'active', :end)"
            ),
            {"u": uid, "e": f"GPA.{uuid.uuid4().hex}", "end": now + timedelta(days=30)},
        )
        start2, _ = await billing.grant_promo_week(session, uid, ref="ref-2", now=now)
        assert start2 == now + timedelta(days=30)
        assert await billing.revoke_promo_grants(session, uid) == 2


async def test_real_providers_speak_the_documented_wire_format() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("/subscriptions"):
            return httpx.Response(
                200, json={"id": "sub_Real01", "status": "created", "short_url": "https://rzp.io/x"}
            )
        if "/subscribers/" in request.url.path:
            return httpx.Response(
                200,
                json={
                    "subscriber": {
                        "subscriptions": {
                            "pro_monthly_intro_android_all": {
                                "expires_date": "2026-11-30T00:00:00Z",
                                "refunded_at": "2026-11-01T00:00:00Z",
                                "store": "play_store",
                            }
                        }
                    }
                },
            )
        return httpx.Response(404)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        rz = RazorpayProvider(
            http,
            base_url="https://api.razorpay.com/v1",
            key_id="rzp_test_x",
            key_secret="s3",
            webhook_secret="w",
            plan_id="plan_X",
            intro_offer_id="offer_Y",
        )
        uid = uuid.uuid4()
        sub = await rz.create_subscription(user_id=uid, intro=True)
        assert sub["id"] == "sub_Real01"
        req = seen[0]
        assert req.headers["authorization"].startswith("Basic ")
        sent = json.loads(req.content)
        assert (sent["plan_id"], sent["offer_id"], sent["notes"]["user_id"]) == (
            "plan_X",
            "offer_Y",
            str(uid),
        )

        rc = RevenueCatProvider(
            http, base_url="https://api.revenuecat.com/v1", secret_api_key="sk", webhook_auth="a"
        )
        now = datetime.now(UTC)
        event = rc.parse_webhook(
            revenuecat_body(
                "RENEWAL", user_id=uid, at=now, purchased=now, expires=now + timedelta(days=30)
            ),
            {},
        )
        event = event.__class__(
            event.source,
            event.external_event_id,
            event.event_type,
            event.user_id,
            [
                u.__class__(**{**u.__dict__, "store_product_id": "pro_monthly_intro_android_all"})
                for u in event.updates
            ],
            event.payload,
        )
        confirmed = await rc.confirm(event)
        # The REST record wins: the purchase was refunded.
        assert confirmed.updates[0].status == "cancelled"
        assert confirmed.updates[0].refunded_at == datetime(2026, 11, 1, tzinfo=UTC)
        assert seen[-1].headers["authorization"] == "Bearer sk"


def test_identity_keys_are_peppered_hmacs() -> None:
    k = billing.identity_key(DEV_IDENTITY_PEPPER, "google", "1234")
    assert k == hmac.new(DEV_IDENTITY_PEPPER.encode(), b"google:1234", hashlib.sha256).hexdigest()
    assert k != billing.identity_key("another-pepper", "google", "1234")
