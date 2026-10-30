"""RLS for the family plan (DB_SCHEMA §12): the payer reads the group, its members and its
invites; a member reads the group and their own row; others read nothing; nobody writes."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from smriti_api.core.deps import AppServices
from tests.test_rls_parent import _claims, _count, _user


async def test_family_rows_for_the_payer_and_members(services: AppServices) -> None:
    owner, member, other_member, stranger = (
        await _user(services),
        await _user(services),
        await _user(services),
        await _user(services),
    )
    async with services.db.system_tx() as session:
        sub = (
            await session.execute(
                text(
                    "insert into billing.subscriptions (user_id, source, external_id, product_id,"
                    " status) values (:u, 'razorpay', :e, 'family_yearly_web', 'active') returning id"
                ),
                {"u": owner, "e": f"sub_rls{uuid.uuid4().hex[:10]}"},
            )
        ).scalar_one()
        group = (
            await session.execute(
                text(
                    "insert into billing.family_groups (owner_user_id, subscription_id)"
                    " values (:o, :s) returning id"
                ),
                {"o": owner, "s": sub},
            )
        ).scalar_one()
        for uid in (member, other_member):
            await session.execute(
                text(
                    "insert into billing.family_members (group_id, user_id, via)"
                    " values (:g, :u, 'invite')"
                ),
                {"g": group, "u": uid},
            )
        await session.execute(
            text(
                "insert into billing.family_invites (group_id, created_by, code_hash)"
                " values (:g, :o, :h)"
            ),
            {"g": group, "o": owner, "h": uuid.uuid4().hex},
        )
    q_group = "select count(*) from billing.family_groups where id = :g"
    q_members = "select count(*) from billing.family_members where group_id = :g"
    q_invites = "select count(*) from billing.family_invites where group_id = :g"
    expected = {owner: (1, 2, 1), member: (1, 1, 0), stranger: (0, 0, 0)}
    for uid, (groups, members, invites) in expected.items():
        assert await _count(services, uid, q_group, g=group) == groups
        assert await _count(services, uid, q_members, g=group) == members
        assert await _count(services, uid, q_invites, g=group) == invites
    with pytest.raises(DBAPIError):
        async with services.db.user_tx(_claims(owner)) as session:
            await session.execute(
                text(
                    "insert into billing.family_members (group_id, user_id, via)"
                    " values (:g, :u, 'invite')"
                ),
                {"g": group, "u": stranger},
            )
