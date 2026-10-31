"""Live mocks (Phase 3, practice §6.11)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

LiveStatus = Literal["scheduled", "room_open", "live", "closed", "results"]


class LiveRoom(BaseModel):
    """MOCK-03. Times are the server's; ``server_time`` gives the client its clock offset."""

    mock_id: str
    title: dict[str, str]
    status: LiveStatus
    server_time: datetime
    window_start: datetime
    window_end: datetime
    results_at: datetime | None
    room_opens_at: datetime = Field(description="window_start minus live.room_lead_min")
    duration_s: int | None
    full_duration_until: datetime | None = Field(
        description="Start by this time for the full duration; later starts end at window_end"
    )
    deadline_if_started_now: datetime | None
    can_start: bool
    registered: bool
    registrations: int
    attempt_id: uuid.UUID | None
    attempt_status: str | None
    ranks_published: bool
    channel: str = Field(description="Supabase Realtime channel (start, clock, results)")
    events_url: str = Field(description="Server-Sent Events fallback for the same events")


class Registration(BaseModel):
    mock_id: str
    registered: bool
    reminder_at: datetime | None = Field(
        description="When the mock_reminder push is due (the room opening)"
    )


class LiveLeaderboardRow(BaseModel):
    rank: int
    name: str | None = Field(description="Adults: display name. Minors: auto nickname (R31)")
    avatar: str | None
    is_you: bool
    score: float
    percentile: float | None


class LiveLeaderboard(BaseModel):
    mock_id: str
    published: bool
    reason: Literal["results_pending", "threshold_unset", "below_threshold"] | None = None
    ranked: int
    rows: list[LiveLeaderboardRow]
    you: LiveLeaderboardRow | None
