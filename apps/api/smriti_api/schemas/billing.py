"""Request and response models for ``/v1/billing/*`` (me-money §5, TRD §5.1 "Billing")."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

Code = Annotated[str, Field(pattern=r"^[a-z0-9_]{1,40}$")]
PlanChoice = Literal["monthly", "yearly", "family_monthly", "family_yearly"]


class EntitlementOut(BaseModel):
    plan: Literal["free", "pro"]
    pro_until: datetime | None
    status: (
        Literal["active", "trialing", "grace", "on_hold", "cancelled", "expired", "pending"] | None
    )
    source: Literal["razorpay", "play", "app_store", "promo", "family"] | None
    grace_until: datetime | None
    cancel_at_period_end: bool
    is_intro: bool


class IntroEligibilityOut(BaseModel):
    eligible: bool | None = Field(
        description="null for a guest: only the hint is known until sign-in (auth flow §8)"
    )
    eligible_hint: bool
    reason: Literal["guest", "had_subscription", "intro_already_claimed"] | None
    intro_price_paise: int | None
    price_paise: int


class RazorpaySubscriptionRequest(BaseModel):
    # PAY-03: a 13 to 17 year old says whether a parent or guardian is paying.
    payer: Literal["self", "guardian_declared"] = "self"
    # PRD §11.2: ₹99/month (the default, with the ₹1 intro), ₹799/year, or a family plan (hidden
    # until the owner sets its seats and price).
    plan: PlanChoice = "monthly"


class ChildProRequest(BaseModel):
    """PAY-17: a parent buys Pro for one child's account (individual plans only; a family plan is
    the parent's own and adds the child as a member instead)."""

    plan: Literal["monthly", "yearly"] = "monthly"


class RazorpaySubscriptionOut(BaseModel):
    subscription_id: str
    key_id: str
    product_id: str
    intro: bool
    amount_today_paise: int
    then_paise: int
    short_url: str | None = None


class RazorpayVerifyRequest(BaseModel):
    razorpay_payment_id: Annotated[str, Field(min_length=3, max_length=64)]
    razorpay_subscription_id: Annotated[str, Field(min_length=3, max_length=64)]
    razorpay_signature: Annotated[str, Field(min_length=16, max_length=256)]


class RazorpayCancelRequest(BaseModel):
    reason: Code | None = None


# --- PAY-17 "Send to my parent" (me-money §5.12) --------------------------------------------------

PayLinkToken = Annotated[str, Field(min_length=32, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]


class ChildPayLinkCreate(BaseModel):
    plan: Literal["monthly", "yearly"] = "monthly"


class ChildPayLinkCreated(BaseModel):
    """Shown once: only the token's hash is kept."""

    id: uuid.UUID
    token: str
    url: str
    plan: Literal["monthly", "yearly"]
    expires_at: datetime


class PayLinkPet(BaseModel):
    species: Literal["cat", "dog"]
    name: str


class ChildPayLinkOut(BaseModel):
    """What the parent's link page shows (no login): the child's first name and pet, the price
    from the child's own eligibility, and whether the link still works."""

    status: Literal["open", "paid", "expired", "cancelled", "already_pro"]
    child_first_name: str | None
    pet: PayLinkPet | None
    plan: Literal["monthly", "yearly"]
    intro: bool
    amount_today_paise: int | None
    then_paise: int | None
    expires_at: datetime


class SubscriptionOut(BaseModel):
    id: uuid.UUID
    source: Literal["razorpay", "play", "app_store", "promo"]
    status: str
    product_id: str
    price_paise: int
    intro_price_paise: int | None
    is_intro: bool
    payer: Literal["self", "guardian_declared", "guardian"]
    current_period_end: datetime | None
    grace_until: datetime | None
    cancel_at_period_end: bool
    next_charge_at: datetime | None
    next_charge_paise: int | None
    ends_at: datetime | None
    # Where Manage plan sends the student (PAY-12): this app, a store, or nothing to manage.
    managed_in: Literal["web", "play", "app_store", "none"]


class SubscriptionDetailsOut(BaseModel):
    entitlement: EntitlementOut
    subscription: SubscriptionOut | None
    promo_until: datetime | None


class RestoreOut(BaseModel):
    restored: bool
    entitlement: EntitlementOut


class WebhookAck(BaseModel):
    status: Literal["applied", "duplicate", "ignored"]


# --- family plan (PRD §11.2, Phase 3) ------------------------------------------------------------


class FamilyMemberOut(BaseModel):
    user_id: uuid.UUID
    first_name: str | None
    via: Literal["guardian_link", "invite"]
    joined_at: datetime


class FamilyInviteOut(BaseModel):
    id: uuid.UUID
    created_at: datetime
    # Only in the response that creates it; only a hash is stored.
    code: str | None = None


class FamilyOut(BaseModel):
    """The payer's view: seats (people besides the payer), members and open invites. A member
    sees ``role = member`` and the seat counts only."""

    group_id: uuid.UUID
    role: Literal["owner", "member"]
    seats: int
    used: int
    members: list[FamilyMemberOut] = Field(default_factory=list)
    invites: list[FamilyInviteOut] = Field(default_factory=list)


class FamilyAddChild(BaseModel):
    learner_id: uuid.UUID
