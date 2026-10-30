"""Supabase JWT verification (TRD §5 "Auth", auth flow §6.9, §12).

Production tokens are signed with Supabase's asymmetric keys and verified against the
project's JWKS (cached, refreshed when an unknown ``kid`` shows up). In ``local`` and
``test`` only, HS256 tokens signed with the dev key are accepted too; those come from the
dev auth endpoints (docs/contracts/sync.md "Dev auth").
"""

from __future__ import annotations

import secrets
import time
import uuid
from typing import Any

import httpx
import jwt
import structlog
from jwt.types import Options
from pydantic import BaseModel, ConfigDict, Field

from smriti_api.core.config import Settings
from smriti_api.core.errors import ApiError

log = structlog.get_logger(__name__)

ASYMMETRIC_ALGS = ("ES256", "RS256", "EdDSA")
DEV_REFRESH_AUDIENCE = "smriti-dev-refresh"


class AmrEntry(BaseModel):
    method: str
    timestamp: int


class AuthContext(BaseModel):
    """The verified caller. Built only from a verified token."""

    model_config = ConfigDict(frozen=True)

    user_id: uuid.UUID
    is_anonymous: bool
    role: str
    amr: list[AmrEntry] = Field(default_factory=list)
    session_id: str | None = None
    claims: dict[str, Any] = Field(default_factory=dict, repr=False)
    token: str = Field(default="", repr=False, exclude=True)

    def amr_fresh_within(self, seconds: int, now: float | None = None) -> bool:
        """True when the token proves a real sign-in (not anonymous) within ``seconds`` (AUTH-15)."""
        current = time.time() if now is None else now
        return any(e.method != "anonymous" and current - e.timestamp <= seconds for e in self.amr)

    @property
    def user_metadata(self) -> dict[str, Any]:
        meta = self.claims.get("user_metadata")
        return meta if isinstance(meta, dict) else {}


class JwtVerifier:
    def __init__(self, settings: Settings, http: httpx.AsyncClient) -> None:
        self._settings = settings
        self._http = http
        self._keys: dict[str, jwt.PyJWK] = {}
        self._fetched_at = 0.0
        self.dev_secret = settings.dev_jwt_secret or (
            secrets.token_urlsafe(48) if settings.is_dev else ""
        )
        if settings.is_dev and not settings.dev_jwt_secret:
            log.info("dev_jwt_secret_generated", note="dev tokens are valid for this process only")

    async def _jwks_key(self, kid: str | None) -> jwt.PyJWK:
        url = self._settings.supabase_jwks_url
        if not url:
            raise ApiError(401, "invalid_token", "Token signing keys are not configured")
        if kid is None or kid not in self._keys:
            if time.monotonic() - self._fetched_at > 30 or not self._keys:
                resp = await self._http.get(url, timeout=5)
                resp.raise_for_status()
                keys = jwt.PyJWKSet.from_dict(resp.json())
                self._keys = {k.key_id: k for k in keys.keys if k.key_id}
                self._fetched_at = time.monotonic()
        if kid is not None and kid in self._keys:
            return self._keys[kid]
        if kid is None and len(self._keys) == 1:
            return next(iter(self._keys.values()))
        raise ApiError(401, "invalid_token", "Unknown signing key")

    async def verify(self, token: str) -> AuthContext:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as exc:
            raise ApiError(401, "invalid_token", "Malformed token") from exc
        alg = header.get("alg")
        key: Any
        if alg == "HS256":
            if not self._settings.is_dev or not self.dev_secret:
                raise ApiError(401, "invalid_token", "Unsupported token algorithm")
            key = self.dev_secret
        elif alg in ASYMMETRIC_ALGS:
            key = await self._jwks_key(header.get("kid"))
        else:
            raise ApiError(401, "invalid_token", "Unsupported token algorithm")

        options: Options = {"require": ["exp", "sub"]}
        try:
            claims: dict[str, Any] = jwt.decode(
                token,
                key=key,
                algorithms=[alg],
                audience=self._settings.jwt_audience,
                issuer=self._settings.jwt_issuer or None,
                leeway=self._settings.jwt_leeway_s,
                options=options,
            )
        except jwt.ExpiredSignatureError as exc:
            raise ApiError(401, "token_expired", "The session token has expired") from exc
        except jwt.PyJWTError as exc:
            raise ApiError(401, "invalid_token", "The session token is not valid") from exc

        if claims.get("role") != "authenticated":
            raise ApiError(401, "invalid_token", "The token is not a user token")
        try:
            user_id = uuid.UUID(str(claims["sub"]))
        except ValueError as exc:
            raise ApiError(401, "invalid_token", "The token subject is not a user id") from exc
        amr = [
            AmrEntry(method=str(e.get("method", "")), timestamp=int(e.get("timestamp", 0)))
            for e in claims.get("amr", [])
            if isinstance(e, dict)
        ]
        return AuthContext(
            user_id=user_id,
            is_anonymous=bool(claims.get("is_anonymous", False)),
            role="authenticated",
            amr=amr,
            session_id=claims.get("session_id"),
            claims=claims,
            token=token,
        )

    def mint_dev_token(
        self,
        user_id: uuid.UUID,
        *,
        is_anonymous: bool,
        email: str | None = None,
        provider: str = "anonymous",
        user_metadata: dict[str, Any] | None = None,
        ttl_s: int = 3600,
        auth_time: int | None = None,
        session_id: str | None = None,
    ) -> tuple[str, int]:
        """A token shaped like a Supabase access token, signed with the dev key. Local/test only.
        ``auth_time`` keeps the original sign-in time in ``amr`` across refreshes, as Supabase does."""
        if not self._settings.is_dev:
            raise ApiError(404, "not_found", "Not found")
        now = int(time.time())
        claims: dict[str, Any] = {
            "iss": self._settings.jwt_issuer or "smriti-dev",
            "aud": self._settings.jwt_audience,
            "sub": str(user_id),
            "role": "authenticated",
            "iat": now,
            "exp": now + ttl_s,
            "is_anonymous": is_anonymous,
            "session_id": session_id or str(uuid.uuid4()),
            "aal": "aal1",
            "amr": [
                {
                    "method": "anonymous" if is_anonymous else "oauth",
                    "timestamp": auth_time if auth_time is not None else now,
                }
            ],
            "app_metadata": {"provider": provider, "providers": [provider]},
            "user_metadata": user_metadata or {},
        }
        if email:
            claims["email"] = email
        token = jwt.encode(claims, self.dev_secret, algorithm="HS256")
        return token, now + ttl_s

    def mint_dev_refresh_token(
        self, user_id: uuid.UUID, *, auth_time: int, session_id: str, ttl_s: int = 30 * 86400
    ) -> str:
        """A dev refresh token. It has its own audience and no ``authenticated`` role, so
        ``verify`` never accepts it as an access token."""
        if not self._settings.is_dev:
            raise ApiError(404, "not_found", "Not found")
        now = int(time.time())
        claims = {
            "aud": DEV_REFRESH_AUDIENCE,
            "sub": str(user_id),
            "typ": "refresh",
            "iat": now,
            "exp": now + ttl_s,
            "auth_time": auth_time,
            "session_id": session_id,
            "jti": secrets.token_urlsafe(12),
        }
        return jwt.encode(claims, self.dev_secret, algorithm="HS256")

    def decode_dev_refresh_token(self, token: str) -> dict[str, Any]:
        if not self._settings.is_dev or not self.dev_secret:
            raise ApiError(404, "not_found", "Not found")
        options: Options = {"require": ["exp", "sub", "auth_time"]}
        try:
            claims: dict[str, Any] = jwt.decode(
                token,
                key=self.dev_secret,
                algorithms=["HS256"],
                audience=DEV_REFRESH_AUDIENCE,
                options=options,
            )
        except jwt.PyJWTError as exc:
            raise ApiError(401, "invalid_grant", "The refresh token is not valid") from exc
        if claims.get("typ") != "refresh":
            raise ApiError(401, "invalid_grant", "The refresh token is not valid")
        return claims
