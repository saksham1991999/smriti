"""Managed accounts for under-13s (auth flow §6.11): a parent adopts the guest that did onboarding
(same user id) or makes a new child, gets one-time token-hash sessions for a device, and deletes
a child. Locally the token hash is exchanged at /v1/dev/auth/verify-otp."""

from __future__ import annotations

import uuid
from typing import Any

import httpx
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from smriti_api.services import notify
from tests.helpers import Session, new_guest
from tests.social_helpers import person


def key() -> dict[str, str]:
    return {"Idempotency-Key": f"managed-{uuid.uuid4().hex}"}


def child_body(**over: Any) -> dict[str, Any]:
    return {
        "first_name": "Riya",
        "age_band": "u10",
        "scopes": ["account", "voice"],
        "declaration": True,
        "notice_version": "2026-10",
        **over,
    }


async def child_session(client: httpx.AsyncClient, parent: Session, child_id: str) -> Session:
    r = await client.post(f"/v1/guardian/children/{child_id}/session", headers=parent.headers)
    assert r.status_code == 200, r.text
    hashed = r.json()
    assert hashed["type"] == "email" and hashed["expires_in"] == 300
    s = await client.post("/v1/dev/auth/verify-otp", json={"token_hash": hashed["token_hash"]})
    assert s.status_code == 200, s.text
    # The hash works once.
    again = await client.post("/v1/dev/auth/verify-otp", json={"token_hash": hashed["token_hash"]})
    assert again.status_code == 401 and again.json()["code"] == "otp_expired"
    return Session(
        token=s.json()["access_token"], user_id=uuid.UUID(child_id), device_id=uuid.uuid4()
    )


async def test_adopt_a_guest_and_hand_a_device_a_child_session(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    parent = await person(client, services, name="Sunita Sharma")
    guest = await new_guest(client)
    r = await client.post(
        "/v1/guardian/children",
        json=child_body(adopt_guest=guest.token),
        headers={**parent.headers, **key()},
    )
    assert r.status_code == 201, r.text
    out = r.json()
    # The child keeps the guest's user id; voice is off for a little learner.
    assert out["user_id"] == str(guest.user_id) and out["adopted"] is True
    assert out["consent"]["method"] == "parent_created"
    assert out["consent"]["scopes"] == ["account"]
    async with services.db.admin_tx() as session:
        row = (
            await session.execute(
                text(
                    "select u.is_anonymous, u.email, p.account_kind, p.age_band, gl.kind"
                    " from auth.users u join app.profiles p on p.user_id = u.id"
                    " join app.guardian_links gl on gl.learner_user_id = u.id"
                    " where u.id = :u"
                ),
                {"u": guest.user_id},
            )
        ).one()
    assert row.is_anonymous is False and row.email.endswith("@managed.smriti.invalid")
    assert (row.account_kind, row.age_band, row.kind) == ("managed", "u10", "managed")

    # The parent sees the child in Parent mode, and hands a device a child session.
    learners = (await client.get("/v1/guardian/learners", headers=parent.headers)).json()
    assert [entry["kind"] for entry in learners["learners"]] == ["managed"]
    child = await child_session(client, parent, out["user_id"])
    me = await client.get("/v1/me/limits", headers=child.headers)
    assert me.status_code == 200, me.text

    # A signed-in account can't be adopted, and nobody else gets a session for this child.
    adult = await person(client, services, name="Kabir Rao")
    r = await client.post(
        "/v1/guardian/children",
        json=child_body(adopt_guest=adult.token),
        headers={**parent.headers, **key()},
    )
    assert r.status_code == 409 and r.json()["code"] == "not_a_guest"
    r = await client.post(f"/v1/guardian/children/{out['user_id']}/session", headers=adult.headers)
    assert r.status_code == 404


async def test_new_child_and_deleting_it(client: httpx.AsyncClient, services: AppServices) -> None:
    parent = await person(client, services, name="Meera Iyer")
    teen = await person(client, services, band="13_17", scopes=("account",))
    r = await client.post(
        "/v1/guardian/children", json=child_body(), headers={**teen.headers, **key()}
    )
    assert r.status_code == 403 and r.json()["code"] == "guardian_is_minor"

    r = await client.post(
        "/v1/guardian/children",
        json=child_body(first_name="Arjun", age_band="10_12"),
        headers={**parent.headers, **key()},
    )
    assert r.status_code == 201, r.text
    child_id = r.json()["user_id"]
    assert r.json()["adopted"] is False and r.json()["consent"]["scopes"] == ["account", "voice"]
    await child_session(client, parent, child_id)

    r = await client.delete(
        f"/v1/guardian/children/{child_id}", headers={**parent.headers, **key()}
    )
    assert r.status_code == 202, r.text
    async with services.db.admin_tx() as session:
        scheduled = (
            await session.execute(
                text("select deletion_scheduled_for from app.profiles where user_id = :u"),
                {"u": child_id},
            )
        ).scalar_one()
    assert scheduled is not None


def test_dispatch_senders_carry_the_mailer(services: AppServices) -> None:
    assert services.integrations is not None
    senders = notify.senders_from(services.integrations)
    assert senders.mailer is services.integrations.mailer
