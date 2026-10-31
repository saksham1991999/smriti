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


class ConsentNoticeOut(BaseModel):
    """AUTH-20 "Read the full notice": the current notice, from config (legal publishes it)."""

    version: str | None = Field(
        description="Send this as notice_version when set; null until the notice is published"
    )
    url: str | None = Field(description="The full notice in `locale`; null until published")
    locale: Literal["en", "hi"]
    published: bool


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
    # AUTH-27: guardians' link requests waiting for this teen (the in-app badge).
    pending_link_requests: int = 0


# --- AUTH-27: a guardian links an existing teen (auth flow §6.11) ----------------------------------

LinkStatus = Literal["pending", "accepted", "declined", "expired", "cancelled"]
ReferralCode = Annotated[str, Field(min_length=4, max_length=16, pattern=r"^[A-Za-z0-9]+$")]


class LinkRequestCreate(BaseModel):
    """SET-18 path 2. At most one of ``teen_email`` (the teen's sign-in email) and ``teen_code``
    (the teen's invite code, as on their friend QR); with neither, the teen claims the returned
    code. The answer never says whether an account matched."""

    teen_email: Email | None = None
    teen_code: ReferralCode | None = None
    scopes: Annotated[list[Scope], Field(min_length=1, max_length=5)]


class LinkRequestCreated(BaseModel):
    id: uuid.UUID
    code: str
    link: str
    scopes: list[Scope]
    expires_at: datetime


class GuardianLinkRequestOut(BaseModel):
    """The guardian's own list (SET-18). The teen's name shows only after the teen accepts."""

    id: uuid.UUID
    status: LinkStatus
    scopes: list[Scope]
    learner_first_name: str | None
    consent_request_id: uuid.UUID | None
    created_at: datetime
    expires_at: datetime


class TeenLinkRequestOut(BaseModel):
    """AUTH-27 on the teen's phone: "Link {parent_first_name} as your guardian?"."""

    id: uuid.UUID
    status: LinkStatus
    parent_first_name: str | None
    scopes: list[Scope]
    expires_at: datetime


class LinkClaim(BaseModel):
    code: Annotated[str, Field(min_length=6, max_length=12, pattern=r"^[A-Za-z0-9]+$")]


class LinkAccept(BaseModel):
    """The teen's confirmation, kept as the request's evidence (no free text)."""

    notice_version: Annotated[str, Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9._-]+$")]
    app_version: Annotated[str, Field(max_length=40)] | None = None
    platform: Literal["ios", "android", "web"] | None = None


class LinkDecision(BaseModel):
    id: uuid.UUID
    status: Literal["accepted", "declined"]
    # Accepted: the §6.10 consent request the guardian now agrees to on AUTH-20 (same code).
    consent_request_id: uuid.UUID | None


# --- managed children (auth flow §6.11, AUTH-24 to AUTH-28) ----------------------------------------


class ChildCreate(BaseModel):
    """AUTH-24/AUTH-26: the parent creates a managed child, adopting the guest that did onboarding
    on this device (``adopt_guest`` is that guest's access token) or making a new account."""

    first_name: Annotated[str, Field(min_length=1, max_length=40)]
    age_band: Literal["u10", "10_12"]
    scopes: Annotated[list[Scope], Field(min_length=1, max_length=5)]
    # The AUTH-20 declaration, made by the parent at creation (method parent_created).
    declaration: Literal[True]
    notice_version: Annotated[str, Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9._-]+$")]
    adopt_guest: Annotated[str, Field(min_length=16, max_length=4096)] | None = None
    locale: Literal["en", "hi"] | None = None


class ManagedChildOut(BaseModel):
    user_id: uuid.UUID
    first_name: str
    age_band: Literal["u10", "10_12"]
    adopted: bool
    consent: ConsentOut


class ChildSessionOut(BaseModel):
    """Exchanged once, within ``expires_in`` seconds, with supabase-js
    ``verifyOtp({ token_hash, type: 'email' })`` (locally ``POST /v1/dev/auth/verify-otp``)."""

    user_id: uuid.UUID
    token_hash: str
    type: Literal["email"] = "email"
    expires_in: int


class ChildDeletionOut(BaseModel):
    user_id: uuid.UUID
    scheduled_for: datetime
