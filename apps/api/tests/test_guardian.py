"""Guardian consent (auth flow §6.10): request, review by code, confirm or decline, evidence,
withdrawal, gates, the expiry and turning-18 jobs, and the analytics deferral (R48)."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from smriti_api.core.errors import ApiError
from smriti_api.integrations.mail import FakeMailer
from smriti_api.services import flags as flag_service
from smriti_api.services import guardian, privacy
from smriti_api.services.analytics import FakeAnalyticsSink
from tests.helpers import Session, new_guest
from tests.money_helpers import set_profile, signed_in

NOTICE = "dpdp-notice-2026-10"


def key() -> dict[str, str]:
    return {"Idempotency-Key": f"consent-{uuid.uuid4().hex}"}


async def teen(client: httpx.AsyncClient, services: AppServices) -> Session:
    s = await signed_in(client)
    await set_profile(services, s.user_id, age_band="13_17", display_name="Riya Sharma")
    return s


async def ask(client: httpx.AsyncClient, s: Session, **body: Any) -> httpx.Response:
    payload = {"channel": "link", "scopes": ["social"], **body}
    return await client.post(
        "/v1/guardian/consent-requests", json=payload, headers={**s.headers, **key()}
    )


async def agree(
    client: httpx.AsyncClient, guardian_s: Session, code: str, scopes: list[str]
) -> httpx.Response:
    return await client.post(
        f"/v1/guardian/consent-requests/{code}/confirm",
        json={
            "scopes": scopes,
            "declaration": True,
            "notice_version": NOTICE,
            "method": "google_own_device",
            "app_version": "1.0.0",
            "platform": "android",
        },
        headers={**guardian_s.headers, **key()},
    )


async def outbox(services: AppServices, user_id: uuid.UUID) -> list[Any]:
    async with services.db.admin_tx() as session:
        return list(
            (
                await session.execute(
                    text("select kind, payload, status from notify.outbox where user_id = :u"),
                    {"u": user_id},
                )
            ).all()
        )


async def test_age_band_sets_the_consent_requirement(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    s = await teen(client, services)
    me = (await client.get("/v1/guardian/consent", headers=s.headers)).json()
    assert (me["state"], me["needs_consent"], me["scopes"]) == ("required", True, [])
    await set_profile(services, s.user_id, age_band="18p")
    me = (await client.get("/v1/guardian/consent", headers=s.headers)).json()
    assert me["state"] == "not_required"


async def test_link_request_email_review_and_consent(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    assert services.integrations is not None
    mailer = services.integrations.mailer
    assert isinstance(mailer, FakeMailer)
    sent_before = len(mailer.outbox)
    s = await teen(client, services)
    address = f"parent-{uuid.uuid4().hex[:8]}@example.com"
    r = await ask(client, s, scopes=["social", "community"], guardian_email=address, locale="hi")
    assert r.status_code == 201, r.text
    req = r.json()
    code = req["code"]
    assert len(code) == 8 and req["link"].endswith(f"/{code}")
    assert req["scopes"] == ["account", "social", "community"] and req["email_sent"] is True

    # The mail went out in Hindi with the link; the address is not stored, only its HMAC.
    mail = mailer.outbox[sent_before]
    assert mail.to == address and code in mail.text and "सहमति" in mail.subject
    async with services.db.admin_tx() as session:
        row = (
            await session.execute(
                text("select * from app.guardian_consent_requests where id = :id"),
                {"id": req["id"]},
            )
        ).one()
    assert address not in str(row._mapping.values()) and row.guardian_email_hash
    assert row.delivered_at is not None and row.code_hash != code

    poll = (
        await client.get(f"/v1/guardian/consent-requests/{req['id']}", headers=s.headers)
    ).json()
    assert poll["status"] == "pending"
    me = (await client.get("/v1/guardian/consent", headers=s.headers)).json()
    assert me["state"] == "pending" and me["pending_request_id"] == req["id"]

    # A guest cannot read the request; the guardian signs in with their own Google account.
    guest = await new_guest(client)
    r = await client.get(f"/v1/guardian/consent-requests/{code}", headers=guest.headers)
    assert r.status_code == 401
    parent = await signed_in(client)
    view = (
        await client.get(f"/v1/guardian/consent-requests/{code.lower()}", headers=parent.headers)
    ).json()
    assert view["learner_first_name"] == "Riya"
    assert view["scopes"] == ["account", "social", "community"]

    # The teen cannot consent for themselves.
    r = await agree(client, s, code, ["account", "social"])
    assert r.json()["code"] == "guardian_is_learner"

    # Voice was not asked for, so it is not granted even if ticked.
    r = await agree(client, parent, code, ["social", "voice"])
    assert r.status_code == 200, r.text
    decision = r.json()
    assert decision["status"] == "granted"
    consent = decision["consent"]
    assert consent["scopes"] == ["account", "social"]
    assert (consent["method"], consent["age_assurance"]) == ("google_own_device", "self_declared")

    async with services.db.admin_tx() as session:
        c = (
            await session.execute(
                text("select * from app.guardian_consents where id = :id"), {"id": consent["id"]}
            )
        ).one()
        link = (
            await session.execute(
                text(
                    "select kind from app.guardian_links where guardian_user_id = :g and learner_user_id = :l"
                ),
                {"g": parent.user_id, "l": s.user_id},
            )
        ).scalar_one()
        parent_band = (
            await session.execute(
                text("select age_band, age_source from app.profiles where user_id = :u"),
                {"u": parent.user_id},
            )
        ).one()
    assert len(c.guardian_sub_hash) == 64 and c.evidence["request_id"] == req["id"]
    assert c.evidence["declared_adult_guardian"] is True and c.notice_version == NOTICE
    assert link == "consent"
    assert tuple(parent_band) == ("18p", "self_declared")

    poll = (
        await client.get(f"/v1/guardian/consent-requests/{req['id']}", headers=s.headers)
    ).json()
    assert (poll["status"], poll["granted_scopes"]) == ("granted", ["account", "social"])
    items = await outbox(services, s.user_id)
    assert [(i.kind, i.payload["outcome"]) for i in items] == [("consent_decided", "granted")]

    # Answered once only.
    r = await agree(client, parent, code, ["social"])
    assert r.json()["code"] == "consent_request_answered"
    r = await client.get(f"/v1/guardian/consent-requests/{code}", headers=parent.headers)
    assert r.json()["code"] == "consent_request_answered"

    # Gates: social is on, voice is not.
    async with services.db.system_tx() as session:
        await privacy.require_scope(session, s.user_id, "social")
        with pytest.raises(ApiError) as err:
            await privacy.require_scope(session, s.user_id, "voice")
    assert err.value.code == "guardian_consent_required"

    learners = (await client.get("/v1/guardian/learners", headers=parent.headers)).json()
    assert [(x["user_id"], x["kind"], x["first_name"]) for x in learners["learners"]] == [
        (str(s.user_id), "consent", "Riya")
    ]

    # The guardian withdraws social: a new consent row supersedes the old one.
    r = await client.delete(
        f"/v1/guardian/consents/{consent['id']}/scopes/social", headers={**parent.headers, **key()}
    )
    assert r.status_code == 200, r.text
    after = r.json()
    assert after["scopes"] == ["account"] and after["id"] != consent["id"]
    assert not await privacy.scope_allowed(services.db, s.user_id, "social")
    # A stranger cannot touch it; the old row is no longer active.
    stranger = await signed_in(client)
    r = await client.delete(
        f"/v1/guardian/consents/{after['id']}/scopes/account", headers={**stranger.headers, **key()}
    )
    assert r.status_code == 404
    r = await client.delete(
        f"/v1/guardian/consents/{consent['id']}/scopes/account", headers={**parent.headers, **key()}
    )
    assert r.json()["code"] == "consent_not_active"

    # Withdrawing account ends the consent and the link.
    r = await client.delete(
        f"/v1/guardian/consents/{after['id']}/scopes/account", headers={**parent.headers, **key()}
    )
    assert r.json()["revoked_at"] is not None
    me = (await client.get("/v1/guardian/consent", headers=s.headers)).json()
    assert (me["state"], me["scopes"]) == ("revoked", [])
    learners = (await client.get("/v1/guardian/learners", headers=parent.headers)).json()
    assert learners["learners"] == []


async def test_decline_then_retry_wait(client: httpx.AsyncClient, services: AppServices) -> None:
    s = await teen(client, services)
    req = (await ask(client, s, channel="handoff")).json()
    parent = await signed_in(client)
    r = await client.post(
        f"/v1/guardian/consent-requests/{req['code']}/decline", headers={**parent.headers, **key()}
    )
    assert r.json()["status"] == "declined"
    poll = (
        await client.get(f"/v1/guardian/consent-requests/{req['id']}", headers=s.headers)
    ).json()
    assert poll["status"] == "declined" and poll["retry_at"] is not None
    r = await ask(client, s)
    assert r.status_code == 429 and r.json()["code"] == "consent_retry_later"
    me = (await client.get("/v1/guardian/consent", headers=s.headers)).json()
    assert me["state"] == "declined"
    items = await outbox(services, s.user_id)
    assert [(i.kind, i.payload["outcome"]) for i in items] == [("consent_decided", "declined")]


async def test_who_can_ask(client: httpx.AsyncClient, services: AppServices) -> None:
    adult = await signed_in(client)
    await set_profile(services, adult.user_id, age_band="18p")
    assert (await ask(client, adult)).json()["code"] == "consent_not_needed"
    child = await signed_in(client)
    await set_profile(services, child.user_id, age_band="10_12")
    assert (await ask(client, child)).json()["code"] == "managed_account_required"
    unknown = await signed_in(client)
    assert (await ask(client, unknown)).json()["code"] == "age_unknown"
    guest = await new_guest(client)
    assert (await ask(client, guest)).json()["code"] == "login_required"
    s = await teen(client, services)
    r = await ask(client, s, channel="handoff", guardian_email="parent@example.com")
    assert r.status_code == 422


async def test_expiry_job_and_new_request_replaces_old(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    s = await teen(client, services)
    first = (await ask(client, s)).json()
    second = (await ask(client, s)).json()
    poll = (
        await client.get(f"/v1/guardian/consent-requests/{first['id']}", headers=s.headers)
    ).json()
    assert poll["status"] == "cancelled"
    async with services.db.admin_tx() as session:
        await session.execute(
            text(
                "update app.guardian_consent_requests set expires_at = now() - interval '1 minute'"
                " where id = :id"
            ),
            {"id": second["id"]},
        )
    parent = await signed_in(client)
    r = await client.get(f"/v1/guardian/consent-requests/{second['code']}", headers=parent.headers)
    assert r.status_code == 410
    assert await guardian.expire_requests(services.db) >= 1
    items = await outbox(services, s.user_id)
    assert [(i.kind, i.payload["outcome"]) for i in items] == [("consent_decided", "expired")]


async def test_turning_18_ends_the_consent(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    s = await teen(client, services)
    req = (await ask(client, s)).json()
    parent = await signed_in(client)
    assert (await agree(client, parent, req["code"], ["social"])).status_code == 200
    # Born in the month 18 years ago: moved up only once that month has fully passed.
    today = datetime.now(UTC).date()
    month = date(today.year - 18, today.month, 1)
    await set_profile(services, s.user_id, birth_ym=month)
    await guardian.age_up(services.db)
    me = (await client.get("/v1/guardian/consent", headers=s.headers)).json()
    if today.month == 12:
        next_month = date(today.year + 1, 1, 1)
    else:
        next_month = date(today.year, today.month + 1, 1)
    if today < next_month - timedelta(days=1):
        assert me["age_band"] == "13_17"
    await set_profile(services, s.user_id, birth_ym=date(today.year - 19, 1, 1))
    assert await guardian.age_up(services.db) >= 1
    me = (await client.get("/v1/guardian/consent", headers=s.headers)).json()
    assert (me["age_band"], me["state"], me["needs_consent"]) == ("18p", "not_required", False)
    async with services.db.admin_tx() as session:
        by = (
            await session.execute(
                text("select revoked_by from app.guardian_consents where user_id = :u"),
                {"u": s.user_id},
            )
        ).scalar_one()
    assert by == "turned_18"


async def test_analytics_wait_for_consent_when_deferred(
    client: httpx.AsyncClient, services: AppServices, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def deferred(session: Any) -> dict[str, Any]:
        return {"minor.defer_sync_until_consent": True}

    monkeypatch.setattr(flag_service, "server_flags", deferred)
    sink = FakeAnalyticsSink()
    analytics = privacy.ConsentAwareAnalytics(sink, services.db)
    s = await teen(client, services)
    adult = await signed_in(client)
    await set_profile(services, adult.user_id, age_band="18p")
    props: dict[str, Any] = {"provider": "google", "utm_source": "x", "referrer": "y"}
    await analytics.emit("account_linked", s.user_id, props)
    await analytics.emit("account_linked", adult.user_id, props)
    await analytics.emit("account_deleted", None, {})
    assert [(e[0], e[1]) for e in sink.events] == [
        ("account_linked", adult.user_id),
        ("account_deleted", None),
    ]
    req = (await ask(client, s)).json()
    parent = await signed_in(client)
    assert (await agree(client, parent, req["code"], ["account"])).status_code == 200
    await analytics.emit("account_linked", s.user_id, props)
    assert sink.events[-1] == ("account_linked", s.user_id, {"provider": "google"})
