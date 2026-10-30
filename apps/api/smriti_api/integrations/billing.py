"""Billing providers (TRD §11, me-money §5): Razorpay for the web, RevenueCat for the stores.

Both turn a provider webhook into ``SubscriptionUpdate`` values that the billing service applies
the same way, so the entitlement recompute never knows where a change came from.

- ``RazorpayProvider``: creates and cancels subscriptions (REST, basic auth with the key id and
  secret), checks the Checkout handler signature (HMAC of ``payment_id|subscription_id`` with the
  key secret) and the webhook signature (``X-Razorpay-Signature``: HMAC-SHA256 of the raw body
  with the webhook secret).
- ``RevenueCatProvider``: checks the webhook ``Authorization`` header and confirms each event
  with ``GET /subscribers/{app_user_id}`` (TRD §11 "the server confirms").
- ``FakeRazorpayProvider`` and ``FakeRevenueCatProvider`` keep the signature and parsing code but
  never call the network, for local and test.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import structlog

log = structlog.get_logger(__name__)


class BillingError(Exception):
    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(detail or code)
        self.code = code
        self.detail = detail or code


@dataclass(frozen=True)
class PaymentUpdate:
    external_payment_id: str
    amount_paise: int
    status: str  # captured | failed | refunded
    method: str | None
    paid_at: datetime


@dataclass(frozen=True)
class SubscriptionUpdate:
    source: str  # razorpay | play | app_store
    external_id: str
    occurred_at: datetime
    user_id: uuid.UUID | None = None
    store_product_id: str | None = None
    status: str | None = None
    is_intro: bool | None = None
    period_start: datetime | None = None
    period_end: datetime | None = None
    grace_until: datetime | None = None
    cancel_at_period_end: bool | None = None
    cancel_reason: str | None = None
    pending_reason: str | None = None
    refunded_at: datetime | None = None
    environment: str = "production"
    payment: PaymentUpdate | None = None
    # A Razorpay refund names the payment, not the subscription.
    refund_of_payment: str | None = None


@dataclass(frozen=True)
class WebhookEvent:
    source: str  # razorpay | revenuecat
    external_event_id: str
    event_type: str
    user_id: uuid.UUID | None
    updates: list[SubscriptionUpdate]
    payload: dict[str, Any] = field(default_factory=dict)


def _ts(seconds: Any) -> datetime | None:
    if seconds in (None, "", 0):
        return None
    try:
        return datetime.fromtimestamp(int(seconds), UTC)
    except (TypeError, ValueError, OverflowError):
        return None


def _ms(millis: Any) -> datetime | None:
    if millis in (None, "", 0):
        return None
    try:
        return datetime.fromtimestamp(int(millis) / 1000, UTC)
    except (TypeError, ValueError, OverflowError):
        return None


def _uuid(value: Any) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


def _code(value: Any) -> str | None:
    """Provider reason strings become lower-case codes (the column only takes codes)."""
    if not value:
        return None
    out = "".join(ch if ch.isalnum() else "_" for ch in str(value).lower())[:40].strip("_")
    return out or None


# --- Razorpay --------------------------------------------------------------------------------

_RAZORPAY_STATUS = {
    "subscription.authenticated": "authenticated",
    "subscription.activated": "active",
    "subscription.charged": "active",
    "subscription.resumed": "active",
    "subscription.pending": "grace",
    "subscription.halted": "halted",
    "subscription.paused": "paused",
    "subscription.cancelled": "cancelled",
    "subscription.completed": "expired",
}


class RazorpayProvider:
    source = "razorpay"

    def __init__(
        self,
        http: httpx.AsyncClient,
        *,
        base_url: str,
        key_id: str,
        key_secret: str,
        webhook_secret: str,
        plan_id: str,
        intro_offer_id: str = "",
        total_count: int = 120,
        grace_days: int = 7,
    ) -> None:
        self._http = http
        self._base = base_url.rstrip("/")
        self.key_id = key_id
        self._secret = key_secret
        self._webhook_secret = webhook_secret
        self.plan_id = plan_id
        self.intro_offer_id = intro_offer_id
        self._total_count = total_count
        self.grace_days = grace_days

    # signatures ---------------------------------------------------------------------------------
    def verify_webhook(self, body: bytes, headers: Mapping[str, str]) -> bool:
        sig = headers.get("x-razorpay-signature", "")
        if not sig or not self._webhook_secret:
            return False
        expected = hmac.new(self._webhook_secret.encode(), body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, sig)

    def verify_payment(self, *, payment_id: str, subscription_id: str, signature: str) -> bool:
        msg = f"{payment_id}|{subscription_id}".encode()
        expected = hmac.new(self._secret.encode(), msg, hashlib.sha256).hexdigest()
        return bool(signature) and hmac.compare_digest(expected, signature)

    # REST -----------------------------------------------------------------------------------------
    async def _request(
        self, method: str, path: str, body: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        try:
            r = await self._http.request(
                method,
                f"{self._base}{path}",
                json=body,
                auth=(self.key_id, self._secret),
                timeout=30,
            )
        except httpx.HTTPError as exc:
            raise BillingError("provider_unreachable", type(exc).__name__) from exc
        if r.status_code >= 400:
            try:
                err = r.json().get("error", {})
            except ValueError:
                err = {}
            log.warning("razorpay_error", status=r.status_code, code=err.get("code"))
            raise BillingError("provider_rejected", str(err.get("code") or r.status_code))
        data = r.json()
        return data if isinstance(data, dict) else {}

    async def create_subscription(
        self, *, user_id: uuid.UUID, intro: bool, notes: Mapping[str, str] | None = None
    ) -> dict[str, Any]:
        if not self.plan_id:
            raise BillingError("billing_not_configured", "RAZORPAY_PLAN_ID is not set")
        body: dict[str, Any] = {
            "plan_id": self.plan_id,
            "total_count": self._total_count,
            "quantity": 1,
            "customer_notify": 1,
            "notes": {"user_id": str(user_id), "intro": "1" if intro else "0", **(notes or {})},
        }
        if intro:
            if not self.intro_offer_id:
                raise BillingError("billing_not_configured", "RAZORPAY_INTRO_OFFER_ID is not set")
            body["offer_id"] = self.intro_offer_id
        return await self._request("POST", "/subscriptions", body)

    async def cancel_subscription(
        self, external_id: str, *, at_cycle_end: bool = True
    ) -> dict[str, Any]:
        return await self._request(
            "POST",
            f"/subscriptions/{external_id}/cancel",
            {"cancel_at_cycle_end": 1 if at_cycle_end else 0},
        )

    # webhooks -------------------------------------------------------------------------------------
    def parse_webhook(self, body: bytes, headers: Mapping[str, str]) -> WebhookEvent:
        try:
            data = json.loads(body)
        except ValueError as exc:
            raise BillingError("invalid_payload", "not JSON") from exc
        event_type = str(data.get("event", ""))
        event_id = headers.get("x-razorpay-event-id") or hashlib.sha256(body).hexdigest()
        occurred = _ts(data.get("created_at")) or datetime.now(UTC)
        payload = data.get("payload") or {}
        sub = (payload.get("subscription") or {}).get("entity") or {}
        pay = (payload.get("payment") or {}).get("entity") or {}
        refund = (payload.get("refund") or {}).get("entity") or {}
        notes = sub.get("notes") or {}
        if not isinstance(notes, dict):
            notes = {}
        user_id = _uuid(notes.get("user_id"))
        updates: list[SubscriptionUpdate] = []
        if event_type in _RAZORPAY_STATUS and sub.get("id"):
            is_intro = notes.get("intro") == "1" or bool(sub.get("offer_id"))
            status = _RAZORPAY_STATUS[event_type]
            paid_count = int(sub.get("paid_count") or 0)
            if status == "active" and is_intro and paid_count <= 1:
                status = "trialing"
            period_end = _ts(sub.get("current_end"))
            payment = None
            if pay.get("id"):
                payment = PaymentUpdate(
                    external_payment_id=str(pay["id"]),
                    amount_paise=int(pay.get("amount") or 0),
                    status="captured"
                    if pay.get("status") == "captured"
                    else str(pay.get("status") or "failed"),
                    method=str(pay["method"]) if pay.get("method") else None,
                    paid_at=_ts(pay.get("created_at")) or occurred,
                )
                if payment.status not in ("captured", "failed", "refunded"):
                    payment = replace(payment, status="failed")
            updates.append(
                SubscriptionUpdate(
                    source="razorpay",
                    external_id=str(sub["id"]),
                    occurred_at=occurred,
                    user_id=user_id,
                    store_product_id=str(sub.get("plan_id") or "") or None,
                    status=status,
                    is_intro=is_intro and paid_count <= 1,
                    period_start=_ts(sub.get("current_start")),
                    period_end=period_end,
                    grace_until=(period_end or occurred) + timedelta(days=self.grace_days)
                    if status == "grace"
                    else None,
                    # A mandate revoked in the UPI app keeps Pro until the paid period ends.
                    cancel_at_period_end=True if status == "cancelled" else None,
                    pending_reason="bank_confirming" if status == "authenticated" else None,
                    payment=payment,
                )
            )
        elif event_type in ("refund.processed", "refund.created", "payment.refunded"):
            payment_id = str(refund.get("payment_id") or pay.get("id") or "")
            if payment_id:
                updates.append(
                    SubscriptionUpdate(
                        source="razorpay",
                        external_id="",
                        occurred_at=occurred,
                        status="cancelled",
                        refunded_at=_ts(refund.get("created_at")) or occurred,
                        refund_of_payment=payment_id,
                    )
                )
        return WebhookEvent("razorpay", str(event_id), event_type, user_id, updates, data)


class FakeRazorpayProvider(RazorpayProvider):
    """Same signatures and parsing, no network: subscriptions get local ids."""

    def __init__(self, http: httpx.AsyncClient, **kw: Any) -> None:
        super().__init__(http, **kw)
        self.created: list[dict[str, Any]] = []
        self.cancelled: list[str] = []

    async def create_subscription(
        self, *, user_id: uuid.UUID, intro: bool, notes: Mapping[str, str] | None = None
    ) -> dict[str, Any]:
        sub = {
            "id": f"sub_fake{secrets.token_hex(6)}",
            "entity": "subscription",
            "plan_id": self.plan_id or "plan_fake",
            "status": "created",
            "offer_id": (self.intro_offer_id or "offer_fake") if intro else None,
            "short_url": "https://example.invalid/rzp-fake",
            "notes": {"user_id": str(user_id), "intro": "1" if intro else "0", **(notes or {})},
        }
        self.created.append(sub)
        return sub

    async def cancel_subscription(
        self, external_id: str, *, at_cycle_end: bool = True
    ) -> dict[str, Any]:
        self.cancelled.append(external_id)
        return {"id": external_id, "status": "active" if at_cycle_end else "cancelled"}


# --- RevenueCat ------------------------------------------------------------------------------

_RC_STORE = {"PLAY_STORE": "play", "APP_STORE": "app_store", "MAC_APP_STORE": "app_store"}


class RevenueCatProvider:
    source = "revenuecat"

    def __init__(
        self, http: httpx.AsyncClient, *, base_url: str, secret_api_key: str, webhook_auth: str
    ) -> None:
        self._http = http
        self._base = base_url.rstrip("/")
        self._key = secret_api_key
        self._auth = webhook_auth

    def verify_webhook(self, body: bytes, headers: Mapping[str, str]) -> bool:
        got = headers.get("authorization", "")
        return bool(self._auth) and hmac.compare_digest(got.encode(), self._auth.encode())

    async def fetch_subscriber(self, app_user_id: str) -> dict[str, Any] | None:
        try:
            r = await self._http.get(
                f"{self._base}/subscribers/{app_user_id}",
                headers={"Authorization": f"Bearer {self._key}"},
                timeout=20,
            )
        except httpx.HTTPError as exc:
            raise BillingError("provider_unreachable", type(exc).__name__) from exc
        if r.status_code == 404:
            return None
        if r.status_code >= 400:
            raise BillingError("provider_rejected", str(r.status_code))
        sub = r.json().get("subscriber")
        return sub if isinstance(sub, dict) else None

    def parse_webhook(self, body: bytes, headers: Mapping[str, str]) -> WebhookEvent:
        try:
            data = json.loads(body)
        except ValueError as exc:
            raise BillingError("invalid_payload", "not JSON") from exc
        ev = data.get("event") or {}
        event_type = str(ev.get("type", ""))
        event_id = str(ev.get("id") or hashlib.sha256(body).hexdigest())
        user_id = _uuid(ev.get("app_user_id")) or _uuid(ev.get("original_app_user_id"))
        occurred = _ms(ev.get("event_timestamp_ms")) or datetime.now(UTC)
        source = _RC_STORE.get(str(ev.get("store", "")))
        external_id = str(ev.get("original_transaction_id") or ev.get("transaction_id") or "")
        updates: list[SubscriptionUpdate] = []
        if source and external_id and event_type not in ("TEST", "TRANSFER", "SUBSCRIBER_ALIAS"):
            period_type = str(ev.get("period_type", "NORMAL"))
            base = SubscriptionUpdate(
                source=source,
                external_id=external_id,
                occurred_at=occurred,
                user_id=user_id,
                store_product_id=str(ev.get("product_id") or "") or None,
                period_start=_ms(ev.get("purchased_at_ms")),
                period_end=_ms(ev.get("expiration_at_ms")),
                environment="sandbox" if ev.get("environment") == "SANDBOX" else "production",
            )
            update: SubscriptionUpdate | None = None
            if event_type == "INITIAL_PURCHASE":
                intro = period_type in ("INTRO", "TRIAL")
                update = replace(
                    base,
                    status="trialing" if intro else "active",
                    is_intro=intro,
                    cancel_at_period_end=False,
                )
            elif event_type in (
                "RENEWAL",
                "PRODUCT_CHANGE",
                "UNCANCELLATION",
                "SUBSCRIPTION_EXTENDED",
            ):
                update = replace(base, status="active", is_intro=False, cancel_at_period_end=False)
            elif event_type == "CANCELLATION":
                reason = _code(ev.get("cancel_reason"))
                if reason == "customer_support":  # a refund from the store or RevenueCat support
                    update = replace(
                        base, status="cancelled", refunded_at=occurred, cancel_reason=reason
                    )
                else:
                    update = replace(base, cancel_at_period_end=True, cancel_reason=reason)
            elif event_type == "BILLING_ISSUE":
                grace = _ms(ev.get("grace_period_expiration_at_ms"))
                update = replace(base, status="grace" if grace else "on_hold", grace_until=grace)
            elif event_type == "SUBSCRIPTION_PAUSED":
                update = replace(base, status="paused")
            elif event_type == "EXPIRATION":
                update = replace(
                    base, status="expired", cancel_reason=_code(ev.get("expiration_reason"))
                )
            if update is not None:
                updates.append(update)
        return WebhookEvent("revenuecat", event_id, event_type, user_id, updates, data)

    async def confirm(self, event: WebhookEvent) -> WebhookEvent:
        """Cross-checks the webhook against RevenueCat's subscriber record: the REST answer wins
        for expiry, grace and refunds (webhooks can arrive late or out of order)."""
        if event.user_id is None or not event.updates:
            return event
        subscriber = await self.fetch_subscriber(str(event.user_id))
        if subscriber is None:
            return event
        subs = subscriber.get("subscriptions") or {}
        out = []
        for u in event.updates:
            rec = subs.get(u.store_product_id or "") if isinstance(subs, dict) else None
            if not isinstance(rec, dict):
                out.append(u)
                continue
            expires = _iso(rec.get("expires_date"))
            grace = _iso(rec.get("grace_period_expires_date"))
            refunded = _iso(rec.get("refunded_at"))
            u2 = replace(
                u,
                period_end=expires or u.period_end,
                grace_until=grace or u.grace_until,
                refunded_at=refunded or u.refunded_at,
            )
            if refunded is not None:
                u2 = replace(u2, status="cancelled")
            if rec.get("unsubscribe_detected_at") and u2.cancel_at_period_end is None:
                u2 = replace(u2, cancel_at_period_end=True)
            out.append(u2)
        return replace(event, updates=out)


class FakeRevenueCatProvider(RevenueCatProvider):
    def __init__(self, http: httpx.AsyncClient, *, webhook_auth: str) -> None:
        super().__init__(
            http, base_url="http://fake.invalid", secret_api_key="", webhook_auth=webhook_auth
        )

    async def fetch_subscriber(self, app_user_id: str) -> dict[str, Any] | None:
        return None


def _iso(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
