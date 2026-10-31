"""AUTH-27 (auth flow §6.11, me-money SET-18 path 2): a guardian asks to link an existing teen;
the teen sees it, accepts or declines; on accept the §6.10 consent request opens for that guardian
only. Rate limit, expiry, no account-existence leak, and the teen's evidence."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from smriti_api.services import guardian
from tests.helpers import Session
from tests.money_helpers import set_profile, signed_in
from tests.practice_helpers import flags
from tests.test_guardian import NOTICE, agree, outbox

ACCEPT = {"notice_version": NOTICE, "app_version": "1.0.0", "platform": "android"}


def key() -> dict[str, str]:
    return {"Idempotency-Key": f"link-{uuid.uuid4().hex}"}


def address() -> str:
    return f"teen-{uuid.uuid4().hex[:10]}@example.com"


async def parent(client: httpx.AsyncClient, services: AppServices) -> Session:
    s = await signed_in(client)
    await set_profile(services, s.user_id, age_band="18p", display_name="Asha Verma")
    return s


async def teen(
    client: httpx.AsyncClient, services: AppServices, email: str | None = None
) -> Session:
    s = await signed_in(client, email)
    await set_profile(services, s.user_id, age_band="13_17", display_name="Riya Sharma")
    return s


async def start(client: httpx.AsyncClient, p: Session, **body: Any) -> httpx.Response:
    return await client.post(
        "/v1/guardian/link-requests",
        json={"scopes": ["social"], **body},
        headers={**p.headers, **key()},
    )


async def row(services: AppServices, request_id: str) -> Any:
    async with services.db.admin_tx() as session:
        return (
            await session.execute(
                text("select * from app.guardian_link_requests where id = :id"),
                {"id": request_id},
            )
        ).one()


async def test_link_by_email_accept_then_guardian_agrees(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    email = address()
    t = await teen(client, services, email)
    p = await parent(client, services)

    r = await start(client, p, teen_email=email.upper())
    assert r.status_code == 201, r.text
    req = r.json()
    assert req["scopes"] == ["account", "social"] and req["link"].endswith(f"/link/{req['code']}")
    stored = await row(services, req["id"])
    # Matched to the teen; the address is never stored, only its HMAC, and the code only hashed.
    assert stored.learner_user_id == t.user_id and stored.target_email_hash
    assert email not in str(stored._mapping.values()) and stored.code_hash != req["code"]

    # The teen is told: a push with the AUTH-27 line, and the in-app list and badge.
    items = await outbox(services, t.user_id)
    assert [(i.kind, i.payload["parent_first_name"]) for i in items] == [
        ("guardian_link_request", "Asha")
    ]
    mine = (await client.get("/v1/me/link-requests", headers=t.headers)).json()
    assert [(m["id"], m["parent_first_name"], m["scopes"]) for m in mine] == [
        (req["id"], "Asha", ["account", "social"])
    ]
    me = (await client.get("/v1/guardian/consent", headers=t.headers)).json()
    assert me["pending_link_requests"] == 1

    # The guardian's own list does not name the teen before they accept.
    listed = (await client.get("/v1/guardian/link-requests", headers=p.headers)).json()
    assert listed[0]["status"] == "pending" and listed[0]["learner_first_name"] is None

    r = await client.post(
        f"/v1/me/link-requests/{req['id']}/accept", json=ACCEPT, headers={**t.headers, **key()}
    )
    assert r.status_code == 200, r.text
    decision = r.json()
    assert decision["status"] == "accepted" and decision["consent_request_id"]
    stored = await row(services, req["id"])
    assert stored.status == "accepted" and stored.resolved_at is not None
    ev = stored.evidence
    assert (ev["notice_version"], ev["platform"], ev["scopes_shown"]) == (
        NOTICE,
        "android",
        ["account", "social"],
    )
    assert ev["accepted_at"]
    async with services.db.admin_tx() as session:
        cr = (
            await session.execute(
                text("select * from app.guardian_consent_requests where id = :id"),
                {"id": decision["consent_request_id"]},
            )
        ).one()
    assert (cr.initiated_by, cr.guardian_user_id, cr.learner_user_id) == (
        "guardian",
        p.user_id,
        t.user_id,
    )
    me = (await client.get("/v1/guardian/consent", headers=t.headers)).json()
    assert me["state"] == "pending" and me["pending_link_requests"] == 0
    assert me["pending_request_id"] == decision["consent_request_id"]
    assert [i.kind for i in await outbox(services, p.user_id)] == ["parent_consent_needed"]

    # Accepting twice is "already answered".
    r = await client.post(
        f"/v1/me/link-requests/{req['id']}/accept", json=ACCEPT, headers={**t.headers, **key()}
    )
    assert r.status_code == 409 and r.json()["code"] == "link_request_answered"

    # Another adult with the code cannot answer it; the guardian who asked can (AUTH-20).
    stranger = await parent(client, services)
    r = await agree(client, stranger, req["code"], ["social"])
    assert r.status_code == 404
    r = await client.post(
        f"/v1/guardian/consent-requests/{req['code']}/decline",
        headers={**stranger.headers, **key()},
    )
    assert r.status_code == 404
    r = await agree(client, p, req["code"], ["social"])
    assert r.status_code == 200, r.text
    assert r.json()["consent"]["scopes"] == ["account", "social"]
    async with services.db.admin_tx() as session:
        link = (
            await session.execute(
                text(
                    "select kind from app.guardian_links"
                    " where guardian_user_id = :g and learner_user_id = :l"
                ),
                {"g": p.user_id, "l": t.user_id},
            )
        ).scalar_one()
    assert link == "consent"
    listed = (await client.get("/v1/guardian/link-requests", headers=p.headers)).json()
    assert listed[0]["status"] == "accepted" and listed[0]["learner_first_name"] == "Riya"


async def test_link_by_invite_code_and_decline(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    t = await teen(client, services)
    code = f"inv{uuid.uuid4().hex[:8]}"
    await set_profile(services, t.user_id, referral_code=code)
    p = await parent(client, services)
    r = await start(client, p, teen_code=code.upper(), scopes=["social", "voice"])
    assert r.status_code == 201, r.text
    req = r.json()
    assert (await row(services, req["id"])).learner_user_id == t.user_id
    assert req["scopes"] == ["account", "social", "voice"]

    # Another teen cannot see or answer it.
    other = await teen(client, services)
    assert (await client.get("/v1/me/link-requests", headers=other.headers)).json() == []
    r = await client.post(
        f"/v1/me/link-requests/{req['id']}/decline", headers={**other.headers, **key()}
    )
    assert r.status_code == 404

    r = await client.post(
        f"/v1/me/link-requests/{req['id']}/decline", headers={**t.headers, **key()}
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"id": req["id"], "status": "declined", "consent_request_id": None}
    stored = await row(services, req["id"])
    assert stored.status == "declined" and stored.consent_request_id is None
    async with services.db.admin_tx() as session:
        n = (
            await session.execute(
                text(
                    "select count(*) from app.guardian_consent_requests where learner_user_id = :u"
                ),
                {"u": t.user_id},
            )
        ).scalar_one()
    assert n == 0
    listed = (await client.get("/v1/guardian/link-requests", headers=p.headers)).json()
    assert listed[0]["status"] == "declined" and listed[0]["learner_first_name"] is None


async def test_open_request_is_claimed_by_code(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    p = await parent(client, services)
    req = (await start(client, p)).json()
    assert (await row(services, req["id"])).learner_user_id is None

    # Adults and the guardian themself cannot claim it; a bad code is a plain 404.
    adult = await parent(client, services)
    r = await client.post(
        "/v1/me/link-requests/claim", json={"code": req["code"]}, headers=adult.headers
    )
    assert r.status_code == 409 and r.json()["code"] == "consent_not_needed"
    t = await teen(client, services)
    r = await client.post(
        "/v1/me/link-requests/claim", json={"code": "ZZZZZZZZ"}, headers=t.headers
    )
    assert r.status_code == 404

    r = await client.post(
        "/v1/me/link-requests/claim", json={"code": req["code"].lower()}, headers=t.headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["parent_first_name"] == "Asha"
    assert (await row(services, req["id"])).learner_user_id == t.user_id
    # Claimed once: a second teen with the same code gets nothing.
    other = await teen(client, services)
    r = await client.post(
        "/v1/me/link-requests/claim", json={"code": req["code"]}, headers=other.headers
    )
    assert r.status_code == 404
    r = await client.post(
        f"/v1/me/link-requests/{req['id']}/accept", json=ACCEPT, headers={**t.headers, **key()}
    )
    assert r.status_code == 200, r.text


async def test_no_match_looks_the_same_and_nobody_is_told(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    adult_email = address()
    adult = await signed_in(client, adult_email)
    await set_profile(services, adult.user_id, age_band="18p")
    p = await parent(client, services)
    shapes = []
    for target in (
        {"teen_email": address()},
        {"teen_email": adult_email},
        {"teen_code": "nope1234"},
    ):
        r = await start(client, p, **target)
        assert r.status_code == 201, r.text
        shapes.append(sorted(r.json()))
        assert (await row(services, r.json()["id"])).learner_user_id is None
    assert shapes[0] == shapes[1] == shapes[2]
    assert await outbox(services, adult.user_id) == []


async def test_guards_rate_limit_cancel_and_expiry(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    email = address()
    t = await teen(client, services, email)
    minor = await teen(client, services)
    r = await start(client, minor, teen_email=email)
    assert r.status_code == 403 and r.json()["code"] == "guardian_is_minor"
    p = await parent(client, services)
    r = await start(client, p, teen_email=email, teen_code="abcd1234")
    assert r.status_code == 422
    r = await client.post(
        "/v1/guardian/link-requests", json={"scopes": ["social"]}, headers=p.headers
    )
    assert r.status_code in (400, 422)  # the idempotency key is required

    async with flags(services, {"auth.link_requests_per_day": 2}):
        first = (await start(client, p, teen_email=email)).json()
        second = (await start(client, p, teen_email=email)).json()
        r = await start(client, p, teen_email=email)
        assert r.status_code == 429 and r.json()["code"] == "rate_limited"
    # A newer request to the same teen replaced the first; the teen sees one.
    assert (await row(services, first["id"])).status == "cancelled"
    mine = (await client.get("/v1/me/link-requests", headers=t.headers)).json()
    assert [m["id"] for m in mine] == [second["id"]]

    # The guardian withdraws it; then a fresh one lapses.
    r = await client.delete(f"/v1/guardian/link-requests/{second['id']}", headers=p.headers)
    assert r.status_code == 204
    r = await client.delete(f"/v1/guardian/link-requests/{second['id']}", headers=p.headers)
    assert r.status_code == 404
    p2 = await parent(client, services)
    third = (await start(client, p2, teen_email=email)).json()
    async with services.db.admin_tx() as session:
        await session.execute(
            text("update app.guardian_link_requests set expires_at = :t where id = :id"),
            {"t": datetime.now(UTC) - timedelta(minutes=1), "id": third["id"]},
        )
    r = await client.post(
        f"/v1/me/link-requests/{third['id']}/accept", json=ACCEPT, headers={**t.headers, **key()}
    )
    assert r.status_code == 410 and r.json()["code"] == "link_request_expired"
    assert await guardian.expire_requests(services.db) >= 1
    assert (await row(services, third["id"])).status == "expired"
    assert (await client.get("/v1/me/link-requests", headers=t.headers)).json() == []


async def test_ttl_comes_from_the_flag(client: httpx.AsyncClient, services: AppServices) -> None:
    p = await parent(client, services)
    async with flags(services, {"auth.link_request_ttl_h": 24}):
        req = (await start(client, p)).json()
    left = datetime.fromisoformat(req["expires_at"]) - datetime.now(UTC)
    assert timedelta(hours=23) < left <= timedelta(hours=24)
