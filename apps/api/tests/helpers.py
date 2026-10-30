"""Helpers shared by the integration tests."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx


@dataclass
class Session:
    token: str
    user_id: uuid.UUID
    device_id: uuid.UUID

    @property
    def headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "X-Device-Id": str(self.device_id),
            "X-App-Variant": "jee",
        }


async def new_guest(client: httpx.AsyncClient) -> Session:
    r = await client.post("/v1/dev/auth/anonymous")
    assert r.status_code == 200, r.text
    body = r.json()
    return Session(
        token=body["access_token"], user_id=uuid.UUID(body["user"]["id"]), device_id=uuid.uuid4()
    )


async def google(
    client: httpx.AsyncClient,
    email: str,
    name: str = "Asha Verma",
    *,
    link_as: Session | None = None,
) -> httpx.Response:
    headers = {"Authorization": f"Bearer {link_as.token}"} if link_as else {}
    return await client.post(
        "/v1/dev/auth/google",
        json={"email": email, "name": name, "link": link_as is not None},
        headers=headers,
    )


def event(
    type_: str, payload: dict[str, Any], *, at: datetime | None = None, tz: str = "Asia/Kolkata"
) -> dict[str, Any]:
    return {
        "event_id": str(uuid.uuid4()),
        "type": type_,
        "occurred_at": (at or datetime.now(UTC)).isoformat(),
        "tz": tz,
        "payload": payload,
    }


def lesson_completed(topic: str = "t-placeholder", **kw: Any) -> dict[str, Any]:
    payload = {
        "topic_id": topic,
        "mode": "deep_dive",
        "cards_seen": 6,
        "correct": 3,
        "total": 4,
        "ms_total": 300000,
        "xp": 9999,
    }
    return event("lesson_completed", payload, **kw)


async def post_events(
    client: httpx.AsyncClient, s: Session, events: list[dict[str, Any]]
) -> dict[str, Any]:
    r = await client.post(
        "/v1/sync/events", json={"device_id": str(s.device_id), "events": events}, headers=s.headers
    )
    assert r.status_code == 200, r.text
    result: dict[str, Any] = r.json()
    return result


async def get_state(
    client: httpx.AsyncClient, s: Session, since: int | None = None
) -> dict[str, Any]:
    params = {"since": since} if since is not None else {}
    r = await client.get("/v1/sync/state", params=params, headers=s.headers)
    assert r.status_code == 200, r.text
    result: dict[str, Any] = r.json()
    return result
