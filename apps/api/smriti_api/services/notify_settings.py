"""Device registration and ``notify.prefs`` (TRD §12, me-money §4.3). Writes run as the student
under RLS where the table allows it (``app.devices`` and ``notify.prefs`` are owner tables)."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text

from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.schemas import notify as n
from smriti_api.services.recompute import zone

# Off for minors (R34: no smart timing or behaviour-predicted sends; no predicted plant copy;
# no product news). Bedtime review is adults only (memory-labs request, X17).
ADULT_ONLY = ("smart_timing", "streak_saver", "pet_plant_nudges", "sleep_review", "news")
NULLABLE = frozenset({"daily_reminder_at", "bedtime_review_time", "focus_until"})
PREF_COLUMNS = (
    "reminder_enabled",
    "daily_reminder_at",
    "smart_timing",
    "streak_saver",
    "pet_plant_nudges",
    "review_due",
    "weak_area_alerts",
    "daily_challenge",
    "sleep_review",
    "bedtime_review_time",
    "focus_timer",
    "friends",
    "exam_alerts",
    "news",
    "email_reminders",
    "quiet_start",
    "quiet_end",
    "school_hours",
    "focus_until",
)


async def register_device(
    db: Database, auth: AuthContext, device_id: uuid.UUID | None, body: n.DeviceRegister
) -> n.DeviceOut:
    if device_id is None:
        raise ApiError(422, "device_id_required", "Send the X-Device-Id header")
    if body.timezone is not None:
        try:
            zone(body.timezone)
        except Exception as exc:
            raise ApiError(422, "invalid_timezone", "Use an IANA timezone name") from exc
    web = body.web_push_subscription.model_dump(mode="json") if body.web_push_subscription else None
    if web is not None and body.platform != "web":
        raise ApiError(422, "web_push_on_web_only", "Web Push subscriptions come from the web app")
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        # A token or subscription moves with the device: free it from any other row first
        # (a shared phone that switched accounts, or a reinstall).
        if body.push_token:
            await session.execute(
                text(
                    "update app.devices set push_token = null where push_token = :t and id <> :id"
                ),
                {"t": body.push_token, "id": device_id},
            )
        if web is not None:
            await session.execute(
                text(
                    "update app.devices set web_push_subscription = null"
                    " where web_push_subscription ->> 'endpoint' = :e and id <> :id"
                ),
                {"e": web["endpoint"], "id": device_id},
            )
        row = (
            await session.execute(
                text(
                    "insert into app.devices (id, user_id, platform, app_variant, app_version, push_token,"
                    " web_push_subscription, push_enabled, notif_permission, timezone, locale, last_seen_at)"
                    " values (:id, :u, :p, :var, :ver, :tok, cast(:web as jsonb), :en, :perm, :tz, :loc, :now)"
                    " on conflict (id) do update set user_id = excluded.user_id, platform = excluded.platform,"
                    " app_variant = excluded.app_variant, app_version = excluded.app_version,"
                    " push_token = excluded.push_token, web_push_subscription = excluded.web_push_subscription,"
                    " push_enabled = excluded.push_enabled, notif_permission = excluded.notif_permission,"
                    " timezone = coalesce(excluded.timezone, app.devices.timezone),"
                    " locale = coalesce(excluded.locale, app.devices.locale),"
                    " notif_asked_count = app.devices.notif_asked_count"
                    "   + case when excluded.notif_permission <> app.devices.notif_permission"
                    "      and app.devices.notif_permission = 'not_asked' then 1 else 0 end,"
                    " last_seen_at = excluded.last_seen_at, invalid_at = null"
                    " returning id, platform, push_enabled, notif_permission, push_token, web_push_subscription"
                ),
                {
                    "id": device_id,
                    "u": auth.user_id,
                    "p": body.platform,
                    "var": "web" if body.platform == "web" else "app",
                    "ver": body.app_version,
                    "tok": body.push_token,
                    "web": json.dumps(web) if web is not None else None,
                    "en": body.push_enabled,
                    "perm": body.notif_permission,
                    "tz": body.timezone,
                    "loc": body.locale,
                    "now": now,
                },
            )
        ).one()
    return _device_out(row)


def _device_out(row: Any) -> n.DeviceOut:
    return n.DeviceOut(
        id=row.id,
        platform=row.platform,
        push_enabled=row.push_enabled,
        notif_permission=row.notif_permission,
        has_push_token=row.push_token is not None,
        has_web_push=row.web_push_subscription is not None,
    )


async def forget_device(db: Database, auth: AuthContext, device_id: uuid.UUID) -> None:
    """Sign-out on this device: no more pushes to it."""
    async with db.user_tx(auth.claims) as session:
        await session.execute(
            text(
                "update app.devices set push_token = null, web_push_subscription = null,"
                " push_enabled = false where id = :id and user_id = :u"
            ),
            {"id": device_id, "u": auth.user_id},
        )


async def _is_minor(session: Any, user_id: uuid.UUID) -> bool:
    band = (
        await session.execute(
            text("select age_band from app.profiles where user_id = :u"), {"u": user_id}
        )
    ).scalar_one_or_none()
    return bool(band != "18p")


async def get_prefs(db: Database, auth: AuthContext) -> n.NotificationPrefs:
    async with db.system_tx() as session:
        await session.execute(
            text("insert into notify.prefs (user_id) values (:u) on conflict do nothing"),
            {"u": auth.user_id},
        )
        row = (
            await session.execute(
                text(
                    f"select {', '.join(PREF_COLUMNS)}, paused_at from notify.prefs where user_id = :u"  # noqa: S608 - fixed columns
                ),
                {"u": auth.user_id},
            )
        ).one()
        minor = await _is_minor(session, auth.user_id)
    values = {c: getattr(row, c) for c in PREF_COLUMNS}
    if minor:
        for c in ADULT_ONLY:
            values[c] = False
        values["school_hours"] = True
    return n.NotificationPrefs(
        **values, paused=row.paused_at is not None, adult_only=list(ADULT_ONLY)
    )


async def patch_prefs(
    db: Database, auth: AuthContext, patch: n.NotificationPrefsPatch
) -> n.NotificationPrefs:
    fields = patch.model_dump(exclude_unset=True)
    async with db.system_tx() as session:
        minor = await _is_minor(session, auth.user_id)
        blocked = [c for c in ADULT_ONLY if fields.get(c) is True]
        if minor and blocked:
            raise ApiError(
                403,
                "not_allowed_for_minors",
                "This setting is for learners 18 and over",
                fields=blocked,
            )
        if minor and fields.get("school_hours") is False:
            raise ApiError(403, "not_allowed_for_minors", "School hours stay on under 18")
        await session.execute(
            text("insert into notify.prefs (user_id) values (:u) on conflict do nothing"),
            {"u": auth.user_id},
        )
        for col in PREF_COLUMNS:
            if col not in fields:
                continue
            if fields[col] is None and col not in NULLABLE:
                continue
            await session.execute(
                text(f"update notify.prefs set {col} = :v where user_id = :u"),  # noqa: S608 - fixed columns
                {"v": fields[col], "u": auth.user_id},
            )
        if fields.get("paused") is False:
            await session.execute(
                text(
                    "update notify.prefs set paused_at = null, ignored_count = 0 where user_id = :u"
                ),
                {"u": auth.user_id},
            )
    return await get_prefs(db, auth)


async def opened(db: Database, auth: AuthContext, outbox_id: uuid.UUID | None) -> None:
    """An app open (with or without a tapped push) resets the ignored count and any auto-pause
    (R34); a tapped push also stamps ``notify.log.opened_at``."""
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        await session.execute(
            text("update notify.prefs set ignored_count = 0, paused_at = null where user_id = :u"),
            {"u": auth.user_id},
        )
        if outbox_id is not None:
            await session.execute(
                text(
                    "update notify.log set opened_at = :now where user_id = :u and outbox_id = :o"
                    " and opened_at is null and sent_at > :now - interval '14 days'"
                ),
                {"u": auth.user_id, "o": outbox_id, "now": now},
            )
