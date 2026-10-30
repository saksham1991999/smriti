"""`content` schema (DB_SCHEMA §4): the catalogue projection the API reads."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import Boolean, DateTime, Integer, Numeric, SmallInteger, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from smriti_api.models.base import Base

S = {"schema": "content"}


class Exam(Base):
    __tablename__ = "exams"
    __table_args__ = S

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[dict[str, str]] = mapped_column(JSONB)
    category: Mapped[str] = mapped_column(Text)
    conducting_body: Mapped[str | None] = mapped_column(Text)
    official_url: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class ExamProfile(Base):
    __tablename__ = "exam_profiles"
    __table_args__ = S

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    exam_id: Mapped[str] = mapped_column(Text)
    cycle: Mapped[str] = mapped_column(Text)
    name: Mapped[dict[str, str]] = mapped_column(JSONB)
    locales: Mapped[list[str]] = mapped_column(ARRAY(Text))
    schedule: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Subject(Base):
    __tablename__ = "subjects"
    __table_args__ = S

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[dict[str, str]] = mapped_column(JSONB)
    color_token: Mapped[str] = mapped_column(Text)
    icon_asset_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    sort: Mapped[int] = mapped_column(SmallInteger)


class Unit(Base):
    __tablename__ = "units"
    __table_args__ = S

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    subject_id: Mapped[str] = mapped_column(Text)
    name: Mapped[dict[str, str]] = mapped_column(JSONB)
    sort: Mapped[int] = mapped_column(SmallInteger)


class Chapter(Base):
    __tablename__ = "chapters"
    __table_args__ = S

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    unit_id: Mapped[str] = mapped_column(Text)
    subject_id: Mapped[str] = mapped_column(Text)
    name: Mapped[dict[str, str]] = mapped_column(JSONB)
    ncert_ref: Mapped[str | None] = mapped_column(Text)
    sort: Mapped[int] = mapped_column(SmallInteger)


class Topic(Base):
    __tablename__ = "topics"
    __table_args__ = S

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    chapter_id: Mapped[str] = mapped_column(Text)
    name: Mapped[dict[str, str]] = mapped_column(JSONB)
    summary: Mapped[dict[str, str] | None] = mapped_column(JSONB)
    sort: Mapped[int] = mapped_column(SmallInteger)


class Subtopic(Base):
    __tablename__ = "subtopics"
    __table_args__ = S

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    topic_id: Mapped[str] = mapped_column(Text)
    name: Mapped[dict[str, str]] = mapped_column(JSONB)
    sort: Mapped[int] = mapped_column(SmallInteger)


class Concept(Base):
    __tablename__ = "concepts"
    __table_args__ = S

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    subtopic_id: Mapped[str] = mapped_column(Text)
    name: Mapped[dict[str, str]] = mapped_column(JSONB)
    summary: Mapped[dict[str, str]] = mapped_column(JSONB)
    key_points: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    kind: Mapped[str] = mapped_column(Text)
    intrinsic_depth: Mapped[int] = mapped_column(SmallInteger)
    sort: Mapped[int] = mapped_column(SmallInteger)


class ExamConcept(Base):
    __tablename__ = "exam_concepts"
    __table_args__ = S

    exam_profile_id: Mapped[str] = mapped_column(Text, primary_key=True)
    concept_id: Mapped[str] = mapped_column(Text, primary_key=True)
    depth: Mapped[int] = mapped_column(SmallInteger)
    weightage: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    priority: Mapped[str] = mapped_column(Text, default="core")


class ContentItem(Base):
    __tablename__ = "content_items"
    __table_args__ = S

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    kind: Mapped[str] = mapped_column(Text)
    topic_id: Mapped[str | None] = mapped_column(Text)
    mode: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text)
    current_version: Mapped[int] = mapped_column(Integer, default=1)
    is_free: Mapped[bool] = mapped_column(Boolean, default=False)
    source_path: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Bundle(Base):
    __tablename__ = "bundles"
    __table_args__ = S

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    topic_id: Mapped[str] = mapped_column(Text)
    mode: Mapped[str] = mapped_column(Text)
    locale: Mapped[str] = mapped_column(Text)
    hash: Mapped[str] = mapped_column(Text)
    size_bytes: Mapped[int] = mapped_column(Integer)
    card_count: Mapped[int] = mapped_column(SmallInteger)
    min_app_version: Mapped[str] = mapped_column(Text)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class BundlePatch(Base):
    __tablename__ = "bundle_patches"
    __table_args__ = S

    bundle_id: Mapped[str] = mapped_column(Text, primary_key=True)
    from_hash: Mapped[str] = mapped_column(Text, primary_key=True)
    to_hash: Mapped[str] = mapped_column(Text, primary_key=True)
    size_bytes: Mapped[int] = mapped_column(Integer)


class Manifest(Base):
    __tablename__ = "manifests"
    __table_args__ = S

    exam_profile_id: Mapped[str] = mapped_column(Text, primary_key=True)
    locale: Mapped[str] = mapped_column(Text, primary_key=True)
    version: Mapped[int] = mapped_column(Integer, primary_key=True)
    hash: Mapped[str] = mapped_column(Text)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
