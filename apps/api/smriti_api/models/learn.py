"""`learn` schema (DB_SCHEMA §5) plus sync_events and srs_tombstones (migration 0011)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, Date, DateTime, Float, Integer, SmallInteger, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from smriti_api.models.base import Base

S = {"schema": "learn"}


class LessonProgress(Base):
    __tablename__ = "lesson_progress"
    __table_args__ = S

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    topic_id: Mapped[str] = mapped_column(Text, primary_key=True)
    mode: Mapped[str] = mapped_column(Text, primary_key=True)
    bundle_hash: Mapped[str] = mapped_column(Text)
    last_card_index: Mapped[int] = mapped_column(SmallInteger, default=0)
    cards_seen: Mapped[int] = mapped_column(SmallInteger, default=0)
    bites_completed: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    best_score: Mapped[int | None] = mapped_column(SmallInteger)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ConceptMastery(Base):
    __tablename__ = "concept_mastery"
    __table_args__ = S

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    concept_id: Mapped[str] = mapped_column(Text, primary_key=True)
    mastery: Mapped[float] = mapped_column(Float, default=0)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    correct: Mapped[int] = mapped_column(Integer, default=0)
    avg_time_ms: Mapped[int | None] = mapped_column(Integer)
    sure_total: Mapped[int] = mapped_column(SmallInteger, default=0)
    sure_correct: Mapped[int] = mapped_column(SmallInteger, default=0)
    fifty_total: Mapped[int] = mapped_column(SmallInteger, default=0)
    fifty_correct: Mapped[int] = mapped_column(SmallInteger, default=0)
    guess_total: Mapped[int] = mapped_column(SmallInteger, default=0)
    guess_correct: Mapped[int] = mapped_column(SmallInteger, default=0)
    calibration: Mapped[float | None] = mapped_column(Float)
    self_confidence: Mapped[int | None] = mapped_column(SmallInteger)
    last_practiced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class TopicStatus(Base):
    __tablename__ = "topic_status"
    __table_args__ = S

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    topic_id: Mapped[str] = mapped_column(Text, primary_key=True)
    status: Mapped[str] = mapped_column(Text)
    learned_via: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    sync_version: Mapped[int] = mapped_column(BigInteger, default=0)


class ActivityDay(Base):
    __tablename__ = "activity_days"
    __table_args__ = S

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    xp: Mapped[int] = mapped_column(Integer, default=0)
    minutes: Mapped[int] = mapped_column(SmallInteger, default=0)
    focus_sessions: Mapped[int] = mapped_column(SmallInteger, default=0)
    cards_reviewed: Mapped[int] = mapped_column(SmallInteger, default=0)
    lessons_completed: Mapped[int] = mapped_column(SmallInteger, default=0)
    mock_sections: Mapped[int] = mapped_column(SmallInteger, default=0)
    daily_challenge: Mapped[bool] = mapped_column(Boolean, default=False)
    qualified: Mapped[bool] = mapped_column(Boolean, default=False)
    goal_met: Mapped[bool] = mapped_column(Boolean, default=False)
    rescue_done: Mapped[bool] = mapped_column(Boolean, default=False)
    rest_day: Mapped[bool] = mapped_column(Boolean, default=False)
    freeze_used: Mapped[bool] = mapped_column(Boolean, default=False)
    first_event_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_event_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Deck(Base):
    __tablename__ = "decks"
    __table_args__ = S

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    source: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text)
    topic_id: Mapped[str | None] = mapped_column(Text)
    share_code: Mapped[str | None] = mapped_column(Text)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    share_status: Mapped[str | None] = mapped_column(Text)
    listed_for_exam: Mapped[str | None] = mapped_column(Text)
    helpful_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Card(Base):
    __tablename__ = "cards"
    __table_args__ = S

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    deck_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    owner_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    kind: Mapped[str] = mapped_column(Text, default="basic")
    front: Mapped[dict[str, Any]] = mapped_column(JSONB)
    back: Mapped[dict[str, Any]] = mapped_column(JSONB)
    image_asset_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    concept_id: Mapped[str | None] = mapped_column(Text)
    source_ref: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SrsCard(Base):
    __tablename__ = "srs_cards"
    __table_args__ = S

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    card_ref: Mapped[str] = mapped_column(Text, primary_key=True)
    deck_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    state: Mapped[int] = mapped_column(SmallInteger)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    stability: Mapped[float] = mapped_column(Float)
    difficulty: Mapped[float] = mapped_column(Float)
    reps: Mapped[int] = mapped_column(SmallInteger, default=0)
    lapses: Mapped[int] = mapped_column(SmallInteger, default=0)
    last_review_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    suspended: Mapped[bool] = mapped_column(Boolean, default=False)
    flags: Mapped[int] = mapped_column(SmallInteger, default=0)
    buried_until: Mapped[date | None] = mapped_column(Date)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    sync_version: Mapped[int] = mapped_column(BigInteger, default=0)


class SrsReview(Base):
    __tablename__ = "srs_reviews"
    __table_args__ = S

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    card_ref: Mapped[str] = mapped_column(Text)
    rating: Mapped[int] = mapped_column(SmallInteger)
    confidence: Mapped[str | None] = mapped_column(Text)
    state_before: Mapped[int] = mapped_column(SmallInteger)
    elapsed_days: Mapped[float] = mapped_column(Float)
    scheduled_days: Mapped[float] = mapped_column(Float)
    stability_after: Mapped[float] = mapped_column(Float)
    difficulty_after: Mapped[float] = mapped_column(Float)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    context: Mapped[str | None] = mapped_column(Text)
    reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)


class FsrsParams(Base):
    __tablename__ = "fsrs_params"
    __table_args__ = S

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    weights: Mapped[list[float]] = mapped_column(ARRAY(Float))
    desired_retention: Mapped[float] = mapped_column(Float, default=0.9)
    review_count: Mapped[int] = mapped_column(Integer)
    optimised_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class QuestionAttempt(Base):
    __tablename__ = "question_attempts"
    __table_args__ = S

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    question_id: Mapped[str] = mapped_column(Text)
    context: Mapped[str] = mapped_column(Text)
    session_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    attempt_no: Mapped[int] = mapped_column(SmallInteger, default=1)
    difficulty_shown: Mapped[str | None] = mapped_column(Text)
    answer: Mapped[Any] = mapped_column(JSONB)
    is_correct: Mapped[bool] = mapped_column(Boolean)
    time_ms: Mapped[int] = mapped_column(Integer)
    confidence: Mapped[str | None] = mapped_column(Text)
    mistake_type: Mapped[str | None] = mapped_column(Text)
    hints_used: Mapped[int] = mapped_column(SmallInteger, default=0)
    answered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)


class PracticeSession(Base):
    __tablename__ = "practice_sessions"
    __table_args__ = S

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    kind: Mapped[str] = mapped_column(Text)
    spec: Mapped[dict[str, Any]] = mapped_column(JSONB)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    answered: Mapped[int] = mapped_column(SmallInteger, default=0)
    correct: Mapped[int] = mapped_column(SmallInteger, default=0)


class SyncEvent(Base):
    __tablename__ = "sync_events"
    __table_args__ = S

    event_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    device_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    type: Mapped[str] = mapped_column(Text)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    tz: Mapped[str | None] = mapped_column(Text)
    local_day: Mapped[date] = mapped_column(Date)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(Text)
    reject_code: Mapped[str | None] = mapped_column(Text)
    state_version: Mapped[int | None] = mapped_column(BigInteger)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class SrsTombstone(Base):
    __tablename__ = "srs_tombstones"
    __table_args__ = S

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    card_ref: Mapped[str] = mapped_column(Text, primary_key=True)
    sync_version: Mapped[int] = mapped_column(BigInteger)
    deleted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
