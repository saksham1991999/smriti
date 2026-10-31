"""The family plan's seats and invites (PRD §11.2 "Family plan for siblings", Phase 3).

The payer buys a family product (``billing.products.plan = 'family'``); while that subscription
gives Pro, the payer owns one ``billing.family_groups`` row (made on first use) with
``billing.family_seats`` places for other people. A child joins when the payer adds them through
a live guardian link with consent (parent mode); an adult joins with an invite code the payer
shares. Minors never join by code. Each member's Pro has source ``family`` and follows the
payer's subscription (:func:`billing.recompute_family_members`). Codes are stored hashed; logs
carry hashed ids only.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.core.logging import hash_user_id
from smriti_api.schemas import billing as b
from smriti_api.services import billing, parent_mode
from smriti_api.services import flags as flag_service
from smriti_api.services.guardian import code_hash, new_code

log = structlog.get_logger(__name__)


async def _seats(session: AsyncSession) -> int:
    return await flag_service.server_pos_int(session, "billing.family_seats", 0)


async def _owner_group(session: AsyncSession, owner_id: uuid.UUID, now: datetime) -> uuid.UUID:
    """The payer's group for a family subscription that gives Pro now (made on first use)."""
    subs = (
        await session.execute(
            text(
                """
                select s.id, s.status, s.current_period_end, s.grace_until, s.refunded_at,
                       s.revoked_at
                  from billing.subscriptions s join billing.products p on p.id = s.product_id
                 where s.user_id = :u and p.plan = 'family'
                 order by s.current_period_end desc nulls last
                """
            ),
            {"u": owner_id},
        )
    ).all()
    sub = next((r for r in subs if billing._gives_pro(r, now)), None)
    if sub is None:
        raise ApiError(404, "no_family_plan", "There is no family plan on this account")
    await session.execute(
        text(
            "insert into billing.family_groups (owner_user_id, subscription_id) values (:o, :s)"
            " on conflict (subscription_id) do nothing"
        ),
        {"o": owner_id, "s": sub.id},
    )
    group_id = (
        await session.execute(
            text("select id from billing.family_groups where subscription_id = :s"), {"s": sub.id}
        )
    ).scalar_one()
    return uuid.UUID(str(group_id))


async def _used(session: AsyncSession, group_id: uuid.UUID) -> int:
    value = (
        await session.execute(
            text(
                "select count(*) from billing.family_members"
                " where group_id = :g and removed_at is null"
            ),
            {"g": group_id},
        )
    ).scalar_one()
    return int(value)


async def _check_free(session: AsyncSession, group_id: uuid.UUID, user_id: uuid.UUID) -> None:
    current = (
        await session.execute(
            text(
                "select group_id from billing.family_members where user_id = :u and removed_at is null"
            ),
            {"u": user_id},
        )
    ).scalar_one_or_none()
    if current is not None:
        if current == group_id:
            raise ApiError(409, "already_a_member", "Already on this family plan")
        raise ApiError(409, "already_in_a_family", "Already on another family plan")
    if await _used(session, group_id) >= await _seats(session):
        raise ApiError(409, "no_seats_left", "Every seat on this plan is taken")


async def _join(
    session: AsyncSession, group_id: uuid.UUID, user_id: uuid.UUID, by: uuid.UUID, via: str
) -> None:
    await session.execute(
        text(
            """
            insert into billing.family_members (group_id, user_id, added_by, via)
            values (:g, :u, :by, :via)
            on conflict (group_id, user_id) do update set removed_at = null, joined_at = now(),
              added_by = excluded.added_by, via = excluded.via
            """
        ),
        {"g": group_id, "u": user_id, "by": by, "via": via},
    )
    await billing.recompute_entitlement(session, user_id)


async def _members(session: AsyncSession, group_id: uuid.UUID) -> list[b.FamilyMemberOut]:
    rows = (
        await session.execute(
            text(
                "select m.user_id, m.via, m.joined_at, p.display_name from billing.family_members m"
                " left join app.profiles p on p.user_id = m.user_id"
                " where m.group_id = :g and m.removed_at is null order by m.joined_at"
            ),
            {"g": group_id},
        )
    ).all()
    return [
        b.FamilyMemberOut(
            user_id=r.user_id,
            first_name=(r.display_name or "").split(" ")[0] or None,
            via=r.via,
            joined_at=r.joined_at,
        )
        for r in rows
    ]


async def _owner_view(session: AsyncSession, group_id: uuid.UUID) -> b.FamilyOut:
    invites = (
        await session.execute(
            text(
                "select id, created_at from billing.family_invites where group_id = :g"
                " and accepted_at is null and revoked_at is null order by created_at"
            ),
            {"g": group_id},
        )
    ).all()
    members = await _members(session, group_id)
    return b.FamilyOut(
        group_id=group_id,
        role="owner",
        seats=await _seats(session),
        used=len(members),
        members=members,
        invites=[b.FamilyInviteOut(id=r.id, created_at=r.created_at) for r in invites],
    )


async def view(db: Database, auth: AuthContext) -> b.FamilyOut:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        try:
            return await _owner_view(session, await _owner_group(session, auth.user_id, now))
        except ApiError as exc:
            if exc.code != "no_family_plan":
                raise
        group_id = (
            await session.execute(
                text(
                    "select group_id from billing.family_members"
                    " where user_id = :u and removed_at is null"
                ),
                {"u": auth.user_id},
            )
        ).scalar_one_or_none()
        if group_id is None:
            raise ApiError(404, "no_family_plan", "There is no family plan on this account")
        return b.FamilyOut(
            group_id=group_id,
            role="member",
            seats=await _seats(session),
            used=await _used(session, group_id),
        )


async def add_child(db: Database, auth: AuthContext, body: b.FamilyAddChild) -> b.FamilyOut:
    """The payer adds a child they are the guardian of (live link and consent, parent mode)."""
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        group_id = await _owner_group(session, auth.user_id, now)
        child = await parent_mode.child_for(session, auth.user_id, body.learner_id)
        await _check_free(session, group_id, child.user_id)
        await _join(session, group_id, child.user_id, auth.user_id, "guardian_link")
        out = await _owner_view(session, group_id)
    log.info("family_member_added", member=hash_user_id(child.user_id), via="guardian_link")
    return out


async def create_invite(db: Database, auth: AuthContext) -> b.FamilyInviteOut:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        group_id = await _owner_group(session, auth.user_id, now)
        if await _used(session, group_id) >= await _seats(session):
            raise ApiError(409, "no_seats_left", "Every seat on this plan is taken")
        code = new_code()
        row = (
            await session.execute(
                text(
                    "insert into billing.family_invites (group_id, created_by, code_hash)"
                    " values (:g, :u, :h) returning id, created_at"
                ),
                {"g": group_id, "u": auth.user_id, "h": code_hash(code)},
            )
        ).one()
    return b.FamilyInviteOut(id=row.id, created_at=row.created_at, code=code)


async def revoke_invite(db: Database, auth: AuthContext, invite_id: uuid.UUID) -> None:
    async with db.system_tx() as session:
        done = (
            await session.execute(
                text(
                    "update billing.family_invites set revoked_at = now() where id = :id"
                    " and created_by = :u and accepted_at is null and revoked_at is null"
                    " returning id"
                ),
                {"id": invite_id, "u": auth.user_id},
            )
        ).first()
    if done is None:
        raise ApiError(404, "not_found", "This invite isn't here")


async def accept_invite(db: Database, auth: AuthContext, code: str) -> b.FamilyOut:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        invite: Any = (
            await session.execute(
                text(
                    "select i.id, i.group_id, g.owner_user_id from billing.family_invites i"
                    " join billing.family_groups g on g.id = i.group_id"
                    " where i.code_hash = :h and i.accepted_at is null and i.revoked_at is null"
                    " for update of i"
                ),
                {"h": code_hash(code)},
            )
        ).one_or_none()
        if invite is None:
            raise ApiError(404, "invite_not_found", "This invite code doesn't work")
        band = (
            await session.execute(
                text("select age_band from app.profiles where user_id = :u"), {"u": auth.user_id}
            )
        ).scalar_one_or_none()
        if band != "18p":
            # Children join through their guardian's Parent mode, never by a shared code.
            raise ApiError(403, "guardian_required", "A grown-up adds you from Parent mode")
        if invite.owner_user_id == auth.user_id:
            raise ApiError(409, "own_plan", "This is your own family plan")
        # The plan must still be paid for.
        await _owner_group(session, invite.owner_user_id, now)
        await _check_free(session, invite.group_id, auth.user_id)
        await _join(session, invite.group_id, auth.user_id, invite.owner_user_id, "invite")
        await session.execute(
            text(
                "update billing.family_invites set accepted_by = :u, accepted_at = now()"
                " where id = :id"
            ),
            {"u": auth.user_id, "id": invite.id},
        )
        out = b.FamilyOut(
            group_id=invite.group_id,
            role="member",
            seats=await _seats(session),
            used=await _used(session, invite.group_id),
        )
    log.info("family_member_added", member=hash_user_id(auth.user_id), via="invite")
    return out


async def remove_member(db: Database, auth: AuthContext, user_id: uuid.UUID) -> None:
    """The payer removes someone, or a member leaves."""
    async with db.system_tx() as session:
        done = (
            await session.execute(
                text(
                    """
                    update billing.family_members m set removed_at = now()
                      from billing.family_groups g
                     where g.id = m.group_id and m.user_id = :member and m.removed_at is null
                       and (g.owner_user_id = :me or m.user_id = :me)
                    returning m.user_id
                    """
                ),
                {"member": user_id, "me": auth.user_id},
            )
        ).first()
        if done is None:
            raise ApiError(404, "not_found", "This person isn't on your family plan")
        await billing.recompute_entitlement(session, user_id)
    log.info("family_member_removed", member=hash_user_id(user_id))
