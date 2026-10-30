"""`app` schema (DB_SCHEMA §3) and the sync bookkeeping row (migration 0011)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Boolean, Computed, Date, DateTime, Integer, SmallInteger, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from smriti_api.models.base import Base


class Profile(Base):
    __tablename__ = "profiles"
    __table_args__ = ({"schema": "app"},)

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    handle: Mapped[str | None] = mapped_column(Text)
    nickname_word_ids: Mapped[list[str] | None] = mapped_column(ARRAY(Text))
    nickname_number: Mapped[int | None] = mapped_column(SmallInteger)
    display_name: Mapped[str | None] = mapped_column(Text)
    avatar_asset_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    locale: Mapped[str] = mapped_column(Text, default="en")
    timezone: Mapped[str] = mapped_column(Text, default="Asia/Kolkata")
    age_band: Mapped[str | None] = mapped_column(Text)
    is_minor: Mapped[bool | None] = mapped_column(
        Boolean, Computed("age_band in ('u10','10_12','13_17')", persisted=True)
    )
    birth_ym: Mapped[date | None] = mapped_column(Date)
    age_source: Mapped[str | None] = mapped_column(Text)
    account_kind: Mapped[str] = mapped_column(Text, default="learner")
    guardian_consent_state: Mapped[str] = mapped_column(Text, default="not_required")
    signed_up_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deletion_scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    primary_exam_profile_id: Mapped[str | None] = mapped_column(Text)
    daily_goal_xp: Mapped[int] = mapped_column(SmallInteger, default=30)
    daily_goal_minutes: Mapped[int] = mapped_column(SmallInteger, default=10)
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    discoverable: Mapped[bool] = mapped_column(Boolean, default=False)
    league_opt_out: Mapped[bool] = mapped_column(Boolean, default=False)
    institution_id: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(Text)
    first_variant: Mapped[str | None] = mapped_column(Text)
    referral_code: Mapped[str | None] = mapped_column(Text)
    referred_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    onboarding_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class UserExam(Base):
    __tablename__ = "user_exams"
    __table_args__ = ({"schema": "app"},)

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    exam_profile_id: Mapped[str] = mapped_column(Text, primary_key=True)
    target_date: Mapped[date | None] = mapped_column(Date)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    self_level: Mapped[str | None] = mapped_column(Text)
    question_language: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Device(Base):
    __tablename__ = "devices"
    __table_args__ = ({"schema": "app"},)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    platform: Mapped[str] = mapped_column(Text)
    app_variant: Mapped[str] = mapped_column(Text)
    app_version: Mapped[str] = mapped_column(Text)
    push_token: Mapped[str | None] = mapped_column(Text)
    web_push_subscription: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    push_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    notif_permission: Mapped[str] = mapped_column(Text, default="not_asked")
    notif_asked_count: Mapped[int] = mapped_column(SmallInteger, default=0)
    timezone: Mapped[str | None] = mapped_column(Text)
    locale: Mapped[str | None] = mapped_column(Text)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    invalid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AccountMerge(Base):
    __tablename__ = "account_merges"
    __table_args__ = ({"schema": "app"},)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    target_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    status: Mapped[str] = mapped_column(Text)
    include_progress: Mapped[bool] = mapped_column(Boolean, default=True)
    attempts: Mapped[int] = mapped_column(SmallInteger, default=0)
    failure_code: Mapped[str | None] = mapped_column(Text)
    stats: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DataRequest(Base):
    __tablename__ = "data_requests"
    __table_args__ = ({"schema": "app"},)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    kind: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SyncState(Base):
    __tablename__ = "sync_state"
    __table_args__ = ({"schema": "app"},)

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, default=0)
    section_versions: Mapped[dict[str, int]] = mapped_column(JSONB, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
