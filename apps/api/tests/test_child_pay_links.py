"""PAY-17 "Send to my parent" (me-money §5.12): a 13 to 17 year old's 48 h link that a parent opens
without signing in to pay for the teen's account."""

from __future__ import annotations

import hashlib
import hmac
import uuid

import httpx
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from smriti_api.integrations import DEV_RAZORPAY_KEY_SECRET
from tests.practice_helpers import flags
from tests.social_helpers import person

BASE = "/v1/billing/child-payment-links"
WEB = {"X-Platform": "web"}


def key() -> dict[str, str]:
    return {"Idempotency-Key": f"pay-link-{uuid.uuid4().hex}"}


async def test_teen_sends_a_link_and_a_parent_pays_without_signing_in(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    teen = await person(client, services, band="13_17", name="Riya Sharma", pet="Miso")
    r = await client.post(BASE, json={}, headers={**teen.headers, **WEB})
    assert r.status_code == 201, r.text
    link = r.json()
    token = link["token"]
    assert link["url"].endswith(f"/pay/child/{token}") and link["plan"] == "monthly"
    async with services.db.admin_tx() as session:
        stored = (
            await session.execute(
                text("select token_hash from billing.payment_links where id = :id"),
                {"id": link["id"]},
            )
        ).scalar_one()
    assert stored != token and stored == hashlib.sha256(token.encode()).hexdigest()

    # The parent's page: no login, first name and pet, the teen's own ₹1 eligibility.
    page = (await client.get(f"{BASE}/{token}")).json()
    assert page["status"] == "open" and page["child_first_name"] == "Riya"
    assert page["pet"] == {"species": "cat", "name": "Miso"}
    assert (page["intro"], page["amount_today_paise"], page["then_paise"]) == (True, 100, 9900)

    r = await client.post(f"{BASE}/{token}/subscription", json={})
    assert r.status_code == 400  # money: an Idempotency-Key is required
    r = await client.post(f"{BASE}/{token}/subscription", json={}, headers=key())
    assert r.status_code == 200, r.text
    sub_id = r.json()["subscription_id"]
    async with services.db.admin_tx() as session:
        row = (
            await session.execute(
                text("select user_id, payer from billing.subscriptions where external_id = :e"),
                {"e": sub_id},
            )
        ).one()
    assert (row.user_id, row.payer) == (teen.user_id, "guardian_declared")

    pay_id = f"pay_{uuid.uuid4().hex[:14]}"
    sig = hmac.new(
        DEV_RAZORPAY_KEY_SECRET.encode(), f"{pay_id}|{sub_id}".encode(), hashlib.sha256
    ).hexdigest()
    body = {
        "razorpay_payment_id": pay_id,
        "razorpay_subscription_id": sub_id,
        "razorpay_signature": sig,
    }
    r = await client.post(f"{BASE}/{token}/verify", json=body, headers=key())
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "paid"
    # Used: a second checkout from the same link is refused.
    r = await client.post(f"{BASE}/{token}/subscription", json={}, headers=key())
    assert r.status_code == 409 and r.json()["code"] == "link_used"


async def test_link_rules(client: httpx.AsyncClient, services: AppServices) -> None:
    adult = await person(client, services)
    r = await client.post(BASE, json={}, headers={**adult.headers, **WEB})
    assert r.status_code == 403 and r.json()["code"] == "child_link_not_for_age"
    teen = await person(client, services, band="13_17")
    # Off in the store apps by default (Q7).
    r = await client.post(BASE, json={}, headers={**teen.headers, "X-Platform": "ios"})
    assert r.status_code == 403 and r.json()["code"] == "child_link_disabled"

    first = (await client.post(BASE, json={}, headers={**teen.headers, **WEB})).json()
    second = (
        await client.post(BASE, json={"plan": "yearly"}, headers={**teen.headers, **WEB})
    ).json()
    # One open link at a time: the new one cancels the old.
    assert (await client.get(f"{BASE}/{first['token']}")).json()["status"] == "cancelled"
    page = (await client.get(f"{BASE}/{second['token']}")).json()
    assert page["plan"] == "yearly" and page["intro"] is False
    r = await client.delete(f"{BASE}/{second['id']}", headers=teen.headers)
    assert r.status_code == 204
    assert (await client.get(f"{BASE}/{second['token']}")).json()["status"] == "cancelled"

    # Expired after pay.child_link_ttl_h.
    third = (await client.post(BASE, json={}, headers={**teen.headers, **WEB})).json()
    async with services.db.admin_tx() as session:
        await session.execute(
            text(
                "update billing.payment_links set expires_at = now() - interval '1 minute'"
                " where id = :id"
            ),
            {"id": third["id"]},
        )
    assert (await client.get(f"{BASE}/{third['token']}")).json()["status"] == "expired"
    r = await client.post(f"{BASE}/{third['token']}/subscription", json={}, headers=key())
    assert r.status_code == 410 and r.json()["code"] == "link_expired"
    assert (await client.get(f"{BASE}/{'x' * 43}")).status_code == 404

    async with flags(services, {"pay.child_link_ttl_h": 1}):
        short = (await client.post(BASE, json={}, headers={**teen.headers, **WEB})).json()
    async with services.db.admin_tx() as session:
        hours = (
            await session.execute(
                text(
                    "select extract(epoch from expires_at - created_at) / 3600"
                    " from billing.payment_links where id = :id"
                ),
                {"id": short["id"]},
            )
        ).scalar_one()
    assert round(float(hours)) == 1
