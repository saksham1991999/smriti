"""Dev auth (docs/contracts/sync.md "Dev auth"): a local stand-in for Supabase anonymous
sign-in, Google sign-in and ``linkIdentity``. Local and test only; the routes are not even
mounted elsewhere. Rows go into the local ``auth`` shim, so the same ``handle_new_user``
trigger runs as it does on Supabase.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

from sqlalchemy import text

from smriti_api.core.auth import AuthContext, JwtVerifier
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.schemas.api import DevGoogleRequest, DevSession

TOKEN_TTL_S = 3600


def _session(
    verifier: JwtVerifier, user_id: uuid.UUID, *, is_anonymous: bool, **kw: Any
) -> DevSession:
    token, exp = verifier.mint_dev_token(
        user_id, is_anonymous=is_anonymous, ttl_s=TOKEN_TTL_S, **kw
    )
    return DevSession(
        access_token=token,
        expires_at=exp,
        expires_in=TOKEN_TTL_S,
        user_id=user_id,
        is_anonymous=is_anonymous,
    )


def _google_meta(body: DevGoogleRequest, sub: str) -> dict[str, Any]:
    given = body.name.strip().split()[0]
    return {
        "iss": "https://accounts.google.com",
        "sub": sub,
        "email": body.email.lower(),
        "email_verified": True,
        "name": body.name.strip(),
        "full_name": body.name.strip(),
        "given_name": given,
        "provider_id": sub,
    }


async def sign_in_anonymously(db: Database, verifier: JwtVerifier) -> DevSession:
    async with db.admin_tx() as session:
        user_id = (
            await session.execute(
                text(
                    "insert into auth.users (is_anonymous, raw_app_meta_data, last_sign_in_at)"
                    " values (true, cast(:app as jsonb), now()) returning id"
                ),
                {"app": json.dumps({"provider": "anonymous", "providers": ["anonymous"]})},
            )
        ).scalar_one()
    return _session(verifier, uuid.UUID(str(user_id)), is_anonymous=True)


async def sign_in_with_google(
    db: Database, verifier: JwtVerifier, body: DevGoogleRequest, guest: AuthContext | None
) -> DevSession:
    sub = body.sub or hashlib.sha256(body.email.lower().encode()).hexdigest()[:21]
    meta = _google_meta(body, sub)
    app_meta = {"provider": "google", "providers": ["google"]}
    async with db.admin_tx() as session:
        owner = (
            await session.execute(
                text(
                    "select user_id from auth.identities where provider = 'google' and provider_id = :s"
                ),
                {"s": sub},
            )
        ).scalar_one_or_none()
        if body.link:
            if guest is None:
                raise ApiError(401, "unauthorized", "Linking needs the guest's Bearer token")
            if not guest.is_anonymous:
                raise ApiError(409, "not_a_guest", "This session is already signed in")
            if owner is not None and owner != guest.user_id:
                # What Supabase's linkIdentity returns; the client goes to the merge path.
                raise ApiError(
                    409,
                    "identity_already_exists",
                    "This Google account already has a Smriti account",
                )
            email_taken = (
                await session.execute(
                    text(
                        "select 1 from auth.users where email = :e and not is_anonymous and id <> :u"
                    ),
                    {"e": body.email.lower(), "u": guest.user_id},
                )
            ).first()
            if email_taken:
                raise ApiError(
                    409,
                    "identity_already_exists",
                    "This Google account already has a Smriti account",
                )
            await session.execute(
                text(
                    "update auth.users set is_anonymous = false, email = :e, raw_user_meta_data = cast(:m as jsonb),"
                    " raw_app_meta_data = cast(:a as jsonb), last_sign_in_at = now(), updated_at = now()"
                    " where id = :u"
                ),
                {
                    "e": body.email.lower(),
                    "m": json.dumps(meta),
                    "a": json.dumps(app_meta),
                    "u": guest.user_id,
                },
            )
            if owner is None:
                await session.execute(
                    text(
                        "insert into auth.identities (user_id, provider, provider_id, identity_data)"
                        " values (:u, 'google', :s, cast(:d as jsonb))"
                    ),
                    {"u": guest.user_id, "s": sub, "d": json.dumps(meta)},
                )
            user_id = guest.user_id
        elif owner is not None:
            user_id = uuid.UUID(str(owner))
            await session.execute(
                text("update auth.users set last_sign_in_at = now() where id = :u"), {"u": user_id}
            )
        else:
            existing = (
                await session.execute(
                    text("select id from auth.users where email = :e and not is_anonymous"),
                    {"e": body.email.lower()},
                )
            ).scalar_one_or_none()
            if existing is not None:
                user_id = uuid.UUID(str(existing))
            else:
                user_id = uuid.UUID(
                    str(
                        (
                            await session.execute(
                                text(
                                    "insert into auth.users (email, is_anonymous, raw_user_meta_data,"
                                    " raw_app_meta_data, last_sign_in_at)"
                                    " values (:e, false, cast(:m as jsonb), cast(:a as jsonb), now()) returning id"
                                ),
                                {
                                    "e": body.email.lower(),
                                    "m": json.dumps(meta),
                                    "a": json.dumps(app_meta),
                                },
                            )
                        ).scalar_one()
                    )
                )
            await session.execute(
                text(
                    "insert into auth.identities (user_id, provider, provider_id, identity_data)"
                    " values (:u, 'google', :s, cast(:d as jsonb))"
                ),
                {"u": user_id, "s": sub, "d": json.dumps(meta)},
            )
    return _session(
        verifier,
        user_id,
        is_anonymous=False,
        email=body.email.lower(),
        provider="google",
        user_metadata={
            k: meta[k]
            for k in ("name", "full_name", "given_name", "email", "email_verified", "sub")
        },
    )
