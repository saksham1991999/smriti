"""Per-user ``state_version`` and the version each state section last changed (migration 0011).

``GET /v1/sync/state?since=v`` returns a section only when its version is greater than ``v``.
Every write path that changes a section bumps the version in the same transaction.
"""

from __future__ import annotations

import json
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

SECTIONS = ("profile", "streak", "plant", "pet", "wallet", "srs", "topic_progress", "entitlement")


async def lock_state(session: AsyncSession, user_id: uuid.UUID) -> tuple[int, dict[str, int]]:
    """Lock the user's sync row for the rest of the transaction (serialises batches per user)."""
    await session.execute(
        text("insert into app.sync_state (user_id) values (:u) on conflict do nothing"),
        {"u": user_id},
    )
    row = (
        await session.execute(
            text(
                "select version, section_versions from app.sync_state where user_id = :u for update"
            ),
            {"u": user_id},
        )
    ).one()
    return int(row.version), dict(row.section_versions or {})


async def bump(session: AsyncSession, user_id: uuid.UUID, sections: set[str]) -> int:
    """Increase the version once and stamp the changed sections; returns the new version."""
    sections = {s for s in sections if s in SECTIONS}
    if not sections:
        row = (
            await session.execute(
                text("select version from app.sync_state where user_id = :u"), {"u": user_id}
            )
        ).one()
        return int(row.version)
    row = (
        await session.execute(
            text(
                """
                update app.sync_state
                   set version = version + 1,
                       section_versions = section_versions || (
                         select coalesce(jsonb_object_agg(s, version + 1), '{}'::jsonb)
                           from jsonb_array_elements_text(cast(:sections as jsonb)) as s
                       )
                 where user_id = :u
             returning version
                """
            ),
            {"u": user_id, "sections": json.dumps(sorted(sections))},
        )
    ).one()
    return int(row.version)
