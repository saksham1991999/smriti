"""AUTH-27: a guardian links an existing teen (auth flow §6.11 "Linking an existing teen to a
parent"; me-money SET-18 path 2).

1. The guardian starts a request (``app.guardian_link_requests``). It can target the teen's sign-in
   email (matched to an account, stored only as an HMAC) or the teen's invite code. With neither,
   the guardian shows the returned code as a QR and the teen claims it. The answer never says
   whether an account matched.
2. A targeted teen gets a push (``guardian_link_request``, the AUTH-27 line) and sees the request
   in the app (``GET /v1/me/link-requests``, and ``pending_link_requests`` on
   ``/v1/guardian/consent``). Lapsed requests are marked by ``guardian.expire_requests``.
3. The teen accepts or declines. On accept the teen's evidence is recorded and the usual §6.10
   consent request is opened with ``initiated_by = 'guardian'`` and the same code. Only this
   guardian can then agree to it on AUTH-20, which creates the consent and the link.

Requests last ``auth.link_request_ttl_h`` hours. A guardian may start ``auth.link_requests_per_day``
a day. Logs carry hashed ids only, never codes or emails.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.core.logging import hash_user_id
from smriti_api.integrations import Integrations
from smriti_api.schemas import guardian as g
from smriti_api.services import consent_notice, notify
from smriti_api.services import flags as flag_service
from smriti_api.services.guardian import (
    _flag_int,
    _profile,
    _scopes_list,
    code_hash,
    email_hash,
    new_code,
)
from smriti_api.services.versioning import bump, lock_state

log = structlog.get_logger(__name__)

TTL_H = 72  # default for the proposed flag auth.link_request_ttl_h
PER_DAY = 5  # default for the proposed flag auth.link_requests_per_day


def _first(name: str | None) -> str | None:
    return (name or "").split(" ")[0] or None


async def _teen_for(session: AsyncSession, body: g.LinkRequestCreate) -> uuid.UUID | None:
    """The signed-in 13 to 17 account the email or invite code names, if any."""
    if body.teen_email is not None:
        sql = (
            "select u.id from auth.users u join app.profiles p on p.user_id = u.id"
            " where lower(u.email) = lower(:v) and not u.is_anonymous"
        )
        value: str = body.teen_email
    elif body.teen_code is not None:
        sql = "select p.user_id from app.profiles p where p.referral_code = :v"
        value = body.teen_code.lower()  # invite codes are lower case (social_people.new_code)
    else:
        return None
    sql += (
        " and p.age_band = '13_17' and p.account_kind = 'learner'"
        " and p.deletion_scheduled_for is null limit 1"
    )
    found = (await session.execute(text(sql), {"v": value})).scalar_one_or_none()
    return uuid.UUID(str(found)) if found is not None else None


async def create(
    db: Database, ints: Integrations, guardian: AuthContext, body: g.LinkRequestCreate
) -> g.LinkRequestCreated:
    if body.teen_email is not None and body.teen_code is not None:
        raise ApiError(422, "one_target", "Give the teen's email or code, not both")
    now = datetime.now(UTC)
    code = new_code()
    async with db.system_tx() as session:
        me = await _profile(session, guardian.user_id)
        if me.age_band != "18p":
            raise ApiError(403, "guardian_is_minor", "A guardian must be 18 or older")
        flags = await flag_service.server_flags(session)
        recent = (
            await session.execute(
                text(
                    "select count(*) from app.guardian_link_requests"
                    " where guardian_user_id = :g and created_at > :since"
                ),
                {"g": guardian.user_id, "since": now - timedelta(days=1)},
            )
        ).scalar_one()
        if int(recent) >= _flag_int(flags, "auth.link_requests_per_day", PER_DAY):
            raise ApiError(429, "rate_limited", "Too many link requests today. Try tomorrow.")
        teen = await _teen_for(session, body)
        if teen == guardian.user_id:
            teen = None
        if teen is not None:
            # A newer request to the same teen replaces the open one.
            await session.execute(
                text(
                    "update app.guardian_link_requests set status = 'cancelled', resolved_at = :now"
                    " where guardian_user_id = :g and learner_user_id = :t and status = 'pending'"
                ),
                {"g": guardian.user_id, "t": teen, "now": now},
            )
        expires_at = now + timedelta(hours=_flag_int(flags, "auth.link_request_ttl_h", TTL_H))
        scopes = sorted({"account", *body.scopes}, key=g.SCOPES.index)
        request_id = (
            await session.execute(
                text(
                    "insert into app.guardian_link_requests (guardian_user_id, learner_user_id,"
                    " code_hash, target_email_hash, scopes, expires_at)"
                    " values (:g, :t, :c, :eh, :s, :exp) returning id"
                ),
                {
                    "g": guardian.user_id,
                    "t": teen,
                    "c": code_hash(code),
                    "eh": email_hash(ints.identity_pepper, body.teen_email)
                    if body.teen_email
                    else None,
                    "s": scopes,
                    "exp": expires_at,
                },
            )
        ).scalar_one()
        parent = _first(me.display_name)
        if teen is not None:
            await bump(session, teen, {"profile"})
            if parent:
                await notify.enqueue(
                    session,
                    user_id=teen,
                    kind="guardian_link_request",
                    payload={"parent_first_name": parent, "request_id": str(request_id)},
                    dedupe_key=f"guardian_link_request:{request_id}",
                )
    log.info(
        "link_request_created",
        guardian=hash_user_id(guardian.user_id),
        target="email" if body.teen_email else "code" if body.teen_code else "open",
    )
    link = f"{ints.settings.guardian_link_base_url.rstrip('/')}/link/{code}"
    return g.LinkRequestCreated(
        id=request_id, code=code, link=link, scopes=scopes, expires_at=expires_at
    )


async def _expire(session: AsyncSession, now: datetime, user_id: uuid.UUID) -> None:
    """Marks the caller's lapsed requests (as guardian or as teen) before a list is read."""
    await session.execute(
        text(
            "update app.guardian_link_requests set status = 'expired', resolved_at = :now"
            " where status = 'pending' and expires_at <= :now"
            " and (guardian_user_id = :u or learner_user_id = :u)"
        ),
        {"now": now, "u": user_id},
    )


async def for_guardian(db: Database, guardian: AuthContext) -> list[g.GuardianLinkRequestOut]:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        await _expire(session, now, guardian.user_id)
        rows = (
            await session.execute(
                text(
                    "select r.*, p.display_name from app.guardian_link_requests r"
                    " left join app.profiles p on p.user_id = r.learner_user_id"
                    " where r.guardian_user_id = :g order by r.created_at desc limit 50"
                ),
                {"g": guardian.user_id},
            )
        ).all()
    return [
        g.GuardianLinkRequestOut(
            id=r.id,
            status=r.status,
            scopes=_scopes_list(dict.fromkeys(r.scopes, True)),
            learner_first_name=_first(r.display_name) if r.status == "accepted" else None,
            consent_request_id=r.consent_request_id,
            created_at=r.created_at,
            expires_at=r.expires_at,
        )
        for r in rows
    ]


async def cancel(db: Database, guardian: AuthContext, request_id: uuid.UUID) -> None:
    async with db.system_tx() as session:
        res = await session.execute(
            text(
                "update app.guardian_link_requests set status = 'cancelled', resolved_at = now()"
                " where id = :id and guardian_user_id = :g and status = 'pending'"
            ),
            {"id": request_id, "g": guardian.user_id},
        )
        if not res.rowcount:  # type: ignore[attr-defined]
            raise ApiError(404, "not_found", "No open request")


def _teen_out(r: Any) -> g.TeenLinkRequestOut:
    return g.TeenLinkRequestOut(
        id=r.id,
        status=r.status,
        parent_first_name=_first(r.display_name),
        scopes=_scopes_list(dict.fromkeys(r.scopes, True)),
        expires_at=r.expires_at,
    )


_TEEN_SELECT = (
    "select r.*, p.display_name from app.guardian_link_requests r"
    " left join app.profiles p on p.user_id = r.guardian_user_id"
)


async def _require_teen(session: AsyncSession, teen: AuthContext) -> Any:
    p = await _profile(session, teen.user_id)
    if p.age_band == "18p":
        raise ApiError(409, "consent_not_needed", "Adults don't need a guardian's OK")
    if p.age_band != "13_17" or p.account_kind != "learner":
        raise ApiError(403, "teen_only", "This is for 13 to 17 year olds with their own sign-in")
    return p


async def for_teen(db: Database, teen: AuthContext) -> list[g.TeenLinkRequestOut]:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        await _expire(session, now, teen.user_id)
        rows = (
            await session.execute(
                text(
                    _TEEN_SELECT + " where r.learner_user_id = :t and r.status = 'pending'"
                    " order by r.created_at desc"
                ),
                {"t": teen.user_id},
            )
        ).all()
    return [_teen_out(r) for r in rows]


async def claim(db: Database, teen: AuthContext, body: g.LinkClaim) -> g.TeenLinkRequestOut:
    """The teen scanned or typed the guardian's code: the open request becomes theirs."""
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        await _require_teen(session, teen)
        r = (
            await session.execute(
                text(_TEEN_SELECT + " where r.code_hash = :h for update of r"),
                {"h": code_hash(body.code)},
            )
        ).one_or_none()
        if r is None or r.guardian_user_id == teen.user_id:
            raise ApiError(404, "not_found", "No such request")
        if r.learner_user_id not in (None, teen.user_id):
            raise ApiError(404, "not_found", "No such request")
        if r.status != "pending" or r.expires_at <= now:
            raise ApiError(410, "link_request_expired", "This request has expired")
        if r.learner_user_id is None:
            await session.execute(
                text(
                    "update app.guardian_link_requests set status = 'cancelled', resolved_at = :now"
                    " where guardian_user_id = :g and learner_user_id = :t and status = 'pending'"
                ),
                {"g": r.guardian_user_id, "t": teen.user_id, "now": now},
            )
            await session.execute(
                text("update app.guardian_link_requests set learner_user_id = :t where id = :id"),
                {"t": teen.user_id, "id": r.id},
            )
    return _teen_out(r)


async def _mine(session: AsyncSession, teen: AuthContext, request_id: uuid.UUID) -> Any:
    r = (
        await session.execute(
            text(_TEEN_SELECT + " where r.id = :id and r.learner_user_id = :t for update of r"),
            {"id": request_id, "t": teen.user_id},
        )
    ).one_or_none()
    if r is None:
        raise ApiError(404, "not_found", "No such request")
    if r.status in ("accepted", "declined"):
        raise ApiError(409, "link_request_answered", "This request has already been answered")
    if r.status != "pending" or r.expires_at <= datetime.now(UTC):
        raise ApiError(410, "link_request_expired", "This request has expired")
    return r


async def accept(
    db: Database, teen: AuthContext, request_id: uuid.UUID, body: g.LinkAccept
) -> g.LinkDecision:
    """AUTH-27 [Yes, link]: evidence on the request, then the §6.10 consent request (same code)
    that only this guardian can agree to on AUTH-20."""
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        await lock_state(session, teen.user_id)
        p = await _require_teen(session, teen)
        r = await _mine(session, teen, request_id)
        await consent_notice.check_version(session, body.notice_version)
        flags = await flag_service.server_flags(session)
        evidence = {
            "accepted_at": now.isoformat(),
            "notice_version": body.notice_version,
            "app_version": body.app_version,
            "platform": body.platform,
            "scopes_shown": list(r.scopes),
            "learner_session": teen.session_id,
        }
        # One pending consent request at a time (as create_request): this one replaces the old.
        await session.execute(
            text(
                "update app.guardian_consent_requests set status = 'cancelled', resolved_at = :now"
                " where learner_user_id = :u and status = 'pending'"
            ),
            {"u": teen.user_id, "now": now},
        )
        ttl = timedelta(hours=_flag_int(flags, "auth.consent_link_ttl_h", 72))
        consent_request = (
            await session.execute(
                text(
                    "insert into app.guardian_consent_requests (learner_user_id, initiated_by,"
                    " channel, code_hash, scopes, expires_at, guardian_user_id, delivery)"
                    " values (:u, 'guardian', 'link', :c, :s, :exp, :g, 'share') returning id"
                ),
                {
                    "u": teen.user_id,
                    "c": r.code_hash,
                    "s": list(r.scopes),
                    "exp": now + ttl,
                    "g": r.guardian_user_id,
                },
            )
        ).scalar_one()
        await session.execute(
            text(
                "update app.guardian_link_requests set status = 'accepted', resolved_at = :now,"
                " consent_request_id = :cr, evidence = cast(:ev as jsonb) where id = :id"
            ),
            {"id": r.id, "now": now, "cr": consent_request, "ev": json.dumps(evidence)},
        )
        if p.guardian_consent_state in ("required", "declined", "revoked", "not_required"):
            await session.execute(
                text(
                    "update app.profiles set guardian_consent_state = 'pending' where user_id = :u"
                ),
                {"u": teen.user_id},
            )
        await bump(session, teen.user_id, {"profile"})
        child = _first(p.display_name)
        if child:
            await notify.enqueue(
                session,
                user_id=r.guardian_user_id,
                kind="parent_consent_needed",
                payload={"child": child},
                dedupe_key=f"parent_consent_needed:{consent_request}:{r.guardian_user_id}",
            )
    log.info("link_request_accepted", learner=hash_user_id(teen.user_id))
    return g.LinkDecision(id=request_id, status="accepted", consent_request_id=consent_request)


async def decline(db: Database, teen: AuthContext, request_id: uuid.UUID) -> g.LinkDecision:
    """AUTH-27 [This isn't my parent]: nothing is linked and the guardian learns only that the
    request was declined."""
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        await _require_teen(session, teen)
        r = await _mine(session, teen, request_id)
        await session.execute(
            text(
                "update app.guardian_link_requests set status = 'declined', resolved_at = :now,"
                " evidence = cast(:ev as jsonb) where id = :id"
            ),
            {"id": r.id, "now": now, "ev": json.dumps({"declined_at": now.isoformat()})},
        )
    log.info("link_request_declined", learner=hash_user_id(teen.user_id))
    return g.LinkDecision(id=request_id, status="declined", consent_request_id=None)
