"""Device attestation and sync anti-cheat (G-10, TRD §10, §14)."""

from __future__ import annotations

import base64
import hashlib
import json
import struct
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from cryptography.x509.oid import NameOID
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from smriti_api.integrations import attestation as att
from tests.helpers import Session, event, lesson_completed, new_guest
from tests.practice_helpers import flags

# --- CBOR encoding for building test objects ---------------------------------------------------------


def _head(major: int, n: int) -> bytes:
    if n < 24:
        return bytes([major << 5 | n])
    for info, size in ((24, 1), (25, 2), (26, 4), (27, 8)):
        if n < 1 << (8 * size):
            return bytes([major << 5 | info]) + n.to_bytes(size, "big")
    raise ValueError(n)


def cbor(value: Any) -> bytes:
    if isinstance(value, bool):
        return b"\xf5" if value else b"\xf4"
    if isinstance(value, int):
        return _head(0, value) if value >= 0 else _head(1, -1 - value)
    if isinstance(value, bytes):
        return _head(2, len(value)) + value
    if isinstance(value, str):
        raw = value.encode()
        return _head(3, len(raw)) + raw
    if isinstance(value, list):
        return _head(4, len(value)) + b"".join(cbor(v) for v in value)
    if isinstance(value, dict):
        return _head(5, len(value)) + b"".join(cbor(k) + cbor(v) for k, v in value.items())
    raise TypeError(type(value))


def test_cbor_round_trip() -> None:
    obj = {"fmt": "x", "n": [1, -2, 300, 70000], "b": b"\x00\x01", "t": True}
    assert att.cbor_decode(cbor(obj)) == obj
    with pytest.raises(att.AttestationError):
        att.cbor_decode(cbor(obj)[:-1])


def test_parse_pairs() -> None:
    assert att.parse_pairs("jee=a.b.jee, neet=a.b.neet") == {"jee": "a.b.jee", "neet": "a.b.neet"}
    assert att.parse_pairs("TEAM.one.app") == {"*": "TEAM.one.app"}


# --- App Attest, with a stand-in Apple chain ---------------------------------------------------------

APP_ID = "TEAM123456.in.example.jee"


def _name(cn: str) -> x509.Name:
    return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])


def _cert(
    subject: str,
    issuer: str,
    pub: Any,
    signer: Any,
    *,
    ca: bool,
    nonce: bytes | None = None,
) -> x509.Certificate:
    now = datetime.now(UTC)
    b = (
        x509.CertificateBuilder()
        .subject_name(_name(subject))
        .issuer_name(_name(issuer))
        .public_key(pub)
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=30))
        .add_extension(x509.BasicConstraints(ca=ca, path_length=None), critical=True)
    )
    if nonce is not None:
        # SEQUENCE { [1] EXPLICIT OCTET STRING (32) }
        der = b"\x30\x24\xa1\x22\x04\x20" + nonce
        b = b.add_extension(x509.UnrecognizedExtension(att.APPLE_NONCE_OID, der), critical=False)
    return b.sign(signer, hashes.SHA384() if ca else hashes.SHA256())


class FakeApple:
    def __init__(self) -> None:
        self.root_key = ec.generate_private_key(ec.SECP384R1())
        self.inter_key = ec.generate_private_key(ec.SECP384R1())
        self.root = _cert(
            "Test Root", "Test Root", self.root_key.public_key(), self.root_key, ca=True
        )
        self.inter = _cert(
            "Test Inter", "Test Root", self.inter_key.public_key(), self.root_key, ca=True
        )
        self.device_key = ec.generate_private_key(ec.SECP256R1())
        point = self.device_key.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
        self.key_hash = hashlib.sha256(point).digest()
        self.key_id = base64.b64encode(self.key_hash).decode()

    def verifier(self) -> att.AppAttestVerifier:
        return att.AppAttestVerifier(
            att.AppAttestConfig(
                app_ids={"jee": APP_ID},
                environment="development",
                root_pem=self.root.public_bytes(serialization.Encoding.PEM),
            )
        )

    def attestation(self, nonce: str, *, app_id: str = APP_ID) -> bytes:
        auth = (
            hashlib.sha256(app_id.encode()).digest()
            + b"\x40"
            + struct.pack(">I", 0)
            + att.AAGUID["development"]
            + struct.pack(">H", len(self.key_hash))
            + self.key_hash
        )
        expected = hashlib.sha256(auth + hashlib.sha256(nonce.encode()).digest()).digest()
        leaf = _cert(
            "device",
            "Test Inter",
            self.device_key.public_key(),
            self.inter_key,
            ca=False,
            nonce=expected,
        )
        x5c = [
            leaf.public_bytes(serialization.Encoding.DER),
            self.inter.public_bytes(serialization.Encoding.DER),
        ]
        return cbor(
            {"fmt": "apple-appattest", "attStmt": {"x5c": x5c, "receipt": b"r"}, "authData": auth}
        )

    def assertion(self, nonce: str, counter: int) -> bytes:
        auth = hashlib.sha256(APP_ID.encode()).digest() + b"\x00" + struct.pack(">I", counter)
        message = hashlib.sha256(auth + hashlib.sha256(nonce.encode()).digest()).digest()
        sig = self.device_key.sign(message, ec.ECDSA(hashes.SHA256()))
        return cbor({"signature": sig, "authenticatorData": auth})


def test_app_attest_attestation_and_assertions() -> None:
    apple = FakeApple()
    v = apple.verifier()
    key = v.attest(apple.key_id, apple.attestation("n-1"), "n-1", "jee")
    assert key.app_id == APP_ID and key.sign_count == 0 and key.receipt == b"r"

    with pytest.raises(att.AttestationError, match="nonce_mismatch"):
        v.attest(apple.key_id, apple.attestation("n-1"), "n-2", "jee")
    with pytest.raises(att.AttestationError, match="app_id_mismatch"):
        v.attest(apple.key_id, apple.attestation("n-1", app_id="OTHER.app"), "n-1", "jee")
    with pytest.raises(att.AttestationError, match="unknown_app"):
        v.attest(apple.key_id, apple.attestation("n-1"), "n-1", "neet")
    other = FakeApple()
    with pytest.raises(att.AttestationError, match="untrusted_chain"):
        other.verifier().attest(apple.key_id, apple.attestation("n-1"), "n-1", "jee")
    with pytest.raises(att.AttestationError, match="key_id_mismatch"):
        v.attest(other.key_id, apple.attestation("n-1"), "n-1", "jee")

    assert v.assert_(key, apple.assertion("n-3", 1), "n-3") == 1
    stored = att.AppAttestKey(key.key_id, key.app_id, key.environment, key.public_key_der, 1)
    with pytest.raises(att.AttestationError, match="counter_replay"):
        v.assert_(stored, apple.assertion("n-4", 1), "n-4")
    with pytest.raises(att.AttestationError, match="bad_signature"):
        v.assert_(stored, apple.assertion("n-4", 2), "n-5")


def test_bundled_apple_root_loads() -> None:
    v = att.AppAttestVerifier(att.AppAttestConfig(app_ids={"*": APP_ID}))
    assert "Apple App Attestation Root CA" in v.root.subject.rfc4514_string()


# --- Play Integrity ----------------------------------------------------------------------------------


def _verdict(nonce: str, **over: Any) -> dict[str, Any]:
    v: dict[str, Any] = {
        "requestDetails": {
            "requestPackageName": "in.example.jee",
            "nonce": nonce,
            "timestampMillis": str(int(time.time() * 1000)),
        },
        "appIntegrity": {"appRecognitionVerdict": "PLAY_RECOGNIZED"},
        "deviceIntegrity": {"deviceRecognitionVerdict": ["MEETS_DEVICE_INTEGRITY"]},
    }
    v.update(over)
    return v


async def test_play_integrity_decodes_with_a_service_account() -> None:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    seen: list[str] = []
    verdicts: dict[str, dict[str, Any]] = {
        "good": _verdict("n-1"),
        "sideloaded": _verdict(
            "n-1", appIntegrity={"appRecognitionVerdict": "UNRECOGNIZED_VERSION"}
        ),
        "rooted": _verdict("n-1", deviceIntegrity={"deviceRecognitionVerdict": []}),
    }

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        if request.url.path == "/token":
            assert b"jwt-bearer" in request.content
            return httpx.Response(200, json={"access_token": "at", "expires_in": 3600})
        assert request.headers["Authorization"] == "Bearer at"
        token = json.loads(request.content)["integrity_token"]
        return httpx.Response(200, json={"tokenPayloadExternal": verdicts[token]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        play = att.PlayIntegrityVerifier(
            http,
            att.PlayIntegrityConfig(
                service_account={
                    "client_email": "sa@example.iam.gserviceaccount.com",
                    "private_key": pem,
                    "token_uri": "https://oauth.example/token",
                },
                packages={"jee": "in.example.jee"},
                base_url="https://play.example/v1",
            ),
        )
        await play.verify("good", "n-1", "jee")
        with pytest.raises(att.AttestationError, match="nonce_mismatch"):
            await play.verify("good", "n-2", "jee")
        with pytest.raises(att.AttestationError, match="app_not_recognized"):
            await play.verify("sideloaded", "n-1", "jee")
        with pytest.raises(att.AttestationError, match="device_integrity"):
            await play.verify("rooted", "n-1", "jee")
        with pytest.raises(att.AttestationError, match="unknown_app"):
            await play.verify("good", "n-1", "neet")
    assert seen.count("/token") == 1  # the access token is reused
    assert "/v1/in.example.jee:decodeIntegrityToken" in seen


def test_play_verdict_checks_package_and_age() -> None:
    old = _verdict("n")
    old["requestDetails"]["timestampMillis"] = "1000"
    with pytest.raises(att.AttestationError, match="stale_token"):
        att.check_play_verdict(
            old, package="in.example.jee", nonce="n", require_device="MEETS_DEVICE_INTEGRITY"
        )
    with pytest.raises(att.AttestationError, match="package_mismatch"):
        att.check_play_verdict(
            _verdict("n"), package="x", nonce="n", require_device="MEETS_DEVICE_INTEGRITY"
        )
    standard = _verdict("n")
    standard["requestDetails"] = {**standard["requestDetails"], "nonce": None, "requestHash": "n"}
    att.check_play_verdict(
        standard, package="in.example.jee", nonce="n", require_device="MEETS_DEVICE_INTEGRITY"
    )


# --- enforcement on endpoints, with the fake ----------------------------------------------------------


def _hdr(s: Session, platform: str, **extra: str) -> dict[str, str]:
    return {**s.headers, "X-Platform": platform, **extra}


async def _sync(
    client: httpx.AsyncClient, headers: dict[str, str], events: list[dict[str, Any]]
) -> httpx.Response:
    body = {"device_id": headers["X-Device-Id"], "events": events}
    return await client.post("/v1/sync/events", json=body, headers=headers)


async def _nonce(client: httpx.AsyncClient, s: Session) -> str:
    r = await client.post("/v1/integrity/challenge", headers=s.headers)
    assert r.status_code == 200, r.text
    assert "X-Integrity-Nonce" in r.json()["headers"]
    return str(r.json()["nonce"])


async def _flags_for(services: AppServices, user_id: uuid.UUID) -> list[Any]:
    async with services.db.admin_tx() as session:
        return list(
            (
                await session.execute(
                    text(
                        "select source, kind, events, detail from ops.integrity_flags"
                        " where user_id = :u order by created_at"
                    ),
                    {"u": user_id},
                )
            ).all()
        )


async def test_android_sync_needs_play_integrity_when_the_flag_is_on(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    s = await new_guest(client)
    android = _hdr(s, "android")
    assert (await _sync(client, android, [lesson_completed()])).status_code == 200  # flag off
    async with flags(services, {"security.attestation_required": True}):
        r = await _sync(client, android, [lesson_completed()])
        assert r.status_code == 403 and r.json()["code"] == "attestation_required"
        # Reviews alone are not XP-heavy; the web has no platform attestation.
        review = event("review_rated", {"card_ref": "d:own-1", "rating": 3, "ms_to_answer": 4000})
        assert (await _sync(client, android, [review])).status_code == 200
        assert (await _sync(client, _hdr(s, "web"), [lesson_completed()])).status_code == 200

        nonce = await _nonce(client, s)
        proof = {"X-Integrity-Token": f"fake-play:{nonce}", "X-Integrity-Nonce": nonce}
        r = await _sync(client, {**android, **proof}, [lesson_completed()])
        assert r.status_code == 200, r.text
        r = await _sync(client, {**android, **proof}, [lesson_completed()])  # nonce used up
        assert r.status_code == 403 and r.json()["code"] == "attestation_failed"
        other = await new_guest(client)
        stolen = await _nonce(client, other)
        r = await _sync(
            client,
            {**android, "X-Integrity-Token": f"fake-play:{stolen}", "X-Integrity-Nonce": stolen},
            [lesson_completed()],
        )
        assert r.status_code == 403
    rows = await _flags_for(services, s.user_id)
    assert [(r.source, r.kind, r.detail["reason"]) for r in rows] == [
        ("attestation", "attestation_failed", "nonce_invalid"),
        ("attestation", "attestation_failed", "nonce_invalid"),
    ]


async def test_ios_app_attest_key_then_assertions(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    s = await new_guest(client)
    ios = _hdr(s, "ios")
    key_id = base64.b64encode(hashlib.sha256(uuid.uuid4().bytes).digest()).decode()
    nonce = await _nonce(client, s)
    body = {
        "key_id": key_id,
        "attestation": base64.b64encode(f"fake-attest:{nonce}".encode()).decode(),
        "nonce": nonce,
    }
    r = await client.post("/v1/integrity/app-attest/keys", json=body, headers=ios)
    assert r.status_code == 201, r.text
    nonce = await _nonce(client, s)
    r = await client.post("/v1/integrity/app-attest/keys", json={**body, "nonce": nonce,
        "attestation": base64.b64encode(f"fake-attest:{nonce}".encode()).decode()}, headers=ios)  # fmt: skip
    assert r.status_code == 409

    async with flags(services, {"security.attestation_required": True}):
        for counter, status in ((1, 200), (1, 403), (2, 200)):
            nonce = await _nonce(client, s)
            assertion = base64.b64encode(f"fake-assert:{nonce}:{counter}".encode()).decode()
            headers = {
                **ios,
                "X-Integrity-Token": assertion,
                "X-Integrity-Nonce": nonce,
                "X-Integrity-Key-Id": key_id,
            }
            r = await _sync(client, headers, [lesson_completed()])
            assert r.status_code == status, (counter, r.text)
    rows = await _flags_for(services, s.user_id)
    assert [r.detail["reason"] for r in rows] == ["counter_replay"]
    async with services.db.admin_tx() as session:
        count = (
            await session.execute(
                text("select sign_count from app.attest_keys where key_id = :k"), {"k": key_id}
            )
        ).scalar_one()
    assert count == 2


# --- sync anti-cheat ---------------------------------------------------------------------------------


async def test_implausible_sync_events_are_flagged_not_rejected(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    s = await new_guest(client)
    fast = [
        event("review_rated", {"card_ref": "d:own-1", "rating": 3, "ms_to_answer": 120}),
        event("review_rated", {"card_ref": "d:own-2", "rating": 3, "ms_to_answer": 90}),
        event("review_rated", {"card_ref": "d:own-3", "rating": 3, "ms_to_answer": 5000}),
        lesson_completed(),
    ]
    fast[-1]["payload"]["ms_total"] = 600  # 100 ms per card
    # The proposed thresholds (R54): 500 ms a card, 700 ms an answer.
    r = await _sync(client, s.headers, fast)
    assert not r.json()["rejected"]
    rows = {r.kind: r for r in await _flags_for(services, s.user_id)}
    assert set(rows) == {"fast_review", "fast_lesson"}
    assert rows["fast_review"].events == 2 and rows["fast_review"].detail == {
        "threshold": 500,
        "min_ms": 90,
    }
    assert rows["fast_lesson"].detail == {"threshold": 500, "min_ms": 100}

    other = await new_guest(client)
    async with flags(
        services,
        {"anticheat.min_review_ms": 100, "xp.rules": {"hourly_cap": 10}},
    ):
        again = [{**e, "event_id": str(uuid.uuid4())} for e in fast]
        r = await _sync(client, other.headers, again)
    assert not r.json()["rejected"]
    rows = {r.kind: r for r in await _flags_for(services, other.user_id)}
    # 100 ms a lesson card is not below a 100 ms minimum; the 10 XP cap holds the lesson back.
    assert set(rows) == {"fast_review", "xp_hourly_cap"}
    assert rows["fast_review"].events == 1 and rows["fast_review"].detail["threshold"] == 100
    assert rows["xp_hourly_cap"].detail["threshold"] == 10
    assert rows["xp_hourly_cap"].detail["xp_held_back"] > 0
