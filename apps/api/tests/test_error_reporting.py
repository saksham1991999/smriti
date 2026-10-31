"""Sentry error reporting: what reaches Sentry carries no personal data (TRD §13, AGENTS rule 6)."""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
import sentry_sdk
from fastapi import FastAPI
from sentry_sdk.envelope import Envelope
from sentry_sdk.transport import Transport

from smriti_api.core import error_reporting
from smriti_api.core.error_reporting import scrub_event, sentry_options, set_user

EMAIL = "learner@example.com"
# Kept up here, out of the source context Sentry sends with the failing frame.
SECRET_TOKEN = "Bearer secret-token"
QUERY = "token=abc"
IDEMPOTENCY_KEY = "k1"
ANSWER = "free text"


class Recorder(Transport):
    def __init__(self, options: dict[str, Any] | None = None) -> None:
        super().__init__(options)
        self.events: list[dict[str, Any]] = []

    def capture_envelope(self, envelope: Envelope) -> None:
        for item in envelope.items:
            if item.type == "event" and item.payload.json is not None:
                self.events.append(item.payload.json)


@pytest.fixture
def recorder() -> Iterator[Recorder]:
    rec = Recorder()
    opts = sentry_options(
        dsn="https://public@sentry.invalid/1",
        environment="test",
        release="r1",
        service="smriti-api",
    )
    sentry_sdk.init(**opts, transport=rec, default_integrations=True)
    try:
        yield rec
    finally:
        sentry_sdk.get_client().close()
        sentry_sdk.init(dsn=None)


def test_scrub_event_keeps_only_safe_fields() -> None:
    event: dict[str, Any] = {
        "request": {
            "url": "https://api.example/v1/x?code=secret",
            "method": "POST",
            "headers": {"Authorization": "Bearer t", "User-Agent": "ua", "Cookie": "c=1"},
            "data": {"email": EMAIL},
            "cookies": {"c": "1"},
            "query_string": "code=secret",
        },
        "user": {"id": "u1", "email": EMAIL, "ip_address": "1.2.3.4", "username": "n"},
        "message": f"no account for {EMAIL}",
        "logentry": {"message": f"hi {EMAIL}", "params": [EMAIL]},
        "exception": {
            "values": [
                {
                    "value": f"bad {EMAIL}",
                    "stacktrace": {"frames": [{"function": "f", "vars": {"email": EMAIL}}]},
                }
            ]
        },
        "breadcrumbs": {
            "values": [
                {
                    "category": "httplib",
                    "type": "http",
                    "data": {"url": "https://p/x?key=k", "method": "GET", "status_code": 200},
                },
                {"category": "query", "message": "select ... where email = 'learner@example.com'"},
                {"category": "log", "message": EMAIL},
            ]
        },
    }
    out = scrub_event(event)
    assert out["request"] == {
        "headers": {"User-Agent": "ua"},
        "method": "POST",
        "url": "https://api.example/v1/x",
    }
    assert out["user"] == {"id": "u1"}
    assert out["breadcrumbs"]["values"] == [
        {
            "type": "http",
            "category": "httplib",
            "timestamp": None,
            "level": None,
            "data": {"method": "GET", "url": "https://p/x", "status_code": 200},
        }
    ]
    assert EMAIL not in json.dumps(out)


def test_options_never_send_pii() -> None:
    opts = sentry_options(
        dsn="https://k@sentry.invalid/1", environment="production", release="", service="s"
    )
    # Unset means no personal data (and no deprecation warning).
    assert "send_default_pii" not in opts
    assert "data_collection" not in opts
    assert opts["max_request_body_size"] == "never"
    assert opts["include_local_variables"] is False
    assert opts["release"] is None
    assert opts["before_send"] is scrub_event


def test_off_without_dsn(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(error_reporting, "_configured", False)
    assert (
        error_reporting.configure_error_reporting(
            dsn="", environment="test", release="", service="s"
        )
        is False
    )
    assert sentry_sdk.get_client().is_active() is False


async def test_unhandled_route_error_reaches_sentry_scrubbed(recorder: Recorder) -> None:
    from smriti_api.core.errors import install_error_handlers

    user_id = uuid.uuid4()
    app = FastAPI()
    install_error_handlers(app)

    @app.post("/boom")
    async def boom() -> None:
        set_user(user_id)
        raise RuntimeError(f"failed for {EMAIL}")

    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.post(
            f"/boom?{QUERY}",
            json={"email": EMAIL, "answer": ANSWER},
            headers={
                "Authorization": SECRET_TOKEN,
                "Idempotency-Key": IDEMPOTENCY_KEY,
                "X-App-Variant": "jee",
            },
        )
    assert r.status_code == 500
    sentry_sdk.flush()
    assert recorder.events, "the error was not reported"
    event = recorder.events[0]
    raw = json.dumps(event)
    for leaked in (EMAIL, SECRET_TOKEN, ANSWER, QUERY, f'"{IDEMPOTENCY_KEY}"'):
        assert leaked not in raw
    assert event["user"] == {"id": str(user_id)}
    headers = {k.lower() for k in event["request"]["headers"]}
    assert "authorization" not in headers
    assert "x-app-variant" in headers
    assert "data" not in event["request"]
    assert event["exception"]["values"][-1]["type"] == "RuntimeError"
    assert event["server_name"] == "smriti-api"


async def test_cors_allows_the_web_trace_headers(client: httpx.AsyncClient) -> None:
    r = await client.options(
        "/v1/config",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "traceparent,tracestate,baggage,sentry-trace",
        },
    )
    assert r.status_code == 200
    allowed = r.headers["access-control-allow-headers"].lower()
    for header in ("traceparent", "tracestate", "baggage", "sentry-trace"):
        assert header in allowed
