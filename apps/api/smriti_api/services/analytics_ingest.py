"""``POST /v1/analytics/events``: product and learning events from the apps, checked on the server
exactly as ``packages/analytics`` checks them on the device (AGENTS rules 6 and 8, DPDP).

- The catalogue and the policy lists come from ``packages/analytics/catalogue.json`` (generated
  from the package; ``ANALYTICS_CATALOGUE_PATH`` points at another copy). Unknown events and
  server-only events are dropped.
- The audience is the profile's age band, never the client's claim: little learners get only the
  allow-list, minors only learning and essential events, adults' product events follow their
  ``analytics_opt_out`` setting, and with ``minor.defer_sync_until_consent`` on nothing is kept
  for a minor without guardian consent.
- Props are checked one by one: names that carry personal data or ad ids are removed, values
  must be short tokens, ids, numbers or booleans (no free text), and anything not in the
  catalogue entry is removed. Minors lose behavioural-tracking props.
- Rows go to the event store (ClickHouse, or a local file). Logs carry counts only.
"""

from __future__ import annotations

import json
import os
import re
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

import structlog
from sqlalchemy import text

from smriti_api.core.auth import AuthContext
from smriti_api.core.config import REPO_ROOT
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.core.logging import hash_user_id
from smriti_api.integrations.event_store import EventStore
from smriti_api.schemas import analytics_ingest as ai
from smriti_api.services import privacy
from smriti_api.services.sync import MAX_AGE, MAX_FUTURE
from smriti_api.services.usage import load_flags

log = structlog.get_logger(__name__)

NIL = uuid.UUID(int=0)
TOKEN_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$")
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:\-/]{0,127}$")
EMAIL_RE = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")
PHONE_RE = re.compile(r"(?:\+?\d[\s-]?){10,}")
BLOCKED_SUFFIX_RE = re.compile(r"(^|_)(email|phone|ad_id)$")


@dataclass(frozen=True)
class Catalogue:
    events: Mapping[str, Mapping[str, Any]]
    little_allowlist: frozenset[str]
    minor_stripped: frozenset[str]
    blocked_names: frozenset[str]
    max_list_items: int


def catalogue_path() -> Path:
    override = os.environ.get("ANALYTICS_CATALOGUE_PATH")
    return Path(override) if override else REPO_ROOT / "packages" / "analytics" / "catalogue.json"


@lru_cache(maxsize=1)
def catalogue() -> Catalogue:
    doc = json.loads(catalogue_path().read_text(encoding="utf-8"))
    guard = doc["guard"]
    return Catalogue(
        events=doc["events"],
        little_allowlist=frozenset(doc["policy"]["little_learner_product_allowlist"]),
        minor_stripped=frozenset(doc["policy"]["minor_stripped_props"]),
        blocked_names=frozenset([*guard["pii_prop_names"], *guard["ad_id_prop_names"]]),
        max_list_items=int(guard["max_list_items"]),
    )


# --- the props guard (packages/analytics src/guard.ts) --------------------------------------------


def is_blocked_name(name: str, cat: Catalogue) -> bool:
    n = name.lower()
    return n in cat.blocked_names or n.startswith("utm_") or bool(BLOCKED_SUFFIX_RE.search(n))


def is_safe_token(value: str, kind: str = "token") -> bool:
    if EMAIL_RE.search(value) or PHONE_RE.search(value):
        return False
    return bool((ID_RE if kind == "id" else TOKEN_RE).match(value))


def _is_number(v: Any) -> bool:
    return (
        isinstance(v, int | float) and not isinstance(v, bool) and v == v and abs(v) != float("inf")
    )


def check_scalar(pd: Mapping[str, Any], v: Any) -> str:
    """'ok', 'ok_unknown_enum' or an issue code, exactly as ``checkScalar``."""
    if v is None:
        return "ok"
    kind = pd.get("type")
    if kind == "number":
        if _is_number(v):
            return "ok"
        return "ok" if isinstance(v, str) and re.fullmatch(r"-?\d+(\.\d+)?", v) else "bad_type"
    if kind == "boolean":
        return "ok" if isinstance(v, bool) else "bad_type"
    if kind == "id":
        return (
            "ok"
            if _is_number(v) or (isinstance(v, str) and is_safe_token(v, "id"))
            else "free_text"
        )
    if kind in ("enum", "enum_list"):
        if not isinstance(v, str) or not is_safe_token(v):
            return "ok" if isinstance(v, bool) or _is_number(v) else "free_text"
        values = pd.get("values")
        return "ok_unknown_enum" if values and v not in values else "ok"
    if isinstance(v, bool) or _is_number(v):
        return "ok"
    return "ok" if isinstance(v, str) and is_safe_token(v) else "free_text"


def guard_props(
    defs: Mapping[str, Any], props: Mapping[str, Any], cat: Catalogue
) -> tuple[dict[str, Any], list[tuple[str, str]]]:
    out: dict[str, Any] = {}
    issues: list[tuple[str, str]] = []
    for name, value in props.items():
        if is_blocked_name(name, cat):
            issues.append((name, "blocked_name"))
            continue
        pd = defs.get(name)
        if pd is None:
            issues.append((name, "unknown_prop"))
            continue
        if isinstance(value, list):
            if pd.get("type") not in ("list", "enum_list"):
                issues.append((name, "bad_type"))
                continue
            if len(value) > cat.max_list_items:
                issues.append((name, "too_many_items"))
                continue
            item = (
                {"type": "enum", **({"values": pd["values"]} if pd.get("values") else {})}
                if pd.get("type") == "enum_list"
                else {"type": "id"}
            )
            results = [check_scalar(item, v) for v in value]
            bad = next((r for r in results if r not in ("ok", "ok_unknown_enum")), None)
            if bad is not None:
                issues.append((name, bad))
                continue
            if "ok_unknown_enum" in results:
                issues.append((name, "unknown_enum_value"))
            out[name] = value
            continue
        if isinstance(value, dict):
            issues.append((name, "bad_type"))
            continue
        r = check_scalar(pd, value)
        if r in ("ok", "ok_unknown_enum"):
            if r == "ok_unknown_enum":
                issues.append((name, "unknown_enum_value"))
            out[name] = value
        else:
            issues.append((name, r))
    return out, issues


# --- the audience policy (packages/analytics src/policy.ts) --------------------------------------


@dataclass(frozen=True)
class Audience:
    kind: str  # adult | teen | child | little | unknown
    opted_in: bool
    defer_until_consent: bool
    guardian_consent: bool

    @property
    def minor(self) -> bool:
        return self.kind != "adult"


def audience_from_band(band: str | None) -> str:
    return {"u10": "little", "10_12": "child", "13_17": "teen", "18p": "adult"}.get(
        band or "", "unknown"
    )


def allow_event(name: str, cat: Catalogue, aud: Audience) -> str | None:
    """None when the event may be kept, else the drop reason (``allowEvent``)."""
    d = cat.events.get(name)
    if d is None:
        return "unknown_event"
    if d["stream"] == "server":
        return "server_only"
    if aud.minor and aud.defer_until_consent and not aud.guardian_consent:
        return "awaiting_consent"
    if d["stream"] == "learning":
        return None
    if aud.kind == "little":
        return None if name in cat.little_allowlist else "little_learner_not_allowed"
    if d.get("essential"):
        return None
    if aud.minor:
        return "minor_not_allowed"
    return None if aud.opted_in else "opted_out"


async def _audience(db: Database, user_id: uuid.UUID) -> Audience:
    async with db.system_tx() as session:
        p = (
            await session.execute(
                text("select age_band, settings from app.profiles where user_id = :u"),
                {"u": user_id},
            )
        ).one_or_none()
        if p is None:
            raise ApiError(401, "session_ended", "This account no longer exists")
        flags = await load_flags(session)
        defer = flags.bool("minor.defer_sync_until_consent")
        kind = audience_from_band(p.age_band)
        consent = (
            "account" in await privacy.granted_scopes(session, user_id)
            if kind != "adult" and defer
            else False
        )
    settings = dict(p.settings or {})
    return Audience(
        kind=kind,
        opted_in=settings.get("analytics_opt_out") is not True,
        defer_until_consent=defer,
        guardian_consent=consent,
    )


def ch_time(at: datetime) -> str:
    """UTC, millisecond precision, in the form ClickHouse's DateTime64 parses by default."""
    return at.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]


def _safe_prop_name(name: str) -> str:
    return name if TOKEN_RE.match(name) else "(invalid)"


async def ingest(
    db: Database,
    store: EventStore,
    auth: AuthContext,
    batch: ai.EventBatchIn,
    device_id: uuid.UUID | None,
    *,
    now: datetime | None = None,
) -> ai.EventBatchOut:
    now = now or datetime.now(UTC)
    cat = catalogue()
    aud = await _audience(db, auth.user_id)
    accepted: list[uuid.UUID] = []
    dropped: list[ai.Dropped] = []
    issues: list[ai.PropIssue] = []
    rows: list[dict[str, Any]] = []
    seen: set[uuid.UUID] = set()
    for ev in batch.events:
        reason: str | None
        if ev.event_id in seen:
            reason = "duplicate_in_batch"
        elif ev.occurred_at < now - MAX_AGE:
            reason = "too_old"
        elif ev.occurred_at > now + MAX_FUTURE:
            reason = "in_the_future"
        else:
            reason = allow_event(ev.name, cat, aud)
        seen.add(ev.event_id)
        if reason is not None:
            dropped.append(ai.Dropped(event_id=ev.event_id, reason=reason))
            continue
        props, found = guard_props(cat.events[ev.name].get("props", {}), ev.props, cat)
        if aud.minor:
            for name in [k for k in props if k in cat.minor_stripped or k.startswith("utm_")]:
                props.pop(name)
                found.append((name, "stripped_for_minor"))
        issues += [
            ai.PropIssue(event_id=ev.event_id, prop=_safe_prop_name(n), code=c) for n, c in found
        ]
        c = ev.context
        rows.append(
            {
                "event_id": str(ev.event_id),
                "user_id": str(auth.user_id),
                "is_guest": auth.is_anonymous,
                "type": ev.name,
                "occurred_at": ch_time(ev.occurred_at),
                "received_at": ch_time(now),
                "session_id": str(NIL),
                "device_id": str(device_id or NIL),
                "platform": c.platform,
                "app_variant": c.app_variant,
                "app_version": c.app_version or "",
                "locale": c.locale,
                "exam_profile": c.exam_profile or "",
                "props": json.dumps(props, sort_keys=True),
            }
        )
        accepted.append(ev.event_id)
    if rows:
        await store.write(rows)
    log.info(
        "analytics_ingest",
        user=hash_user_id(auth.user_id),
        accepted=len(accepted),
        dropped=len(dropped),
        prop_issues=len(issues),
    )
    return ai.EventBatchOut(accepted=accepted, dropped=dropped, issues=issues)
