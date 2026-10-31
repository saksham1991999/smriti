"""Voice tutor, read-aloud, dictation and Feynman models (tutor-social §A6, §A8, §A9; TRD §9.4)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

from smriti_api.schemas.practice import QuotaOut
from smriti_api.schemas.tutor import ContextRef

ConceptId = Annotated[str, Field(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9._:-]+$")]
EndReason = Literal["user", "session_cap", "daily_cap", "network", "background", "phone_call"]
VoiceTool = Literal[
    "look_up_concept", "show_formula", "queue_cards", "get_mastery", "make_flashcard"
]


# --- voice ---------------------------------------------------------------------------------------


class VoiceSessionCreate(BaseModel):
    client_session_id: uuid.UUID = Field(
        description="Client UUID; asking again with the same id mints a fresh token (reconnect)"
    )
    context_ref: ContextRef | None = None
    exam: Annotated[str, Field(max_length=200)] | None = None


class ToolDeclaration(BaseModel):
    name: str
    description: str
    parameters: dict[str, Any]


class VoiceQuota(BaseModel):
    """AI-13 shows the remaining daily time. ``available`` is false with a ``reason`` when voice
    can't start for this student right now."""

    available: bool
    reason: str | None = None
    daily_seconds: int | None
    used_seconds: int
    remaining_seconds: int | None
    session_max_seconds: int | None
    reconnect_seconds: int | None
    background_grace_seconds: int | None
    resets_at: datetime


class VoiceSessionOut(BaseModel):
    id: uuid.UUID
    tutor_session_id: uuid.UUID
    token: str = Field(description="Single-use Gemini Live token; never stored by the server")
    token_expires_at: datetime
    provider: str
    model: str = Field(description="From GEMINI_LIVE_MODEL (config), for the client's connect call")
    max_seconds: int = Field(description="This session ends at this many seconds of talk")
    warn_at_seconds: int = Field(description="Show the 'about 2 minutes left' banner here")
    locale: str
    tools: list[ToolDeclaration]
    resumed: bool = False
    quota: VoiceQuota


class ToolCallIn(BaseModel):
    call_id: Annotated[str, Field(min_length=1, max_length=128)]
    name: VoiceTool
    args: dict[str, Any] = Field(default_factory=dict)


class ToolCallOut(BaseModel):
    call_id: str
    name: VoiceTool
    result: dict[str, Any] = Field(description="Send back to Gemini Live as the function response")


class TranscriptTurn(BaseModel):
    role: Literal["student", "tutor"]
    text: Annotated[str, Field(max_length=4000)]
    at_ms: Annotated[int, Field(ge=0, le=86_400_000)] = 0


class VoiceSessionEnd(BaseModel):
    seconds: Annotated[int, Field(ge=0, le=86_400)]
    end_reason: EndReason = "user"
    flashcards_made: Annotated[int, Field(ge=0, le=500)] = 0
    turns: Annotated[list[TranscriptTurn], Field(max_length=2000)] = Field(default_factory=list)


class VoiceSummary(BaseModel):
    """AI-15."""

    id: uuid.UUID
    tutor_session_id: uuid.UUID | None
    context_ref: str | None
    started_at: datetime
    ended_at: datetime | None
    seconds: int | None
    flashcards_made: int
    has_transcript: bool
    status: str
    safety: dict[str, Any] | None = Field(
        default=None, description="Present when the transcript showed a crisis signal"
    )


class VoiceTranscript(BaseModel):
    session_id: uuid.UUID
    locale: str | None
    turns: list[TranscriptTurn]


# --- read-aloud and dictation --------------------------------------------------------------------


class ReadAloudIn(BaseModel):
    text: Annotated[str, Field(min_length=1, max_length=3000)]
    locale: Literal["en", "hi"]


class ReadAloudOut(BaseModel):
    url: str = Field(description="Signed, short-lived link to the audio")
    mime: str
    cached: bool
    quota: QuotaOut


class DictationOut(BaseModel):
    text: str
    confidence: float | None
    quota: QuotaOut


# --- Feynman -------------------------------------------------------------------------------------


class FeynmanIn(BaseModel):
    client_attempt_id: uuid.UUID
    concept_id: ConceptId
    explanation: Annotated[str, Field(min_length=1, max_length=4000)]
    input_mode: Literal["text", "voice"] = "text"
    follow_up_of: uuid.UUID | None = Field(
        default=None, description="The score this answers a follow-up question of"
    )


class KeyPointOut(BaseModel):
    index: int
    text: dict[str, str]
    status: Literal["covered", "missing", "misconception"]
    note: str | None = None


class FeynmanOut(BaseModel):
    """AI-11: three meters (0-100), the key points with their status, follow-ups, and the last
    score for this concept when one exists (never a made-up comparison)."""

    id: uuid.UUID
    session_id: uuid.UUID
    concept_id: str
    attempt_no: int
    clarity: int
    completeness: int
    accuracy: int
    key_points: list[KeyPointOut]
    follow_ups: list[str]
    previous: dict[str, int] | None
    mastery_delta: float
    status: Literal["graded", "crisis", "refused"] = "graded"
    safety: dict[str, Any] | None = None
    quota: QuotaOut
