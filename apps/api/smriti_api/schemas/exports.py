"""PDF exports (me-money §3.9 ME-22/ME-23; TRD §5.1 "Exports")."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

TopicId = Annotated[str, Field(min_length=1, max_length=120, pattern=r"^[a-z0-9][a-z0-9._-]*$")]


class PdfExportCreate(BaseModel):
    # formula_sheet: the formula and summary cards of the picked topics (published content only,
    # nothing new is written for the book). progress_report: the student's own numbers.
    template: Literal["formula_sheet", "progress_report"]
    topic_ids: Annotated[list[TopicId], Field(max_length=40)] = []
    language: Literal["en", "hi", "both"] = "en"


class ExportOut(BaseModel):
    id: uuid.UUID
    kind: Literal["pdf_book", "data_export"]
    template: str | None
    status: Literal["queued", "rendering", "ready", "failed", "expired"]
    pages: int | None
    bytes: int | None
    requested_at: datetime
    completed_at: datetime | None
    expires_at: datetime | None
    # A short-lived signed link, only when ready.
    url: str | None


class ExportList(BaseModel):
    exports: list[ExportOut]
