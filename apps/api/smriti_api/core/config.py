"""Settings from the environment (docs/TRD.md §17). Names only live in .env.example."""

from __future__ import annotations

from enum import StrEnum
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[4]


class AppEnv(StrEnum):
    local = "local"
    test = "test"
    preview = "preview"
    staging = "staging"
    production = "production"


class JobsMode(StrEnum):
    arq = "arq"
    inline = "inline"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    app_env: AppEnv = AppEnv.local
    api_public_url: str = "http://127.0.0.1:8000"
    web_app_url: str = ""
    cors_origins: str = Field(default="", description="Comma-separated extra origins")

    database_url: str = "postgresql+asyncpg://postgres:postgres@127.0.0.1:54322/smriti"
    db_pool_size: int = 10
    db_system_role: str = "service_role"
    redis_url: str = "redis://127.0.0.1:56379/0"

    # Supabase
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_jwks_url: str = ""
    jwt_audience: str = "authenticated"
    jwt_issuer: str = ""
    jwt_leeway_s: int = 60
    # Local and test only: HS256 key for dev tokens. Generated per process when unset.
    dev_jwt_secret: str = ""
    # Managed children (auth flow §6.11): the internal identity is {child_user_id}@<this domain>,
    # a domain we own with a null MX record. Local and test fall back to a reserved .invalid name.
    managed_identity_domain: str = ""

    # Content
    content_local_dir: str = ""
    cdn_base_url: str = ""
    content_bundle_path: str = "bundles/{hash}.json"
    content_manifest_path: str = "manifests/{exam}/{locale}.json"
    content_patch_path: str = "patches/{from_hash}-{to_hash}.json"
    variants_dir: str = str(REPO_ROOT / "packages" / "config" / "variants")

    # AI (model names only from env, never in code)
    ai_provider: str = "agnes"
    agnes_base_url: str = "https://apihub.agnes-ai.com/v1"
    agnes_ai_api_key: str = ""
    ai_tier_tutor_model: str = ""
    ai_tier_cheap_model: str = ""
    ai_tier_author_model: str = ""
    ai_tier_vision_model: str = ""
    ai_tier_image_model: str = ""
    ai_request_timeout_s: float = 60.0
    ai_image_timeout_s: float = 360.0
    deepgram_api_key: str = ""
    deepgram_tts_model: str = ""
    deepgram_stt_model: str = ""
    gemini_api_key: str = ""
    gemini_live_model: str = ""

    # Jobs
    jobs_mode: JobsMode | None = None

    # Observability
    otel_exporter_otlp_endpoint: str = ""
    otel_service_name: str = "smriti-api"
    log_level: str = "INFO"
    log_hash_salt: str = ""
    # Sentry error reporting; off when empty. The release defaults to the package version.
    sentry_dsn: str = ""
    sentry_release: str = ""

    # Rate limits (requests per window)
    rate_sync_per_min: int = 60
    rate_dev_auth_per_min: int = 60
    rate_merges_per_day: int = 5
    rate_default_per_min: int = 300

    @property
    def is_dev(self) -> bool:
        return self.app_env in (AppEnv.local, AppEnv.test)

    @property
    def effective_jobs_mode(self) -> JobsMode:
        if self.jobs_mode is not None:
            return self.jobs_mode
        return JobsMode.inline if self.is_dev else JobsMode.arq

    @property
    def cors_origin_list(self) -> list[str]:
        origins = [o.strip() for o in self.cors_origins.split(",") if o.strip()]
        if self.web_app_url:
            origins.append(self.web_app_url.rstrip("/"))
        if self.is_dev:
            origins += [
                "http://localhost:5173",
                "http://127.0.0.1:5173",
                "http://localhost:8081",
                "http://localhost:19006",
            ]
        return sorted(set(origins))

    @property
    def content_base_url(self) -> str:
        if self.is_dev and self.content_local_dir:
            return f"{self.api_public_url.rstrip('/')}/v1/content/files"
        return f"{self.cdn_base_url.rstrip('/')}/c" if self.cdn_base_url else ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
