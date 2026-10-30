"""SQLAlchemy declarative base. The schema itself lives in supabase/migrations; these models
mirror it column for column for the tables the API touches, and tests/test_model_drift.py
fails when they drift."""

from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
