"""Auth administration behind one interface (auth flow §6.4 step 13, §6.8, §6.11).

* ``SupabaseAuthAdmin`` calls the Supabase Auth admin API (production, preview, staging).
* ``LocalAuthAdmin`` edits the local ``auth`` schema shim directly (local and test only).

Managed children (auth flow §6.11) have an internal email identity nobody types or sees. The
server gives a device a child session through a one-time **token hash**: Supabase's admin
``generate_link`` makes it (no email is sent), and the device exchanges it with supabase-js
``verifyOtp({ token_hash, type: 'email' })``. Locally the hash is kept in memory for 5 minutes
and exchanged at ``POST /v1/dev/auth/verify-otp``.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import time
import uuid
from typing import Any, Protocol

import httpx
from sqlalchemy import text

from smriti_api.core.config import Settings
from smriti_api.core.db import Database

# auth flow §6.11 step 3: "The hash works once and expires in 5 minutes."
TOKEN_HASH_TTL_S = 300


class AuthAdminError(Exception):
    pass


class AuthAdmin(Protocol):
    async def delete_user(self, user_id: uuid.UUID) -> None: ...

    async def sign_out_everywhere(self, user_id: uuid.UUID, access_token: str | None) -> None: ...

    async def make_managed(self, user_id: uuid.UUID, email: str, *, adopt: bool) -> uuid.UUID:
        """Gives ``user_id`` the internal identity ``email``: a new user (``adopt=False``), or a
        guest that becomes permanent and keeps its id (``adopt=True``)."""
        ...

    async def session_token_hash(self, user_id: uuid.UUID, email: str) -> str:
        """A one-time token hash a device exchanges for a session of this user (no email)."""
        ...


_MANAGED_META = {"provider": "email", "providers": ["email"], "managed": True}


class LocalAuthAdmin:
    """Local-only stand-in. Deleting the auth.users row cascades every user table (DB_SCHEMA §1)."""

    def __init__(self, db: Database) -> None:
        self._db = db
        self._tokens: dict[str, tuple[uuid.UUID, float]] = {}

    async def delete_user(self, user_id: uuid.UUID) -> None:
        async with self._db.admin_tx() as session:
            await session.execute(text("delete from auth.users where id = :u"), {"u": user_id})

    async def sign_out_everywhere(self, user_id: uuid.UUID, access_token: str | None) -> None:
        # Dev tokens are stateless; there are no refresh tokens to revoke locally.
        return None

    async def make_managed(self, user_id: uuid.UUID, email: str, *, adopt: bool) -> uuid.UUID:
        async with self._db.admin_tx() as session:
            if adopt:
                res = await session.execute(
                    text(
                        "update auth.users set email = :e, is_anonymous = false,"
                        " raw_app_meta_data = cast(:m as jsonb), updated_at = now()"
                        " where id = :u and is_anonymous"
                    ),
                    {"u": user_id, "e": email, "m": json.dumps(_MANAGED_META)},
                )
                if not res.rowcount:  # type: ignore[attr-defined]
                    raise AuthAdminError("not an anonymous user")
            else:
                await session.execute(
                    text(
                        "insert into auth.users (id, email, is_anonymous, raw_app_meta_data)"
                        " values (:u, :e, false, cast(:m as jsonb))"
                    ),
                    {"u": user_id, "e": email, "m": json.dumps(_MANAGED_META)},
                )
        return user_id

    async def session_token_hash(self, user_id: uuid.UUID, email: str) -> str:
        now = time.time()
        self._tokens = {h: v for h, v in self._tokens.items() if v[1] > now}
        token_hash = hashlib.sha256(secrets.token_bytes(32)).hexdigest()
        self._tokens[token_hash] = (user_id, now + TOKEN_HASH_TTL_S)
        return token_hash

    def consume_token_hash(self, token_hash: str) -> uuid.UUID | None:
        """Local ``verifyOtp``: once, within 5 minutes."""
        entry = self._tokens.pop(token_hash, None)
        if entry is None or entry[1] <= time.time():
            return None
        return entry[0]


class SupabaseAuthAdmin:
    def __init__(self, settings: Settings, http: httpx.AsyncClient) -> None:
        self._base = settings.supabase_url.rstrip("/") + "/auth/v1"
        self._service_key = settings.supabase_service_role_key
        self._anon_key = settings.supabase_anon_key
        self._http = http

    def _admin_headers(self) -> dict[str, str]:
        return {"apikey": self._service_key, "Authorization": f"Bearer {self._service_key}"}

    async def delete_user(self, user_id: uuid.UUID) -> None:
        resp = await self._http.delete(
            f"{self._base}/admin/users/{user_id}", headers=self._admin_headers(), timeout=10
        )
        if resp.status_code not in (200, 204, 404):
            resp.raise_for_status()

    async def sign_out_everywhere(self, user_id: uuid.UUID, access_token: str | None) -> None:
        if not access_token:
            return
        resp = await self._http.post(
            f"{self._base}/logout",
            params={"scope": "global"},
            headers={"apikey": self._anon_key, "Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        if resp.status_code not in (200, 204, 401, 404):
            resp.raise_for_status()

    async def make_managed(self, user_id: uuid.UUID, email: str, *, adopt: bool) -> uuid.UUID:
        body: dict[str, Any] = {
            "email": email,
            "email_confirm": True,
            "app_metadata": {"managed": True},
        }
        if adopt:
            # Setting a confirmed email on an anonymous user makes it permanent with the same id.
            resp = await self._http.put(
                f"{self._base}/admin/users/{user_id}",
                json=body,
                headers=self._admin_headers(),
                timeout=10,
            )
        else:
            resp = await self._http.post(
                f"{self._base}/admin/users",
                json={**body, "id": str(user_id)},
                headers=self._admin_headers(),
                timeout=10,
            )
        if resp.status_code >= 400:
            raise AuthAdminError(f"supabase admin users status {resp.status_code}")
        return uuid.UUID(str(resp.json().get("id", user_id)))

    async def session_token_hash(self, user_id: uuid.UUID, email: str) -> str:
        resp = await self._http.post(
            f"{self._base}/admin/generate_link",
            json={"type": "magiclink", "email": email},
            headers=self._admin_headers(),
            timeout=10,
        )
        if resp.status_code >= 400:
            raise AuthAdminError(f"supabase generate_link status {resp.status_code}")
        data = resp.json()
        props = data.get("properties") if isinstance(data.get("properties"), dict) else {}
        token_hash = data.get("hashed_token") or props.get("hashed_token")
        if not token_hash:
            raise AuthAdminError("generate_link returned no hashed_token")
        return str(token_hash)


def build_auth_admin(settings: Settings, db: Database, http: httpx.AsyncClient) -> AuthAdmin:
    if settings.supabase_url and settings.supabase_service_role_key:
        return SupabaseAuthAdmin(settings, http)
    if settings.is_dev:
        return LocalAuthAdmin(db)
    raise RuntimeError(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required outside local and test"
    )
