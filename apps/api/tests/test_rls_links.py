"""RLS for AUTH-27 link requests (DB_SCHEMA §12): app.guardian_link_requests is read by the
guardian who asked and the teen it names, nobody else; nobody writes it except the API."""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from smriti_api.core.deps import AppServices
from tests.test_rls_parent import _claims, _count, _user


async def test_guardian_and_teen_read_only(services: AppServices) -> None:
    guardian, teen, other_guardian, stranger = (
        await _user(services),
        await _user(services),
        await _user(services),
        await _user(services),
    )
    async with services.db.system_tx() as session:
        await session.execute(
            text(
                "insert into app.guardian_link_requests"
                " (guardian_user_id, learner_user_id, code_hash, scopes, expires_at) values"
                " (:g, :t, md5(random()::text), '{account}', now() + interval '1 day'),"
                " (:o, null, md5(random()::text), '{account}', now() + interval '1 day')"
            ),
            {"g": guardian, "t": teen, "o": other_guardian},
        )
    sql = "select count(*) from app.guardian_link_requests where guardian_user_id = any(:ids)"
    ids = [guardian, other_guardian]
    assert await _count(services, guardian, sql, ids=ids) == 1
    assert await _count(services, teen, sql, ids=ids) == 1
    assert await _count(services, other_guardian, sql, ids=ids) == 1
    assert await _count(services, stranger, sql, ids=ids) == 0

    # No write policy for anyone: the API writes after its own checks.
    for who in (guardian, teen):
        async with services.db.user_tx(_claims(who)) as session:
            changed = (
                await session.execute(
                    text(
                        "update app.guardian_link_requests set status = 'accepted'"
                        " where guardian_user_id = :g returning 1"
                    ),
                    {"g": guardian},
                )
            ).all()
            deleted = (
                await session.execute(
                    text(
                        "delete from app.guardian_link_requests"
                        " where guardian_user_id = :g returning 1"
                    ),
                    {"g": guardian},
                )
            ).all()
        assert changed == [] and deleted == []
        with pytest.raises(DBAPIError):
            async with services.db.user_tx(_claims(who)) as session:
                await session.execute(
                    text(
                        "insert into app.guardian_link_requests"
                        " (guardian_user_id, learner_user_id, code_hash, scopes, expires_at)"
                        " values (:g, :t, md5(random()::text), '{account}', now())"
                    ),
                    {"g": guardian, "t": teen},
                )
