"""Server notifications (TRD §12, me-money §6): the outbox, the rules engine and delivery.

Features call :func:`enqueue` inside their own transaction (the outbox pattern). The
notifications worker calls :func:`dispatch_due`, which for each queued item:

1. loads the student's audience, ``notify.prefs``, consent and today's counts,
2. runs :func:`decide` (caps by audience, quiet hours, school hours, the minors rules R34, R45
   and R49, auto-pause, transactional exceptions), mirroring app-core's local planner,
3. renders the copy from the ``packages/i18n`` catalogues (round-robin template pools),
4. sends through the push senders (Expo for the apps, Web Push for the web app), prunes dead
   tokens, and writes ``notify.log`` (sent or suppressed with a reason).

Mobile apps schedule habit reminders locally (me-money §6.1); the server sends habit kinds only to
web devices, through :func:`plan_web_habit`, which runs every 15 minutes.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.db import Database
from smriti_api.integrations.push import PushMessage, PushSender, PushTicket
from smriti_api.services import copy
from smriti_api.services import flags as flag_service

log = structlog.get_logger(__name__)

Audience = Literal["adult", "teen", "child"]
Class = Literal[
    "habit", "learning", "social", "transactional", "exam_alert", "parent", "re_engagement"
]
Action = Literal["send", "hold", "suppress"]
NS = "me_money"


@dataclass(frozen=True)
class KindSpec:
    cls: Class
    # Catalogue keys (namespace me_money); more than one is a rotating pool.
    pool: tuple[str, ...]
    title: Literal["pet", "brand"] = "brand"
    deep_link: str = "/home"
    # Sent to minors at all (R34: no predicted-state or streak-saver copy for minors).
    minors: bool = True
    # Server habit kinds go only to web devices; the apps schedule them locally.
    web_only: bool = False
    # Dropped rather than held when it would land after quiet hours (a streak saver at 07:00 is
    # noise).
    drop_in_quiet: bool = False
    ttl: timedelta = timedelta(days=2)


KINDS: dict[str, KindSpec] = {
    "daily_reminder": KindSpec(
        "habit",
        (
            "NTF-01.daily_reminder_pool_1",
            "NTF-01.daily_reminder_pool_2",
            "NTF-01.daily_reminder_pool_3",
        ),
        title="pet",
        web_only=True,
        ttl=timedelta(hours=6),
    ),
    "daily_reminder_thirsty": KindSpec(
        "habit",
        ("NTF-01.daily_reminder_thirsty_adults",),
        title="pet",
        deep_link="/garden",
        minors=False,
        web_only=True,
        ttl=timedelta(hours=6),
    ),
    "streak_risk": KindSpec(
        "habit",
        (
            "NTF-01.streak_risk_streak_saver_pool_1_adults",
            "NTF-01.streak_risk_pool_2",
            "NTF-01.streak_risk_pool_3",
        ),
        title="pet",
        minors=False,
        web_only=True,
        drop_in_quiet=True,
        ttl=timedelta(hours=3),
    ),
    "pro_activated": KindSpec("transactional", ("NTF-01.pro_activated",)),
    "payment_not_completed": KindSpec(
        "transactional", ("NTF-01.payment_not_completed",), deep_link="/pro"
    ),
    "billing_issue": KindSpec("transactional", ("NTF-01.billing_issue",), deep_link="/pro/fix"),
    "trial_ending": KindSpec("transactional", ("NTF-01.trial_ending",), deep_link="/pro/manage"),
    "export_ready": KindSpec(
        "transactional", ("NTF-01.export_ready",), deep_link="/books/{export_id}"
    ),
    "consent_decided": KindSpec(
        "transactional",
        ("NTF-01.consent_decided_agreed",),
        deep_link="/guardian/requests/{request_id}",
    ),
    "parent_consent_needed": KindSpec(
        "parent", ("NTF-01.parent_consent_needed",), deep_link="/parent", ttl=timedelta(days=1)
    ),
    # Social (tutor-social B3, me-money §6.4). Class "social": consent, caps, and R45 for minors.
    "friend_request": KindSpec("social", ("NTF-01.friend_request",), deep_link="/friends"),
    "friend_accepted": KindSpec("social", ("NTF-01.friend_accepted",), deep_link="/friends"),
    "friend_cheer": KindSpec("social", ("NTF-01.friend_cheer",), deep_link="/friends"),
    "duo_invite": KindSpec("social", ("NTF-01.duo_invite",), deep_link="/friends"),
    "duo_nudge": KindSpec("social", ("NTF-01.duo_nudge",), deep_link="/home"),
    "duel_challenge": KindSpec(
        "social", ("NTF-01.duel_challenge",), deep_link="/duel/{code}", ttl=timedelta(hours=24)
    ),
    "duel_result": KindSpec("social", ("NTF-01.duel_result",), deep_link="/duel/{code}"),
    "squad_quest_done": KindSpec("social", ("NTF-01.squad_quest_done",), deep_link="/friends"),
    "league_promoted": KindSpec("social", ("NTF-01.league_promoted",), deep_link="/friends"),
    "league_result": KindSpec("social", ("NTF-01.league_result",), deep_link="/friends"),
}
# consent_decided picks its line from the outcome, not from rotation.
CONSENT_DECIDED_OTHER = "NTF-01.consent_decided_declined_or_expired"

# Defaults mirror packages/config (me-money §6.2); the server reads the same flags.
DEFAULT_CAPS: dict[str, dict[Audience, int]] = {
    "habit": {"adult": 2, "teen": 1, "child": 1},
    "learning": {"adult": 1, "teen": 0, "child": 0},
    "social": {"adult": 3, "teen": 2, "child": 0},
    "total": {"adult": 4, "teen": 3, "child": 1},
}
DEFAULT_QUIET: dict[Audience, dict[str, str]] = {
    "adult": {"start": "22:00", "end": "07:00"},
    "teen": {"start": "21:00", "end": "07:00"},
    "child": {"start": "20:00", "end": "08:00"},
}
DEFAULT_SCHOOL = {"start": "08:00", "end": "14:00"}
UNCAPPED: set[str] = {"transactional", "exam_alert", "parent"}


def audience_for(age_band: str | None) -> Audience:
    """A missing band counts as a minor (the safe side), like the analytics policy."""
    if age_band == "18p":
        return "adult"
    if age_band in ("u10", "10_12"):
        return "child"
    return "teen"


def hhmm(value: str | time) -> time:
    if isinstance(value, time):
        return value
    h, m = value.split(":")[:2]
    return time(int(h), int(m))


def in_window(t: time, start: time, end: time) -> bool:
    """``start <= t < end``, wrapping past midnight when start > end."""
    if start <= end:
        return start <= t < end
    return t >= start or t < end


def next_at(local_now: datetime, at: time) -> datetime:
    """The next local instant at clock time ``at`` (today if still ahead, else tomorrow)."""
    candidate = local_now.replace(hour=at.hour, minute=at.minute, second=0, microsecond=0)
    if candidate <= local_now:
        candidate += timedelta(days=1)
    return candidate


# --- enqueue ---------------------------------------------------------------------------------------


async def enqueue(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    kind: str,
    payload: dict[str, Any] | None = None,
    dedupe_key: str | None = None,
    not_before: datetime | None = None,
) -> bool:
    """Adds a send to the outbox in the caller's transaction. Returns False for a duplicate."""
    spec = KINDS[kind]
    now = datetime.now(UTC)
    start = not_before or now
    row = (
        await session.execute(
            text(
                "insert into notify.outbox (user_id, kind, class, payload, dedupe_key, not_before, expires_at)"
                " values (:u, :k, :c, cast(:p as jsonb), :d, :nb, :exp)"
                " on conflict (dedupe_key) do nothing returning id"
            ),
            {
                "u": user_id,
                "k": kind,
                "c": spec.cls,
                "p": _json(payload or {}),
                "d": dedupe_key,
                "nb": start,
                "exp": start + spec.ttl,
            },
        )
    ).first()
    return row is not None


def _json(value: Any) -> str:
    import json

    return json.dumps(value, separators=(",", ":"), default=str)


# --- the rules engine ------------------------------------------------------------------------------


@dataclass
class Prefs:
    reminder_enabled: bool = True
    daily_reminder_at: time | None = None
    streak_saver: bool = False
    pet_plant_nudges: bool = False
    friends: bool = True
    quiet_start: time = time(22, 0)
    quiet_end: time = time(7, 0)
    school_hours: bool = False
    focus_until: datetime | None = None
    paused_at: datetime | None = None


@dataclass
class UserCtx:
    user_id: uuid.UUID
    audience: Audience
    timezone: str
    locale: str
    prefs: Prefs
    pet_name: str | None = None
    social_consent: bool = False
    # Sent today (local day) per class, from notify.log.
    sent_today: dict[str, int] = field(default_factory=dict)
    caps: dict[str, dict[Audience, int]] = field(default_factory=lambda: DEFAULT_CAPS)
    quiet_flag: dict[Audience, dict[str, str]] = field(default_factory=lambda: DEFAULT_QUIET)
    school: dict[str, str] = field(default_factory=lambda: dict(DEFAULT_SCHOOL))

    @property
    def minor(self) -> bool:
        return self.audience != "adult"

    def zone(self) -> ZoneInfo:
        try:
            return ZoneInfo(self.timezone)
        except (KeyError, ValueError):
            return ZoneInfo("Asia/Kolkata")

    def quiet(self) -> tuple[time, time]:
        """Adults use their own quiet hours; minors never get a window looser than the flag's."""
        if not self.minor:
            return self.prefs.quiet_start, self.prefs.quiet_end
        q = self.quiet_flag[self.audience]
        return hhmm(q["start"]), hhmm(q["end"])

    def school_window(self) -> tuple[time, time] | None:
        # School hours are on for minors (me-money §6.2), whatever the stored pref says.
        if self.minor or self.prefs.school_hours:
            return hhmm(self.school["start"]), hhmm(self.school["end"])
        return None


@dataclass(frozen=True)
class Decision:
    action: Action
    reason: str | None = None
    until: datetime | None = None


def decide(kind: str, ctx: UserCtx, now: datetime, expires_at: datetime | None = None) -> Decision:
    """Whether a server send goes now, waits (``hold`` until a time) or is dropped (me-money §6.2)."""
    spec = KINDS[kind]
    if expires_at is not None and now >= expires_at:
        return Decision("suppress", "stale")
    cls = spec.cls
    prefs = ctx.prefs
    if ctx.minor and not spec.minors:
        return Decision("suppress", "minor_not_allowed")
    if cls == "social":
        if ctx.audience == "child":
            return Decision("suppress", "minor_not_allowed")
        if ctx.minor and not ctx.social_consent:
            return Decision("suppress", "awaiting_consent")
        if not prefs.friends:
            return Decision("suppress", "pref_off")
    if cls == "learning" and ctx.minor:
        return Decision("suppress", "folded_into_reminder")
    if cls in ("habit", "learning"):
        if prefs.paused_at is not None:
            return Decision("suppress", "paused")
        if kind.startswith("daily_reminder") and not prefs.reminder_enabled:
            return Decision("suppress", "pref_off")
        if kind == "streak_risk" and not prefs.streak_saver:
            return Decision("suppress", "pref_off")
        if kind == "daily_reminder_thirsty" and not prefs.pet_plant_nudges:
            return Decision("suppress", "pref_off")

    tz = ctx.zone()
    local = now.astimezone(tz)
    clock = local.time()

    # Caps (transactional, exam alerts and parent messages skip them).
    if cls not in UNCAPPED:
        cap = ctx.caps.get(cls, {}).get(ctx.audience)
        if cap is not None and ctx.sent_today.get(cls, 0) >= cap:
            return Decision("suppress", "cap_class")
        total = sum(v for k, v in ctx.sent_today.items() if k not in UNCAPPED)
        if total >= ctx.caps["total"][ctx.audience]:
            return Decision("suppress", "cap_total")

    # A focus session the student started holds everything but transactional sends.
    if prefs.focus_until is not None and now < prefs.focus_until and cls != "transactional":
        return Decision("hold", "focus", prefs.focus_until)

    q_start, q_end = ctx.quiet()
    if in_window(clock, q_start, q_end):
        if spec.drop_in_quiet:
            return Decision("suppress", "quiet_hours")
        return Decision("hold", "quiet_hours", next_at(local, q_end).astimezone(UTC))

    # Minors on a weekday in school hours: held to the end of school (R49).
    school = ctx.school_window()
    if school and local.isoweekday() <= 5 and cls != "transactional":
        if in_window(clock, school[0], school[1]):
            return Decision("hold", "school_hours", next_at(local, school[1]).astimezone(UTC))

    # R45: minors' social pushes wait for their own reminder window.
    if cls == "social" and ctx.minor and prefs.daily_reminder_at is not None:
        window_start = local.replace(
            hour=prefs.daily_reminder_at.hour,
            minute=prefs.daily_reminder_at.minute,
            second=0,
            microsecond=0,
        )
        if not window_start <= local < window_start + timedelta(minutes=30):
            return Decision("hold", "reminder_window", next_at(local, prefs.daily_reminder_at))
    return Decision("send")


# --- loading a student's context -------------------------------------------------------------------


def _flag_caps(flags: dict[str, Any]) -> dict[str, dict[Audience, int]]:
    caps: dict[str, dict[Audience, int]] = {}
    for cls, default in DEFAULT_CAPS.items():
        value = flags.get(f"notify.cap.{cls}")
        caps[cls] = (
            {a: int(value.get(a, default[a])) for a in ("adult", "teen", "child")}
            if isinstance(value, dict)
            else dict(default)
        )
    return caps


async def load_prefs(session: AsyncSession, user_id: uuid.UUID) -> Prefs:
    row = (
        await session.execute(
            text(
                "select reminder_enabled, daily_reminder_at, streak_saver, pet_plant_nudges, friends,"
                " quiet_start, quiet_end, school_hours, focus_until, paused_at"
                " from notify.prefs where user_id = :u"
            ),
            {"u": user_id},
        )
    ).one_or_none()
    if row is None:
        return Prefs()
    return Prefs(**row._mapping)


async def load_ctx(
    session: AsyncSession, user_id: uuid.UUID, now: datetime, flags: dict[str, Any]
) -> UserCtx | None:
    p = (
        await session.execute(
            text(
                "select p.age_band, p.timezone, p.locale, p.deletion_scheduled_for, pet.name as pet_name"
                " from app.profiles p left join game.pets pet on pet.user_id = p.user_id"
                " where p.user_id = :u"
            ),
            {"u": user_id},
        )
    ).one_or_none()
    if p is None or p.deletion_scheduled_for is not None:
        return None
    from smriti_api.services import privacy

    scopes = await privacy.granted_scopes(session, user_id)
    quiet = flags.get("notify.quiet_hours")
    school = flags.get("notify.school_hours")
    ctx = UserCtx(
        user_id=user_id,
        audience=audience_for(p.age_band),
        timezone=p.timezone,
        locale=p.locale,
        prefs=await load_prefs(session, user_id),
        pet_name=p.pet_name,
        social_consent="social" in scopes,
        caps=_flag_caps(flags),
        quiet_flag=quiet if isinstance(quiet, dict) else DEFAULT_QUIET,
        school=school if isinstance(school, dict) else dict(DEFAULT_SCHOOL),
    )
    local_midnight = now.astimezone(ctx.zone()).replace(hour=0, minute=0, second=0, microsecond=0)
    rows = (
        await session.execute(
            text(
                "select class, count(*) as n from notify.log where user_id = :u and status = 'sent'"
                " and sent_at >= :since and class is not null group by class"
            ),
            {"u": user_id, "since": local_midnight.astimezone(UTC)},
        )
    ).all()
    ctx.sent_today = {str(r[0]): int(r[1]) for r in rows}
    return ctx


# --- copy --------------------------------------------------------------------------------------------


async def pick_template(
    session: AsyncSession, user_id: uuid.UUID, kind: str, payload: dict[str, Any]
) -> str:
    """Round robin through the kind's pool: the template sent least recently wins (minors and
    adults alike here; the adult bandit, ``notify.bandit``, is off by default)."""
    spec = KINDS[kind]
    if kind == "consent_decided":
        return spec.pool[0] if payload.get("outcome") == "granted" else CONSENT_DECIDED_OTHER
    if len(spec.pool) == 1:
        return spec.pool[0]
    last = (
        await session.execute(
            text(
                "select template_id, max(sent_at) as at from notify.log where user_id = :u and kind = :k"
                " and status = 'sent' group by template_id"
            ),
            {"u": user_id, "k": kind},
        )
    ).all()
    seen = {r.template_id: r.at for r in last}
    never = [t for t in spec.pool if t not in seen]
    if never:
        return never[0]
    return min(spec.pool, key=lambda t: seen[t])


def render(
    kind: str, template: str, ctx: UserCtx, payload: dict[str, Any], brand: str
) -> tuple[str, str, str]:
    spec = KINDS[kind]
    values = {"brand": brand, "pet": ctx.pet_name or brand, **payload}
    body = copy.text(NS, template, ctx.locale, **values)
    title = (ctx.pet_name or brand) if spec.title == "pet" else brand
    link = spec.deep_link.format(**{k: v for k, v in payload.items() if isinstance(v, str | int)})
    return title, body, link


# --- delivery ----------------------------------------------------------------------------------------


@dataclass
class Senders:
    expo: PushSender
    web: PushSender | None = None


@dataclass(frozen=True)
class Device:
    id: uuid.UUID
    platform: str
    push_token: str | None
    web_push: dict[str, Any] | None


async def devices_for(session: AsyncSession, user_id: uuid.UUID, *, web_only: bool) -> list[Device]:
    rows = (
        await session.execute(
            text(
                "select id, platform, push_token, web_push_subscription from app.devices"
                " where user_id = :u and push_enabled and invalid_at is null"
                " and notif_permission in ('granted','provisional','not_required')"
                " and (push_token is not null or web_push_subscription is not null)"
            ),
            {"u": user_id},
        )
    ).all()
    out = [Device(r.id, r.platform, r.push_token, r.web_push_subscription) for r in rows]
    if web_only:
        out = [d for d in out if d.web_push is not None]
    return out


async def _deliver(
    senders: Senders, devices: Sequence[Device], title: str, body: str, data: dict[str, Any]
) -> list[tuple[Device, PushTicket]]:
    results: list[tuple[Device, PushTicket]] = []
    expo_devices = [d for d in devices if d.push_token]
    if expo_devices:
        tickets = await senders.expo.send(
            [
                PushMessage(token=d.push_token or "", title=title, body=body, data=data)
                for d in expo_devices
            ]
        )
        results.extend(zip(expo_devices, tickets, strict=True))
    web_devices = [d for d in devices if d.web_push and not d.push_token]
    if web_devices and senders.web is not None:
        import json

        tickets = await senders.web.send(
            [
                PushMessage(token=json.dumps(d.web_push), title=title, body=body, data=data)
                for d in web_devices
            ]
        )
        results.extend(zip(web_devices, tickets, strict=True))
    return results


async def _log(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    device_id: uuid.UUID | None,
    template_id: str,
    kind: str,
    status: str,
    reason: str | None,
    outbox_id: uuid.UUID,
    now: datetime,
) -> None:
    await session.execute(
        text(
            "insert into notify.log (user_id, device_id, template_id, channel, status, suppressed_reason,"
            " sent_at, kind, class, outbox_id) values (:u, :d, :t, 'push', :s, :r, :at, :k, :c, :o)"
        ),
        {
            "u": user_id,
            "d": device_id,
            "t": template_id,
            "s": status,
            "r": reason,
            "at": now,
            "k": kind,
            "c": KINDS[kind].cls,
            "o": outbox_id,
        },
    )


@dataclass
class DispatchResult:
    sent: int = 0
    held: int = 0
    suppressed: int = 0
    failed: int = 0
    pruned: int = 0


async def dispatch_due(
    db: Database,
    senders: Senders,
    *,
    now: datetime | None = None,
    brand: str = "Smriti",
    limit: int = 500,
) -> DispatchResult:
    """Decides and sends every outbox item that is due. Safe to run concurrently: rows are
    claimed with ``for update skip locked``."""
    now = now or datetime.now(UTC)
    result = DispatchResult()
    async with db.system_tx() as session:
        flags = await flag_service.server_flags(session)
        items = (
            await session.execute(
                text(
                    "select id, user_id, kind, payload, expires_at from notify.outbox"
                    " where status in ('queued','held') and not_before <= :now"
                    " order by not_before limit :n for update skip locked"
                ),
                {"now": now, "n": limit},
            )
        ).all()
        ctx_cache: dict[uuid.UUID, UserCtx | None] = {}
        for item in items:
            if item.kind not in KINDS:
                await _finish(session, item.id, "failed", "unknown_kind", now)
                result.failed += 1
                continue
            if item.user_id not in ctx_cache:
                ctx_cache[item.user_id] = await load_ctx(session, item.user_id, now, flags)
            ctx = ctx_cache[item.user_id]
            if ctx is None:
                await _finish(session, item.id, "suppressed", "no_profile", now)
                result.suppressed += 1
                continue
            payload = dict(item.payload or {})
            decision = decide(item.kind, ctx, now, item.expires_at)
            template = await pick_template(session, item.user_id, item.kind, payload)
            if decision.action == "hold" and decision.until is not None:
                await session.execute(
                    text(
                        "update notify.outbox set status = 'held', reason = :r, not_before = :nb"
                        " where id = :id"
                    ),
                    {"id": item.id, "r": decision.reason, "nb": decision.until},
                )
                result.held += 1
                continue
            if decision.action == "suppress":
                await _log(
                    session,
                    user_id=item.user_id,
                    device_id=None,
                    template_id=template,
                    kind=item.kind,
                    status="suppressed",
                    reason=decision.reason,
                    outbox_id=item.id,
                    now=now,
                )
                await _finish(session, item.id, "suppressed", decision.reason, now)
                result.suppressed += 1
                continue
            devices = await devices_for(session, item.user_id, web_only=KINDS[item.kind].web_only)
            if not devices:
                await _log(
                    session,
                    user_id=item.user_id,
                    device_id=None,
                    template_id=template,
                    kind=item.kind,
                    status="suppressed",
                    reason="no_device",
                    outbox_id=item.id,
                    now=now,
                )
                await _finish(session, item.id, "suppressed", "no_device", now)
                result.suppressed += 1
                continue
            try:
                title, body, link = render(item.kind, template, ctx, payload, brand)
            except copy.MissingCopy:
                log.error("notify_copy_missing", kind=item.kind, template=template)
                await _finish(session, item.id, "failed", "copy_missing", now)
                result.failed += 1
                continue
            data = {"kind": item.kind, "template_id": template, "url": link, "id": str(item.id)}
            delivered = await _deliver(senders, devices, title, body, data)
            ok = False
            for device, ticket in delivered:
                if ticket.token_invalid:
                    await session.execute(
                        text(
                            "update app.devices set invalid_at = :now, push_token = null,"
                            " web_push_subscription = null where id = :id"
                        ),
                        {"id": device.id, "now": now},
                    )
                    result.pruned += 1
                if ticket.ok:
                    ok = True
                await _log(
                    session,
                    user_id=item.user_id,
                    device_id=device.id,
                    template_id=template,
                    kind=item.kind,
                    status="sent" if ticket.ok else "failed",
                    reason=None if ticket.ok else (ticket.error or "send_failed")[:60],
                    outbox_id=item.id,
                    now=now,
                )
            if ok:
                cls = KINDS[item.kind].cls
                ctx.sent_today[cls] = ctx.sent_today.get(cls, 0) + 1
                if cls == "habit":
                    # Auto-pause after N habit sends without an app open (R34); an open resets it.
                    await session.execute(
                        text(
                            "update notify.prefs set ignored_count = ignored_count + 1,"
                            " paused_at = case when ignored_count + 1 >= :n then :now else paused_at end"
                            " where user_id = :u"
                        ),
                        {
                            "u": item.user_id,
                            "now": now,
                            "n": int(flags.get("notify.autopause_after_ignored", 7) or 7),
                        },
                    )
                await _finish(session, item.id, "sent", None, now)
                result.sent += 1
            else:
                await _finish(session, item.id, "failed", "send_failed", now)
                result.failed += 1
    if result.sent or result.failed:
        log.info("notify_dispatch", **result.__dict__)
    return result


async def _finish(
    session: AsyncSession, outbox_id: uuid.UUID, status: str, reason: str | None, now: datetime
) -> None:
    await session.execute(
        text(
            "update notify.outbox set status = :s, reason = :r, processed_at = :now,"
            " attempts = attempts + 1 where id = :id"
        ),
        {"id": outbox_id, "s": status, "r": reason, "now": now},
    )


# --- web habit planner ----------------------------------------------------------------------------


async def plan_web_habit(db: Database, *, now: datetime | None = None, window_min: int = 15) -> int:
    """Enqueues today's daily reminder and streak saver for students with a Web Push device
    (me-money §6.1: the web app cannot schedule locally). Runs every ``window_min`` minutes and
    picks the students whose send time falls in the window that just started. The rules engine
    then applies caps, quiet hours and the minors rules when the item is dispatched."""
    now = now or datetime.now(UTC)
    queued = 0
    async with db.system_tx() as session:
        rows = (
            await session.execute(
                text(
                    "select distinct p.user_id, p.timezone, p.age_band, p.daily_goal_minutes,"
                    " np.daily_reminder_at, np.quiet_start, np.streak_saver, np.reminder_enabled,"
                    " coalesce(us.current_streak, 0) as streak, pl.health"
                    " from app.devices d join app.profiles p on p.user_id = d.user_id"
                    " left join notify.prefs np on np.user_id = p.user_id"
                    " left join game.user_stats us on us.user_id = p.user_id"
                    " left join game.plants pl on pl.user_id = p.user_id"
                    " where d.web_push_subscription is not null and d.push_enabled and d.invalid_at is null"
                    " and p.deletion_scheduled_for is null"
                )
            )
        ).all()
        for r in rows:
            try:
                tz = ZoneInfo(r.timezone)
            except (KeyError, ValueError):
                continue
            local = now.astimezone(tz)
            today = local.date()
            qualified = (
                await session.execute(
                    text(
                        "select qualified from learn.activity_days where user_id = :u and day = :d"
                    ),
                    {"u": r.user_id, "d": today},
                )
            ).scalar_one_or_none()
            # R49: today's reminder is skipped once today already qualifies.
            if qualified:
                continue
            audience = audience_for(r.age_band)
            if r.daily_reminder_at is not None and r.reminder_enabled is not False:
                if _due_in_window(local, r.daily_reminder_at, window_min):
                    kind = (
                        "daily_reminder_thirsty"
                        if audience == "adult" and r.health == "droopy"
                        else "daily_reminder"
                    )
                    queued += await enqueue(
                        session,
                        user_id=r.user_id,
                        kind=kind,
                        payload={"min": int(r.daily_goal_minutes or 10)},
                        dedupe_key=f"{kind}:{r.user_id}:{today}",
                    )
            if audience == "adult" and r.streak_saver and int(r.streak) >= 1:
                quiet_start = r.quiet_start or time(22, 0)
                saver = (
                    datetime.combine(today, quiet_start, tzinfo=tz) - timedelta(hours=1)
                ).time()
                if _due_in_window(local, saver, window_min):
                    queued += await enqueue(
                        session,
                        user_id=r.user_id,
                        kind="streak_risk",
                        payload={"streak": int(r.streak)},
                        dedupe_key=f"streak_risk:{r.user_id}:{today}",
                    )
    return queued


def _due_in_window(local: datetime, at: time, window_min: int) -> bool:
    slot = local.replace(hour=at.hour, minute=at.minute, second=0, microsecond=0)
    return slot <= local < slot + timedelta(minutes=window_min)


def local_day(now: datetime, tz: str) -> date:
    return now.astimezone(ZoneInfo(tz)).date()


def senders_from(ints: Any) -> Senders:
    return Senders(expo=ints.push, web=ints.web_push)


async def dispatch_job(deps: Any) -> dict[str, int]:
    """The ``notify_dispatch`` job (notifications queue; also run every minute by cron)."""
    if deps.integrations is None:
        return {"skipped": 1}
    result = await dispatch_due(
        deps.db, senders_from(deps.integrations), brand=deps.integrations.settings.brand_name
    )
    return dict(result.__dict__)
