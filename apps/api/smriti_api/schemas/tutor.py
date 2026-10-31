"""AI tutor and content-report models (docs/flows/tutor-social.md §A5 to §A14, SET-24)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, field_validator

from smriti_api.schemas.practice import AnswerIn, QuotaOut

ContextRef = Annotated[
    str, Field(min_length=3, max_length=300, pattern=r"^(card|question|topic|concept|lab):[^\s]+$")
]
# The schema cap; the owner's ``tutor.max_input_chars`` flag can lower it (tutor-social §A13).
MAX_INPUT_CHARS = 4000
FeedbackReason = Literal[
    "wrong", "confusing", "too_long", "didnt_answer", "wrong_language", "not_suitable"
]


class SessionCreate(BaseModel):
    mode: Literal["chat"] = "chat"
    context_ref: ContextRef | None = None
    exam: Annotated[str, Field(max_length=200)] | None = None


class ContextOut(BaseModel):
    """What the tutor can see, for the context chip (tutor-social §A5 step 1)."""

    kind: Literal["card", "question", "topic", "concept", "lab", "doubt"]
    ref: str
    topic_id: str | None = None
    title: dict[str, str] | None = None


class MessageOut(BaseModel):
    id: uuid.UUID
    role: Literal["user", "assistant"]
    content: str
    status: Literal["ok", "stopped", "refused", "crisis", "error"]
    citations: list[dict[str, Any]] = Field(default_factory=list)
    created_at: datetime


class TutorSession(BaseModel):
    id: uuid.UUID
    mode: str
    context: ContextOut | None
    exam_profile_id: str | None
    locale: str
    started_at: datetime
    last_message_at: datetime | None
    message_count: int
    resumed: bool = False
    messages: list[MessageOut] = Field(default_factory=list)
    quota: QuotaOut


class SessionSummary(BaseModel):
    id: uuid.UUID
    mode: str
    context_ref: str | None
    started_at: datetime
    last_message_at: datetime | None
    message_count: int


class MessageIn(BaseModel):
    # The client's id for the student's message: a retry with the same id never counts twice.
    client_message_id: uuid.UUID
    text: str = Field(min_length=1, max_length=MAX_INPUT_CHARS)
    input: Literal["typed", "chip", "prefill"] = "typed"
    chip_id: Annotated[str, Field(max_length=40)] | None = None

    @field_validator("text")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("text is blank")
        return value


class AskCard(MessageIn):
    """ask-about-this-card (LES-04, MEM-03 back side)."""

    card_id: Annotated[str, Field(min_length=1, max_length=200)]
    exam: Annotated[str, Field(max_length=200)] | None = None


class AskQuestion(MessageIn):
    """ask-about-this-question (LES-02 after Check, PRC-05, MOCK-22 after submit)."""

    question_id: Annotated[str, Field(min_length=1, max_length=200)]
    exam: Annotated[str, Field(max_length=200)] | None = None
    # The student's own answer, for "Why is my answer wrong?". Checked on the server.
    your_answer: AnswerIn | None = None


DoubtStatus = Literal["read", "unreadable", "rejected", "solved"]
DoubtReason = Literal[
    "blurry",
    "no_question",
    "multiple",
    "unreadable",
    "not_study",
    "personal",
    "unsafe",
    "ai_unavailable",
]


class DoubtPhotoOut(BaseModel):
    """AI-18: what the vision model read from the photo, for the student to check or edit.
    ``reason`` says why nothing usable was read (the app shows Retake)."""

    id: uuid.UUID
    status: DoubtStatus
    reason: DoubtReason | None = None
    question_text: str | None = None
    subject: str | None = None
    session_id: uuid.UUID | None = None
    created_at: datetime


class DoubtSolve(MessageIn):
    """AI-19: solve the confirmed question as a tutor chat (SSE, the tutor's events). ``text`` is
    the student's message (the confirmed question or a chip); ``question_text`` saves an edit
    from AI-18 first; ``reveal`` is "Show full solution" (hints first until then)."""

    question_text: Annotated[str, Field(min_length=1, max_length=MAX_INPUT_CHARS)] | None = None
    reveal: bool = False
    exam: Annotated[str, Field(max_length=200)] | None = None


class FeedbackIn(BaseModel):
    rating: Literal["up", "down"]
    reasons: list[FeedbackReason] = Field(default_factory=list, max_length=6)


class FeedbackOut(BaseModel):
    message_id: uuid.UUID
    rating: Literal["up", "down"]
    reasons: list[str]
    queued_for_review: bool


ReportKind = Literal[
    "lesson_card",
    "question",
    "review_card",
    "solution",
    "tutor_message",
    "generated_image",
    "story_page",
    "roleplay_turn",
    "community_mnemonic",
    "lab",
    "album_card",
]
ReportReason = Literal["wrong", "unclear", "typo", "translation", "offensive", "spam", "other"]


class ContentReportIn(BaseModel):
    """SET-24 Report content: one sheet for lesson, question, AI and community content (R39)."""

    kind: ReportKind
    item_ref: Annotated[str, Field(min_length=1, max_length=300)]
    reason: ReportReason
    bundle_hash: Annotated[str, Field(max_length=128)] | None = None
    locale: Literal["en", "hi"] | None = None
    # Stored on the report for the content team; never logged or sent to analytics.
    note: Annotated[str, Field(max_length=280)] | None = None


class ContentReportOut(BaseModel):
    id: uuid.UUID
    kind: ReportKind
    item_ref: str
    reason: ReportReason
    status: Literal["open", "accepted", "fixed", "rejected"]
    created_at: datetime
