"""Tutor image models ("Draw it" and the voice board; tutor-social §A5 step 6, §A9 step 4)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ImageStatus = Literal["pending", "ready", "failed", "blocked"]
ImageReason = Literal[
    "policy", "busy", "ai_unavailable", "failed", "pro_required", "not_for_age", "limit_reached"
]


class GenerationOut(BaseModel):
    """One tutor picture. Poll while ``pending`` (the SSE ``image_ready`` event may never reach a
    closed sheet). ``url`` is a short-lived signed link, set only when ``ready``: ask again after
    ``url_expires_at``."""

    id: uuid.UUID
    kind: Literal["image"] = "image"
    source: Literal["tutor_chat", "voice_board"]
    status: ImageStatus
    reason: ImageReason | None = None
    origin: Literal["index", "cache", "generated"] | None = Field(
        default=None, description="An approved index image, a cached picture, or a new one"
    )
    alt: str
    locale: str
    url: str | None = None
    url_expires_at: datetime | None = None
    message_id: uuid.UUID | None = None
    tutor_session_id: uuid.UUID | None = None
    can_retry: bool = Field(description="[Try again] is offered once after a failure")
    created_at: datetime
    finished_at: datetime | None = None


class MessageImage(BaseModel):
    """A picture attached to a tutor answer; fetch the link from ``GET /v1/ai/generations/{id}``."""

    generation_id: uuid.UUID
    status: ImageStatus
    alt: str
