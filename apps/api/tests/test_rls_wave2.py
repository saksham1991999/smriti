"""RLS for the wave-2 tables (DB_SCHEMA §12): the notification outbox and media requests are
service only, the card index is public read for published rows, and a guardian reads a consent
request only through ``app.consent_request_by_code``. The generic isolation test in test_rls.py
covers owner isolation for every user table as well."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from smriti_api.core.deps import AppServices
from smriti_api.services import guardian


async def _user(services: AppServices) -> uuid.UUID:
    async with services.db.admin_tx() as session:
        uid = (
            await session.execute(
                text("insert into auth.users (is_anonymous) values (true) returning id")
            )
        ).scalar_one()
    return uuid.UUID(str(uid))


def _claims(user_id: uuid.UUID) -> dict[str, Any]:
    return {
        "sub": str(user_id),
        "role": "authenticated",
        "is_anonymous": True,
        "aud": "authenticated",
    }


async def test_outbox_is_service_only(services: AppServices) -> None:
    me = await _user(services)
    async with services.db.system_tx() as session:
        await session.execute(
            text(
                "insert into notify.outbox (user_id, kind, class) values (:u, 'pro_activated', 'transactional')"
            ),
            {"u": me},
        )
    with pytest.raises(DBAPIError):
        async with services.db.user_tx(_claims(me)) as session:
            await session.execute(text("select count(*) from notify.outbox"))
    with pytest.raises(DBAPIError):
        async with services.db.user_tx(_claims(me)) as session:
            await session.execute(
                text("insert into notify.outbox (user_id, kind, class) values (:u, 'x', 'habit')"),
                {"u": me},
            )


async def test_media_requests_are_service_only(services: AppServices) -> None:
    me = await _user(services)
    async with services.db.system_tx() as session:
        await session.execute(
            text(
                "insert into ops.media_requests (ref, requested_by, prompt, alt)"
                " values ('img.rls', 'test', 'p', '{\"en\": \"a\", \"hi\": \"b\"}')"
            )
        )
    with pytest.raises(DBAPIError):
        async with services.db.user_tx(_claims(me)) as session:
            await session.execute(text("select count(*) from ops.media_requests"))


async def test_card_index_is_public_read_for_published_rows(services: AppServices) -> None:
    me = await _user(services)
    async with services.db.user_tx(_claims(me)) as session:
        statuses = set(
            (
                await session.execute(text("select distinct status from content.card_index"))
            ).scalars()
        )
    assert statuses <= {"published"}
    with pytest.raises(DBAPIError):
        async with services.db.user_tx(_claims(me)) as session:
            await session.execute(text("delete from content.card_index"))
            await session.execute(
                text(
                    "insert into content.card_index (card_id, item_id, topic_id, mode, kind, concept_ids, ordinal)"
                    " values ('x', 'x', 'x', 'deep_dive', 'summary', '{}', 0)"
                )
            )


async def test_consent_request_reads(services: AppServices) -> None:
    learner, guardian_id, stranger = [await _user(services) for _ in range(3)]
    code = guardian.new_code()
    async with services.db.system_tx() as session:
        await session.execute(
            text(
                "insert into app.guardian_consent_requests (learner_user_id, channel, code_hash, scopes,"
                " expires_at) values (:u, 'link', :h, '{account}', now() + interval '1 hour')"
            ),
            {"u": learner, "h": guardian.code_hash(code)},
        )
    async with services.db.user_tx(_claims(learner)) as session:
        own = (
            await session.execute(
                text(
                    "select count(*) from app.guardian_consent_requests where learner_user_id = :u"
                ),
                {"u": learner},
            )
        ).scalar_one()
    assert own == 1
    async with services.db.user_tx(_claims(stranger)) as session:
        direct = (
            await session.execute(
                text(
                    "select count(*) from app.guardian_consent_requests where learner_user_id = :u"
                ),
                {"u": learner},
            )
        ).scalar_one()
        by_code = (
            await session.execute(
                text("select count(*) from app.consent_request_by_code(:c)"), {"c": code}
            )
        ).scalar_one()
        wrong = (
            await session.execute(
                text("select count(*) from app.consent_request_by_code(:c)"),
                {"c": guardian.new_code()},
            )
        ).scalar_one()
    assert (direct, by_code, wrong) == (0, 1, 0)
    assert guardian_id != learner
