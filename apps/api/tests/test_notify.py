"""Server notifications (TRD §12, me-money §6): the rules engine, devices and prefs, dispatch
with copy from the i18n catalogues, token pruning, the web habit planner, and Web Push."""

from __future__ import annotations

import base64
import json
import os
import uuid
from datetime import UTC, datetime, time, timedelta
from typing import Any

import httpx
import jwt
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from smriti_api.integrations.push import FakePushSender, PushMessage, WebPushSender
from smriti_api.services import billing, notify
from smriti_api.services.notify import Prefs, UserCtx, decide
from tests.helpers import Session
from tests.money_helpers import set_profile, signed_in

IST = "Asia/Kolkata"


def at_ist(hour: int, minute: int = 0, day: int = 28) -> datetime:
    # 28 Oct 2026 is a Wednesday; 31 Oct is a Saturday.
    return datetime(2026, 10, day, hour, minute, tzinfo=UTC) - timedelta(hours=5, minutes=30)


def ctx(audience: notify.Audience = "adult", **kw: Any) -> UserCtx:
    prefs = kw.pop("prefs", Prefs(streak_saver=True, pet_plant_nudges=True))
    return UserCtx(
        user_id=uuid.uuid4(),
        audience=audience,
        timezone=IST,
        locale="en",
        prefs=prefs,
        **kw,
    )


# --- rules engine ------------------------------------------------------------------------------


def test_quiet_hours_hold_or_drop() -> None:
    late = at_ist(23)
    d = decide("pro_activated", ctx(), late)
    assert (d.action, d.reason) == ("hold", "quiet_hours")
    assert d.until == at_ist(7, day=29)
    assert decide("streak_risk", ctx(), late).reason == "quiet_hours"
    assert decide("streak_risk", ctx(), late).action == "suppress"
    # A teen's quiet hours start at 21:00 whatever the stored prefs say.
    assert decide("consent_decided", ctx("teen"), at_ist(21, 30)).action == "hold"
    assert decide("consent_decided", ctx("adult"), at_ist(21, 30)).action == "send"


def test_minor_rules() -> None:
    afternoon = at_ist(17)
    assert decide("streak_risk", ctx("teen"), afternoon).reason == "minor_not_allowed"
    assert decide("daily_reminder_thirsty", ctx("child"), afternoon).reason == "minor_not_allowed"
    assert decide("daily_reminder", ctx("teen"), afternoon).action == "send"
    # School hours on a weekday hold a minor's send to the end of school (R49), not on Saturday.
    d = decide("daily_reminder", ctx("teen"), at_ist(10))
    assert (d.action, d.reason, d.until) == ("hold", "school_hours", at_ist(14))
    assert decide("daily_reminder", ctx("teen"), at_ist(10, day=31)).action == "send"
    assert decide("daily_reminder", ctx("adult"), at_ist(10)).action == "send"


def test_social_needs_consent_and_waits_for_the_reminder_window() -> None:
    notify.KINDS["test_friend_cheer"] = notify.KindSpec("social", ("NTF-01.friend_cheer",))
    try:
        teen = ctx("teen", prefs=Prefs(daily_reminder_at=time(18, 0)))
        assert decide("test_friend_cheer", teen, at_ist(16)).reason == "awaiting_consent"
        teen.social_consent = True
        d = decide("test_friend_cheer", teen, at_ist(16))
        assert (d.action, d.reason) == ("hold", "reminder_window")
        assert d.until is not None and d.until.astimezone(UTC) == at_ist(18)
        assert decide("test_friend_cheer", teen, at_ist(18, 10)).action == "send"
        assert decide("test_friend_cheer", ctx("child"), at_ist(16)).reason == "minor_not_allowed"
        assert decide("test_friend_cheer", ctx("adult"), at_ist(16)).action == "send"
    finally:
        del notify.KINDS["test_friend_cheer"]


def test_caps_pause_and_prefs() -> None:
    noon = at_ist(17)
    full = ctx(sent_today={"habit": 2})
    assert decide("daily_reminder", full, noon).reason == "cap_class"
    assert decide("pro_activated", full, noon).action == "send"  # transactional skips caps
    teen = ctx("teen", sent_today={"habit": 1})
    assert decide("daily_reminder", teen, noon).reason == "cap_class"
    paused = ctx(prefs=Prefs(paused_at=noon, streak_saver=True))
    assert decide("daily_reminder", paused, noon).reason == "paused"
    assert decide("streak_risk", ctx(prefs=Prefs()), noon).reason == "pref_off"
    focus = ctx(prefs=Prefs(focus_until=noon + timedelta(minutes=20)))
    assert decide("daily_reminder", focus, noon).reason == "focus"
    assert decide("pro_activated", focus, noon).action == "send"
    assert decide("pro_activated", ctx(), noon, expires_at=noon).reason == "stale"


async def quiet_far_away(services: AppServices, user_id: uuid.UUID) -> None:
    """Quiet hours 12 hours from now (UTC profile), so a test never lands inside them."""
    start = (datetime.now(UTC) + timedelta(hours=12)).time().replace(second=0, microsecond=0)
    end = (
        (datetime.now(UTC) + timedelta(hours=12, minutes=1)).time().replace(second=0, microsecond=0)
    )
    async with services.db.admin_tx() as session:
        await session.execute(
            text("update notify.prefs set quiet_start = :s, quiet_end = :e where user_id = :u"),
            {"s": start, "e": end, "u": user_id},
        )


# --- devices and prefs -------------------------------------------------------------------------


async def register(client: httpx.AsyncClient, s: Session, **body: Any) -> httpx.Response:
    payload = {"platform": "android", "app_version": "1.0.0", "notif_permission": "granted", **body}
    return await client.post("/v1/devices", json=payload, headers=s.headers)


async def test_device_registration_moves_tokens(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    a = await signed_in(client)
    token = f"ExponentPushToken[{uuid.uuid4().hex[:22]}]"
    r = await register(client, a, push_token=token)
    assert r.status_code == 200, r.text
    assert r.json()["has_push_token"] is True
    b = await signed_in(client)
    assert (await register(client, b, push_token=token)).status_code == 200
    async with services.db.admin_tx() as session:
        owners = (
            (
                await session.execute(
                    text("select user_id from app.devices where push_token = :t"), {"t": token}
                )
            )
            .scalars()
            .all()
        )
    assert owners == [b.user_id]
    r = await register(
        client,
        a,
        web_push_subscription={
            "endpoint": "https://push.example.com/x",
            "keys": {"p256dh": "A" * 40, "auth": "B" * 16},
        },
    )
    assert r.json()["code"] == "web_push_on_web_only"
    r = await client.delete(f"/v1/devices/{a.device_id}", headers=a.headers)
    assert r.status_code == 204


async def test_prefs_minor_rules(client: httpx.AsyncClient, services: AppServices) -> None:
    adult = await signed_in(client)
    await set_profile(services, adult.user_id, age_band="18p")
    prefs = (await client.get("/v1/notification-prefs", headers=adult.headers)).json()
    assert prefs["reminder_enabled"] is True and prefs["quiet_start"] == "22:00:00"
    r = await client.patch(
        "/v1/notification-prefs",
        json={"streak_saver": True, "daily_reminder_at": "19:30", "quiet_start": "23:00"},
        headers=adult.headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["streak_saver"], body["daily_reminder_at"], body["quiet_start"]) == (
        True,
        "19:30:00",
        "23:00:00",
    )
    teen = await signed_in(client)
    await set_profile(services, teen.user_id, age_band="13_17")
    r = await client.patch(
        "/v1/notification-prefs", json={"smart_timing": True}, headers=teen.headers
    )
    assert r.status_code == 403 and r.json()["fields"] == ["smart_timing"]
    prefs = (await client.get("/v1/notification-prefs", headers=teen.headers)).json()
    assert prefs["school_hours"] is True and prefs["streak_saver"] is False


# --- dispatch ----------------------------------------------------------------------------------


async def test_dispatch_sends_logs_and_prunes(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    s = await signed_in(client)
    await set_profile(services, s.user_id, age_band="18p", locale="hi", timezone="UTC")
    await quiet_far_away(services, s.user_id)
    live = f"ExponentPushToken[{uuid.uuid4().hex[:22]}]"
    assert (await register(client, s, push_token=live)).status_code == 200
    other = Session(token=s.token, user_id=s.user_id, device_id=uuid.uuid4())
    dead = f"ExponentPushToken[{uuid.uuid4().hex[:22]}]"
    assert (await register(client, other, push_token=dead, platform="ios")).status_code == 200
    async with services.db.system_tx() as session:
        assert await notify.enqueue(
            session, user_id=s.user_id, kind="pro_activated", dedupe_key=f"t:{s.user_id}"
        )
        assert not await notify.enqueue(
            session, user_id=s.user_id, kind="pro_activated", dedupe_key=f"t:{s.user_id}"
        )
        # A web-only habit kind has no web device here.
        await notify.enqueue(session, user_id=s.user_id, kind="daily_reminder", payload={"min": 10})
    expo = FakePushSender(dead_tokens={dead})
    result = await notify.dispatch_due(
        services.db, notify.Senders(expo=expo), now=datetime.now(UTC) + timedelta(seconds=1)
    )
    assert result.sent >= 1 and result.pruned >= 1
    assert result.suppressed >= 1
    sent = [m for m in expo.sent if m.token == live]
    assert sent and sent[0].body == "Pro चालू हो गया! जहाँ छोड़ा था, वहीं से शुरू करें।"
    assert sent[0].data["kind"] == "pro_activated" and "Pro" not in sent[0].data["url"]
    async with services.db.admin_tx() as session:
        logs = (
            await session.execute(
                text(
                    "select kind, status, suppressed_reason from notify.log where user_id = :u"
                    " order by status, kind"
                ),
                {"u": s.user_id},
            )
        ).all()
        pruned = (
            await session.execute(
                text("select push_token, invalid_at from app.devices where id = :id"),
                {"id": other.device_id},
            )
        ).one()
    assert ("pro_activated", "sent", None) in [tuple(r) for r in logs]
    assert ("daily_reminder", "suppressed", "no_device") in [tuple(r) for r in logs]
    assert pruned.push_token is None and pruned.invalid_at is not None

    r = await client.post("/v1/notifications/opened", json={"id": None}, headers=s.headers)
    assert r.status_code == 204


async def test_billing_and_trial_pushes(client: httpx.AsyncClient, services: AppServices) -> None:
    s = await signed_in(client)
    async with services.db.system_tx() as session:
        ent = billing.Entitlement(
            active=True,
            status="trialing",
            source="razorpay",
            expires_at=None,
            grace_until=None,
            cancel_at_period_end=False,
            is_intro=True,
            subscription_id=None,
        )
        await billing._billing_pushes(session, s.user_id, None, ent, f"evt_{uuid.uuid4().hex}")
        kinds = (
            (
                await session.execute(
                    text("select kind from notify.outbox where user_id = :u"), {"u": s.user_id}
                )
            )
            .scalars()
            .all()
        )
    assert kinds == ["pro_activated"]


async def test_web_habit_planner(client: httpx.AsyncClient, services: AppServices) -> None:
    s = await signed_in(client)
    await set_profile(services, s.user_id, age_band="18p", timezone="UTC")
    sub = {
        "endpoint": f"https://push.example.com/{uuid.uuid4().hex}",
        "keys": {"p256dh": "A" * 87, "auth": "B" * 22},
    }
    r = await register(client, s, platform="web", web_push_subscription=sub)
    assert r.status_code == 200, r.text
    await quiet_far_away(services, s.user_id)
    now = datetime.now(UTC).replace(second=0, microsecond=0)
    async with services.db.admin_tx() as session:
        await session.execute(
            text("update notify.prefs set daily_reminder_at = :t where user_id = :u"),
            {"t": now.time().replace(tzinfo=None), "u": s.user_id},
        )
    assert await notify.plan_web_habit(services.db, now=now) >= 1
    assert await notify.plan_web_habit(services.db, now=now) == 0  # once a day
    async with services.db.admin_tx() as session:
        kinds = (
            (
                await session.execute(
                    text("select kind from notify.outbox where user_id = :u"), {"u": s.user_id}
                )
            )
            .scalars()
            .all()
        )
    assert kinds == ["daily_reminder"]
    web = FakePushSender(name="fake-web")
    result = await notify.dispatch_due(
        services.db,
        notify.Senders(expo=FakePushSender(), web=web),
        now=datetime.now(UTC) + timedelta(seconds=1),
    )
    assert result.sent >= 1 and json.loads(web.sent[-1].token)["endpoint"] == sub["endpoint"]


# --- Web Push ----------------------------------------------------------------------------------


def _b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _decrypt(body: bytes, ua_private: ec.EllipticCurvePrivateKey, auth: bytes) -> bytes:
    salt, idlen = body[:16], body[20]
    as_public = body[21 : 21 + idlen]
    ua_public = ua_private.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    secret = ua_private.exchange(
        ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_public)
    )
    ikm = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=auth,
        info=b"WebPush: info\x00" + ua_public + as_public,
    ).derive(secret)
    cek = HKDF(
        algorithm=hashes.SHA256(), length=16, salt=salt, info=b"Content-Encoding: aes128gcm\x00"
    ).derive(ikm)
    nonce = HKDF(
        algorithm=hashes.SHA256(), length=12, salt=salt, info=b"Content-Encoding: nonce\x00"
    ).derive(ikm)
    plain = AESGCM(cek).decrypt(nonce, body[21 + idlen :], None)
    assert plain.endswith(b"\x02")
    return plain[:-1]


async def test_web_push_encrypts_and_signs() -> None:
    ua = ec.generate_private_key(ec.SECP256R1())
    auth = os.urandom(16)
    p256dh = _b64u(
        ua.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
    )
    vapid = ec.generate_private_key(ec.SECP256R1())
    raw = vapid.private_numbers().private_value.to_bytes(32, "big")
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(410 if request.url.path.endswith("/gone") else 201)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        sender = WebPushSender(http, private_key=_b64u(raw), subject="mailto:ops@example.com")
        sub = {
            "endpoint": "https://fcm.example.com/push/abc",
            "keys": {"p256dh": p256dh, "auth": _b64u(auth)},
        }
        gone = {**sub, "endpoint": "https://fcm.example.com/push/gone"}
        tickets = await sender.send(
            [
                PushMessage(
                    token=json.dumps(sub), title="Smriti", body="Pro is on!", data={"url": "/home"}
                ),
                PushMessage(token=json.dumps(gone), title="Smriti", body="x"),
            ]
        )
    assert tickets[0].ok and tickets[1].token_invalid
    req = seen[0]
    assert req.headers["content-encoding"] == "aes128gcm"
    payload = json.loads(_decrypt(req.content, ua, auth))
    assert payload == {"title": "Smriti", "body": "Pro is on!", "data": {"url": "/home"}}
    scheme, _, rest = req.headers["authorization"].partition(" ")
    parts = dict(p.strip().split("=", 1) for p in rest.split(","))
    assert scheme == "vapid" and parts["k"] == sender.public_key
    claims = jwt.decode(
        parts["t"], vapid.public_key(), algorithms=["ES256"], audience="https://fcm.example.com"
    )
    assert claims["sub"] == "mailto:ops@example.com"
