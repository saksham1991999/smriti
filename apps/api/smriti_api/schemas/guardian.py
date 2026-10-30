"""Request and response models for ``/v1/guardian/*`` (auth flow §6.10, DPDP s.9)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

Email = Annotated[str, Field(min_length=3, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
Scope = Literal["account", "social", "community", "voice", "uploads"]
SCOPES: tuple[Scope, ...] = ("account", "social", "community", "voice", "uploads")
RequestStatus = Literal["pending", "granted", "declined", "expired", "cancelled"]
ConsentState = Literal["not_required", "required", "pending", "granted", "declined", "revoked"]


class ConsentRequestCreate(BaseModel):
    channel: Literal["handoff", "link"]
    scopes: Annotated[list[Scope], Field(min_length=1, max_length=5)]
    # Optional: the teen types a guardian's email and we send the link (the address is used once
    # and never stored; only an HMAC is kept to limit repeat sends).
    guardian_email: Email | None = None
    locale: Literal["en", "hi"] = "en"


class ConsentRequestCreated(BaseModel):
    id: uuid.UUID
    code: str
    link: str
    channel: Literal["handoff", "link"]
    scopes: list[Scope]
    expires_at: datetime
    email_sent: bool


class ConsentRequestStatus(BaseModel):
    """The teen's poll while AUTH-21 is open (every 5 s), and AUTH-23's data."""

    id: uuid.UUID
    status: RequestStatus
    scopes: list[Scope]
    granted_scopes: list[Scope]
    expires_at: datetime
    resolved_at: datetime | None
    # When the teen may ask again after a decline (auth.consent_retry_h, decline pause).
    retry_at: datetime | None


class ConsentRequestForGuardian(BaseModel):
    """What AUTH-20 shows the guardian: no more than the screen needs (DB_SCHEMA §12)."""

    request_id: uuid.UUID
    learner_first_name: str | None
    pet_name: str | None
    pet_species: str | None
    app_variant: str | None
    scopes: list[Scope]
    expires_at: datetime


class ConsentConfirm(BaseModel):
    scopes: Annotated[list[Scope], Field(min_length=1, max_length=5)]
    # The AUTH-20 declaration: "I am {first_name}'s parent or legal guardian, and I am 18 or older."
    declaration: Literal[True]
    notice_version: Annotated[str, Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9._-]+$")]
    method: Literal["google_same_device", "google_own_device"]
    app_version: Annotated[str, Field(max_length=40)] | None = None
    platform: Literal["ios", "android", "web"] | None = None


class ConsentOut(BaseModel):
    id: uuid.UUID
    learner_user_id: uuid.UUID
    scopes: list[Scope]
    method: str
    age_assurance: str
    notice_version: str
    consented_at: datetime
    revoked_at: datetime | None


class ConsentDecision(BaseModel):
    request_id: uuid.UUID
    status: Literal["granted", "declined"]
    consent: ConsentOut | None


class LearnerOut(BaseModel):
    user_id: uuid.UUID
    first_name: str | None
    age_band: str | None
    kind: Literal["managed", "consent"]
    linked_at: datetime
    consent: ConsentOut | None


class LearnersOut(BaseModel):
    learners: list[LearnerOut]


class MyConsentOut(BaseModel):
    state: ConsentState
    age_band: str | None
    needs_consent: bool
    scopes: list[Scope]
    consent_id: uuid.UUID | None
    consented_at: datetime | None
    pending_request_id: uuid.UUID | None
    retry_at: datetime | None
