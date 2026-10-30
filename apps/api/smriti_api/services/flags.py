"""Feature flags and tunables from ``ops.flags`` (TRD §17). Rules target a variant, platform or app
version; the first matching rule's ``value`` wins. Cohort percentages need a user and are left
to the client SDK, so ``/v1/config`` stays cacheable."""

from __future__ import annotations

import re
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.models.ops import Flag

_CACHE_TTL_S = 30.0


@dataclass(frozen=True)
class FlagRow:
    """A detached copy of an ``ops.flags`` row, safe to cache across sessions."""

    key: str
    value: Any
    rules: list[Any]


_cache: tuple[float, dict[str, FlagRow]] | None = None


def parse_version(v: str | None) -> tuple[int, ...]:
    if not v:
        return ()
    return tuple(int(p) for p in re.findall(r"\d+", v)[:3])


@dataclass(frozen=True)
class FlagContext:
    variant: str | None = None
    platform: str | None = None
    app_version: str | None = None


def _rule_matches(rule: Mapping[str, Any], ctx: FlagContext) -> bool:
    if "variant" in rule and rule["variant"] != ctx.variant:
        return False
    if "platform" in rule and rule["platform"] != ctx.platform:
        return False
    version = parse_version(ctx.app_version)
    if "min_app_version" in rule and (
        not version or version < parse_version(str(rule["min_app_version"]))
    ):
        return False
    return not (
        "max_app_version" in rule
        and (not version or version > parse_version(str(rule["max_app_version"])))
    )


def evaluate(flag_rows: Mapping[str, FlagRow], ctx: FlagContext) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, flag in flag_rows.items():
        value = flag.value
        for rule in flag.rules or []:
            if isinstance(rule, dict) and "value" in rule and _rule_matches(rule, ctx):
                value = rule["value"]
                break
        out[key] = value
    return out


async def load_flag_rows(session: AsyncSession, *, use_cache: bool = True) -> dict[str, FlagRow]:
    global _cache
    now = time.monotonic()
    if use_cache and _cache is not None and now - _cache[0] < _CACHE_TTL_S:
        return _cache[1]
    rows = (await session.execute(select(Flag))).scalars().all()
    result = {r.key: FlagRow(key=r.key, value=r.value, rules=list(r.rules or [])) for r in rows}
    _cache = (now, result)
    return result


async def server_flags(session: AsyncSession) -> dict[str, Any]:
    """Flag values for server-side rules (no variant targeting)."""
    return evaluate(await load_flag_rows(session), FlagContext())


def pos_int(values: Mapping[str, Any], key: str, default: int) -> int:
    """A positive whole-number flag, or ``default`` when it is unset, null or malformed."""
    value = values.get(key)
    if isinstance(value, bool) or not isinstance(value, int | float) or value < 1:
        return default
    return int(value)


async def server_pos_int(session: AsyncSession, key: str, default: int) -> int:
    return pos_int(await server_flags(session), key, default)


def clear_cache() -> None:
    global _cache
    _cache = None
