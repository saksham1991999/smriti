"""Structured JSON logs (TRD §13). No personal data: user ids are hashed, no bodies, no free text."""

from __future__ import annotations

import hashlib
import logging
import re
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


# Personal data and secrets that exception text can carry (a failed query's parameters, a provider's
# error body, a URL with a key in it). Applied to rendered tracebacks and messages (AGENTS rules 5
# and 6), after ``format_exc_info``.
_TEXT_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"(?<=://)[^/\s:@]+:[^/\s@]+@"), "[redacted]@"),
    (re.compile(r"\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*"), "[token]"),
    (re.compile(r"(?i)\b(bearer|basic)\s+[\w.~+/=-]{8,}"), r"\1 [token]"),
    (
        re.compile(
            r"(?i)\b(password|passwd|secret|token|api[_-]?key|access[_-]?key|authorization|"
            r"client[_-]?secret|refresh[_-]?token|id[_-]?token)(\"?'?\s*[:=]\s*\"?'?)[^\s\"'&,;)]+"
        ),
        r"\1\2[redacted]",
    ),
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "[email]"),
    # Indian mobile numbers (with or without +91 / 0), then any number written with a + prefix.
    (re.compile(r"(?<!\d)(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)"), "[phone]"),
    (re.compile(r"(?<![\w+])\+\d{1,3}[\s-]?\d(?:[\s-]?\d){7,13}(?!\d)"), "[phone]"),
    # Long opaque secrets: 40+ characters mixing letters and digits. Plain hex (ids, digests) stays.
    (
        re.compile(
            r"\b(?![0-9a-fA-F]{40,}\b)(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)"
            r"[A-Za-z0-9_-]{40,}\b"
        ),
        "[secret]",
    ),
)
_TEXT_KEYS = ("exception", "event", "error", "detail", "message", "stack")


def scrub_text(value: str) -> str:
    """Removes emails, phone numbers, tokens and secrets from free text bound for a log line."""
    for pattern, repl in _TEXT_RULES:
        value = pattern.sub(repl, value)
    return value


def _scrub_text(_: Any, __: str, event_dict: MutableMapping[str, Any]) -> MutableMapping[str, Any]:
    for key in _TEXT_KEYS:
        value = event_dict.get(key)
        if isinstance(value, str):
            event_dict[key] = scrub_text(value)
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
            _scrub_text,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.getLevelNamesMapping()[level.upper()]
        ),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )
