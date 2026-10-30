"""Server push (TRD §12): Expo Push in batches of 100, retries with backoff, invalid-token pruning.

``PushSender`` is the interface. ``ExpoPushSender`` calls the Expo Push API
(https://docs.expo.dev/push-notifications/sending-notifications/); ``FakePushSender`` records
messages for local and test. Message data carries ids and deep links only, never study text.
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

import httpx
import structlog

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
