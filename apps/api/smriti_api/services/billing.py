"""Subscriptions and the Pro entitlement (TRD §11, me-money §5, auth flow §8).

- Webhooks from Razorpay and RevenueCat are stored raw (``billing.payment_events``, unique per
  provider event id, so a retry is a no-op), turned into ``SubscriptionUpdate`` values and
  applied to ``billing.subscriptions``. An update older than the newest one already applied to a
  subscription is ignored (webhooks are not ordered).
- ``recompute_entitlement`` derives ``billing.entitlements`` from every subscription and promo
  grant of the user: Pro while a subscription is trialing or active in its period, in grace until
  ``grace_until``, or cancelled with paid time left; never from a refunded or revoked one. Any
  change bumps the ``entitlement`` sync section.
- The ₹1 intro is once per person: identity keys (HMAC of ``provider:sub``) are claimed on the
  first intro purchase and survive account deletion (``billing.intro_claims``).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import uuid
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.db import Database
from smriti_api.core.logging import hash_user_id
from smriti_api.integrations import Integrations
from smriti_api.integrations.billing import SubscriptionUpdate, WebhookEvent
from smriti_api.services import flags as flag_service
from smriti_api.services import versioning

log = structlog.get_logger(__name__)

PRO_STATUSES = ("trialing", "active")
SOURCE_PLATFORM = {"razorpay": "web", "play": "android", "app_store": "ios"}


# --- identity keys and the ₹1 intro --------------------------------------------------------------


def identity_key(pepper: str, provider: str, sub: str) -> str:
    return hmac.new(pepper.encode(), f"{provider}:{sub}".encode(), hashlib.sha256).hexdigest()


async def identity_keys(
    session: AsyncSession, user_id: uuid.UUID, pepper: str
) -> list[tuple[str, str]]:
    """(claim key, kind) for every Google and Apple identity on the account."""
    rows = (
        await session.execute(
            text(
                "select provider, provider_id from auth.identities where user_id = :u"
                " and provider in ('google','apple') order by provider, provider_id"
            ),
            {"u": user_id},
        )
    ).all()
    return [(identity_key(pepper, r.provider, r.provider_id), f"{r.provider}_sub") for r in rows]


@dataclass(frozen=True)
class IntroEligibility:
    eligible: bool | None
    eligible_hint: bool
    reason: str | None


async def intro_eligibility(
    session: AsyncSession, user_id: uuid.UUID, *, is_anonymous: bool, pepper: str
) -> IntroEligibility:
    """auth flow §8: a guest gets only a hint (no identity keys yet); a signed-in user is not
    eligible when any identity already claimed a ₹1 month or the account ever had a subscription."""
    if is_anonymous:
        return IntroEligibility(eligible=None, eligible_hint=True, reason="guest")
    had = (
        await session.execute(
            text(
                "select 1 from billing.subscriptions where user_id = :u"
                " and status not in ('created') limit 1"
            ),
            {"u": user_id},
        )
    ).first()
    if had is not None:
        return IntroEligibility(False, False, "had_subscription")
    keys = [k for k, _ in await identity_keys(session, user_id, pepper)]
    if keys:
        claimed = (
            await session.execute(
                text("select 1 from billing.intro_claims where claim_key = any(:k) limit 1"),
                {"k": keys},
            )
        ).first()
        if claimed is not None:
            return IntroEligibility(False, False, "intro_already_claimed")
    return IntroEligibility(True, True, None)


async def claim_intro(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    pepper: str,
    version: int,
    source: str,
    variant: str | None,
) -> int:
    """Writes one claim per identity key. A key claimed by another account is a race or abuse
    attempt: it is logged for review, nothing is refunded or blocked (auth flow §8)."""
    claimed = 0
    for key, kind in await identity_keys(session, user_id, pepper):
        row = (
            await session.execute(
                text(
                    """
                    insert into billing.intro_claims (claim_key, key_kind, key_version, user_id, source, variant_id)
                    values (:k, :kind, :v, :u, :src, :var)
                    on conflict (claim_key) do nothing
                    returning claim_key
                    """
                ),
                {"k": key, "kind": kind, "v": version, "u": user_id, "src": source, "var": variant},
            )
        ).first()
        if row is None:
            owner = (
                await session.execute(
                    text("select user_id from billing.intro_claims where claim_key = :k"),
                    {"k": key},
                )
            ).scalar_one_or_none()
            if owner != user_id:
                log.warning("intro_claim_conflict", user=hash_user_id(user_id), kind=kind)
        else:
            claimed += 1
    return claimed


# --- entitlement ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class Entitlement:
    active: bool
    status: str | None
    source: str | None
    expires_at: datetime | None
    grace_until: datetime | None
    cancel_at_period_end: bool
    is_intro: bool
    subscription_id: uuid.UUID | None


def _pro_until(row: Any) -> datetime | None:
    until: datetime | None = row.current_period_end
    if row.status == "grace":
        until = row.grace_until or until
    return until


def _gives_pro(row: Any, now: datetime) -> bool:
    if row.refunded_at is not None or row.revoked_at is not None:
        return False
    if row.status in PRO_STATUSES:
        return row.current_period_end is None or row.current_period_end > now
    if row.status == "grace":
        until = row.grace_until or row.current_period_end
        return until is None or until > now
    if row.status == "cancelled":
        # Cancelled (UPI mandate revoked, store auto-renew off then lapsed early): paid time stays.
        return row.current_period_end is not None and row.current_period_end > now
    return False


def _free_status(rows: list[Any], now: datetime) -> str | None:
    if not rows:
        return None
    latest = max(rows, key=lambda r: r.updated_at)
    st = str(latest.status)
    if st in ("halted", "on_hold", "paused"):
        return "on_hold"
    if st in ("created", "authenticated", "pending"):
        # A checkout someone walked away from is not "pending" for ever.
        return "pending" if latest.updated_at > now - timedelta(days=1) else None
    if st in ("cancelled", "expired"):
        return st
    return "expired"


async def compute_entitlement(
    session: AsyncSession, user_id: uuid.UUID, now: datetime
) -> Entitlement:
    subs = list(
        (
            await session.execute(
                text(
                    """
                    select s.id, s.source, s.status, s.is_intro, s.current_period_end, s.grace_until,
                           s.cancel_at_period_end, s.refunded_at, s.revoked_at, s.updated_at
                      from billing.subscriptions s
                      join billing.products p on p.id = s.product_id
                     where s.user_id = :u and p.entitlement = 'pro'
                    """
                ),
                {"u": user_id},
            )
        ).all()
    )
    paid = [r for r in subs if _gives_pro(r, now)]
    if paid:
        # Prefer a subscription in good standing, then the one that lasts longest.
        rank = {"active": 0, "trialing": 0, "grace": 1, "cancelled": 2}
        far = datetime.max.replace(tzinfo=UTC)
        best = sorted(
            paid, key=lambda r: (rank.get(r.status, 3), -(_pro_until(r) or far).timestamp())
        )[0]
        return Entitlement(
            active=True,
            status=str(best.status),
            source=str(best.source),
            expires_at=best.current_period_end,
            grace_until=best.grace_until if best.status == "grace" else None,
            cancel_at_period_end=bool(best.cancel_at_period_end) or best.status == "cancelled",
            is_intro=bool(best.is_intro),
            subscription_id=best.id,
        )
    grant = (
        await session.execute(
            text(
                "select ends_at from billing.promo_grants where user_id = :u and cancelled_at is null"
                " and starts_at <= :now and ends_at > :now order by ends_at desc limit 1"
            ),
            {"u": user_id, "now": now},
        )
    ).first()
    if grant is not None:
        return Entitlement(True, "active", "promo", grant.ends_at, None, False, False, None)
    return Entitlement(False, _free_status(subs, now), None, None, None, False, False, None)


async def recompute_entitlement(
    session: AsyncSession, user_id: uuid.UUID, now: datetime | None = None
) -> tuple[Entitlement, bool]:
    """Writes ``billing.entitlements`` and bumps the sync section when anything changed."""
    now = now or datetime.now(UTC)
    ent = await compute_entitlement(session, user_id, now)
    exists = (
        await session.execute(text("select 1 from auth.users where id = :u"), {"u": user_id})
    ).first()
    if exists is None:
        return ent, False  # erased account: subscriptions stay for tax, nothing to entitle
    before = (
        await session.execute(
            text(
                "select active, status, source, expires_at, grace_until, cancel_at_period_end, is_intro,"
                " subscription_id from billing.entitlements where user_id = :u and entitlement = 'pro'"
            ),
            {"u": user_id},
        )
    ).first()
    after = (
        ent.active,
        ent.status,
        ent.source,
        ent.expires_at,
        ent.grace_until,
        ent.cancel_at_period_end,
        ent.is_intro,
        ent.subscription_id,
    )
    if before is not None and tuple(before) == after:
        return ent, False
    await session.execute(
        text(
            """
            insert into billing.entitlements
              (user_id, entitlement, active, subscription_id, expires_at, grace_until, status, source,
               is_intro, cancel_at_period_end)
            values (:u, 'pro', :active, :sub, :exp, :grace, :status, :source, :intro, :cancel)
            on conflict (user_id, entitlement) do update set
              active = excluded.active, subscription_id = excluded.subscription_id,
              expires_at = excluded.expires_at, grace_until = excluded.grace_until,
              status = excluded.status, source = excluded.source, is_intro = excluded.is_intro,
              cancel_at_period_end = excluded.cancel_at_period_end
            """
        ),
        {
            "u": user_id,
            "active": ent.active,
            "sub": ent.subscription_id,
            "exp": ent.expires_at,
            "grace": ent.grace_until,
            "status": ent.status,
            "source": ent.source,
            "intro": ent.is_intro,
            "cancel": ent.cancel_at_period_end,
        },
    )
    await versioning.lock_state(session, user_id)
    await versioning.bump(session, user_id, {"entitlement"})
    return ent, True


# --- products ------------------------------------------------------------------------------------


async def product_for(
    session: AsyncSession,
    *,
    source: str,
    store_product_id: str | None,
    intro: bool,
    variant: str | None,
) -> str:
    """Our ``billing.products`` id for a provider product (falls back to the platform's plan)."""
    if store_product_id:
        found = (
            await session.execute(
                text("select id from billing.products where store_product_id = :p"),
                {"p": store_product_id},
            )
        ).scalar_one_or_none()
        if found:
            return str(found)
    platform = SOURCE_PLATFORM.get(source, "web")
    row = (
        await session.execute(
            text(
                """
                select id from billing.products
                 where platform = :pf and active and (intro_price_paise is not null) = :intro
                 order by (variant_id is not distinct from :var) desc, id limit 1
                """
            ),
            {"pf": platform, "intro": intro, "var": variant},
        )
    ).scalar_one_or_none()
    if row is None:
        raise ValueError(f"no billing product for {platform}")
    return str(row)


# --- webhooks ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class WebhookOutcome:
    status: str  # applied | duplicate | ignored
    users: tuple[uuid.UUID, ...] = ()
    changed: tuple[tuple[uuid.UUID, str], ...] = ()  # (user, new entitlement status) for pushes


async def _find_subscription(session: AsyncSession, u: SubscriptionUpdate) -> Any:
    if u.refund_of_payment:
        return (
            await session.execute(
                text(
                    "select s.* from billing.subscriptions s join billing.payments p on p.subscription_id = s.id"
                    " where p.external_payment_id = :p for update of s"
                ),
                {"p": u.refund_of_payment},
            )
        ).first()
    return (
        await session.execute(
            text(
                "select * from billing.subscriptions where source = :s and external_id = :e for update"
            ),
            {"s": u.source, "e": u.external_id},
        )
    ).first()


async def _apply_update(
    session: AsyncSession, u: SubscriptionUpdate, integrations: Integrations
) -> uuid.UUID | None:
    row = await _find_subscription(session, u)
    if row is None and u.refund_of_payment:
        log.warning("refund_for_unknown_payment", source=u.source)
        return None
    user_id = row.user_id if row is not None else u.user_id
    if user_id is None:
        log.warning("billing_event_without_user", source=u.source)
        return None
    if row is not None and row.last_event_at is not None and u.occurred_at < row.last_event_at:
        if u.refunded_at is None:  # a refund always applies, whatever its order
            log.info("billing_event_stale", source=u.source)
            return user_id
    if row is None:
        variant = None
        product = await product_for(
            session,
            source=u.source,
            store_product_id=u.store_product_id,
            intro=bool(u.is_intro),
            variant=variant,
        )
        sub_id = (
            await session.execute(
                text(
                    """
                    insert into billing.subscriptions
                      (user_id, source, external_id, product_id, status, is_intro, current_period_start,
                       current_period_end, started_at, environment)
                    values (:u, :src, :ext, :prod, coalesce(:status, 'pending'), coalesce(:intro, false),
                            :ps, :pe, :at, :env)
                    returning id, status
                    """
                ),
                {
                    "u": user_id,
                    "src": u.source,
                    "ext": u.external_id,
                    "prod": product,
                    "status": u.status,
                    "intro": u.is_intro,
                    "ps": u.period_start,
                    "pe": u.period_end,
                    "at": u.occurred_at,
                    "env": u.environment,
                },
            )
        ).one()
        sub_uuid, previous_status, was_intro = sub_id.id, None, bool(u.is_intro)
    else:
        sub_uuid, previous_status, was_intro = row.id, row.status, bool(row.is_intro)
    await session.execute(
        text(
            """
            update billing.subscriptions set
              status = coalesce(:status, status),
              is_intro = coalesce(:intro, is_intro),
              current_period_start = coalesce(:ps, current_period_start),
              current_period_end = coalesce(:pe, current_period_end),
              grace_until = case when coalesce(:status, status) = 'grace'
                                 then coalesce(:grace, grace_until) else null end,
              cancel_at_period_end = coalesce(:cancel, cancel_at_period_end),
              cancel_reason = coalesce(:reason, cancel_reason),
              pending_reason = case when coalesce(:status, status) in ('authenticated','pending')
                                    then coalesce(:pending, pending_reason) else null end,
              refunded_at = coalesce(refunded_at, :refunded),
              ended_at = case when coalesce(:status, status) in ('expired','cancelled','halted')
                              then coalesce(ended_at, :at) else null end,
              started_at = coalesce(started_at, case when coalesce(:status, status) in ('trialing','active')
                                                     then cast(:at as timestamptz) end),
              last_event_at = greatest(coalesce(last_event_at, :at), :at)
             where id = :id
            """
        ),
        {
            "id": sub_uuid,
            "status": u.status,
            "intro": u.is_intro,
            "ps": u.period_start,
            "pe": u.period_end,
            "grace": u.grace_until,
            "cancel": u.cancel_at_period_end,
            "reason": u.cancel_reason,
            "pending": u.pending_reason,
            "refunded": u.refunded_at,
            "at": u.occurred_at,
        },
    )
    if u.payment is not None:
        await session.execute(
            text(
                """
                insert into billing.payments (subscription_id, external_payment_id, amount_paise, status, method, paid_at)
                values (:s, :p, :amt, :st, :m, :at)
                on conflict (external_payment_id) do update set status = excluded.status
                """
            ),
            {
                "s": sub_uuid,
                "p": u.payment.external_payment_id,
                "amt": u.payment.amount_paise,
                "st": u.payment.status,
                "m": u.payment.method,
                "at": u.payment.paid_at,
            },
        )
    if u.refund_of_payment:
        await session.execute(
            text("update billing.payments set status = 'refunded' where external_payment_id = :p"),
            {"p": u.refund_of_payment},
        )
    # The first intro purchase claims the ₹1 month for every identity on the account.
    if (
        u.status in ("trialing", "active")
        and was_intro
        and previous_status not in ("trialing", "active", "grace")
    ):
        await claim_intro(
            session,
            user_id,
            pepper=integrations.identity_pepper,
            version=integrations.settings.auth_identity_hash_key_version,
            source=u.source,
            variant=None,
        )
    return uuid.UUID(str(user_id))


async def _billing_pushes(
    session: AsyncSession, user_id: uuid.UUID, prior: Any, ent: Entitlement, event_id: str
) -> None:
    """The transactional billing pushes (me-money §6.3): Pro on after a pending payment or a
    first purchase, a pending payment that failed, and the first grace day of a billing issue."""
    from smriti_api.services import notify

    was_active = bool(prior.active) if prior is not None else False
    was_status = prior.status if prior is not None else None
    if ent.active and ent.status in ("active", "trialing") and not was_active:
        await notify.enqueue(
            session, user_id=user_id, kind="pro_activated", dedupe_key=f"pro_activated:{event_id}"
        )
    elif ent.status == "grace" and was_status != "grace":
        day = ent.grace_until.date().isoformat() if ent.grace_until else "na"
        await notify.enqueue(
            session,
            user_id=user_id,
            kind="billing_issue",
            dedupe_key=f"billing_issue:{user_id}:{day}",
        )
    elif was_status == "pending" and not ent.active:
        await notify.enqueue(
            session,
            user_id=user_id,
            kind="payment_not_completed",
            dedupe_key=f"payment_not_completed:{event_id}",
        )


def _with_web_grace(update: SubscriptionUpdate, days: int) -> SubscriptionUpdate:
    """Razorpay has no store-run grace, so ours sets it: the proposed flag
    ``billing.web_grace_days`` (0 means unset; the provider's ``RAZORPAY_GRACE_DAYS`` stands)."""
    if days < 1 or update.source != "razorpay" or update.status != "grace":
        return update
    start = update.period_end or update.occurred_at
    return replace(update, grace_until=start + timedelta(days=days))


async def handle_webhook(
    db: Database, integrations: Integrations, event: WebhookEvent
) -> WebhookOutcome:
    """Stores the raw event, applies its updates and recomputes the entitlements, in one
    transaction. The same provider event id twice is a no-op (``duplicate``)."""
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        stored = (
            await session.execute(
                text(
                    """
                    insert into billing.payment_events
                      (source, external_event_id, event_type, user_id, payload, signature_ok)
                    values (:s, :e, :t, :u, cast(:p as jsonb), true)
                    on conflict (source, external_event_id) do nothing
                    returning id
                    """
                ),
                {
                    "s": event.source,
                    "e": event.external_event_id,
                    "t": event.event_type[:80],
                    "u": event.user_id,
                    "p": json.dumps(event.payload),
                },
            )
        ).scalar_one_or_none()
        if stored is None:
            return WebhookOutcome("duplicate")
        users: list[uuid.UUID] = []
        web_grace = await flag_service.server_pos_int(session, "billing.web_grace_days", 0)
        for update in event.updates:
            uid = await _apply_update(session, _with_web_grace(update, web_grace), integrations)
            if uid is not None and uid not in users:
                users.append(uid)
        changed: list[tuple[uuid.UUID, str]] = []
        for uid in users:
            prior = (
                await session.execute(
                    text(
                        "select active, status from billing.entitlements"
                        " where user_id = :u and entitlement = 'pro'"
                    ),
                    {"u": uid},
                )
            ).first()
            ent, did_change = await recompute_entitlement(session, uid, now)
            if did_change:
                changed.append((uid, ent.status or ("active" if ent.active else "free")))
                await _billing_pushes(session, uid, prior, ent, event.external_event_id)
        await session.execute(
            text(
                "update billing.payment_events set processed_at = now(), user_id = coalesce(user_id, :u) where id = :id"
            ),
            {"id": stored, "u": users[0] if users else None},
        )
    log.info(
        "billing_webhook_applied",
        source=event.source,
        type=event.event_type,
        updates=len(event.updates),
        changed=len(changed),
    )
    return WebhookOutcome("applied" if event.updates else "ignored", tuple(users), tuple(changed))


# --- promo grants --------------------------------------------------------------------------------


async def grant_promo_week(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    reason: str = "referral_week",
    ref: str | None = None,
    now: datetime | None = None,
    days: int = 7,
) -> tuple[datetime, datetime]:
    """me-money §5.16: a free week. If the student already has paid Pro the week waits for the
    paid period to end, so it is never wasted. One grant per (user, reason, ref)."""
    now = now or datetime.now(UTC)
    existing = (
        await session.execute(
            text(
                "select starts_at, ends_at from billing.promo_grants where user_id = :u and reason = :r"
                " and ref is not distinct from :ref and cancelled_at is null"
            ),
            {"u": user_id, "r": reason, "ref": ref},
        )
    ).first()
    if existing is not None:
        return existing.starts_at, existing.ends_at
    ent = await compute_entitlement(session, user_id, now)
    start = now
    if ent.active and ent.source != "promo" and ent.expires_at and ent.expires_at > now:
        start = ent.expires_at
    latest_grant = (
        await session.execute(
            text(
                "select max(ends_at) from billing.promo_grants where user_id = :u and cancelled_at is null"
            ),
            {"u": user_id},
        )
    ).scalar_one_or_none()
    if latest_grant is not None and latest_grant > start:
        start = latest_grant
    end = start + timedelta(days=days)
    await session.execute(
        text(
            "insert into billing.promo_grants (user_id, reason, ref, starts_at, ends_at)"
            " values (:u, :r, :ref, :s, :e)"
        ),
        {"u": user_id, "r": reason, "ref": ref, "s": start, "e": end},
    )
    await recompute_entitlement(session, user_id, now)
    return start, end


async def revoke_promo_grants(
    session: AsyncSession, user_id: uuid.UUID, *, ref: str | None = None
) -> int:
    """Revocation (abuse review, a referral found invalid): ends the grant now."""
    res = await session.execute(
        text(
            "update billing.promo_grants set cancelled_at = now() where user_id = :u and cancelled_at is null"
            " and (cast(:ref as text) is null or ref = :ref)"
        ),
        {"u": user_id, "ref": ref},
    )
    await recompute_entitlement(session, user_id)
    return int(res.rowcount or 0)  # type: ignore[attr-defined]


async def trial_reminders(db: Database, *, now: datetime | None = None) -> int:
    """R33: our own reminder ``billing.trial_reminder_days_before`` days before the ₹1 month turns
    into the ₹99 charge (push ``trial_ending``, once per subscription)."""
    from smriti_api.services import notify

    now = now or datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await flag_service.server_flags(session)
        days = int(flags.get("billing.trial_reminder_days_before", 3) or 3)
        rows = (
            await session.execute(
                text(
                    "select id, user_id, current_period_end from billing.subscriptions"
                    " where status = 'trialing' and not cancel_at_period_end and user_id is not null"
                    " and refunded_at is null and revoked_at is null"
                    " and current_period_end > :now and current_period_end <= :until"
                ),
                {"now": now, "until": now + timedelta(days=days)},
            )
        ).all()
        queued = 0
        for r in rows:
            queued += await notify.enqueue(
                session,
                user_id=r.user_id,
                kind="trial_ending",
                payload={"date": r.current_period_end.strftime("%d/%m/%Y")},
                dedupe_key=f"trial_ending:{r.id}",
            )
    return queued
