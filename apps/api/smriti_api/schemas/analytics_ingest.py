"""``POST /v1/analytics/events`` (packages/analytics ``httpTransport``: ``{"events": [...]}``)."""

from __future__ import annotations

import uuid
from typing import Annotated, Any, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

MAX_EVENTS = 100
MAX_BODY_BYTES = 256 * 1024

Token = Annotated[str, Field(max_length=64, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]*$")]


class EventContext(BaseModel):
    """The client's common props (packages/analytics ``CommonContext``). Anything else is dropped.
    ``is_guest`` and the audience come from the session and profile, never from here."""

    model_config = ConfigDict(extra="ignore")

    platform: Literal["ios", "android", "web"]
    app_variant: Token
    app_version: Token | None = None
    locale: Literal["en", "hi"]
    exam_profile: Token | None = None
    tier: Literal["free", "pro"] | None = None


class EventIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    event_id: uuid.UUID
    name: Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_]*$")]
    occurred_at: AwareDatetime
    # Checked prop by prop against the catalogue; anything else is dropped before storage.
    props: dict[str, Any] = Field(default_factory=dict, max_length=64)
    context: EventContext


class EventBatchIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    events: Annotated[list[EventIn], Field(min_length=1, max_length=MAX_EVENTS)]


DropReason = Literal[
    "unknown_event",
    "server_only",
    "minor_not_allowed",
    "little_learner_not_allowed",
    "opted_out",
    "awaiting_consent",
    "too_old",
    "in_the_future",
    "duplicate_in_batch",
]


class Dropped(BaseModel):
    event_id: uuid.UUID
    reason: DropReason


class PropIssue(BaseModel):
    """A prop that was removed: its name and why (never its value)."""

    event_id: uuid.UUID
    prop: str
    code: Literal[
        "blocked_name",
        "unknown_prop",
        "free_text",
        "bad_type",
        "unknown_enum_value",
        "too_many_items",
        "stripped_for_minor",
    ]


class EventBatchOut(BaseModel):
    accepted: list[uuid.UUID]
    dropped: list[Dropped]
    issues: list[PropIssue]
