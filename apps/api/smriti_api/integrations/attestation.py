"""Device attestation behind one interface (IMPLEMENTATION_PLAN G-10, TRD §14).

Two platform signals, both bound to a one-time server nonce:

- **Android, Play Integrity.** The app asks Play for an integrity token with our nonce, and the
  server decodes it with Google (``decodeIntegrityToken``) using the service account in
  ``PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON``. The verdict must name one of our package names, carry
  our nonce, say Play recognises the app and that the device meets device integrity.
  https://developer.android.com/google/play/integrity/verdicts
- **iOS, App Attest.** The app makes a key in the Secure Enclave and has Apple attest it once
  (``attestKey``); the server checks the certificate chain to Apple's App Attestation root, the
  nonce extension, the key id, the App ID hash and the counter, then keeps the public key. Each
  sensitive call carries an assertion signed by that key over our nonce, with a counter that
  must go up.
  https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server

The real verifier runs when its env is set (``PLAY_INTEGRITY_*``, ``APP_ATTEST_*``). Local and test
use the fake; elsewhere a platform without env answers ``not_configured``.
"""

from __future__ import annotations

import base64
import hashlib
import json
import struct
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

import httpx
import jwt
import structlog
from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

log = structlog.get_logger(__name__)

# Apple App Attestation Root CA, as published at
# https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem (a public
# certificate; SHA-256 fingerprint 1C:B9:82:3B:...:62:42:C9:32). APP_ATTEST_ROOT_CA_PEM overrides it.
APPLE_ROOT_PATH = Path(__file__).parent / "certs" / "apple_app_attestation_root_ca.pem"
APPLE_NONCE_OID = x509.ObjectIdentifier("1.2.840.113635.100.8.2")
AAGUID = {"production": b"appattest" + b"\x00" * 7, "development": b"appattestdevelop"}
PLAY_SCOPE = "https://www.googleapis.com/auth/playintegrity"
PLAY_MAX_AGE_MS = 10 * 60 * 1000


class AttestationError(Exception):
    """A signal that did not verify. ``reason`` is a short code, safe to log and to store."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class AppAttestKey:
    key_id: str  # base64 of SHA-256 of the uncompressed public key, as the device reports it
    app_id: str  # TEAMID.bundle.id
    environment: str
    public_key_der: bytes  # SubjectPublicKeyInfo
    sign_count: int
    receipt: bytes | None = None


class AttestationVerifier(Protocol):
    name: str

    def configured(self, platform: str) -> bool: ...

    async def verify_play_integrity(self, *, token: str, nonce: str, variant: str | None) -> None:
        """Raises ``AttestationError`` unless the token carries our nonce and a good verdict."""

    def verify_app_attestation(
        self, *, key_id: str, attestation: bytes, nonce: str, variant: str | None
    ) -> AppAttestKey:
        """Checks a new App Attest key and returns what to store."""

    def verify_app_assertion(self, *, key: AppAttestKey, assertion: bytes, nonce: str) -> int:
        """Checks an assertion by a stored key and returns the new counter to store."""


def parse_pairs(raw: str) -> dict[str, str]:
    """``jee=in.example.jee,neet=in.example.neet`` -> ``{variant: value}``; a bare value maps ``*``."""
    out: dict[str, str] = {}
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        key, sep, value = part.partition("=")
        if sep:
            out[key.strip()] = value.strip()
        else:
            out["*"] = key
    return out


def _pick(values: dict[str, str], variant: str | None) -> str | None:
    if variant and variant in values:
        return values[variant]
    return values.get("*") if "*" in values else None


# --- CBOR (RFC 8949), only what attestation objects use -------------------------------------------


def cbor_decode(data: bytes) -> Any:
    value, end = _cbor_item(data, 0)
    if end != len(data):
        raise AttestationError("cbor_trailing_bytes")
    return value


def _cbor_item(data: bytes, i: int) -> tuple[Any, int]:
    if i >= len(data):
        raise AttestationError("cbor_truncated")
    head = data[i]
    major, info = head >> 5, head & 0x1F
    i += 1
    if info < 24:
        arg = info
    elif info in (24, 25, 26, 27):
        size = 1 << (info - 24)
        if i + size > len(data):
            raise AttestationError("cbor_truncated")
        arg = int.from_bytes(data[i : i + size], "big")
        i += size
    else:
        raise AttestationError("cbor_unsupported")  # indefinite lengths are not used here
    if major == 0:
        return arg, i
    if major == 1:
        return -1 - arg, i
    if major in (2, 3):
        if i + arg > len(data):
            raise AttestationError("cbor_truncated")
        chunk = data[i : i + arg]
        return (chunk if major == 2 else chunk.decode("utf-8")), i + arg
    if major == 4:
        items = []
        for _ in range(arg):
            item, i = _cbor_item(data, i)
            items.append(item)
        return items, i
    if major == 5:
        out: dict[Any, Any] = {}
        for _ in range(arg):
            k, i = _cbor_item(data, i)
            v, i = _cbor_item(data, i)
            out[k] = v
        return out, i
    if major == 6:
        return _cbor_item(data, i)  # tags carry no meaning we need
    if info == 20:
        return False, i
    if info == 21:
        return True, i
    if info in (22, 23):
        return None, i
    raise AttestationError("cbor_unsupported")


def _der_nonce(ext_value: bytes) -> bytes:
    """The nonce extension is ``SEQUENCE { [1] EXPLICIT OCTET STRING }``; returns the octets."""

    def tlv(buf: bytes, j: int) -> tuple[int, bytes, int]:
        if j + 2 > len(buf):
            raise AttestationError("bad_nonce_extension")
        tag, length = buf[j], buf[j + 1]
        j += 2
        if length & 0x80:
            n = length & 0x7F
            length = int.from_bytes(buf[j : j + n], "big")
            j += n
        if j + length > len(buf):
            raise AttestationError("bad_nonce_extension")
        return tag, buf[j : j + length], j + length

    tag, seq, _ = tlv(ext_value, 0)
    if tag != 0x30:
        raise AttestationError("bad_nonce_extension")
    tag, inner, _ = tlv(seq, 0)
    if tag != 0xA1:
        raise AttestationError("bad_nonce_extension")
    tag, octets, _ = tlv(inner, 0)
    if tag != 0x04:
        raise AttestationError("bad_nonce_extension")
    return octets


@dataclass(frozen=True)
class AuthData:
    rp_id_hash: bytes
    flags: int
    counter: int
    aaguid: bytes = b""
    credential_id: bytes = b""


def parse_auth_data(raw: bytes, *, attested: bool) -> AuthData:
    if len(raw) < 37:
        raise AttestationError("bad_auth_data")
    rp, flags, counter = raw[:32], raw[32], struct.unpack(">I", raw[33:37])[0]
    if not attested:
        return AuthData(rp, flags, counter)
    if len(raw) < 55:
        raise AttestationError("bad_auth_data")
    aaguid = raw[37:53]
    (cred_len,) = struct.unpack(">H", raw[53:55])
    cred = raw[55 : 55 + cred_len]
    if len(cred) != cred_len:
        raise AttestationError("bad_auth_data")
    return AuthData(rp, flags, counter, aaguid, cred)


def _b64decode(value: str) -> bytes:
    padded = value + "=" * (-len(value) % 4)
    try:
        return base64.b64decode(padded.replace("-", "+").replace("_", "/"), validate=True)
    except ValueError as exc:
        raise AttestationError("bad_base64") from exc


# --- App Attest ----------------------------------------------------------------------------------


@dataclass
class AppAttestConfig:
    app_ids: dict[str, str]  # variant -> TEAMID.bundle.id
    environment: str = "production"
    root_pem: bytes | None = None


class AppAttestVerifier:
    def __init__(self, cfg: AppAttestConfig) -> None:
        self.cfg = cfg
        pem = cfg.root_pem or APPLE_ROOT_PATH.read_bytes()
        self.root = x509.load_pem_x509_certificate(pem)
        self.aaguid = AAGUID.get(cfg.environment)
        if self.aaguid is None:
            raise ValueError("APP_ATTEST_ENVIRONMENT must be production or development")

    def _app_id(self, variant: str | None) -> str:
        app_id = _pick(self.cfg.app_ids, variant)
        if not app_id:
            raise AttestationError("unknown_app")
        return app_id

    def attest(
        self, key_id: str, attestation: bytes, nonce: str, variant: str | None
    ) -> AppAttestKey:
        obj = cbor_decode(attestation)
        if not isinstance(obj, dict) or obj.get("fmt") != "apple-appattest":
            raise AttestationError("bad_format")
        stmt, auth_raw = obj.get("attStmt"), obj.get("authData")
        if not isinstance(stmt, dict) or not isinstance(auth_raw, bytes):
            raise AttestationError("bad_format")
        x5c = stmt.get("x5c")
        if not isinstance(x5c, list) or len(x5c) < 2 or not all(isinstance(c, bytes) for c in x5c):
            raise AttestationError("bad_certificates")
        try:
            leaf = x509.load_der_x509_certificate(x5c[0])
            inter = x509.load_der_x509_certificate(x5c[1])
        except ValueError as exc:
            raise AttestationError("bad_certificates") from exc
        now = datetime.now(UTC)
        for cert in (leaf, inter):
            if not cert.not_valid_before_utc <= now <= cert.not_valid_after_utc:
                raise AttestationError("certificate_expired")
        try:
            inter.verify_directly_issued_by(self.root)
            leaf.verify_directly_issued_by(inter)
        except (ValueError, TypeError, InvalidSignature) as exc:
            raise AttestationError("untrusted_chain") from exc

        client_hash = hashlib.sha256(nonce.encode()).digest()
        expected = hashlib.sha256(auth_raw + client_hash).digest()
        try:
            ext = leaf.extensions.get_extension_for_oid(APPLE_NONCE_OID).value
        except x509.ExtensionNotFound as exc:
            raise AttestationError("missing_nonce_extension") from exc
        raw_ext = ext.value if isinstance(ext, x509.UnrecognizedExtension) else b""
        if _der_nonce(raw_ext) != expected:
            raise AttestationError("nonce_mismatch")

        pub = leaf.public_key()
        if not isinstance(pub, ec.EllipticCurvePublicKey):
            raise AttestationError("bad_key")
        point = pub.public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
        key_hash = hashlib.sha256(point).digest()
        if key_hash != _b64decode(key_id):
            raise AttestationError("key_id_mismatch")

        auth = parse_auth_data(auth_raw, attested=True)
        app_id = self._app_id(variant)
        if auth.rp_id_hash != hashlib.sha256(app_id.encode()).digest():
            raise AttestationError("app_id_mismatch")
        if auth.counter != 0:
            raise AttestationError("bad_counter")
        if auth.aaguid != self.aaguid:
            raise AttestationError("wrong_environment")
        if auth.credential_id != key_hash:
            raise AttestationError("key_id_mismatch")
        receipt = stmt.get("receipt")
        return AppAttestKey(
            key_id=key_id,
            app_id=app_id,
            environment=self.cfg.environment,
            public_key_der=pub.public_bytes(
                serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
            ),
            sign_count=0,
            receipt=receipt if isinstance(receipt, bytes) else None,
        )

    def assert_(self, key: AppAttestKey, assertion: bytes, nonce: str) -> int:
        obj = cbor_decode(assertion)
        if not isinstance(obj, dict):
            raise AttestationError("bad_format")
        sig, auth_raw = obj.get("signature"), obj.get("authenticatorData")
        if not isinstance(sig, bytes) or not isinstance(auth_raw, bytes):
            raise AttestationError("bad_format")
        client_hash = hashlib.sha256(nonce.encode()).digest()
        message = hashlib.sha256(auth_raw + client_hash).digest()
        pub = serialization.load_der_public_key(key.public_key_der)
        if not isinstance(pub, ec.EllipticCurvePublicKey):
            raise AttestationError("bad_key")
        try:
            pub.verify(sig, message, ec.ECDSA(hashes.SHA256()))
        except InvalidSignature as exc:
            raise AttestationError("bad_signature") from exc
        auth = parse_auth_data(auth_raw, attested=False)
        if auth.rp_id_hash != hashlib.sha256(key.app_id.encode()).digest():
            raise AttestationError("app_id_mismatch")
        if auth.counter <= key.sign_count:
            raise AttestationError("counter_replay")
        return auth.counter


# --- Play Integrity --------------------------------------------------------------------------------


@dataclass
class PlayIntegrityConfig:
    service_account: dict[str, Any]
    packages: dict[str, str]  # variant -> package name
    base_url: str = "https://playintegrity.googleapis.com/v1"
    require_device: str = "MEETS_DEVICE_INTEGRITY"


@dataclass
class _Token:
    value: str = ""
    expires: float = 0.0


class PlayIntegrityVerifier:
    def __init__(self, http: httpx.AsyncClient, cfg: PlayIntegrityConfig) -> None:
        self.http = http
        self.cfg = cfg
        self._token = _Token()
        for k in ("client_email", "private_key", "token_uri"):
            if not cfg.service_account.get(k):
                raise ValueError(f"PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON is missing {k}")

    async def _access_token(self) -> str:
        if self._token.value and self._token.expires - 60 > time.time():
            return self._token.value
        sa = self.cfg.service_account
        now = int(time.time())
        assertion = jwt.encode(
            {
                "iss": sa["client_email"],
                "scope": PLAY_SCOPE,
                "aud": sa["token_uri"],
                "iat": now,
                "exp": now + 3600,
            },
            sa["private_key"],
            algorithm="RS256",
            headers={"kid": sa["private_key_id"]} if sa.get("private_key_id") else None,
        )
        r = await self.http.post(
            sa["token_uri"],
            data={
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": assertion,
            },
            timeout=10,
        )
        if r.status_code != 200:
            log.warning("play_integrity_oauth_failed", status=r.status_code)
            raise AttestationError("provider_unavailable")
        body = r.json()
        self._token = _Token(
            str(body["access_token"]), time.time() + int(body.get("expires_in", 3600))
        )
        return self._token.value

    async def verify(self, token: str, nonce: str, variant: str | None) -> None:
        package = _pick(self.cfg.packages, variant)
        if not package:
            raise AttestationError("unknown_app")
        access = await self._access_token()
        try:
            r = await self.http.post(
                f"{self.cfg.base_url}/{package}:decodeIntegrityToken",
                json={"integrity_token": token},
                headers={"Authorization": f"Bearer {access}"},
                timeout=10,
            )
        except httpx.HTTPError as exc:
            raise AttestationError("provider_unavailable") from exc
        if r.status_code == 400:
            raise AttestationError("bad_token")
        if r.status_code != 200:
            log.warning("play_integrity_decode_failed", status=r.status_code)
            raise AttestationError("provider_unavailable")
        check_play_verdict(
            r.json().get("tokenPayloadExternal") or {},
            package=package,
            nonce=nonce,
            require_device=self.cfg.require_device,
        )


def check_play_verdict(
    payload: dict[str, Any], *, package: str, nonce: str, require_device: str
) -> None:
    req = payload.get("requestDetails") or {}
    if req.get("requestPackageName") != package:
        raise AttestationError("package_mismatch")
    # Classic requests echo the nonce; standard requests echo it as the request hash.
    if nonce not in (req.get("nonce"), req.get("requestHash")):
        raise AttestationError("nonce_mismatch")
    try:
        ts = int(req.get("timestampMillis", 0))
    except (TypeError, ValueError):
        ts = 0
    if abs(time.time() * 1000 - ts) > PLAY_MAX_AGE_MS:
        raise AttestationError("stale_token")
    app = payload.get("appIntegrity") or {}
    if app.get("appRecognitionVerdict") != "PLAY_RECOGNIZED":
        raise AttestationError("app_not_recognized")
    device = (payload.get("deviceIntegrity") or {}).get("deviceRecognitionVerdict") or []
    if require_device not in device:
        raise AttestationError("device_integrity")


# --- the verifiers -------------------------------------------------------------------------------


@dataclass
class RealAttestationVerifier:
    """Play Integrity and App Attest; either can be absent and then answers ``not_configured``."""

    play: PlayIntegrityVerifier | None
    apple: AppAttestVerifier | None
    name: str = "real"

    def configured(self, platform: str) -> bool:
        return (self.play if platform == "android" else self.apple) is not None

    async def verify_play_integrity(self, *, token: str, nonce: str, variant: str | None) -> None:
        if self.play is None:
            raise AttestationError("not_configured")
        await self.play.verify(token, nonce, variant)

    def verify_app_attestation(
        self, *, key_id: str, attestation: bytes, nonce: str, variant: str | None
    ) -> AppAttestKey:
        if self.apple is None:
            raise AttestationError("not_configured")
        return self.apple.attest(key_id, attestation, nonce, variant)

    def verify_app_assertion(self, *, key: AppAttestKey, assertion: bytes, nonce: str) -> int:
        if self.apple is None:
            raise AttestationError("not_configured")
        return self.apple.assert_(key, assertion, nonce)


@dataclass
class FakeAttestationVerifier:
    """Local and test. Android tokens are ``fake-play:<nonce>``; an App Attest attestation is the
    bytes ``fake-attest:<nonce>`` and an assertion ``fake-assert:<nonce>:<counter>``."""

    name: str = "fake"
    calls: list[str] = field(default_factory=list)

    def configured(self, platform: str) -> bool:
        return True

    async def verify_play_integrity(self, *, token: str, nonce: str, variant: str | None) -> None:
        self.calls.append("play")
        if token != f"fake-play:{nonce}":
            raise AttestationError("bad_token")

    def verify_app_attestation(
        self, *, key_id: str, attestation: bytes, nonce: str, variant: str | None
    ) -> AppAttestKey:
        self.calls.append("attest")
        if attestation != f"fake-attest:{nonce}".encode():
            raise AttestationError("bad_format")
        return AppAttestKey(key_id, "FAKETEAM.fake.app", "development", b"fake-key", 0)

    def verify_app_assertion(self, *, key: AppAttestKey, assertion: bytes, nonce: str) -> int:
        self.calls.append("assert")
        prefix = f"fake-assert:{nonce}:".encode()
        if not assertion.startswith(prefix):
            raise AttestationError("bad_signature")
        try:
            counter = int(assertion[len(prefix) :])
        except ValueError as exc:
            raise AttestationError("bad_format") from exc
        if counter <= key.sign_count:
            raise AttestationError("counter_replay")
        return counter


def build_attestation(
    http: httpx.AsyncClient,
    *,
    dev: bool,
    provider: str,
    play_service_account_json: str,
    play_packages: str,
    app_attest_app_ids: str,
    app_attest_environment: str,
    app_attest_root_ca_pem: str,
) -> AttestationVerifier:
    if provider.lower() == "fake" or (
        dev and provider.lower() != "real" and not (play_service_account_json or app_attest_app_ids)
    ):
        return FakeAttestationVerifier()
    play = None
    if play_service_account_json and play_packages:
        play = PlayIntegrityVerifier(
            http,
            PlayIntegrityConfig(
                service_account=json.loads(play_service_account_json),
                packages=parse_pairs(play_packages),
            ),
        )
    apple = None
    if app_attest_app_ids:
        apple = AppAttestVerifier(
            AppAttestConfig(
                app_ids=parse_pairs(app_attest_app_ids),
                environment=app_attest_environment or "production",
                root_pem=app_attest_root_ca_pem.encode() if app_attest_root_ca_pem else None,
            )
        )
    return RealAttestationVerifier(play=play, apple=apple)
