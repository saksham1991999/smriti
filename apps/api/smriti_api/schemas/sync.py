"""Wire format of docs/contracts/sync.md. These models are the OpenAPI source of truth."""

from __future__ import annotations

import unicodedata
import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_EVENTS_PER_BATCH = 200

EVENT_TYPES = (
    "lesson_started",
    "lesson_card_viewed",
    "answer_submitted",
    "lesson_completed",
    "review_rated",
    "practice_session_completed",
    "daily_challenge_completed",
    "mock_section_submitted",
    "pet_care",
    "pet_named",
    "plant_seeded",
    "onboarding_answer",
    "settings_changed",
    "deck_card_upserted",
    "deck_card_deleted",
    "focus_session_completed",
    "quest_claimed",
    "freeze_equipped",
    "rescue_completed",
    "cards_queued",
    "comeback_plan_started",
)

SETTINGS_KEYS = (
    "sound",
    "haptics",
    "reduced_motion",
    "theme",
    "mock_dark_mode",
    "content_locale",
    "tutor_locale",
    "analytics_opt_out",
    "start_mode",
    "name_display",
)

Confidence = Literal["sure", "fifty_fifty", "guess"]
Locale = Literal["en", "hi"]
Id = Annotated[str, Field(min_length=1, max_length=200)]
Ms = Annotated[int, Field(ge=0, le=24 * 3600 * 1000)]
Count = Annotated[int, Field(ge=0, le=10_000)]


class _Payload(BaseModel):
    model_config = ConfigDict(extra="ignore")


class LessonStarted(_Payload):
    topic_id: Id
    mode: Literal["deep_dive", "quick_revision", "onboarding", "quick_check"]
    bundle_version: Annotated[str, Field(min_length=1, max_length=128)]
    locale: Locale


class LessonCardViewed(_Payload):
    topic_id: Id
    card_id: Id
    index: Annotated[int, Field(ge=0, le=10_000)]
    ms_on_card: Ms


# A response is option ids, a number or a text key, never free text typed by the student.
ResponseKey = Annotated[str, Field(max_length=64, pattern=r"^[A-Za-z0-9_.:\-]*$")]


class AnswerSubmitted(_Payload):
    topic_id: Id | None = None
    card_id: Id | None = None
    question_id: Id | None = None
    # ``mock`` answers are recorded by the server when an attempt is submitted (v1.3).
    context: Literal["lesson", "practice", "review", "challenge", "chapter_test", "mock"]
    response: list[ResponseKey] | ResponseKey | float | int | None = None
    correct: bool
    attempt: Literal[1, 2] = 1
    confidence: Confidence | None = None
    ms_to_answer: Ms
    # The submitted mock attempt the answer belongs to; required with ``context: mock``.
    attempt_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _needs_target(self) -> AnswerSubmitted:
        if not self.card_id and not self.question_id:
            raise ValueError("card_id or question_id is required")
        if self.context == "mock" and (self.attempt_id is None or not self.question_id):
            raise ValueError("a mock answer needs attempt_id and question_id")
        return self


class LessonCompleted(_Payload):
    topic_id: Id
    mode: Literal["deep_dive", "quick_revision", "onboarding", "quick_check"]
    cards_seen: Count
    correct: Count
    total: Count
    ms_total: Ms
    xp: int | None = None  # the client's prediction; the server recomputes


class FsrsStateIn(_Payload):
    due: datetime | None = None
    stability: float | None = None
    difficulty: float | None = None
    elapsed_days: float | None = None
    scheduled_days: float | None = None
    reps: int | None = None
    lapses: int | None = None
    state: int | None = None


CARD_REF_PATTERN = r"^(c|d|q|u):[A-Za-z0-9_.:\-]{1,200}$"


def normalize_card_ref(ref: str) -> str:
    """``u:`` is accepted as an alias of ``d:`` (sync contract v1.1); only ``d:`` is stored."""
    return "d:" + ref[2:] if ref.startswith("u:") else ref


class ReviewRated(_Payload):
    card_ref: Annotated[str, Field(pattern=CARD_REF_PATTERN)]
    rating: Literal[1, 2, 3, 4]
    confidence: Confidence | None = None
    ms_to_answer: Ms
    fsrs_state: FsrsStateIn | None = None  # ignored: the server replays the history

    @field_validator("card_ref")
    @classmethod
    def _alias(cls, v: str) -> str:
        return normalize_card_ref(v)


class PracticeSessionCompleted(_Payload):
    session_id: uuid.UUID
    kind: Literal["drill", "pyq", "weak_spots"]
    answered: Count
    correct: Count
    ms_total: Ms


class DailyChallengeCompleted(_Payload):
    challenge_date: date
    score: Annotated[int, Field(ge=0, le=10_000)]
    ms_total: Ms


class MockSectionSubmitted(_Payload):
    attempt_id: uuid.UUID
    section_code: Annotated[str, Field(min_length=1, max_length=64)]


class PetCare(_Payload):
    action: Literal["pet", "feed", "play"]
    item_id: Id | None = None


def validate_display_text(value: str, *, min_len: int, max_len: int) -> str:
    """Letters (any script, with combining marks) and single spaces only; no digits or symbols."""
    cleaned = " ".join(value.split())
    if not min_len <= len(cleaned) <= max_len:
        raise ValueError(f"must be {min_len} to {max_len} characters")
    for ch in cleaned:
        cat = unicodedata.category(ch)
        if not (ch == " " or cat.startswith("L") or cat.startswith("M")):
            raise ValueError("only letters and spaces are allowed")
    return cleaned


class PetNamed(_Payload):
    species: Literal["cat", "dog"]
    name: str

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return validate_display_text(v, min_len=1, max_len=12)


class PlantSeeded(_Payload):
    pass


class OnboardingAnswer(_Payload):
    step: Literal["goal", "class", "birth_year", "exam_date", "level", "daily_goal", "reminder"]
    value: Any = None


class SettingsChanged(_Payload):
    key: Literal[
        "sound",
        "haptics",
        "reduced_motion",
        "theme",
        "mock_dark_mode",
        "content_locale",
        "tutor_locale",
        "analytics_opt_out",
        "start_mode",
        "name_display",
    ]
    value: bool | str | int | None


CardText = Annotated[str, Field(max_length=4000)]


class DeckCardUpserted(_Payload):
    user_card_id: uuid.UUID
    deck_id: uuid.UUID
    front: CardText | dict[str, Any]
    back: CardText | dict[str, Any]


class DeckCardDeleted(_Payload):
    user_card_id: uuid.UUID


class FocusSessionCompleted(_Payload):
    minutes: Annotated[int, Field(ge=1, le=600)]
    rounds: Annotated[int, Field(ge=0, le=100)]


class QuestClaimed(_Payload):
    quest_id: Id


class FreezeEquipped(_Payload):
    slot: Annotated[int, Field(ge=0, le=10)] = 0


# The three v1.1 events are accepted in both shapes in use: the one in docs/contracts/sync.md
# and the one packages/app-core sends (src/sync/types.ts). Only ids and counts, never text.


class RescueCompleted(_Payload):
    """The 2-minute rescue (R23): waters the plant for the day, never a streak day."""

    cards: Count
    ms_total: Ms | None = None
    reached_qualify: bool | None = None


ConceptId = Annotated[str, Field(pattern=r"^[A-Za-z0-9_.:\-]{1,200}$")]
CardRef = Annotated[str, Field(pattern=CARD_REF_PATTERN)]


class CardsQueued(_Payload):
    """memory-labs §5.14 "add cards to reviews". ``card_refs`` are the cards the client queued
    (new ones start due now; started ones are pulled into the queue); ``concept_ids`` say why."""

    source: Literal["lesson", "practice", "comeback", "mock_report", "practice_summary", "solution"]
    concept_ids: Annotated[list[ConceptId], Field(max_length=200)] = Field(default_factory=list)
    card_refs: Annotated[list[CardRef], Field(max_length=500)] = Field(default_factory=list)

    @field_validator("card_refs")
    @classmethod
    def _aliases(cls, v: list[str]) -> list[str]:
        return [normalize_card_ref(r) for r in v]

    @model_validator(mode="after")
    def _not_empty(self) -> CardsQueued:
        if not self.concept_ids and not self.card_refs:
            raise ValueError("concept_ids or card_refs is required")
        return self


class ComebackPlanStarted(_Payload):
    """memory-labs §5.2: mirrors the comeback plan so a second device shows the same plan."""

    days_away: Annotated[int, Field(ge=0, le=3650)] | None = None
    cards: Count | None = None
    start_day: date | None = None
    plan_days: Annotated[int, Field(ge=1, le=60)] | None = None
    daily_chunk: Annotated[int, Field(ge=0, le=1000)] | None = None
    relearn_topics: Annotated[list[Id], Field(max_length=100)] = Field(default_factory=list)


PAYLOAD_MODELS: dict[str, type[_Payload]] = {
    "lesson_started": LessonStarted,
    "lesson_card_viewed": LessonCardViewed,
    "answer_submitted": AnswerSubmitted,
    "lesson_completed": LessonCompleted,
    "review_rated": ReviewRated,
    "practice_session_completed": PracticeSessionCompleted,
    "daily_challenge_completed": DailyChallengeCompleted,
    "mock_section_submitted": MockSectionSubmitted,
    "pet_care": PetCare,
    "pet_named": PetNamed,
    "plant_seeded": PlantSeeded,
    "onboarding_answer": OnboardingAnswer,
    "settings_changed": SettingsChanged,
    "deck_card_upserted": DeckCardUpserted,
    "deck_card_deleted": DeckCardDeleted,
    "focus_session_completed": FocusSessionCompleted,
    "quest_claimed": QuestClaimed,
    "freeze_equipped": FreezeEquipped,
    "rescue_completed": RescueCompleted,
    "cards_queued": CardsQueued,
    "comeback_plan_started": ComebackPlanStarted,
}


class SyncEventIn(BaseModel):
    event_id: uuid.UUID
    type: Annotated[str, Field(min_length=1, max_length=64)]
    occurred_at: AwareDatetime
    tz: Annotated[
        str,
        Field(
            min_length=1,
            max_length=64,
            description="IANA zone of the device when the event happened; places it on the local day",
        ),
    ]
    payload: dict[str, Any] = Field(default_factory=dict)


class SyncEventsRequest(BaseModel):
    device_id: uuid.UUID
    events: Annotated[list[SyncEventIn], Field(max_length=MAX_EVENTS_PER_BATCH)]


class RejectedEvent(BaseModel):
    event_id: uuid.UUID
    code: str
    detail: str | None = None


class SyncEventsResponse(BaseModel):
    accepted: list[uuid.UUID]
    rejected: list[RejectedEvent]
    state_version: int


# ---------------------------------------------------------------------------------------------
# GET /v1/sync/state


class ProfileState(BaseModel):
    id: uuid.UUID
    display_name: str | None
    locale: str
    is_guest: bool
    age_band: str | None
    exam_profile_ids: list[str]
    daily_goal_minutes: int
    timezone: str
    primary_exam_profile_id: str | None
    settings: dict[str, Any]
    onboarding_completed: bool


class StreakState(BaseModel):
    current: int
    longest: int
    today_qualified: bool
    freezes_equipped: int
    freezes_available: int
    rest_day: date | None
    at_risk: bool


class PlantState(BaseModel):
    stage: Literal["seed", "sprout", "sapling", "flowering", "tree"]
    health: Literal["thriving", "droopy", "dry", "wilted", "dormant"]
    study_days: int
    next_stage_at: int | None
    revival_progress: int = 0
    revival_target: int | None = None
    # The same number under the name packages/app-core reads (PlantSection.revival_days).
    revival_days: int | None = None
    species: str = "tulsi"


class PetState(BaseModel):
    species: Literal["cat", "dog"]
    name: str
    mood: int
    energy: int
    state: str


class WalletState(BaseModel):
    xp_total: int
    xp_today: int
    gems: int


class SrsCardState(BaseModel):
    card_ref: str
    due: datetime
    stability: float
    difficulty: float
    state: int
    reps: int
    lapses: int
    last_review: datetime | None


class SrsState(BaseModel):
    cards: list[SrsCardState]
    deleted: list[str]


class TopicProgressState(BaseModel):
    topic_id: str
    status: Literal["not_started", "in_progress", "learned"]
    percent: int


class EntitlementState(BaseModel):
    plan: Literal["free", "pro"]
    pro_until: datetime | None


class SyncStateResponse(BaseModel):
    """Sections that did not change since ``since`` are omitted."""

    state_version: int
    profile: ProfileState | None = None
    streak: StreakState | None = None
    plant: PlantState | None = None
    pet: PetState | None = None
    wallet: WalletState | None = None
    srs: SrsState | None = None
    topic_progress: list[TopicProgressState] | None = None
    entitlement: EntitlementState | None = None
