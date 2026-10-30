"""Helpers for the social tests (wave 2, Agent B): signed-in adults and minors, guardian consent
rows, friendships by invite link or QR, and reading the notification outbox."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy import text

from smriti_api.core.deps import AppServices
from tests.helpers import Session
from tests.money_helpers import set_profile, signed_in


async def person(
    client: httpx.AsyncClient,
    services: AppServices,
    *,
    band: str = "18p",
    name: str | None = "Asha Verma",
    exam: str | None = None,
    scopes: tuple[str, ...] | None = ("account", "social"),
    pet: str | None = None,
) -> Session:
    """A signed-in student. Minors get a guardian consent row with ``scopes`` (None: no consent)."""
    s = await signed_in(client)
    cols: dict[str, Any] = {"age_band": band, "signed_up_at": datetime.now(UTC)}
    if name is not None:
        cols["display_name"] = name
    if exam is not None:
        cols["primary_exam_profile_id"] = exam
    await set_profile(services, s.user_id, **cols)
    if band != "18p" and scopes is not None:
        await consent(services, s.user_id, scopes)
    if pet is not None:
        async with services.db.admin_tx() as session:
            await session.execute(
                text(
                    "insert into game.pets (user_id, species, name) values (:u, 'cat', :n)"
                    " on conflict (user_id) do update set name = excluded.name"
                ),
                {"u": s.user_id, "n": pet},
            )
    return s


async def consent(services: AppServices, user_id: uuid.UUID, scopes: tuple[str, ...]) -> None:
    async with services.db.admin_tx() as session:
        await session.execute(
            text(
                "update app.guardian_consents set revoked_at = now()"
                " where user_id = :u and revoked_at is null"
            ),
            {"u": user_id},
        )
        await session.execute(
            text(
                """
                insert into app.guardian_consents (user_id, guardian_sub_hash, method, age_assurance,
                  scope, notice_version, consented_at)
                values (:u, 'test-hash', 'parent_created', 'known_adult', cast(:s as jsonb), 'test', now())
                """
            ),
            {"u": user_id, "s": json.dumps({k: True for k in scopes})},
        )
        await session.execute(
            text("update app.profiles set guardian_consent_state = 'granted' where user_id = :u"),
            {"u": user_id},
        )


async def befriend(
    client: httpx.AsyncClient, inviter: Session, invitee: Session, via: str = "link"
) -> dict[str, Any]:
    r = await client.get("/v1/friends/invite", headers=inviter.headers)
    assert r.status_code == 200, r.text
    code = r.json()["code"]
    r = await client.post(
        f"/v1/friends/invite/{code}/accept", json={"via": via}, headers=invitee.headers
    )
    assert r.status_code == 200, r.text
    result: dict[str, Any] = r.json()
    return result


async def outbox(services: AppServices, user_id: uuid.UUID) -> list[Any]:
    async with services.db.admin_tx() as session:
        return list(
            (
                await session.execute(
                    text(
                        "select kind, payload, status, not_before from notify.outbox"
                        " where user_id = :u order by created_at"
                    ),
                    {"u": user_id},
                )
            ).all()
        )


async def add_xp(
    services: AppServices,
    user_id: uuid.UUID,
    amount: int,
    *,
    at: datetime | None = None,
    source: str = "lesson",
    ref: str | None = None,
) -> None:
    async with services.db.admin_tx() as session:
        await session.execute(
            text(
                "insert into game.xp_ledger (event_id, user_id, amount, source, ref, occurred_at)"
                " values (:e, :u, :a, :s, :r, :t)"
            ),
            {
                "e": uuid.uuid4(),
                "u": user_id,
                "a": amount,
                "s": source,
                "r": ref,
                "t": at or datetime.now(UTC),
            },
        )
