"""Structured JSON logs (TRD §13). No personal data: user ids are hashed, no bodies, no free text."""

from __future__ import annotations

import hashlib
import logging
import sys
from collections.abc import MutableMapping
from typing import Any

import structlog
from opentelemetry import trace

_SALT = ""


def hash_user_id(user_id: object) -> str:
    """A stable, non-reversible id for logs (TRD §13 `user_id (hashed)`)."""
    digest = hashlib.sha256(f"{_SALT}:{user_id}".encode()).hexdigest()
    return digest[:16]


def _add_trace(_: Any, __: str, event_dict: MutableMapping[str, Any]) -> MutableMapping[str, Any]:
    ctx = trace.get_current_span().get_span_context()
    if ctx.is_valid:
        event_dict["trace_id"] = format(ctx.trace_id, "032x")
        event_dict["span_id"] = format(ctx.span_id, "016x")
    return event_dict


_FORBIDDEN_KEYS = {
    "email",
    "name",
    "display_name",
    "payload",
    "body",
    "prompt",
    "front",
    "back",
    "token",
}


def _scrub(_: Any, __: str, event_dict: MutableMapping[str, Any]) -> MutableMapping[str, Any]:
    """Defence in depth: drop keys that commonly carry personal data if a caller logs them."""
    for key in list(event_dict):
        if key in _FORBIDDEN_KEYS:
            event_dict[key] = "[redacted]"
    return event_dict


def configure_logging(level: str = "INFO", salt: str = "") -> None:
    global _SALT
    _SALT = salt
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=level.upper())
    for noisy in ("uvicorn.access",):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            _add_trace,
            _scrub,
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.getLevelNamesMapping()[level.upper()]
        ),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )
