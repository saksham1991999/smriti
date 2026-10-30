"""Server push (TRD §12): Expo Push in batches of 100, retries with backoff, invalid-token pruning.

``PushSender`` is the interface. ``ExpoPushSender`` calls the Expo Push API
(https://docs.expo.dev/push-notifications/sending-notifications/); ``FakePushSender`` records
messages for local and test. Message data carries ids and deep links only, never study text.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import struct
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol
from urllib.parse import urlsplit

import httpx
import jwt
import structlog
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

log = structlog.get_logger(__name__)

EXPO_BATCH = 100
_RETRY_STATUSES = {429, 500, 502, 503, 504}


@dataclass(frozen=True)
class PushMessage:
    token: str
    title: str
    body: str
    data: dict[str, Any] = field(default_factory=dict)
    channel_id: str | None = None
    priority: Literal["default", "normal", "high"] = "default"
    ttl_s: int | None = None


@dataclass(frozen=True)
class PushTicket:
    token: str
    ok: bool
    ticket_id: str | None = None
    # DeviceNotRegistered means the token is dead: the caller marks the device invalid.
    error: str | None = None

    @property
    def token_invalid(self) -> bool:
        return self.error == "DeviceNotRegistered"


class PushSender(Protocol):
    name: str

    async def send(self, messages: Sequence[PushMessage]) -> list[PushTicket]: ...


@dataclass
class FakePushSender:
    name: str = "fake"
    sent: list[PushMessage] = field(default_factory=list)
    # Tokens that answer DeviceNotRegistered, to test pruning.
    dead_tokens: set[str] = field(default_factory=set)

    async def send(self, messages: Sequence[PushMessage]) -> list[PushTicket]:
        tickets = []
        for m in messages:
            if m.token in self.dead_tokens:
                tickets.append(PushTicket(m.token, False, error="DeviceNotRegistered"))
            else:
                self.sent.append(m)
                tickets.append(PushTicket(m.token, True, ticket_id=f"fake-{len(self.sent)}"))
        return tickets


class ExpoPushSender:
    name = "expo"

    def __init__(
        self,
        http: httpx.AsyncClient,
        *,
        url: str,
        access_token: str = "",
        max_attempts: int = 4,
        base_delay_s: float = 0.5,
    ) -> None:
        self._http = http
        self._url = url
        self._token = access_token
        self._attempts = max_attempts
        self._delay = base_delay_s

    @staticmethod
    def _payload(m: PushMessage) -> dict[str, Any]:
        out: dict[str, Any] = {
            "to": m.token,
            "title": m.title,
            "body": m.body,
            "data": m.data,
            "sound": "default",
            "priority": m.priority,
        }
        if m.channel_id:
            out["channelId"] = m.channel_id
        if m.ttl_s is not None:
            out["ttl"] = m.ttl_s
        return out

    async def _post(self, batch: Sequence[PushMessage]) -> list[dict[str, Any]]:
        headers = {"Accept": "application/json", "Accept-Encoding": "gzip, deflate"}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        payload = [self._payload(m) for m in batch]
        for attempt in range(self._attempts):
            try:
                r = await self._http.post(self._url, json=payload, headers=headers, timeout=30)
            except httpx.HTTPError as exc:
                if attempt + 1 == self._attempts:
                    raise
                log.warning("push_retry", provider="expo", reason=type(exc).__name__)
            else:
                if r.status_code not in _RETRY_STATUSES:
                    r.raise_for_status()
                    data = r.json().get("data", [])
                    return list(data) if isinstance(data, list) else []
                if attempt + 1 == self._attempts:
                    r.raise_for_status()
                log.warning("push_retry", provider="expo", status=r.status_code)
            await asyncio.sleep(self._delay * (2**attempt))
        return []

    async def send(self, messages: Sequence[PushMessage]) -> list[PushTicket]:
        tickets: list[PushTicket] = []
        for i in range(0, len(messages), EXPO_BATCH):
            batch = messages[i : i + EXPO_BATCH]
            try:
                results = await self._post(batch)
            except httpx.HTTPError as exc:
                log.warning(
                    "push_failed", provider="expo", reason=type(exc).__name__, count=len(batch)
                )
                tickets += [PushTicket(m.token, False, error="transport") for m in batch]
                continue
            for m, res in zip(batch, results + [{}] * (len(batch) - len(results)), strict=True):
                if res.get("status") == "ok":
                    tickets.append(PushTicket(m.token, True, ticket_id=res.get("id")))
                else:
                    details = res.get("details") or {}
                    tickets.append(
                        PushTicket(m.token, False, error=details.get("error") or "unknown")
                    )
        return tickets


class DisabledPushSender:
    name = "disabled"

    async def send(self, messages: Sequence[PushMessage]) -> list[PushTicket]:
        return [PushTicket(m.token, False, error="push_not_configured") for m in messages]


# --- Web Push (the web app; me-money §6.1) --------------------------------------------------------


def _b64u_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def encrypt_aes128gcm(payload: bytes, p256dh: str, auth: str, *, record_size: int = 4096) -> bytes:
    """Web Push message encryption (RFC 8291) with the aes128gcm content coding (RFC 8188)."""
    ua_public = _b64u_decode(p256dh)
    auth_secret = _b64u_decode(auth)
    ua_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public)
    as_private = ec.generate_private_key(ec.SECP256R1())
    as_public = as_private.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    ecdh_secret = as_private.exchange(ec.ECDH(), ua_key)
    ikm = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=auth_secret,
        info=b"WebPush: info\x00" + ua_public + as_public,
    ).derive(ecdh_secret)
    salt = os.urandom(16)
    cek = HKDF(
        algorithm=hashes.SHA256(), length=16, salt=salt, info=b"Content-Encoding: aes128gcm\x00"
    ).derive(ikm)
    nonce = HKDF(
        algorithm=hashes.SHA256(), length=12, salt=salt, info=b"Content-Encoding: nonce\x00"
    ).derive(ikm)
    # One record: the payload, then the 0x02 "last record" delimiter.
    ciphertext = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)
    header = salt + struct.pack("!I", record_size) + bytes([len(as_public)]) + as_public
    return header + ciphertext


def vapid_private_key(value: str) -> ec.EllipticCurvePrivateKey:
    """Accepts a PEM key or the raw 32-byte private scalar in base64url (the usual VAPID export)."""
    if "BEGIN" in value:
        key = serialization.load_pem_private_key(value.encode(), password=None)
        if not isinstance(key, ec.EllipticCurvePrivateKey):
            raise ValueError("VAPID key must be an EC P-256 key")
        return key
    return ec.derive_private_key(int.from_bytes(_b64u_decode(value), "big"), ec.SECP256R1())


class WebPushSender:
    """Sends to Web Push subscriptions (``PushMessage.token`` is the subscription JSON:
    ``{"endpoint", "keys": {"p256dh", "auth"}}``) with VAPID (RFC 8292). A 404 or 410 from the push
    service means the subscription is gone, reported as ``DeviceNotRegistered`` like Expo."""

    name = "webpush"

    def __init__(
        self,
        http: httpx.AsyncClient,
        *,
        private_key: str,
        subject: str,
        ttl_s: int = 6 * 3600,
    ) -> None:
        self._http = http
        self._key = vapid_private_key(private_key)
        self._public = _b64u(
            self._key.public_key().public_bytes(
                serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
            )
        )
        self._subject = subject
        self._ttl = ttl_s

    @property
    def public_key(self) -> str:
        """The application server key the web app passes to ``pushManager.subscribe``."""
        return self._public

    def _vapid(self, endpoint: str) -> str:
        parts = urlsplit(endpoint)
        claims = {
            "aud": f"{parts.scheme}://{parts.netloc}",
            "exp": int(time.time()) + 12 * 3600,
            "sub": self._subject,
        }
        token = jwt.encode(claims, self._key, algorithm="ES256")
        return f"vapid t={token}, k={self._public}"

    async def _send_one(self, m: PushMessage) -> PushTicket:
        try:
            sub = json.loads(m.token)
            endpoint = str(sub["endpoint"])
            keys = sub["keys"]
            body = encrypt_aes128gcm(
                json.dumps(
                    {"title": m.title, "body": m.body, "data": m.data}, separators=(",", ":")
                ).encode(),
                str(keys["p256dh"]),
                str(keys["auth"]),
            )
        except (ValueError, KeyError, TypeError):
            return PushTicket(m.token, False, error="DeviceNotRegistered")
        headers = {
            "Authorization": self._vapid(endpoint),
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            "TTL": str(m.ttl_s if m.ttl_s is not None else self._ttl),
            "Urgency": "high" if m.priority == "high" else "normal",
        }
        try:
            r = await self._http.post(endpoint, content=body, headers=headers, timeout=30)
        except httpx.HTTPError as exc:
            log.warning("push_failed", provider="webpush", reason=type(exc).__name__)
            return PushTicket(m.token, False, error="transport")
        if r.status_code in (404, 410):
            return PushTicket(m.token, False, error="DeviceNotRegistered")
        if r.status_code >= 400:
            log.warning("push_failed", provider="webpush", status=r.status_code)
            return PushTicket(m.token, False, error=f"http_{r.status_code}")
        return PushTicket(m.token, True, ticket_id=r.headers.get("location"))

    async def send(self, messages: Sequence[PushMessage]) -> list[PushTicket]:
        return list(await asyncio.gather(*(self._send_one(m) for m in messages)))
