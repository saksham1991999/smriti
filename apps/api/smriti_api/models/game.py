"""`game` schema (DB_SCHEMA §6)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, Date, DateTime, Integer, SmallInteger, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from smriti_api.models.base import Base

S = {"schema": "game"}


class UserStats(Base):
    __tablename__ = "user_stats"
    __table_args__ = S

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    xp_total: Mapped[int] = mapped_column(BigInteger, default=0)
    xp_week: Mapped[int] = mapped_column(Integer, default=0)
    week_start: Mapped[date | None] = mapped_column(Date)
    level: Mapped[int] = mapped_column(SmallInteger, default=1)
    gems: Mapped[int] = mapped_column(Integer, default=0)
    current_streak: Mapped[int] = mapped_column(Integer, default=0)
    longest_streak: Mapped[int] = mapped_column(Integer, default=0)
    streak_last_day: Mapped[date | None] = mapped_column(Date)
    freezes_available: Mapped[int] = mapped_column(SmallInteger, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Plant(Base):
    __tablename__ = "plants"
    __table_args__ = S

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    species: Mapped[str] = mapped_column(Text, default="tulsi")
    skin: Mapped[str | None] = mapped_column(Text)
    growth_points: Mapped[int] = mapped_column(Integer, default=0)
    stage: Mapped[str] = mapped_column(Text, default="seed")
    health: Mapped[str] = mapped_column(Text, default="thriving")
    last_watered_day: Mapped[date | None] = mapped_column(Date)
    revival_progress: Mapped[int] = mapped_column(SmallInteger, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Pet(Base):
    __tablename__ = "pets"
    __table_args__ = S

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    species: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    mood: Mapped[int] = mapped_column(SmallInteger, default=80)
    energy: Mapped[int] = mapped_column(SmallInteger, default=80)
    state: Mapped[str] = mapped_column(Text, default="happy")
    outfit_ids: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    room_theme: Mapped[str | None] = mapped_column(Text)
    last_cared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_decay_day: Mapped[date | None] = mapped_column(Date)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class XpLedger(Base):
    __tablename__ = "xp_ledger"
    __table_args__ = S

    event_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    amount: Mapped[int] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(Text)
    ref: Mapped[str | None] = mapped_column(Text)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)


class GemLedger(Base):
    __tablename__ = "gem_ledger"
    __table_args__ = S

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    delta: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(Text)
    ref: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class StreakFreeze(Base):
    __tablename__ = "streak_freezes"
    __table_args__ = S

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    source: Mapped[str] = mapped_column(Text)
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_on: Mapped[date | None] = mapped_column(Date)
    equipped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Quest(Base):
    __tablename__ = "quests"
    __table_args__ = S

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    period: Mapped[str] = mapped_column(Text)
    spec: Mapped[dict[str, Any]] = mapped_column(JSONB)
    reward: Mapped[dict[str, Any]] = mapped_column(JSONB)
    active_from: Mapped[date] = mapped_column(Date)
    active_to: Mapped[date | None] = mapped_column(Date)


class UserQuest(Base):
    __tablename__ = "user_quests"
    __table_args__ = S

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    quest_id: Mapped[str] = mapped_column(Text, primary_key=True)
    period_start: Mapped[date] = mapped_column(Date, primary_key=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    target: Mapped[int] = mapped_column(Integer)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Badge(Base):
    __tablename__ = "badges"
    __table_args__ = S

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[dict[str, str]] = mapped_column(JSONB)
    description: Mapped[dict[str, str]] = mapped_column(JSONB)
    asset_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    rule: Mapped[dict[str, Any]] = mapped_column(JSONB)
    tier: Mapped[int] = mapped_column(SmallInteger, default=1)


class UserBadge(Base):
    __tablename__ = "user_badges"
    __table_args__ = S

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    badge_id: Mapped[str] = mapped_column(Text, primary_key=True)
    earned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ShopItem(Base):
    __tablename__ = "shop_items"
    __table_args__ = S

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    kind: Mapped[str] = mapped_column(Text)
    price_gems: Mapped[int] = mapped_column(Integer)
    pro_only: Mapped[bool] = mapped_column(Boolean, default=False)
    asset_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Inventory(Base):
    __tablename__ = "inventory"
    __table_args__ = S

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    item_id: Mapped[str] = mapped_column(Text, primary_key=True)
    qty: Mapped[int] = mapped_column(SmallInteger, default=1)
    acquired_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
