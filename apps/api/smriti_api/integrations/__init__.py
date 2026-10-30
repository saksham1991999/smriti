"""Outside services for money, guardians, notifications and files, behind interfaces.

``build_integrations`` picks the real provider when its credentials are set. Without them, local
and test get the fakes; other environments get a provider that refuses (``*_not_configured``),
so a missing secret shows up as an error instead of a silent no-op.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

import httpx

from smriti_api.core.config import REPO_ROOT, Settings
from smriti_api.integrations.billing import (
    FakeRazorpayProvider,
    FakeRevenueCatProvider,
    RazorpayProvider,
    RevenueCatProvider,
)
from smriti_api.integrations.mail import (
    DisabledMailer,
    FakeMailer,
    Mailer,
    ResendMailer,
    SmtpMailer,
)
from smriti_api.integrations.push import (
    DisabledPushSender,
    ExpoPushSender,
    FakePushSender,
    PushSender,
    WebPushSender,
)
from smriti_api.integrations.settings import IntegrationSettings, get_integration_settings
from smriti_api.integrations.storage import LocalStorage, ObjectStorage, R2Storage

# Local and test only: the fake providers sign with these, so tests and the dev curl
# walkthrough can produce valid webhooks. They are not secrets and never used elsewhere.
DEV_RAZORPAY_KEY_SECRET = "dev-razorpay-key-secret"  # noqa: S105 (local/test only)
DEV_RAZORPAY_WEBHOOK_SECRET = "dev-razorpay-webhook-secret"  # noqa: S105 (local/test only)
DEV_REVENUECAT_WEBHOOK_AUTH = "Bearer dev-revenuecat-webhook"
DEV_IDENTITY_PEPPER = "dev-identity-pepper"


@dataclass
class Integrations:
    settings: IntegrationSettings
    razorpay: RazorpayProvider
    revenuecat: RevenueCatProvider
    mailer: Mailer
    push: PushSender
    storage: ObjectStorage
    identity_pepper: str
    billing_configured: bool
    # Web Push for the web app (VAPID). None when not configured outside local and test.
    web_push: PushSender | None = None
    web_push_public_key: str | None = None


def _mailer(cfg: IntegrationSettings, http: httpx.AsyncClient, dev: bool) -> Mailer:
    provider = cfg.mail_provider.lower()
    if provider == "resend" and cfg.resend_api_key and cfg.mail_from:
        return ResendMailer(
            http, api_key=cfg.resend_api_key, sender=cfg.mail_from, base_url=cfg.resend_base_url
        )
    if provider == "smtp" and cfg.smtp_host and cfg.mail_from:
        return SmtpMailer(
            host=cfg.smtp_host,
            port=cfg.smtp_port,
            username=cfg.smtp_username,
            password=cfg.smtp_password,
            sender=cfg.mail_from,
            starttls=cfg.smtp_starttls,
        )
    return FakeMailer() if dev or provider == "fake" else DisabledMailer()


def _push(cfg: IntegrationSettings, http: httpx.AsyncClient, dev: bool) -> PushSender:
    provider = cfg.push_provider.lower()
    if provider == "expo" or (not provider and not dev):
        return ExpoPushSender(http, url=cfg.expo_push_url, access_token=cfg.expo_access_token)
    return FakePushSender() if dev or provider == "fake" else DisabledPushSender()


def _web_push(
    cfg: IntegrationSettings, http: httpx.AsyncClient, dev: bool
) -> tuple[PushSender | None, str | None]:
    if cfg.web_push_vapid_private_key and cfg.web_push_vapid_subject:
        sender = WebPushSender(
            http, private_key=cfg.web_push_vapid_private_key, subject=cfg.web_push_vapid_subject
        )
        return sender, sender.public_key
    if dev:
        return FakePushSender(name="fake-web"), None
    return None, None


def _storage(
    cfg: IntegrationSettings, settings: Settings, http: httpx.AsyncClient
) -> ObjectStorage:
    provider = cfg.storage_provider.lower()
    if provider == "r2" or (not provider and cfg.r2_access_key_id):
        endpoint = cfg.r2_endpoint or f"https://{cfg.r2_account_id}.r2.cloudflarestorage.com"
        return R2Storage(
            http,
            endpoint=endpoint,
            access_key_id=cfg.r2_access_key_id,
            secret_access_key=cfg.r2_secret_access_key,
            buckets={"uploads": cfg.r2_bucket_uploads, "assets": cfg.r2_bucket_assets},
        )
    root = Path(cfg.storage_local_dir) if cfg.storage_local_dir else REPO_ROOT / ".dev" / "storage"
    key = hashlib.sha256(f"local-storage:{settings.dev_jwt_secret or root}".encode()).digest()
    return LocalStorage(root, public_base_url=settings.api_public_url, signing_key=key)


def build_integrations(
    settings: Settings,
    http: httpx.AsyncClient,
    cfg: IntegrationSettings | None = None,
    *,
    grace_days: int | None = None,
) -> Integrations:
    cfg = cfg or get_integration_settings()
    dev = settings.is_dev
    rz_kw = {
        "base_url": cfg.razorpay_base_url,
        "plan_id": cfg.razorpay_plan_id,
        "intro_offer_id": cfg.razorpay_intro_offer_id,
        "total_count": cfg.razorpay_total_count,
        "grace_days": cfg.razorpay_grace_days if grace_days is None else grace_days,
        "plans": {
            "pro_yearly_web": cfg.razorpay_yearly_plan_id,
            "family_monthly_web": cfg.razorpay_family_monthly_plan_id,
            "family_yearly_web": cfg.razorpay_family_yearly_plan_id,
        },
        "yearly_total_count": cfg.razorpay_yearly_total_count,
    }
    razorpay: RazorpayProvider
    configured = bool(cfg.razorpay_key_id and cfg.razorpay_key_secret)
    if configured:
        razorpay = RazorpayProvider(
            http,
            key_id=cfg.razorpay_key_id,
            key_secret=cfg.razorpay_key_secret,
            webhook_secret=cfg.razorpay_webhook_secret,
            **rz_kw,  # type: ignore[arg-type]
        )
    else:
        razorpay = FakeRazorpayProvider(
            http,
            key_id="rzp_test_fake" if dev else "",
            key_secret=DEV_RAZORPAY_KEY_SECRET if dev else "",
            webhook_secret=DEV_RAZORPAY_WEBHOOK_SECRET if dev else "",
            **rz_kw,
        )
    revenuecat: RevenueCatProvider
    if cfg.revenuecat_secret_api_key:
        revenuecat = RevenueCatProvider(
            http,
            base_url=cfg.revenuecat_base_url,
            secret_api_key=cfg.revenuecat_secret_api_key,
            webhook_auth=cfg.revenuecat_webhook_auth,
        )
    else:
        revenuecat = FakeRevenueCatProvider(
            http, webhook_auth=DEV_REVENUECAT_WEBHOOK_AUTH if dev else ""
        )
    web_push, web_push_key = _web_push(cfg, http, dev)
    return Integrations(
        settings=cfg,
        razorpay=razorpay,
        revenuecat=revenuecat,
        mailer=_mailer(cfg, http, dev),
        push=_push(cfg, http, dev),
        storage=_storage(cfg, settings, http),
        identity_pepper=cfg.auth_identity_hash_pepper or (DEV_IDENTITY_PEPPER if dev else ""),
        billing_configured=configured or dev,
        web_push=web_push,
        web_push_public_key=web_push_key,
    )
