"""Managed accounts for under-13s (auth flow §6.11, AUTH-24 to AUTH-28).

A managed child never signs in. The parent, signed in with their own Google account, creates the
child (adopting the guest that did onboarding on this device, so the child keeps its user id, or
making a new account), and later hands a device a child session through a one-time token hash
(:func:`child_session`, the token-hash path of the F-7 spike). Every child still has its own
``auth.users`` row, and the internal identity ``{child_user_id}@<MANAGED_IDENTITY_DOMAIN>`` is
never shown, typed or logged.

The parent's consent is captured at creation (``method = 'parent_created'``, the AUTH-20
declaration) and the link is ``app.guardian_links.kind = 'managed'``. Deleting a child schedules
the same erasure as an account deletion (auth flow §6.8), run by the purge job.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import structlog
from sqlalchemy import text

from smriti_api.core.auth import AuthContext, JwtVerifier
from smriti_api.core.config import Settings
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.core.logging import hash_user_id
from smriti_api.integrations import Integrations
from smriti_api.schemas import guardian as g
from smriti_api.services import consent_notice, guardian, parent_mode
from smriti_api.services import flags as flag_service
from smriti_api.services.auth_admin import TOKEN_HASH_TTL_S, AuthAdmin, AuthAdminError
from smriti_api.services.versioning import bump

log = structlog.get_logger(__name__)

# auth flow §6.11 step 1: the parent's JWT has an amr entry newer than 10 minutes.
SESSION_REAUTH_S = 600
# Reserved by RFC 2606, so it can never receive mail; local and test only.
DEV_MANAGED_DOMAIN = "managed.smriti.invalid"


def internal_email(settings: Settings, child_id: uuid.UUID) -> str:
    domain = settings.managed_identity_domain.strip().lower()
    if not domain:
        if not settings.is_dev:
            raise ApiError(503, "managed_accounts_unavailable", "Child accounts are not set up yet")
        domain = DEV_MANAGED_DOMAIN
    return f"{child_id}@{domain}"


async def create_child(
    db: Database,
    settings: Settings,
    ints: Integrations,
    auth_admin: AuthAdmin,
    verifier: JwtVerifier,
    parent: AuthContext,
    body: g.ChildCreate,
) -> g.ManagedChildOut:
    adopted = body.adopt_guest is not None
    if body.adopt_guest is not None:
        try:
            guest = await verifier.verify(body.adopt_guest)
        except Exception as exc:  # any verification failure is the same answer
            raise ApiError(400, "invalid_guest", "This guest session is not valid") from exc
        if not guest.is_anonymous:
            raise ApiError(409, "not_a_guest", "Only a guest can become a child account")
        child_id = guest.user_id
    else:
        child_id = uuid.uuid4()
    if child_id == parent.user_id:
        raise ApiError(403, "guardian_is_learner", "A guardian must use their own account")
    email = internal_email(settings, child_id)
    now = datetime.now(UTC)
    # The guardian checks first (adult, own identity), so nothing changes for a refused caller.
    async with db.system_tx() as session:
        await guardian._check_guardian(session, ints, parent, child_id)
        await consent_notice.check_version(session, body.notice_version)
    try:
        await auth_admin.make_managed(child_id, email, adopt=adopted)
    except AuthAdminError as exc:
        raise ApiError(409, "child_not_created", "This child account could not be made") from exc
    granted = {"account"} | set(body.scopes)
    if body.age_band == "u10":
        granted.discard("voice")  # voice is off for little learners (auth flow §6.11)
    async with db.system_tx() as session:
        sub_hash = await guardian._check_guardian(session, ints, parent, child_id)
        sets = (
            "account_kind = 'managed', age_band = :band, age_source = 'guardian',"
            " display_name = :name, guardian_consent_state = 'granted'"
        )
        if body.locale is not None:
            sets += ", locale = :locale"
        await session.execute(
            text(f"update app.profiles set {sets} where user_id = :u"),  # noqa: S608
            {"u": child_id, "band": body.age_band, "name": body.first_name, "locale": body.locale},
        )
        await session.execute(
            text(
                "insert into app.guardian_links (guardian_user_id, learner_user_id, kind)"
                " values (:g, :l, 'managed') on conflict (guardian_user_id, learner_user_id)"
                " do update set kind = 'managed', revoked_at = null"
            ),
            {"g": parent.user_id, "l": child_id},
        )
        row = await guardian._write_consent(
            session,
            learner=child_id,
            guardian=parent.user_id,
            sub_hash=sub_hash,
            request_id=None,
            method="parent_created",
            age_assurance="self_declared",
            scope=guardian._scope_map(granted),
            notice_version=body.notice_version,
            evidence={
                "declaration_version": body.notice_version,
                "declared_adult_guardian": True,
                "adopted_guest": adopted,
            },
            now=now,
        )
        await bump(session, child_id, {"profile"})
    log.info(
        "managed_child_created",
        guardian=hash_user_id(parent.user_id),
        child=hash_user_id(child_id),
        adopted=adopted,
    )
    return g.ManagedChildOut(
        user_id=child_id,
        first_name=body.first_name,
        age_band=body.age_band,
        adopted=adopted,
        consent=guardian._consent_out(row),
    )


async def _managed_child(db: Database, parent: AuthContext, child_id: uuid.UUID) -> None:
    async with db.system_tx() as session:
        child = await parent_mode.child_for(session, parent.user_id, child_id)
    if child.kind != "managed":
        raise ApiError(404, "learner_not_found", "This child isn't linked to your account")


async def child_session(
    db: Database,
    settings: Settings,
    auth_admin: AuthAdmin,
    parent: AuthContext,
    child_id: uuid.UUID,
) -> g.ChildSessionOut:
    """``POST /v1/guardian/children/{id}/session`` (auth flow §6.11 steps 1 to 3)."""
    if not parent.amr_fresh_within(SESSION_REAUTH_S):
        raise ApiError(401, "reauth_required", "Sign in again to continue", reason="parent_mode")
    await _managed_child(db, parent, child_id)
    try:
        token_hash = await auth_admin.session_token_hash(
            child_id, internal_email(settings, child_id)
        )
    except AuthAdminError as exc:
        raise ApiError(502, "auth_provider_error", "Sign-in is not answering. Try again.") from exc
    log.info("managed_child_session", child=hash_user_id(child_id))
    return g.ChildSessionOut(user_id=child_id, token_hash=token_hash, expires_in=TOKEN_HASH_TTL_S)


async def delete_child(
    db: Database, auth_admin: AuthAdmin, parent: AuthContext, child_id: uuid.UUID
) -> g.ChildDeletionOut:
    """SET-14 → AUTH-13 to AUTH-16 in the parent's session: the child's account is scheduled for
    erasure after the usual grace period (auth flow §6.8), and its devices are signed out."""
    await _managed_child(db, parent, child_id)
    async with db.system_tx() as session:
        flags = await flag_service.server_flags(session)
        grace = int(flags.get("auth.deletion_grace_days", 7) or 7)
        current = (
            await session.execute(
                text(
                    "select deletion_scheduled_for from app.profiles where user_id = :u for update"
                ),
                {"u": child_id},
            )
        ).scalar_one_or_none()
        when: datetime = current or datetime.now(UTC) + timedelta(days=grace)
        if current is None:
            await session.execute(
                text(
                    "update app.profiles set deletion_scheduled_for = :w, discoverable = false"
                    " where user_id = :u"
                ),
                {"w": when, "u": child_id},
            )
            await session.execute(
                text(
                    "insert into app.data_requests (user_id, kind, status)"
                    " values (:u, 'erasure', 'open')"
                ),
                {"u": child_id},
            )
            await session.execute(
                text("delete from app.devices where user_id = :u"), {"u": child_id}
            )
    await auth_admin.sign_out_everywhere(child_id, None)
    log.info("managed_child_deletion", child=hash_user_id(child_id))
    return g.ChildDeletionOut(user_id=child_id, scheduled_for=when)
