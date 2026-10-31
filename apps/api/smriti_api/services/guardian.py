"""Guardian consent for 13 to 17 (auth flow §6.10; DPDP s.9; AGENTS rule 8).

Request (as the teen) -> the guardian reads it by code, signs in with their own Google or Apple
account and agrees or declines -> the consent is stored with its evidence -> scopes can be
withdrawn later. The guardian's email (when the teen asks us to email the link) is used once to
send the message and never stored; logs carry no names, emails or codes.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import uuid
from collections.abc import Collection
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
from smriti_api.integrations.mail import Email, MailError
from smriti_api.schemas import guardian as g
from smriti_api.services import billing, copy, notify
from smriti_api.services import flags as flag_service
from smriti_api.services.versioning import bump, lock_state

log = structlog.get_logger(__name__)

# No 0/O, 1/I/L: the code is read aloud and typed (AUTH-21).
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 8
EMAILS_PER_ADDRESS_PER_DAY = 3  # default for the proposed flag auth.consent_emails_per_day


def new_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def code_hash(code: str) -> str:
    """Matches ``app.consent_request_by_code``: sha256 of the upper-cased code."""
    return hashlib.sha256(code.strip().upper().encode()).hexdigest()


def email_hash(pepper: str, address: str) -> str:
    return hmac.new(
        pepper.encode(), f"email:{address.strip().lower()}".encode(), hashlib.sha256
    ).hexdigest()


def _flag_int(flags: dict[str, Any], key: str, default: int) -> int:
    value = flags.get(key, default)
    return int(value) if isinstance(value, int | float) else default


def _scope_map(granted: Collection[str]) -> dict[str, bool]:
    return {s: s in granted for s in g.SCOPES}


def _scopes_list(scope: Any) -> list[g.Scope]:
    if not isinstance(scope, dict):
        return []
    return [s for s in g.SCOPES if scope.get(s) is True]


async def _retry_at(
    session: AsyncSession, learner: uuid.UUID, flags: dict[str, Any], now: datetime
) -> datetime | None:
    """When the teen may ask again after declines (auth.consent_retry_h, decline limit and pause)."""
    retry_h = _flag_int(flags, "auth.consent_retry_h", 24)
    limit = _flag_int(flags, "auth.consent_decline_limit", 3)
    pause_days = _flag_int(flags, "auth.consent_decline_pause_days", 30)
    declines: list[datetime] = list(
        (
            await session.execute(
                text(
                    "select resolved_at from app.guardian_consent_requests where learner_user_id = :u"
                    " and status = 'declined' and resolved_at > :since order by resolved_at desc"
                ),
                {"u": learner, "since": now - timedelta(days=pause_days)},
            )
        ).scalars()
    )
    if not declines:
        return None
    if len(declines) >= limit:
        until = declines[limit - 1] + timedelta(days=pause_days)
        if until > now:
            return until
    until = declines[0] + timedelta(hours=retry_h)
    return until if until > now else None


async def _profile(session: AsyncSession, user_id: uuid.UUID) -> Any:
    row = (
        await session.execute(
            text(
                "select age_band, account_kind, guardian_consent_state, display_name, first_variant"
                " from app.profiles where user_id = :u for update"
            ),
            {"u": user_id},
        )
    ).one_or_none()
    if row is None:
        raise ApiError(401, "session_ended", "This account no longer exists")
    return row


# --- the teen's side ----------------------------------------------------------------------------


async def create_request(
    db: Database,
    ints: Integrations,
    auth: AuthContext,
    body: g.ConsentRequestCreate,
    app_variant: str | None,
) -> g.ConsentRequestCreated:
    if body.guardian_email is not None and body.channel != "link":
        raise ApiError(422, "email_needs_link", "An emailed request uses the link channel")
    now = datetime.now(UTC)
    code = new_code()
    async with db.system_tx() as session:
        await lock_state(session, auth.user_id)
        p = await _profile(session, auth.user_id)
        if p.age_band == "18p":
            raise ApiError(409, "consent_not_needed", "Adults don't need a guardian's OK")
        if p.age_band is None:
            raise ApiError(409, "age_unknown", "Tell us your class or birth year first")
        if p.account_kind == "managed" or p.age_band in ("u10", "10_12"):
            raise ApiError(
                403,
                "managed_account_required",
                "Under 13, a parent sets up the account (Ask a grown-up)",
            )
        flags = await flag_service.server_flags(session)
        retry = await _retry_at(session, auth.user_id, flags, now)
        if retry is not None:
            raise ApiError(
                429,
                "consent_retry_later",
                "You can ask again later",
                retry_at=retry.isoformat(),
            )
        email_key: str | None = None
        if body.guardian_email is not None:
            email_key = email_hash(ints.identity_pepper, body.guardian_email)
            recent = (
                await session.execute(
                    text(
                        "select count(*) from app.guardian_consent_requests"
                        " where guardian_email_hash = :h and created_at > :since"
                    ),
                    {"h": email_key, "since": now - timedelta(days=1)},
                )
            ).scalar_one()
            if int(recent) >= _flag_int(
                flags, "auth.consent_emails_per_day", EMAILS_PER_ADDRESS_PER_DAY
            ):
                raise ApiError(429, "rate_limited", "Too many emails to this address today")
        # One pending request at a time: a new one replaces the old.
        await session.execute(
            text(
                "update app.guardian_consent_requests set status = 'cancelled', resolved_at = :now"
                " where learner_user_id = :u and status = 'pending'"
            ),
            {"u": auth.user_id, "now": now},
        )
        ttl = (
            timedelta(minutes=_flag_int(flags, "auth.consent_handoff_ttl_min", 15))
            if body.channel == "handoff"
            else timedelta(hours=_flag_int(flags, "auth.consent_link_ttl_h", 72))
        )
        scopes = sorted({"account", *body.scopes}, key=g.SCOPES.index)
        request_id = (
            await session.execute(
                text(
                    "insert into app.guardian_consent_requests (learner_user_id, initiated_by, channel,"
                    " code_hash, scopes, expires_at, delivery, guardian_email_hash, locale, app_variant)"
                    " values (:u, 'learner', :ch, :code, :scopes, :exp, :del, :eh, :loc, :var) returning id"
                ),
                {
                    "u": auth.user_id,
                    "ch": body.channel,
                    "code": code_hash(code),
                    "scopes": scopes,
                    "exp": now + ttl,
                    "del": "email" if email_key else "share",
                    "eh": email_key,
                    "loc": body.locale,
                    "var": app_variant,
                },
            )
        ).scalar_one()
        if p.guardian_consent_state in ("required", "declined", "revoked", "not_required"):
            await session.execute(
                text(
                    "update app.profiles set guardian_consent_state = 'pending' where user_id = :u"
                ),
                {"u": auth.user_id},
            )
            await bump(session, auth.user_id, {"profile"})
        # A guardian already linked (asking for more scopes) gets a push (parent_consent_needed).
        guardians = list(
            (
                await session.execute(
                    text(
                        "select guardian_user_id from app.guardian_links where learner_user_id = :u"
                        " and revoked_at is null"
                    ),
                    {"u": auth.user_id},
                )
            ).scalars()
        )
        first = (p.display_name or "").split(" ")[0] or None
        for guardian_id in guardians:
            if first:
                await notify.enqueue(
                    session,
                    user_id=guardian_id,
                    kind="parent_consent_needed",
                    payload={"child": first},
                    dedupe_key=f"parent_consent_needed:{request_id}:{guardian_id}",
                )
        expires_at = now + ttl
    link = f"{ints.settings.guardian_link_base_url.rstrip('/')}/{code}"
    sent = False
    if body.guardian_email is not None:
        sent = await _send_consent_email(
            ints, body.guardian_email, link, first, body.locale, request_id
        )
        if sent:
            async with db.system_tx() as session:
                await session.execute(
                    text(
                        "update app.guardian_consent_requests set delivered_at = now() where id = :id"
                    ),
                    {"id": request_id},
                )
    log.info(
        "consent_request_created",
        user=hash_user_id(auth.user_id),
        channel=body.channel,
        delivery="email" if body.guardian_email else "share",
        scopes=len(scopes),
    )
    return g.ConsentRequestCreated(
        id=request_id,
        code=code,
        link=link,
        channel=body.channel,
        scopes=scopes,
        expires_at=expires_at,
        email_sent=sent,
    )


async def _send_consent_email(
    ints: Integrations,
    address: str,
    link: str,
    first_name: str | None,
    locale: str,
    request_id: uuid.UUID,
) -> bool:
    brand = ints.settings.brand_name
    subject = (
        copy.text("auth", "AUTH-22.title", locale, first_name=first_name)
        if first_name
        else copy.text("auth", "AUTH-22.title_no_name_yet_consent_first_variant", locale)
    )
    lines = [
        subject,
        "",
        copy.text("auth", "AUTH-22.about_line_1", locale, app_name=brand),
        copy.text("auth", "AUTH-22.about_line_2", locale),
        "",
        copy.text("auth", "AUTH-22.body", locale),
        link,
    ]
    try:
        await ints.mailer.send(
            Email(
                to=address,
                subject=subject,
                text="\n".join(lines),
                template_id="guardian_consent_request",
                idempotency_key=f"consent-{request_id}",
            )
        )
    except MailError:
        log.warning("consent_email_failed", request=str(request_id))
        return False
    return True


async def request_status(
    db: Database, auth: AuthContext, request_id: uuid.UUID
) -> g.ConsentRequestStatus:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        r = (
            await session.execute(
                text(
                    "select id, status, scopes, expires_at, resolved_at from app.guardian_consent_requests"
                    " where id = :id and learner_user_id = :u"
                ),
                {"id": request_id, "u": auth.user_id},
            )
        ).one_or_none()
        if r is None:
            raise ApiError(404, "not_found", "No such request")
        status = r.status
        if status == "pending" and r.expires_at <= now:
            status = "expired"
            await session.execute(
                text(
                    "update app.guardian_consent_requests set status = 'expired', resolved_at = :now"
                    " where id = :id and status = 'pending'"
                ),
                {"id": r.id, "now": now},
            )
        granted: list[g.Scope] = []
        if status == "granted":
            granted = _scopes_list(
                (
                    await session.execute(
                        text(
                            "select scope from app.guardian_consents where user_id = :u"
                            " and revoked_at is null and superseded_by is null"
                        ),
                        {"u": auth.user_id},
                    )
                ).scalar_one_or_none()
            )
        retry = None
        if status == "declined":
            retry = await _retry_at(
                session, auth.user_id, await flag_service.server_flags(session), now
            )
    return g.ConsentRequestStatus(
        id=r.id,
        status=status,
        scopes=list(r.scopes),
        granted_scopes=granted,
        expires_at=r.expires_at,
        resolved_at=r.resolved_at,
        retry_at=retry,
    )


async def my_consent(db: Database, auth: AuthContext) -> g.MyConsentOut:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        p = (
            await session.execute(
                text(
                    "select age_band, guardian_consent_state from app.profiles where user_id = :u"
                ),
                {"u": auth.user_id},
            )
        ).one()
        c = (
            await session.execute(
                text(
                    "select id, scope, consented_at from app.guardian_consents where user_id = :u"
                    " and revoked_at is null and superseded_by is null"
                ),
                {"u": auth.user_id},
            )
        ).one_or_none()
        pending = (
            await session.execute(
                text(
                    "select id from app.guardian_consent_requests where learner_user_id = :u"
                    " and status = 'pending' and expires_at > :now order by created_at desc limit 1"
                ),
                {"u": auth.user_id, "now": now},
            )
        ).scalar_one_or_none()
        retry = await _retry_at(
            session, auth.user_id, await flag_service.server_flags(session), now
        )
        # AUTH-27: open link requests from guardians (the teen's in-app badge).
        links = (
            await session.execute(
                text(
                    "select count(*) from app.guardian_link_requests where learner_user_id = :u"
                    " and status = 'pending' and expires_at > :now"
                ),
                {"u": auth.user_id, "now": now},
            )
        ).scalar_one()
    return g.MyConsentOut(
        state=p.guardian_consent_state,
        age_band=p.age_band,
        needs_consent=p.age_band != "18p" and (c is None),
        scopes=_scopes_list(c.scope) if c else [],
        consent_id=c.id if c else None,
        consented_at=c.consented_at if c else None,
        pending_request_id=pending,
        retry_at=retry,
        pending_link_requests=int(links),
    )


# --- the guardian's side ------------------------------------------------------------------------


async def request_for_guardian(
    db: Database, auth: AuthContext, code: str
) -> g.ConsentRequestForGuardian:
    async with db.user_tx(auth.claims) as session:
        row = (
            await session.execute(
                text("select * from app.consent_request_by_code(:c)"), {"c": code.strip().upper()}
            )
        ).one_or_none()
    if row is None:
        await _explain_missing(db, code)
    assert row is not None
    return g.ConsentRequestForGuardian(
        request_id=row.request_id,
        learner_first_name=row.learner_first_name or None,
        pet_name=row.pet_name,
        pet_species=row.pet_species,
        app_variant=row.app_variant,
        scopes=list(row.scopes),
        expires_at=row.expires_at,
    )


async def _explain_missing(db: Database, code: str) -> None:
    """AUTH-22 shows "expired" or "already answered" rather than a bare not-found."""
    async with db.system_tx() as session:
        status = (
            await session.execute(
                text(
                    "select case when status = 'pending' and expires_at <= now() then 'expired'"
                    " else status end from app.guardian_consent_requests where code_hash = :h"
                ),
                {"h": code_hash(code)},
            )
        ).scalar_one_or_none()
    if status in ("expired", "cancelled"):
        raise ApiError(410, "consent_request_expired", "This link has expired")
    if status in ("granted", "declined"):
        raise ApiError(409, "consent_request_answered", "This request has already been answered")
    raise ApiError(404, "not_found", "No such request")


async def _pending_by_code(
    session: AsyncSession, code: str, now: datetime, guardian: uuid.UUID
) -> Any:
    r = (
        await session.execute(
            text(
                "select id, learner_user_id, status, scopes, expires_at, channel, app_variant,"
                " initiated_by, guardian_user_id"
                " from app.guardian_consent_requests where code_hash = :h for update"
            ),
            {"h": code_hash(code)},
        )
    ).one_or_none()
    if r is None:
        raise ApiError(404, "not_found", "No such request")
    if r.initiated_by == "guardian" and r.guardian_user_id != guardian:
        # AUTH-27: a request the teen accepted from one guardian is that guardian's to answer.
        raise ApiError(404, "not_found", "No such request")
    if r.status in ("granted", "declined"):
        raise ApiError(409, "consent_request_answered", "This request has already been answered")
    if r.status != "pending" or r.expires_at <= now:
        raise ApiError(410, "consent_request_expired", "This link has expired")
    if r.learner_user_id is None:
        # The device-held variant (minor.defer_sync_until_consent on) is not wired yet.
        raise ApiError(409, "consent_request_unclaimed", "This request has no account yet")
    return r


async def _check_guardian(
    session: AsyncSession, ints: Integrations, guardian: AuthContext, learner: uuid.UUID
) -> str:
    """The server checks on confirm (auth flow §6.10). Returns the guardian's identity HMAC."""
    if guardian.user_id == learner:
        raise ApiError(403, "guardian_is_learner", "A guardian must use their own account")
    g_ids = await billing.identity_keys(session, guardian.user_id, ints.identity_pepper)
    if not g_ids:
        raise ApiError(
            403, "guardian_identity_required", "Sign in with Google or Apple to give consent"
        )
    l_ids = {k for k, _ in await billing.identity_keys(session, learner, ints.identity_pepper)}
    if any(k in l_ids for k, _ in g_ids):
        raise ApiError(403, "guardian_is_learner", "A guardian must use their own account")
    gp = (
        await session.execute(
            text("select age_band from app.profiles where user_id = :u for update"),
            {"u": guardian.user_id},
        )
    ).one_or_none()
    if gp is not None and gp.age_band in ("u10", "10_12", "13_17"):
        raise ApiError(403, "guardian_is_minor", "A guardian must be 18 or older")
    if gp is not None and gp.age_band is None:
        # The AUTH-20 declaration says the guardian is 18 or older.
        await session.execute(
            text(
                "update app.profiles set age_band = '18p', age_source = 'self_declared' where user_id = :u"
            ),
            {"u": guardian.user_id},
        )
    return g_ids[0][0]


def _consent_out(row: Any) -> g.ConsentOut:
    return g.ConsentOut(
        id=row.id,
        learner_user_id=row.user_id,
        scopes=_scopes_list(row.scope),
        method=row.method,
        age_assurance=row.age_assurance,
        notice_version=row.notice_version,
        consented_at=row.consented_at,
        revoked_at=row.revoked_at,
    )


async def _write_consent(
    session: AsyncSession,
    *,
    learner: uuid.UUID,
    guardian: uuid.UUID | None,
    sub_hash: str,
    request_id: uuid.UUID | None,
    method: str,
    age_assurance: str,
    scope: dict[str, bool],
    notice_version: str,
    evidence: dict[str, Any],
    now: datetime,
) -> Any:
    """Inserts a consent and supersedes the learner's previous active one (one at a time)."""
    old = (
        await session.execute(
            text(
                "select id from app.guardian_consents where user_id = :u"
                " and revoked_at is null and superseded_by is null for update"
            ),
            {"u": learner},
        )
    ).scalar_one_or_none()
    if old is not None:
        # Step out of the "one active consent" index first; point it at the new row after.
        await session.execute(
            text("update app.guardian_consents set superseded_by = id where id = :id"), {"id": old}
        )
    row = (
        await session.execute(
            text(
                "insert into app.guardian_consents (user_id, guardian_user_id, guardian_sub_hash, request_id,"
                " method, age_assurance, scope, notice_version, consented_at, evidence)"
                " values (:u, :g, :sh, :rid, :m, :aa, cast(:scope as jsonb), :nv, :at, cast(:ev as jsonb))"
                " returning *"
            ),
            {
                "u": learner,
                "g": guardian,
                "sh": sub_hash,
                "rid": request_id,
                "m": method,
                "aa": age_assurance,
                "scope": json.dumps(scope),
                "nv": notice_version,
                "at": now,
                "ev": json.dumps(evidence),
            },
        )
    ).one()
    if old is not None:
        await session.execute(
            text("update app.guardian_consents set superseded_by = :new where id = :id"),
            {"id": old, "new": row.id},
        )
    return row


async def confirm(
    db: Database, ints: Integrations, auth: AuthContext, code: str, body: g.ConsentConfirm
) -> g.ConsentDecision:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        r = await _pending_by_code(session, code, now, auth.user_id)
        learner: uuid.UUID = r.learner_user_id
        await lock_state(session, learner)
        sub_hash = await _check_guardian(session, ints, auth, learner)
        granted = ({"account"} | set(body.scopes)) & set(r.scopes)
        row = await _write_consent(
            session,
            learner=learner,
            guardian=auth.user_id,
            sub_hash=sub_hash,
            request_id=r.id,
            method=body.method,
            age_assurance="self_declared",
            scope=_scope_map(granted),
            notice_version=body.notice_version,
            evidence={
                "request_id": str(r.id),
                "channel": r.channel,
                "app_variant": r.app_variant,
                "app_version": body.app_version,
                "platform": body.platform,
                "declaration_version": body.notice_version,
                "declared_adult_guardian": True,
            },
            now=now,
        )
        await session.execute(
            text(
                "insert into app.guardian_links (guardian_user_id, learner_user_id, kind)"
                " values (:g, :l, 'consent') on conflict (guardian_user_id, learner_user_id)"
                " do update set revoked_at = null"
            ),
            {"g": auth.user_id, "l": learner},
        )
        await session.execute(
            text(
                "update app.guardian_consent_requests set status = 'granted', guardian_user_id = :g,"
                " resolved_at = :now where id = :id"
            ),
            {"id": r.id, "g": auth.user_id, "now": now},
        )
        await session.execute(
            text("update app.profiles set guardian_consent_state = 'granted' where user_id = :u"),
            {"u": learner},
        )
        await bump(session, learner, {"profile"})
        await notify.enqueue(
            session,
            user_id=learner,
            kind="consent_decided",
            payload={"outcome": "granted", "request_id": str(r.id)},
            dedupe_key=f"consent_decided:{r.id}",
        )
    log.info("consent_granted", learner=hash_user_id(learner), scopes=len(granted))
    return g.ConsentDecision(request_id=r.id, status="granted", consent=_consent_out(row))


async def decline(db: Database, auth: AuthContext, code: str) -> g.ConsentDecision:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        r = await _pending_by_code(session, code, now, auth.user_id)
        if auth.user_id == r.learner_user_id:
            raise ApiError(403, "guardian_is_learner", "A guardian must use their own account")
        await lock_state(session, r.learner_user_id)
        await session.execute(
            text(
                "update app.guardian_consent_requests set status = 'declined', guardian_user_id = :g,"
                " resolved_at = :now where id = :id"
            ),
            {"id": r.id, "g": auth.user_id, "now": now},
        )
        await session.execute(
            text(
                "update app.profiles set guardian_consent_state = 'declined' where user_id = :u"
                " and guardian_consent_state <> 'granted'"
            ),
            {"u": r.learner_user_id},
        )
        await bump(session, r.learner_user_id, {"profile"})
        await notify.enqueue(
            session,
            user_id=r.learner_user_id,
            kind="consent_decided",
            payload={"outcome": "declined", "request_id": str(r.id)},
            dedupe_key=f"consent_decided:{r.id}",
        )
    return g.ConsentDecision(request_id=r.id, status="declined", consent=None)


async def withdraw_scope(
    db: Database, auth: AuthContext, consent_id: uuid.UUID, scope: g.Scope
) -> g.ConsentOut:
    """The guardian (Parent mode, SET-17) or the teen turns a scope off. ``account`` withdraws the
    whole consent. Effects are immediate: every gate reads the active consent."""
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        c = (
            await session.execute(
                text("select * from app.guardian_consents where id = :id for update"),
                {"id": consent_id},
            )
        ).one_or_none()
        if c is None or auth.user_id not in (c.user_id, c.guardian_user_id):
            raise ApiError(404, "not_found", "No such consent")
        if c.revoked_at is not None or c.superseded_by is not None:
            raise ApiError(409, "consent_not_active", "This consent is no longer active")
        await lock_state(session, c.user_id)
        by = "guardian" if auth.user_id == c.guardian_user_id else "learner"
        if scope == "account":
            row = (
                await session.execute(
                    text(
                        "update app.guardian_consents set revoked_at = :now, revoked_by = :by"
                        " where id = :id returning *"
                    ),
                    {"id": c.id, "now": now, "by": by},
                )
            ).one()
            await session.execute(
                text(
                    "update app.guardian_links set revoked_at = :now where learner_user_id = :u"
                    " and kind = 'consent' and revoked_at is null"
                ),
                {"u": c.user_id, "now": now},
            )
            await session.execute(
                text(
                    "update app.profiles set guardian_consent_state = 'revoked', discoverable = false"
                    " where user_id = :u"
                ),
                {"u": c.user_id},
            )
        else:
            granted = set(_scopes_list(c.scope)) - {scope}
            evidence = dict(c.evidence or {})
            evidence.update({"withdrawn": scope, "withdrawn_by": by, "previous": str(c.id)})
            row = await _write_consent(
                session,
                learner=c.user_id,
                guardian=c.guardian_user_id,
                sub_hash=c.guardian_sub_hash,
                request_id=c.request_id,
                method=c.method,
                age_assurance=c.age_assurance,
                scope=_scope_map(granted),
                notice_version=c.notice_version,
                evidence=evidence,
                now=c.consented_at,
            )
            if scope == "social":
                await session.execute(
                    text("update app.profiles set discoverable = false where user_id = :u"),
                    {"u": c.user_id},
                )
        await bump(session, c.user_id, {"profile"})
    log.info("consent_scope_withdrawn", learner=hash_user_id(c.user_id), scope=scope, by=by)
    return _consent_out(row)


async def learners(db: Database, auth: AuthContext) -> g.LearnersOut:
    async with db.system_tx() as session:
        rows = (
            await session.execute(
                text(
                    "select gl.learner_user_id, gl.kind, gl.created_at, p.display_name, p.age_band,"
                    " c.id as c_id from app.guardian_links gl"
                    " join app.profiles p on p.user_id = gl.learner_user_id"
                    " left join app.guardian_consents c on c.user_id = gl.learner_user_id"
                    "  and c.revoked_at is null and c.superseded_by is null"
                    " where gl.guardian_user_id = :g and gl.revoked_at is null"
                    " order by gl.created_at"
                ),
                {"g": auth.user_id},
            )
        ).all()
        out = []
        for r in rows:
            consent = None
            if r.c_id is not None:
                c = (
                    await session.execute(
                        text("select * from app.guardian_consents where id = :id"), {"id": r.c_id}
                    )
                ).one()
                consent = _consent_out(c)
            out.append(
                g.LearnerOut(
                    user_id=r.learner_user_id,
                    first_name=(r.display_name or "").split(" ")[0] or None,
                    age_band=r.age_band,
                    kind=r.kind,
                    linked_at=r.created_at,
                    consent=consent,
                )
            )
    return g.LearnersOut(learners=out)


# --- jobs --------------------------------------------------------------------------------------------


async def expire_requests(db: Database, *, now: datetime | None = None) -> int:
    """Marks lapsed requests expired and tells the teen (consent_decided, "no answer in time")."""
    now = now or datetime.now(UTC)
    async with db.system_tx() as session:
        rows = (
            await session.execute(
                text(
                    "update app.guardian_consent_requests set status = 'expired', resolved_at = :now"
                    " where status = 'pending' and expires_at <= :now returning id, learner_user_id, channel"
                ),
                {"now": now},
            )
        ).all()
        for r in rows:
            if r.learner_user_id is not None and r.channel == "link":
                await notify.enqueue(
                    session,
                    user_id=r.learner_user_id,
                    kind="consent_decided",
                    payload={"outcome": "expired", "request_id": str(r.id)},
                    dedupe_key=f"consent_decided:{r.id}",
                )
        # AUTH-27 link requests lapse quietly: the guardian sees "expired" in their list.
        links = (
            await session.execute(
                text(
                    "update app.guardian_link_requests set status = 'expired', resolved_at = :now"
                    " where status = 'pending' and expires_at <= :now returning id"
                ),
                {"now": now},
            )
        ).all()
    return len(rows) + len(links)


async def age_up(db: Database, *, now: datetime | None = None) -> int:
    """The daily turning-18 job (auth flow §6.10): a teen whose birth month says 18 becomes ``18p``
    (the profile trigger clears the consent requirement) and the guardian link ends."""
    now = now or datetime.now(UTC)
    today = now.date()
    async with db.system_tx() as session:
        users = list(
            (
                await session.execute(
                    text(
                        # birth_ym is a month: count from its last day, so nobody is moved early.
                        "update app.profiles set age_band = '18p' where age_band = '13_17'"
                        " and birth_ym is not null"
                        " and (birth_ym + interval '1 month' - interval '1 day' + interval '18 years')::date <= :today"
                        " returning user_id"
                    ),
                    {"today": today},
                )
            ).scalars()
        )
        for user_id in users:
            await session.execute(
                text(
                    "update app.guardian_links set revoked_at = :now where learner_user_id = :u"
                    " and kind = 'consent' and revoked_at is null"
                ),
                {"u": user_id, "now": now},
            )
            await session.execute(
                text(
                    "update app.guardian_consents set revoked_at = :now, revoked_by = 'turned_18'"
                    " where user_id = :u and revoked_at is null and superseded_by is null"
                ),
                {"u": user_id, "now": now},
            )
            await bump(session, user_id, {"profile"})
    return len(users)
