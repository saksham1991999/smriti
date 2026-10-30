"""Request and response models for the REST endpoints other than sync. They are the OpenAPI
source that ``packages/api-client`` is generated from."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from smriti_api.schemas.sync import (
    SETTINGS_KEYS,
    EntitlementState,
    PetState,
    PlantState,
    ProfileState,
    StreakState,
    WalletState,
    validate_display_text,
)

I18nText = dict[str, str]
"""Content text in both languages: ``{"en": ..., "hi": ...}``."""


class Ok(BaseModel):
    ok: bool = True


# --- config ----------------------------------------------------------------------------------


class VariantConfig(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    app_name: I18nText
    exam_ids: list[str]
    exam_profile_ids: list[str]
    show_exam_switcher: bool
    accent_color: str | None = None
    deep_link_prefix: str | None = None
    products: dict[str, str] = Field(default_factory=dict)
    revenuecat_offering_id: str | None = None
    source: Literal["packages/config", "database", "built_in"]


class AppVersionInfo(BaseModel):
    min_version: str
    latest_version: str
    update_required: bool | None = None


class PriceInfo(BaseModel):
    product_id: str
    platform: Literal["web", "android", "ios"]
    variant_id: str | None
    store_product_id: str
    price_paise: int
    intro_price_paise: int | None
    period: Literal["month", "year"]
    entitlement: str


class ConfigResponse(BaseModel):
    variant: VariantConfig
    variants: list[str]
    app_version: AppVersionInfo
    flags: dict[str, Any]
    free_limits: dict[str, Any]
    pricing: list[PriceInfo]
    content_base_url: str
    server_time: datetime


class TimeResponse(BaseModel):
    server_time: datetime


# --- me --------------------------------------------------------------------------------------


class MeResponse(BaseModel):
    profile: ProfileState
    handle: str | None
    discoverable: bool
    signed_up_at: datetime | None
    account_kind: Literal["learner", "managed", "guardian"]
    guardian_consent_state: str
    deletion_scheduled_for: datetime | None
    referral_code: str | None
    entitlement: EntitlementState


class MePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: str | None = None
    locale: Literal["en", "hi"] | None = None
    timezone: Annotated[str, Field(max_length=64)] | None = None
    daily_goal_minutes: Literal[5, 10, 20, 30] | None = None
    settings: dict[str, bool | str | int | None] | None = None
    discoverable: bool | None = None

    @field_validator("display_name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        return None if v is None else validate_display_text(v, min_len=1, max_len=24)

    @field_validator("settings")
    @classmethod
    def _settings(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        if v is not None:
            unknown = sorted(set(v) - set(SETTINGS_KEYS))
            if unknown:
                raise ValueError(f"unknown settings keys: {', '.join(unknown)}")
        return v


class ExamsPut(BaseModel):
    exam_profile_ids: Annotated[list[Annotated[str, Field(max_length=64)]], Field(max_length=10)]
    primary: Annotated[str, Field(max_length=64)] | None = None


class TodaySummary(BaseModel):
    date: date
    minutes: int
    goal_minutes: int
    goal_met: bool
    lessons_completed: int
    cards_reviewed: int
    reviews_to_qualify: int
    qualified: bool


class SummaryResponse(BaseModel):
    state_version: int
    today: TodaySummary
    streak: StreakState
    plant: PlantState
    pet: PetState | None
    wallet: WalletState
    entitlement: EntitlementState
    limits: dict[str, Any]


# --- catalogue -------------------------------------------------------------------------------


class ExamProfileOut(BaseModel):
    id: str
    cycle: str
    name: I18nText
    locales: list[str]
    schedule: dict[str, Any] | None
    is_active: bool


class ExamOut(BaseModel):
    id: str
    name: I18nText
    category: str
    conducting_body: str | None
    official_url: str | None
    is_active: bool
    profiles: list[ExamProfileOut]


class SubjectOut(BaseModel):
    id: str
    name: I18nText
    color_token: str
    sort: int
    chapter_count: int


class BundleRef(BaseModel):
    id: str
    mode: str
    locale: str
    hash: str
    size_bytes: int
    card_count: int
    min_app_version: str
    url: str | None


class TopicBrief(BaseModel):
    id: str
    name: I18nText
    summary: I18nText | None
    sort: int


class ChapterOut(BaseModel):
    id: str
    subject_id: str
    unit_id: str
    name: I18nText
    ncert_ref: str | None
    sort: int
    topics: list[TopicBrief]
    is_free: bool | None = None


class SubtopicOut(BaseModel):
    id: str
    name: I18nText
    sort: int


class TopicOut(BaseModel):
    id: str
    chapter_id: str
    subject_id: str
    name: I18nText
    summary: I18nText | None
    sort: int
    subtopics: list[SubtopicOut]
    bundles: list[BundleRef]


class ManifestResponse(BaseModel):
    exam_profile_id: str
    locale: Literal["en", "hi"]
    version: int | None
    hash: str | None
    url: str | None
    base_url: str
    bundle_url_template: str
    patch_url_template: str
    free_rotating_chapters: list[str]
    manifest: dict[str, Any] | None = Field(
        default=None,
        description="The manifest body, inlined in local mode when the file is on disk",
    )


# --- dev auth --------------------------------------------------------------------------------


class DevGoogleRequest(BaseModel):
    email: Annotated[
        str, Field(min_length=3, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    ]
    name: Annotated[str, Field(min_length=1, max_length=80)]
    sub: Annotated[str, Field(min_length=1, max_length=64)] | None = None
    link: bool = Field(
        default=False, description="Link Google to the guest in the Authorization header"
    )


class DevUser(BaseModel):
    id: uuid.UUID
    is_anonymous: bool
    email: str | None = None


class DevSession(BaseModel):
    """The shape of Supabase's token endpoint (docs/contracts/sync.md "Dev auth")."""

    access_token: str
    token_type: Literal["bearer"] = "bearer"  # noqa: S105 - the OAuth token type, not a secret
    expires_in: int
    expires_at: int
    refresh_token: str
    user: DevUser


class DevRefreshRequest(BaseModel):
    refresh_token: Annotated[str, Field(min_length=10, max_length=4096)]


# --- accounts --------------------------------------------------------------------------------


class LinkedRequest(BaseModel):
    referral_code: Annotated[str, Field(max_length=32)] | None = None


class LinkedResponse(BaseModel):
    profile: ProfileState
    consent_needed: bool
    show_shared_phone_check: bool


class MergeIntentRequest(BaseModel):
    has_unsent_events: bool = False


class MergeIntentResponse(BaseModel):
    merge_intent: str
    expires_at: datetime


class MergeRequest(BaseModel):
    merge_intent: Annotated[str, Field(min_length=16, max_length=128)]
    include_progress: bool = True
    convert_guardian: bool = False


class MergeAccepted(BaseModel):
    merge_id: uuid.UUID
    status: str


class MergeStatus(BaseModel):
    merge_id: uuid.UUID
    status: Literal["queued", "running", "done", "failed"]
    include_progress: bool
    attempts: int
    failure_code: str | None
    stats: dict[str, Any] | None
    created_at: datetime
    finished_at: datetime | None


class DeletionResponse(BaseModel):
    scheduled_for: datetime | None


# --- gamification ----------------------------------------------------------------------------


class PetResponse(BaseModel):
    pet: PetState | None
    outfit_ids: list[str] = Field(default_factory=list)
    room_theme: str | None = None
    care_today: dict[str, int] = Field(default_factory=dict)
    treats_held: int = 0


class PetCareRequest(BaseModel):
    action: Literal["pet", "feed", "play"]
    item_id: Annotated[str, Field(max_length=64)] | None = None


class StreakFreezeRequest(BaseModel):
    slot: Annotated[int, Field(ge=0, le=10)] = 0


class RestDayRequest(BaseModel):
    day: date


class ShopItemOut(BaseModel):
    id: str
    kind: str
    price_gems: int
    pro_only: bool
    owned: int


class ShopResponse(BaseModel):
    gems: int
    items: list[ShopItemOut]


class PurchaseRequest(BaseModel):
    item_id: Annotated[str, Field(min_length=1, max_length=64)]


class PurchaseResponse(BaseModel):
    item_id: str
    gems: int
    state_version: int


class GemLedgerEntry(BaseModel):
    id: uuid.UUID
    delta: int
    reason: str
    ref: str | None
    created_at: datetime


class QuestOut(BaseModel):
    id: str
    period: Literal["daily", "weekly", "event"]
    counter: str | None
    target: int
    progress: int
    reward: dict[str, int]
    period_start: date
    period_end: date
    completed: bool
    claimed: bool


class QuestClaimResponse(BaseModel):
    quest_id: str
    gems: int
    xp: int
    state_version: int


class BadgeOut(BaseModel):
    id: str
    name: I18nText
    description: I18nText
    tier: int
    earned_at: datetime | None


class StateVersion(BaseModel):
    state_version: int
