"""``GET``/``PATCH /v1/me`` and ``PUT /v1/me/exams``. Reads and owner writes run as the student
(RLS on); the profile section version is bumped so other devices pick the change up."""

from __future__ import annotations

import json

from sqlalchemy import text

from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.schemas.api import ExamsPut, MePatch, MeResponse
from smriti_api.services import profile_rules
from smriti_api.services.recompute import zone
from smriti_api.services.state import entitlement_state, profile_state
from smriti_api.services.versioning import bump, lock_state


async def get_me(db: Database, auth: AuthContext) -> MeResponse:
    async with db.user_tx(auth.claims) as session:
        row = (
            await session.execute(
                text(
                    "select handle, discoverable, signed_up_at, account_kind, guardian_consent_state,"
                    " deletion_scheduled_for, referral_code from app.profiles where user_id = :u"
                ),
                {"u": auth.user_id},
            )
        ).one_or_none()
        if row is None:
            raise ApiError(401, "session_ended", "This account no longer exists")
        return MeResponse(
            profile=await profile_state(session, auth),
            handle=row.handle,
            discoverable=row.discoverable,
            signed_up_at=row.signed_up_at,
            account_kind=row.account_kind,
            guardian_consent_state=row.guardian_consent_state,
            deletion_scheduled_for=row.deletion_scheduled_for,
            referral_code=row.referral_code,
            entitlement=await entitlement_state(session, auth.user_id),
        )


async def patch_me(db: Database, auth: AuthContext, patch: MePatch) -> MeResponse:
    fields = patch.model_dump(exclude_unset=True)
    if not fields:
        return await get_me(db, auth)
    if (
        "timezone" in fields
        and fields["timezone"] is not None
        and zone(fields["timezone"]).key != fields["timezone"]
    ):
        raise ApiError(422, "invalid_timezone", "Use an IANA timezone name such as Asia/Kolkata")
    if fields.get("discoverable") and auth.is_anonymous:
        raise ApiError(401, "login_required", "Sign in to continue", reason="discoverable")
    async with db.system_tx() as session:
        await lock_state(session, auth.user_id)
        minor = (
            await session.execute(
                text("select is_minor from app.profiles where user_id = :u"), {"u": auth.user_id}
            )
        ).scalar_one_or_none()
        if fields.get("discoverable") and minor:
            raise ApiError(
                403, "not_allowed_for_minors", "Discoverability is off for learners under 18"
            )
        simple = {
            k: v
            for k, v in fields.items()
            if k in ("display_name", "locale", "timezone", "daily_goal_minutes", "discoverable")
        }
        for key, value in simple.items():
            if value is None and key != "display_name":
                continue
            await session.execute(
                text(f"update app.profiles set {key} = :v where user_id = :u"),  # noqa: S608 - fixed column names
                {"v": value, "u": auth.user_id},
            )
        if fields.get("settings"):
            await session.execute(
                text(
                    "update app.profiles set settings = settings || cast(:s as jsonb) where user_id = :u"
                ),
                {"s": json.dumps(fields["settings"]), "u": auth.user_id},
            )
        sections = {"profile"}
        if "timezone" in simple or "daily_goal_minutes" in simple:
            sections |= {"streak", "wallet"}
        await bump(session, auth.user_id, sections)
    return await get_me(db, auth)


async def put_exams(db: Database, auth: AuthContext, body: ExamsPut) -> MeResponse:
    async with db.system_tx() as session:
        await lock_state(session, auth.user_id)
        try:
            await profile_rules.set_exams(
                session, auth.user_id, body.exam_profile_ids, body.primary
            )
        except profile_rules.ProfileValueError as exc:
            raise ApiError(422, "unknown_exam_profile", str(exc)) from exc
        await bump(session, auth.user_id, {"profile"})
    return await get_me(db, auth)
