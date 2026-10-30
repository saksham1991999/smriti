"""Dev auth, link, guest merge, deletion and guest erase (auth flow §6.3-6.8)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from smriti_api.services.accounts import purge_deleted_accounts
from smriti_api.services.analytics import FakeAnalyticsSink
from smriti_api.services.jobs import InlineJobQueue, JobDeps
from tests.helpers import (
    Session,
    event,
    get_state,
    google,
    lesson_completed,
    new_guest,
    post_events,
)


def email() -> str:
    return f"learner-{uuid.uuid4().hex[:10]}@example.com"


async def signed_in(client: httpx.AsyncClient, address: str | None = None) -> Session:
    r = await google(client, address or email())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["is_anonymous"] is False
    return Session(
        token=body["access_token"], user_id=uuid.UUID(body["user_id"]), device_id=uuid.uuid4()
    )


async def drain(services: AppServices) -> None:
    if isinstance(services.jobs, InlineJobQueue):
        await services.jobs.drain()


async def test_dev_token_is_shaped_like_supabase(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    guest = await new_guest(client)
    ctx = await services.verifier.verify(guest.token)
    assert ctx.is_anonymous
    assert ctx.role == "authenticated"
    assert ctx.claims["aud"] == "authenticated"
    assert ctx.amr[0].method == "anonymous"
    me = await client.get("/v1/me", headers=guest.headers)
    assert me.status_code == 200
    assert me.json()["profile"]["is_guest"] is True


async def test_link_keeps_the_user_and_its_progress(client: httpx.AsyncClient) -> None:
    guest = await new_guest(client)
    await post_events(client, guest, [lesson_completed()])
    r = await google(client, email(), "Asha Verma", link_as=guest)
    assert r.status_code == 200, r.text
    linked = Session(
        token=r.json()["access_token"],
        user_id=uuid.UUID(r.json()["user_id"]),
        device_id=guest.device_id,
    )
    assert linked.user_id == guest.user_id
    assert r.json()["is_anonymous"] is False

    headers = {**linked.headers, "Idempotency-Key": "link-0001"}
    first = await client.post("/v1/auth/linked", json={}, headers=headers)
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["profile"]["display_name"] == "Asha"
    assert body["profile"]["is_guest"] is False
    assert body["consent_needed"] is False
    again = await client.post("/v1/auth/linked", json={}, headers=headers)
    assert again.json() == body
    me = (await client.get("/v1/me", headers=linked.headers)).json()
    assert me["handle"].startswith("learner_")
    assert me["signed_up_at"] is not None
    state = await get_state(client, linked)
    assert state["streak"]["current"] == 1


async def test_minor_gets_no_public_handle(client: httpx.AsyncClient) -> None:
    guest = await new_guest(client)
    await post_events(client, guest, [event("onboarding_answer", {"step": "class", "value": 8})])
    r = await google(client, email(), "Ravi Kumar", link_as=guest)
    token = r.json()["access_token"]
    await client.post("/v1/auth/linked", json={}, headers={"Authorization": f"Bearer {token}"})
    me = (await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})).json()
    assert me["profile"]["age_band"] == "13_17"
    assert me["handle"] is None
    assert me["discoverable"] is False
    assert me["profile"]["display_name"] == "Ravi"


async def test_guest_gets_login_required_on_hard_login_endpoints(client: httpx.AsyncClient) -> None:
    guest = await new_guest(client)
    r = await client.post("/v1/auth/linked", json={}, headers=guest.headers)
    assert r.status_code == 401
    assert r.json()["code"] == "login_required"
    assert r.json()["reason"] == "link"
    assert r.headers["content-type"].startswith("application/problem+json")


async def test_merge_guest_into_existing_account(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    address = email()
    account = await signed_in(client, address)
    yesterday = datetime.now(UTC) - timedelta(days=1)
    await post_events(
        client,
        account,
        [lesson_completed(at=yesterday), event("pet_named", {"species": "cat", "name": "Miso"})],
    )

    guest = await new_guest(client)
    deck, card = str(uuid.uuid4()), str(uuid.uuid4())
    await post_events(
        client,
        guest,
        [
            lesson_completed(),
            event("pet_named", {"species": "dog", "name": "Bholu"}),
            event(
                "deck_card_upserted",
                {"user_card_id": card, "deck_id": deck, "front": "a", "back": "b"},
            ),
            event(
                "review_rated",
                {"card_ref": f"d:{card}", "rating": 3, "confidence": None, "ms_to_answer": 1},
            ),
        ],
    )

    # linkIdentity fails: the Google account already has a Smriti account.
    r = await google(client, address, link_as=guest)
    assert r.status_code == 409
    assert r.json()["code"] == "identity_already_exists"

    intent = await client.post(
        "/v1/account/merge-intents", json={"has_unsent_events": False}, headers=guest.headers
    )
    assert intent.status_code == 200, intent.text
    token = intent.json()["merge_intent"]

    signed_back = await signed_in(client, address)
    assert signed_back.user_id == account.user_id
    r = await client.post(
        "/v1/account/merges",
        json={"merge_intent": token, "include_progress": True},
        headers={**signed_back.headers, "Idempotency-Key": "merge-0001"},
    )
    assert r.status_code == 202, r.text
    merge_id = r.json()["merge_id"]
    await drain(services)

    status = (
        await client.get(f"/v1/account/merges/{merge_id}", headers=signed_back.headers)
    ).json()
    assert status["status"] == "done", status
    assert status["stats"]["pet_kept"] in ("account", "both")
    assert status["stats"]["days_added"] >= 1

    state = await get_state(client, signed_back)
    assert state["streak"]["current"] == 2  # yesterday (account) + today (guest)
    assert state["wallet"]["xp_total"] >= 32
    assert state["pet"]["name"] == "Miso"  # the account's buddy stays the main pet
    assert [c["card_ref"] for c in state["srs"]["cards"]] == [f"d:{card}"]

    gone = await client.get("/v1/me", headers=guest.headers)
    assert gone.status_code == 401
    assert gone.json()["code"] == "session_ended"

    # The intent was single use.
    again = await client.post(
        "/v1/account/merges", json={"merge_intent": token}, headers=signed_back.headers
    )
    assert again.status_code == 410
    assert isinstance(services.analytics, FakeAnalyticsSink)
    assert (guest.user_id, account.user_id) in services.analytics.aliases


async def test_merge_without_progress_only_deletes_the_guest(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    account = await signed_in(client)
    guest = await new_guest(client)
    await post_events(client, guest, [lesson_completed()])
    token = (await client.post("/v1/account/merge-intents", json={}, headers=guest.headers)).json()[
        "merge_intent"
    ]
    r = await client.post(
        "/v1/account/merges",
        json={"merge_intent": token, "include_progress": False},
        headers=account.headers,
    )
    await drain(services)
    status = (
        await client.get(f"/v1/account/merges/{r.json()['merge_id']}", headers=account.headers)
    ).json()
    assert status["status"] == "done"
    state = await get_state(client, account)
    assert state["streak"]["current"] == 0
    assert (await client.get("/v1/me", headers=guest.headers)).status_code == 401


async def test_merge_intent_rules(client: httpx.AsyncClient) -> None:
    account = await signed_in(client)
    r = await client.post("/v1/account/merge-intents", json={}, headers=account.headers)
    assert r.json()["code"] == "not_a_guest"
    r = await client.post(
        "/v1/account/merges", json={"merge_intent": "x" * 40}, headers=account.headers
    )
    assert r.status_code == 410
    assert r.json()["code"] == "merge_intent_invalid"


async def test_deletion_grace_cancel_and_purge(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    account = await signed_in(client)
    r = await client.post(
        "/v1/account/deletion", headers={**account.headers, "Idempotency-Key": "delete-0001"}
    )
    assert r.status_code == 202, r.text
    when = datetime.fromisoformat(r.json()["scheduled_for"])
    assert timedelta(days=6, hours=23) < when - datetime.now(UTC) <= timedelta(days=7)

    blocked = await client.get("/v1/me", headers=account.headers)
    assert blocked.status_code == 409
    assert blocked.json()["code"] == "account_deletion_scheduled"

    cancel = await client.delete("/v1/account/deletion", headers=account.headers)
    assert cancel.status_code == 200
    assert (await client.get("/v1/me", headers=account.headers)).status_code == 200

    await client.post("/v1/account/deletion", headers=account.headers)
    async with services.db.admin_tx() as session:
        await session.execute(
            text(
                "update app.profiles set deletion_scheduled_for = now() - interval '1 minute' where user_id = :u"
            ),
            {"u": account.user_id},
        )
    deps = JobDeps(db=services.db, auth_admin=services.auth_admin, analytics=services.analytics)
    assert await purge_deleted_accounts(deps) >= 1
    async with services.db.admin_tx() as session:
        left = (
            await session.execute(
                text("select count(*) from auth.users where id = :u"), {"u": account.user_id}
            )
        ).scalar_one()
    assert left == 0


async def test_deletion_needs_a_recent_sign_in(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    account = await signed_in(client)
    stale, _ = services.verifier.mint_dev_token(
        account.user_id, is_anonymous=False, provider="google"
    )
    ctx = await services.verifier.verify(stale)
    assert ctx.amr_fresh_within(300)
    # Re-sign the same claims with an old sign-in time.
    import jwt

    claims = dict(ctx.claims)
    claims["amr"] = [{"method": "oauth", "timestamp": int(datetime.now(UTC).timestamp()) - 3600}]
    old = jwt.encode(claims, services.verifier.dev_secret, algorithm="HS256")
    r = await client.post("/v1/account/deletion", headers={"Authorization": f"Bearer {old}"})
    assert r.status_code == 401
    assert r.json()["code"] == "reauth_required"


async def test_guest_erase(client: httpx.AsyncClient) -> None:
    guest = await new_guest(client)
    await post_events(client, guest, [lesson_completed()])
    r = await client.delete("/v1/account", headers=guest.headers)
    assert r.status_code == 204
    assert (await client.get("/v1/me", headers=guest.headers)).status_code == 401
    account = await signed_in(client)
    r = await client.delete("/v1/account", headers=account.headers)
    assert r.status_code == 409
