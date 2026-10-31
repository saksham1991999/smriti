"""The yearly plan and the family plan (PRD §11.2, Phase 3): prices in /v1/config, web checkout,
and the family plan's seats, guardian adds, invites and Pro that follows the payer.

The family price and seats are owner flags; the values set here are test values only."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from smriti_api.services import billing
from tests.helpers import Session
from tests.practice_helpers import flags
from tests.social_helpers import person
from tests.test_parent_mode import link

TEST_FAMILY = {"billing.family_seats": 2, "billing.family_yearly_price_paise": 123400}


def key() -> dict[str, str]:
    return {"Idempotency-Key": f"family-{uuid.uuid4().hex}"}


async def pricing(client: httpx.AsyncClient) -> dict[str, Any]:
    # A fresh app version each call, so the cached /v1/config answer is not reused.
    version = f"1.0.{uuid.uuid4().int % 100000}"
    r = await client.get(
        "/v1/config",
        headers={"X-App-Variant": "jee", "X-Platform": "web", "X-App-Version": version},
    )
    assert r.status_code == 200, r.text
    return {p["product_id"]: p for p in r.json()["pricing"]}


async def family_subscription(services: AppServices, owner: Session) -> uuid.UUID:
    """A paid family plan, as the Razorpay webhook leaves it."""
    async with services.db.admin_tx() as session:
        sub = (
            await session.execute(
                text(
                    "insert into billing.subscriptions (user_id, source, external_id, product_id,"
                    " status, current_period_start, current_period_end)"
                    " values (:u, 'razorpay', :e, 'family_yearly_web', 'active', now(), :end)"
                    " returning id"
                ),
                {
                    "u": owner.user_id,
                    "e": f"sub_test{uuid.uuid4().hex[:10]}",
                    "end": datetime.now(UTC) + timedelta(days=365),
                },
            )
        ).scalar_one()
        await billing.recompute_entitlement(session, owner.user_id)
    return uuid.UUID(str(sub))


async def ent(client: httpx.AsyncClient, s: Session) -> dict[str, Any]:
    body: dict[str, Any] = (await client.get("/v1/billing/entitlement", headers=s.headers)).json()
    return body


async def test_yearly_in_config_and_family_hidden_until_set(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    prices = await pricing(client)
    yearly = prices["pro_yearly_web"]
    assert yearly["price_paise"] == 79900 and yearly["period"] == "year"
    assert yearly["plan"] == "individual" and yearly["intro_price_paise"] is None
    assert not any(p["plan"] == "family" for p in prices.values())
    async with flags(services, TEST_FAMILY):
        prices = await pricing(client)
    fam = prices["family_yearly_web"]
    assert fam["price_paise"] == 123400 and fam["seats"] == 2 and fam["plan"] == "family"
    # No monthly family price set: that one stays hidden.
    assert "family_monthly_web" not in prices


async def test_checkout_yearly_and_family(client: httpx.AsyncClient, services: AppServices) -> None:
    adult = await person(client, services, name="Sunita Sharma")
    r = await client.post(
        "/v1/billing/razorpay/subscription",
        json={"plan": "yearly"},
        headers={**adult.headers, **key()},
    )
    assert r.status_code == 200, r.text
    assert r.json()["product_id"] == "pro_yearly_web" and r.json()["intro"] is False
    assert r.json()["then_paise"] == 79900 and r.json()["amount_today_paise"] == 79900

    other = await person(client, services, name="Kabir Rao")
    r = await client.post(
        "/v1/billing/razorpay/subscription",
        json={"plan": "family_yearly"},
        headers={**other.headers, **key()},
    )
    assert r.status_code == 404 and r.json()["code"] == "plan_unavailable"
    teen = await person(client, services, band="13_17", scopes=("account",))
    async with flags(services, TEST_FAMILY):
        r = await client.post(
            "/v1/billing/razorpay/subscription",
            json={"plan": "family_yearly"},
            headers={**other.headers, **key()},
        )
        assert r.status_code == 200, r.text
        assert r.json()["product_id"] == "family_yearly_web" and r.json()["then_paise"] == 123400
        r = await client.post(
            "/v1/billing/razorpay/subscription",
            json={"plan": "family_yearly"},
            headers={**teen.headers, **key()},
        )
        assert r.status_code == 403 and r.json()["code"] == "guardian_required"


async def test_family_seats_invites_and_pro(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    owner = await person(client, services, name="Sunita Sharma")
    child = await person(client, services, band="13_17", name="Riya Sharma", scopes=None)
    await link(services, owner, child)
    sibling = await person(client, services, name="Arjun Sharma")
    teen = await person(client, services, band="13_17", scopes=("account",))
    stranger = await person(client, services, name="Kabir Rao")

    async with flags(services, TEST_FAMILY):
        # Before the plan is paid for, there is no family to manage.
        r = await client.get("/v1/billing/family", headers=owner.headers)
        assert r.status_code == 404 and r.json()["code"] == "no_family_plan"
        await family_subscription(services, owner)
        r = await client.get("/v1/billing/family", headers=owner.headers)
        assert r.json()["role"] == "owner" and r.json()["seats"] == 2 and r.json()["used"] == 0

        # A child joins through the guardian link; nobody else's child can be added.
        r = await client.post(
            "/v1/billing/family/members",
            json={"learner_id": str(stranger.user_id)},
            headers={**owner.headers, **key()},
        )
        assert r.status_code == 404 and r.json()["code"] == "learner_not_found"
        r = await client.post(
            "/v1/billing/family/members",
            json={"learner_id": str(child.user_id)},
            headers={**owner.headers, **key()},
        )
        assert r.status_code == 200, r.text
        assert r.json()["members"][0]["first_name"] == "Riya"
        assert (await ent(client, child))["plan"] == "pro"
        assert (await ent(client, child))["source"] == "family"

        # An adult joins with a code; a minor can't.
        invite = await client.post("/v1/billing/family/invites", headers=owner.headers)
        assert invite.status_code == 201 and invite.json()["code"]
        code = invite.json()["code"]
        r = await client.post(
            f"/v1/billing/family/invites/{code}/accept", headers={**teen.headers, **key()}
        )
        assert r.status_code == 403 and r.json()["code"] == "guardian_required"
        r = await client.post(
            f"/v1/billing/family/invites/{code}/accept", headers={**sibling.headers, **key()}
        )
        assert r.status_code == 200, r.text
        assert r.json()["role"] == "member" and r.json()["used"] == 2
        assert (await ent(client, sibling))["source"] == "family"
        # The same code doesn't work twice, and the plan is full.
        r = await client.post(
            f"/v1/billing/family/invites/{code}/accept", headers={**stranger.headers, **key()}
        )
        assert r.status_code == 404
        r = await client.post("/v1/billing/family/invites", headers=owner.headers)
        assert r.status_code == 409 and r.json()["code"] == "no_seats_left"

        # A member sees the seats, not the others' names.
        mine = (await client.get("/v1/billing/family", headers=sibling.headers)).json()
        assert mine["role"] == "member" and mine["members"] == []
        assert (await client.get("/v1/billing/family", headers=stranger.headers)).status_code == 404

        # The payer removes the child; the child is back on free.
        r = await client.delete(
            f"/v1/billing/family/members/{child.user_id}", headers=owner.headers
        )
        assert r.status_code == 204
        assert (await ent(client, child))["plan"] == "free"
        # Someone else can't remove a member.
        r = await client.delete(
            f"/v1/billing/family/members/{sibling.user_id}", headers=stranger.headers
        )
        assert r.status_code == 404

        # When the payer's plan ends, members lose Pro with it.
        async with services.db.admin_tx() as session:
            await session.execute(
                text(
                    "update billing.subscriptions set status = 'expired',"
                    " current_period_end = now() - interval '1 day' where user_id = :u"
                ),
                {"u": owner.user_id},
            )
            await billing.recompute_entitlement(session, owner.user_id)
            assert await billing.recompute_family_members(session, owner.user_id) == [
                sibling.user_id
            ]
        assert (await ent(client, sibling))["plan"] == "free"
