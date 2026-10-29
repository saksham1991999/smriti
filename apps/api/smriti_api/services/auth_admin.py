"""Auth administration behind one interface (auth flow §6.4 step 13, §6.8).

* ``SupabaseAuthAdmin`` calls the Supabase Auth admin API (production, preview, staging).
* ``LocalAuthAdmin`` edits the local ``auth`` schema shim directly (local and test only).
"""

from __future__ import annotations

import uuid
from typing import Protocol

import httpx
from sqlalchemy import text

from smriti_api.core.config import Settings
from smriti_api.core.db import Database


class AuthAdmin(Protocol):
    async def delete_user(self, user_id: uuid.UUID) -> None: ...

    async def sign_out_everywhere(self, user_id: uuid.UUID, access_token: str | None) -> None: ...


class LocalAuthAdmin:
    """Local-only stand-in. Deleting the auth.users row cascades every user table (DB_SCHEMA §1)."""

    def __init__(self, db: Database) -> None:
        self._db = db

    async def delete_user(self, user_id: uuid.UUID) -> None:
        async with self._db.admin_tx() as session:
            await session.execute(text("delete from auth.users where id = :u"), {"u": user_id})

    async def sign_out_everywhere(self, user_id: uuid.UUID, access_token: str | None) -> None:
        # Dev tokens are stateless; there are no refresh tokens to revoke locally.
        return None


class SupabaseAuthAdmin:
    def __init__(self, settings: Settings, http: httpx.AsyncClient) -> None:
        self._base = settings.supabase_url.rstrip("/") + "/auth/v1"
        self._service_key = settings.supabase_service_role_key
        self._anon_key = settings.supabase_anon_key
        self._http = http

    async def delete_user(self, user_id: uuid.UUID) -> None:
        resp = await self._http.delete(
            f"{self._base}/admin/users/{user_id}",
            headers={"apikey": self._service_key, "Authorization": f"Bearer {self._service_key}"},
            timeout=10,
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


def build_auth_admin(settings: Settings, db: Database, http: httpx.AsyncClient) -> AuthAdmin:
    if settings.supabase_url and settings.supabase_service_role_key:
        return SupabaseAuthAdmin(settings, http)
    if settings.is_dev:
        return LocalAuthAdmin(db)
    raise RuntimeError(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required outside local and test"
    )
