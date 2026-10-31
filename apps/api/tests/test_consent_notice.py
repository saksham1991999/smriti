"""The consent notice from config (AUTH-20 "Read the full notice") and AUTH-21 [Cancel request]."""

from __future__ import annotations

import httpx

from smriti_api.core.deps import AppServices
from tests.money_helpers import signed_in
from tests.practice_helpers import flags
from tests.test_guardian import NOTICE, agree, ask, teen

# Placeholder values for the test only: legal publishes the real notice and its URLs.
URLS = {"en": "https://example.test/notice/en", "hi": "https://example.test/notice/hi"}


async def test_notice_is_unpublished_until_the_owner_sets_it(client: httpx.AsyncClient) -> None:
    r = await client.get("/v1/guardian/consent-notice")
    assert r.status_code == 200
    assert r.json() == {"version": None, "url": None, "locale": "en", "published": False}


async def test_notice_comes_from_config_and_consent_must_record_it(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    s = await teen(client, services)
    code = (await ask(client, s)).json()["code"]
    guardian_s = await signed_in(client)
    async with flags(
        services, {"auth.consent_notice_version": NOTICE, "auth.consent_notice_url": URLS}
    ):
        hi = (await client.get("/v1/guardian/consent-notice?locale=hi")).json()
        assert hi == {"version": NOTICE, "url": URLS["hi"], "locale": "hi", "published": True}
        # A consent that records an older notice is refused, with the current version.
        old = {"auth.consent_notice_version": "notice-2026-11"}
        async with flags(services, {**old, "auth.consent_notice_url": URLS}):
            r = await agree(client, guardian_s, code, ["social"])
            assert r.status_code == 409, r.text
            assert r.json()["code"] == "consent_notice_outdated"
            assert r.json()["current_version"] == "notice-2026-11"
        r = await agree(client, guardian_s, code, ["social"])
    assert r.status_code == 200, r.text
    assert r.json()["consent"]["notice_version"] == NOTICE


async def test_teen_cancels_a_pending_request(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    s = await teen(client, services)
    req = (await ask(client, s)).json()
    me = (await client.get("/v1/guardian/consent", headers=s.headers)).json()
    assert me["state"] == "pending" and me["pending_request_id"] == req["id"]

    # Only the teen who asked can cancel it.
    other = await teen(client, services)
    r = await client.delete(f"/v1/guardian/consent-requests/{req['id']}", headers=other.headers)
    assert r.status_code == 404
    for _ in range(2):  # a repeat is a no-op
        r = await client.delete(f"/v1/guardian/consent-requests/{req['id']}", headers=s.headers)
        assert r.status_code == 204
    poll = (
        await client.get(f"/v1/guardian/consent-requests/{req['id']}", headers=s.headers)
    ).json()
    assert poll["status"] == "cancelled"
    me = (await client.get("/v1/guardian/consent", headers=s.headers)).json()
    assert me["state"] == "required" and me["pending_request_id"] is None
    # The code no longer works for a guardian.
    guardian_s = await signed_in(client)
    r = await agree(client, guardian_s, req["code"], ["social"])
    assert r.status_code == 410 and r.json()["code"] == "consent_request_expired"
