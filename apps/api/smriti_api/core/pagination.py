"""Cursor pagination (TRD §5 "API style"). Cursors are opaque, URL-safe base64 JSON."""

from __future__ import annotations

import base64
import binascii
import json
from typing import Any

from pydantic import BaseModel

from smriti_api.core.errors import ApiError

MAX_LIMIT = 100


class Page[T](BaseModel):
    items: list[T]
    next_cursor: str | None = None


def encode_cursor(values: dict[str, Any]) -> str:
    raw = json.dumps(values, separators=(",", ":"), default=str).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str | None) -> dict[str, Any] | None:
    if not cursor:
        return None
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        value = json.loads(base64.urlsafe_b64decode(padded.encode()))
    except (binascii.Error, ValueError, UnicodeDecodeError) as exc:
        raise ApiError(400, "invalid_cursor", "The cursor is not valid") from exc
    if not isinstance(value, dict):
        raise ApiError(400, "invalid_cursor", "The cursor is not valid")
    return value


def clamp_limit(limit: int | None, default: int = 20) -> int:
    if limit is None:
        return default
    return max(1, min(limit, MAX_LIMIT))


def page_from_rows[T](rows: list[T], limit: int, key: Any) -> Page[T]:
    """``rows`` was fetched with ``limit + 1``; ``key`` maps the last kept row to its cursor values."""
    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor = encode_cursor(key(items[-1])) if has_more and items else None
    return Page[T](items=items, next_cursor=next_cursor)
