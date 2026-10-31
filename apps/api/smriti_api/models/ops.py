"""`ops`, `billing`, `notify` and `ai` tables the API reads or writes."""

from __future__ import annotations

import uuid
from datetime import date, datetime, time
from typing import Any

from sqlalchemy import BigInteger, Boolean, Date, DateTime, Float, Integer, SmallInteger, Text, Time
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from smriti_api.models.base import Base


class AppVariant(Base):
    __tablename__ = "app_variants"
    __table_args__ = ({"schema": "ops"},)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    exam_profile_ids: Mapped[list[str]] = mapped_column(ARRAY(Text))
    min_version: Mapped[str] = mapped_column(Text)
    latest_version: Mapped[str] = mapped_column(Text)
    config: Mapped[dict[str, Any]] = mapped_column(JSONB)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Flag(Base):
    __tablename__ = "flags"
    __table_args__ = ({"schema": "ops"},)

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value: Mapped[Any] = mapped_column(JSONB)
    rules: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    description: Mapped[str | None] = mapped_column(Text)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Product(Base):
    __tablename__ = "products"
    __table_args__ = ({"schema": "billing"},)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    platform: Mapped[str] = mapped_column(Text)
    variant_id: Mapped[str | None] = mapped_column(Text)
    store_product_id: Mapped[str] = mapped_column(Text)
    price_paise: Mapped[int] = mapped_column(Integer)
    intro_price_paise: Mapped[int | None] = mapped_column(Integer)
    period: Mapped[str] = mapped_column(Text)
    entitlement: Mapped[str] = mapped_column(Text, default="pro")
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Entitlement(Base):
    __tablename__ = "entitlements"
    __table_args__ = ({"schema": "billing"},)

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    entitlement: Mapped[str] = mapped_column(Text, primary_key=True)
    active: Mapped[bool] = mapped_column(Boolean)
    subscription_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    grace_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class NotifyPrefs(Base):
    __tablename__ = "prefs"
    __table_args__ = ({"schema": "notify"},)

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    reminder_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    daily_reminder_at: Mapped[time | None] = mapped_column(Time)
    smart_timing: Mapped[bool] = mapped_column(Boolean, default=False)
    streak_saver: Mapped[bool] = mapped_column(Boolean, default=False)
    pet_plant_nudges: Mapped[bool] = mapped_column(Boolean, default=False)
    review_due: Mapped[bool] = mapped_column(Boolean, default=True)
    weak_area_alerts: Mapped[bool] = mapped_column(Boolean, default=True)
    daily_challenge: Mapped[bool] = mapped_column(Boolean, default=True)
    sleep_review: Mapped[bool] = mapped_column(Boolean, default=False)
    bedtime_review_time: Mapped[time | None] = mapped_column(Time)
    focus_timer: Mapped[bool] = mapped_column(Boolean, default=True)
    friends: Mapped[bool] = mapped_column(Boolean, default=True)
    exam_alerts: Mapped[bool] = mapped_column(Boolean, default=True)
    news: Mapped[bool] = mapped_column(Boolean, default=False)
    email_reminders: Mapped[bool] = mapped_column(Boolean, default=False)
    quiet_start: Mapped[time] = mapped_column(Time)
    quiet_end: Mapped[time] = mapped_column(Time)
    school_hours: Mapped[bool] = mapped_column(Boolean, default=False)
    focus_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ignored_count: Mapped[int] = mapped_column(SmallInteger, default=0)
    paused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    estimated_bedtime: Mapped[time | None] = mapped_column(Time)
    usual_study_hour: Mapped[time | None] = mapped_column(Time)
    bedtime_confidence: Mapped[float | None] = mapped_column(Float)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AiUsageDaily(Base):
    __tablename__ = "usage_daily"
    __table_args__ = ({"schema": "ai"},)

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    tier: Mapped[str] = mapped_column(Text, primary_key=True)
    requests: Mapped[int] = mapped_column(Integer, default=0)
    tokens_in: Mapped[int] = mapped_column(BigInteger, default=0)
    tokens_out: Mapped[int] = mapped_column(BigInteger, default=0)
    units: Mapped[int] = mapped_column(Integer, default=0)
    cost_micros: Mapped[int] = mapped_column(BigInteger, default=0)


class AiGeneration(Base):
    __tablename__ = "generations"
    __table_args__ = ({"schema": "ai"},)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    kind: Mapped[str] = mapped_column(Text)
    provider: Mapped[str] = mapped_column(Text)
    model: Mapped[str] = mapped_column(Text)
    input_hash: Mapped[str] = mapped_column(Text)
    asset_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    cache_hit: Mapped[bool] = mapped_column(Boolean, default=False)
    cost_micros: Mapped[int | None] = mapped_column(BigInteger)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(Text)
    trace_id: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
