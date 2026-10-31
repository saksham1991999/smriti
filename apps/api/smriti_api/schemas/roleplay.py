"""AI-21 role play (tutor-social §A11): a chat with a lesson's role-play character."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, model_validator

from smriti_api.schemas.practice import QuotaOut
from smriti_api.schemas.tutor import MAX_INPUT_CHARS

CardId = Annotated[str, Field(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9_.:-]+$")]


class RoleplayStart(BaseModel):
    """Starts the chat for a role-play card, or returns the open one for it."""

    card_id: CardId


class RoleplayTurnIn(BaseModel):
    """One student turn: a tap on a suggested reply (``reply_index``) or typed ``text``.
    Under-13s and little learners send replies only. ``client_message_id`` makes a retry safe."""

    client_message_id: uuid.UUID
    text: Annotated[str, Field(min_length=1, max_length=MAX_INPUT_CHARS)] | None = None
    reply_index: Annotated[int, Field(ge=0, le=2)] | None = None

    @model_validator(mode="after")
    def _one(self) -> RoleplayTurnIn:
        if (self.text is None) == (self.reply_index is None):
            raise ValueError("send text or reply_index")
        return self


class RoleplayMessage(BaseModel):
    id: uuid.UUID
    role: Literal["student", "character"]
    text: str
    created_at: datetime


class SummaryConcept(BaseModel):
    id: str
    name: dict[str, str]


class RoleplaySummary(BaseModel):
    """The end card: the goals the student met, as "What you found out", with the card's
    concepts as chips. Both come from the published script, never from the model."""

    found_out: list[dict[str, str]]
    concepts: list[SummaryConcept]


class RoleplayChat(BaseModel):
    session_id: uuid.UUID
    card_id: str
    status: Literal["open", "ended"]
    end_reason: Literal["goals_met", "turn_cap", "wrap_up"] | None = None
    turns: int
    max_turns: int | None = Field(description="Student turns per chat; null when no cap is set")
    goals_total: int
    goals_met: list[int] = Field(description="Indexes into the card's goals")
    messages: list[RoleplayMessage]
    summary: RoleplaySummary | None = None


class RoleplayTurnOut(RoleplayChat):
    """``step_out`` is set when the character stepped out of the story (the student asked for
    something unsafe or off-topic): the app shows the pet line and [Back to the story]. ``safety``
    carries the crisis card's helplines. Pro turns report the shared fair-use ``quota``."""

    step_out: bool = False
    safety: Literal["crisis"] | None = None
    helplines: list[dict[str, Any]] = Field(default_factory=list)
    quota: QuotaOut | None = None
