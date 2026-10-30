"""Devices, push registration and notification settings (TRD §12; me-money §4.3 SET-03 to SET-05)."""

from __future__ import annotations

import uuid
from datetime import datetime, time
from typing import Annotated, Literal

from pydantic import BaseModel, Field, HttpUrl

Permission = Literal["not_asked", "granted", "denied", "provisional", "not_required"]


class WebPushKeys(BaseModel):
    p256dh: Annotated[str, Field(min_length=20, max_length=200, pattern=r"^[A-Za-z0-9_-]+=*$")]
    auth: Annotated[str, Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+=*$")]


class WebPushSubscription(BaseModel):
    endpoint: HttpUrl
    keys: WebPushKeys


class DeviceRegister(BaseModel):
    platform: Literal["ios", "android", "web"]
    app_version: Annotated[str, Field(min_length=1, max_length=40)]
    # Expo push token from the apps (ExponentPushToken[...]).
    push_token: Annotated[str, Field(min_length=10, max_length=200)] | None = None
    web_push_subscription: WebPushSubscription | None = None
    notif_permission: Permission = "not_asked"
    push_enabled: bool = True
    timezone: Annotated[str, Field(max_length=64)] | None = None
    locale: Literal["en", "hi"] | None = None


class DeviceOut(BaseModel):
    id: uuid.UUID
    platform: Literal["ios", "android", "web"]
    push_enabled: bool
    notif_permission: Permission
    has_push_token: bool
    has_web_push: bool


class NotificationPrefs(BaseModel):
    reminder_enabled: bool
    daily_reminder_at: time | None
    smart_timing: bool
    streak_saver: bool
    pet_plant_nudges: bool
    review_due: bool
    weak_area_alerts: bool
    daily_challenge: bool
    sleep_review: bool
    bedtime_review_time: time | None
    focus_timer: bool
    friends: bool
    exam_alerts: bool
    news: bool
    email_reminders: bool
    quiet_start: time
    quiet_end: time
    school_hours: bool
    focus_until: datetime | None
    paused: bool
    # Fields a minor cannot turn on (R34, me-money §6.2); the app hides them.
    adult_only: list[str]


class NotificationPrefsPatch(BaseModel):
    reminder_enabled: bool | None = None
    daily_reminder_at: time | None = None
    smart_timing: bool | None = None
    streak_saver: bool | None = None
    pet_plant_nudges: bool | None = None
    review_due: bool | None = None
    weak_area_alerts: bool | None = None
    daily_challenge: bool | None = None
    sleep_review: bool | None = None
    bedtime_review_time: time | None = None
    focus_timer: bool | None = None
    friends: bool | None = None
    exam_alerts: bool | None = None
    news: bool | None = None
    email_reminders: bool | None = None
    quiet_start: time | None = None
    quiet_end: time | None = None
    school_hours: bool | None = None
    focus_until: datetime | None = None
    # false resumes reminders after an auto-pause (any app open does the same).
    paused: Literal[False] | None = None


class NotificationOpened(BaseModel):
    # The ``id`` from the push's data (the outbox id). Absent for a plain app open.
    id: uuid.UUID | None = None


class WebPushKey(BaseModel):
    public_key: str | None
