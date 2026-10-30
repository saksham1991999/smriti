"""Settings for the money, mail, push and storage integrations (TRD §11, §12, §17).

Kept apart from ``core.config.Settings`` so the two can change without touching each other.
Names live in ``.env.example``; values in Railway, Cloudflare and EAS secrets. A provider whose
credentials are missing runs as its fake in local and test, and refuses to work elsewhere.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class IntegrationSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    # Razorpay (web subscriptions, TRD §11)
    razorpay_base_url: str = "https://api.razorpay.com/v1"
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    razorpay_webhook_secret: str = ""
    # The ₹99/month plan and the offer that makes the first charge ₹1 (created in the dashboard).
    razorpay_plan_id: str = ""
    razorpay_intro_offer_id: str = ""
    razorpay_total_count: int = 120
    # Days of Pro kept after a failed web renewal (me-money §5.6, proposed; owner to confirm).
    razorpay_grace_days: int = 7

    # RevenueCat (Android and iOS)
    revenuecat_base_url: str = "https://api.revenuecat.com/v1"
    # .env.example has used REVENUECAT_API_KEY and REVENUECAT_WEBHOOK_SECRET; both names work.
    revenuecat_secret_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("REVENUECAT_SECRET_API_KEY", "REVENUECAT_API_KEY"),
    )
    # The exact Authorization header value set on the RevenueCat webhook.
    revenuecat_webhook_auth: str = Field(
        default="",
        validation_alias=AliasChoices("REVENUECAT_WEBHOOK_AUTH", "REVENUECAT_WEBHOOK_SECRET"),
    )

    # ₹1 intro claims: HMAC-SHA256(pepper, provider:sub), never rotated in place (auth §8).
    auth_identity_hash_pepper: str = ""
    auth_identity_hash_key_version: int = 1

    # Email: resend | smtp | fake (TRD names no provider; me-money Q9)
    mail_provider: str = ""
    mail_from: str = ""
    resend_base_url: str = "https://api.resend.com"
    resend_api_key: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_starttls: bool = True

    # Push: expo | fake (TRD §12)
    push_provider: str = ""
    expo_push_url: str = "https://exp.host/--/api/v2/push/send"
    expo_access_token: str = ""
    # Web Push (VAPID, RFC 8292): the private key (PEM or raw base64url) and a mailto: or https: contact.
    web_push_vapid_private_key: str = ""
    web_push_vapid_subject: str = ""

    # Files: r2 | local (TRD §8 buckets)
    storage_provider: str = ""
    storage_local_dir: str = ""
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket_uploads: str = "smriti-uploads"
    r2_bucket_assets: str = "smriti-assets"
    r2_endpoint: str = ""
    signed_url_ttl_s: int = 3600

    # Public links in emails and pushes
    guardian_link_base_url: str = "https://smriti.app/guardian/"
    brand_name: str = "Smriti"


@lru_cache
def get_integration_settings() -> IntegrationSettings:
    return IntegrationSettings()
