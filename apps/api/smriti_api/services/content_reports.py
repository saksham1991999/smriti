"""SET-24 Report content (R39): one sheet for lessons, questions, AI output and community items.

Reports land in ``learn.content_reports`` for the content team (``content-qa``). The optional
note is the student's own words: it is stored on the report only, never logged and never sent to
analytics (AGENTS rule 6).
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text

from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.schemas import tutor as t


def _out(r: Any) -> t.ContentReportOut:
    return t.ContentReportOut(
        id=r.id,
        kind=r.kind,
        item_ref=r.item_ref,
        reason=r.reason,
        status=r.status,
        created_at=r.created_at,
    )


async def create(db: Database, auth: AuthContext, body: t.ContentReportIn) -> t.ContentReportOut:
    """An open report from the same student for the same item and reason is returned as is, so a
    double tap files one report."""
    note = body.note.strip() if body.note and body.note.strip() else None
    async with db.user_tx(auth.claims) as session:
        existing = (
            await session.execute(
                text(
                    "select id, kind, item_ref, reason, status, created_at from learn.content_reports"
                    " where user_id = :u and kind = :k and item_ref = :i and reason = :r"
                    " and status = 'open' limit 1"
                ),
                {"u": auth.user_id, "k": body.kind, "i": body.item_ref, "r": body.reason},
            )
        ).one_or_none()
        if existing is not None:
            return _out(existing)
        row = (
            await session.execute(
                text(
                    "insert into learn.content_reports (user_id, kind, item_ref, bundle_hash, locale,"
                    " reason, note) values (:u, :k, :i, :b, :l, :r, :n)"
                    " returning id, kind, item_ref, reason, status, created_at"
                ),
                {
                    "u": auth.user_id,
                    "k": body.kind,
                    "i": body.item_ref,
                    "b": body.bundle_hash,
                    "l": body.locale,
                    "r": body.reason,
                    "n": note,
                },
            )
        ).one()
    return _out(row)


async def mine(db: Database, auth: AuthContext, limit: int) -> list[t.ContentReportOut]:
    async with db.user_tx(auth.claims) as session:
        rows = (
            await session.execute(
                text(
                    "select id, kind, item_ref, reason, status, created_at from learn.content_reports"
                    " where user_id = :u order by created_at desc limit :n"
                ),
                {"u": auth.user_id, "n": limit},
            )
        ).all()
    return [_out(r) for r in rows]
