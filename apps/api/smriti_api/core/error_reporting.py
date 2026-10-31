"""Error reporting to Sentry (TRD §13), for the API and the worker. Off unless SENTRY_DSN is set.

Traces stay in OpenTelemetry; Sentry gets errors only. No personal data leaves the process:

- no request bodies, cookies or query strings, and only an allow-list of request headers (never
  ``Authorization`` or ``Idempotency-Key``);
- the user is the internal user id and nothing else (no email, name or IP address);
- no local variables in stack frames, and email addresses in messages are masked;
- breadcrumbs are kept only for outgoing HTTP calls, without their query strings;
- arq job arguments are replaced by the SDK (personal data collection stays off).

Each error carries the OpenTelemetry ``trace_id`` as a tag, so it can be found in the traces.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

import sentry_sdk
from opentelemetry import trace

_configured = False

# Request headers that help debugging and carry no credential or personal data.
_HEADER_ALLOW = {
    "accept",
    "accept-language",
    "content-length",
    "content-type",
    "host",
    "user-agent",
    "x-platform",
    "x-app-variant",
    "x-app-version",
    "x-request-id",
    "traceparent",
}
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_MASK = "[email]"


def _mask(text: Any) -> Any:
    return _EMAIL.sub(_MASK, text) if isinstance(text, str) else text


def _scrub_request(request: dict[str, Any]) -> dict[str, Any]:
    headers = request.get("headers") or {}
    kept = {k: v for k, v in headers.items() if str(k).lower() in _HEADER_ALLOW}
    out: dict[str, Any] = {"headers": kept}
    for key in ("method", "url"):
        if key in request:
            out[key] = str(request[key]).split("?", 1)[0]
    return out


def _scrub_breadcrumbs(crumbs: Any) -> Any:
    values = crumbs.get("values") if isinstance(crumbs, Mapping) else crumbs
    if not isinstance(values, list):
        return crumbs
    kept = []
    for crumb in values:
        if crumb.get("category") != "httplib" and crumb.get("type") != "http":
            continue
        data = crumb.get("data") or {}
        kept.append(
            {
                "type": "http",
                "category": crumb.get("category"),
                "timestamp": crumb.get("timestamp"),
                "level": crumb.get("level"),
                "data": {
                    "method": data.get("method"),
                    "url": str(data.get("url", "")).split("?", 1)[0],
                    "status_code": data.get("status_code"),
                },
            }
        )
    return {"values": kept} if isinstance(crumbs, Mapping) else kept


def scrub_event(event: dict[str, Any], _hint: Any = None) -> dict[str, Any]:
    """Sentry ``before_send``: strip everything that could carry personal data."""
    if "request" in event:
        event["request"] = _scrub_request(event["request"])
    user = event.get("user") or {}
    event["user"] = {"id": str(user["id"])} if user.get("id") else {}
    if "breadcrumbs" in event:
        event["breadcrumbs"] = _scrub_breadcrumbs(event["breadcrumbs"])
    if "message" in event:
        event["message"] = _mask(event["message"])
    logentry = event.get("logentry")
    if isinstance(logentry, dict):
        logentry["message"] = _mask(logentry.get("message"))
        logentry.pop("params", None)
    for exc in (event.get("exception") or {}).get("values") or []:
        exc["value"] = _mask(exc.get("value"))
        for frame in (exc.get("stacktrace") or {}).get("frames") or []:
            frame.pop("vars", None)
    ctx = trace.get_current_span().get_span_context()
    if ctx.is_valid:
        event.setdefault("tags", {})["trace_id"] = format(ctx.trace_id, "032x")
    return event


def sentry_options(*, dsn: str, environment: str, release: str, service: str) -> dict[str, Any]:
    """The ``sentry_sdk.init`` arguments, shared by the API, the worker and the tests."""
    return {
        "dsn": dsn,
        "environment": environment,
        "release": release or None,
        "server_name": service,
        # send_default_pii and data_collection stay unset: the SDK then collects no personal
        # data and keeps its own denylist scrubber on, under scrub_event.
        "max_request_body_size": "never",
        "include_local_variables": False,
        "traces_sample_rate": 0.0,
        "profiles_sample_rate": 0.0,
        "before_send": scrub_event,
    }


def configure_error_reporting(*, dsn: str, environment: str, release: str, service: str) -> bool:
    """Starts the Sentry SDK once per process. Returns whether reporting is on."""
    global _configured
    if not dsn:
        return False
    if _configured:
        return True
    sentry_sdk.init(
        **sentry_options(dsn=dsn, environment=environment, release=release, service=service)
    )
    sentry_sdk.set_tag("service", service)
    _configured = True
    return True


def set_user(user_id: object) -> None:
    """Tags this request's errors with the internal user id (a no-op while Sentry is off)."""
    sentry_sdk.set_user({"id": str(user_id)})
