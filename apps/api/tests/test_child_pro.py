"""PAY-17: a parent buys Pro for a child (me-money §5.4 "Parent mode"). The subscription is the
child's, with ``payer = guardian``; only a linked guardian starts, verifies, reads or cancels it,
and the child's own cancel refuses it."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from tests.helpers import get_state
from tests.money_helpers import razorpay_body, razorpay_headers
from tests.social_helpers import person
from tests.test_parent_mode import link


def key() -> dict[str, str]:
    return {"Idempotency-Key": f"child-pro-{uuid.uuid4().hex}"}


async def test_parent_buys_pro_for_a_child(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    parent = await person(client, services, name="Sunita Sharma")
    child = await person(client, services, band="10_12", name="Riya Sharma", scopes=None)
    await link(services, parent, child, scopes=("account",), kind="managed")
    stranger = await person(client, services, name="Kabir Rao")
    teen = await person(client, services, band="13_17", scopes=("account",))

    # The child never reaches checkout; a stranger or a minor can't buy for the child.
    r = await client.post(
        "/v1/billing/razorpay/subscription", json={}, headers={**child.headers, **key()}
    )
    assert r.status_code == 403 and r.json()["code"] == "guardian_required"
    url = f"/v1/guardian/learners/{child.user_id}/pro"
    r = await client.post(url, json={}, headers={**stranger.headers, **key()})
    assert r.status_code == 404 and r.json()["code"] == "learner_not_found"
    r = await client.post(url, json={}, headers={**teen.headers, **key()})
    assert r.status_code == 403 and r.json()["code"] == "guardian_required"

    # The parent starts it: the ₹1 month follows the child's own eligibility.
    r = await client.post(url, json={"plan": "monthly"}, headers={**parent.headers, **key()})
    assert r.status_code == 200, r.text
    started = r.json()
    assert started["product_id"] == "pro_monthly_intro_web" and started["intro"] is True
    sub_id = started["subscription_id"]
    async with services.db.admin_tx() as session:
        row = (
            await session.execute(
                text("select user_id, payer from billing.subscriptions where external_id = :e"),
                {"e": sub_id},
            )
        ).one()
    assert (row.user_id, row.payer) == (child.user_id, "guardian")

    # The webhook turns Pro on for the child; the parent sees the plan they manage.
    now = datetime.now(UTC).replace(microsecond=0)
    body = razorpay_body(
        "subscription.activated",
        user_id=child.user_id,
        sub_id=sub_id,
        start=now,
        end=now + timedelta(days=30),
        created=now,
    )
    r = await client.post("/v1/webhooks/razorpay", content=body, headers=razorpay_headers(body))
    assert r.status_code == 200, r.text
    ent = (await client.get("/v1/billing/entitlement", headers=child.headers)).json()
    assert ent["plan"] == "pro" and ent["source"] == "razorpay"
    # Sync v1.4: the child's state says the parent manages the plan (no payer inference needed).
    state = await get_state(client, child)
    assert state["entitlement"]["managed_in"] == "parent"
    seen = (await client.get(url, headers=parent.headers)).json()
    assert seen["subscription"]["payer"] == "guardian"
    assert (await client.get(url, headers=stranger.headers)).status_code == 404

    # Already Pro: no second plan.
    r = await client.post(url, json={}, headers={**parent.headers, **key()})
    assert r.status_code == 409 and r.json()["code"] == "already_pro"

    # Only the parent cancels it.
    r = await client.post(
        "/v1/billing/razorpay/cancel", json={}, headers={**child.headers, **key()}
    )
    assert r.status_code == 403 and r.json()["code"] == "managed_by_parent"
    r = await client.post(f"{url}/cancel", json={}, headers={**parent.headers, **key()})
    assert r.status_code == 200, r.text
    assert r.json()["cancel_at_period_end"] is True and r.json()["plan"] == "pro"
