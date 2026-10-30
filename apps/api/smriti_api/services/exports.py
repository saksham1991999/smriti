"""PDF exports (me-money §3.9; TRD §5 "PDF export").

The API records the request in ``app.exports`` and queues ``render_pdf`` on the ``pdf`` queue. The
job builds HTML from published content (formula sheet) or the student's own numbers (progress
report), renders it with WeasyPrint, stores the file in the private ``uploads`` bucket and pushes
``export_ready``. Labels come from the ``packages/i18n`` catalogues; content text comes from the
published lesson files. Nothing is written for the book (me-money §3.9).

Renderer: WeasyPrint (a worker dependency) rather than the headless Chromium the TRD names. It needs
no browser binary in the worker image, shapes Devanagari through HarfBuzz and Pango, and is much
smaller and faster to start. LaTeX is printed as source text (there is no KaTeX without a JS
engine); the deploy image must carry Noto Sans and Noto Sans Devanagari.
"""

from __future__ import annotations

import html
import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.auth import AuthContext
from smriti_api.core.config import REPO_ROOT
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.schemas import exports as x
from smriti_api.services import billing, copy, notify

if TYPE_CHECKING:
    from smriti_api.integrations import Integrations
    from smriti_api.services.jobs import JobDeps, JobQueue

log = structlog.get_logger(__name__)

BOOKS_PER_DAY = 5  # me-money §3.9 "5 books a day"
EXPIRES_DAYS = 30  # me-money §3.9 "flag 30 days"
SIGNED_URL_TTL_S = 15 * 60

CSS = """
@page { size: A4; margin: 18mm 16mm; @bottom-center { content: counter(page); font-size: 9pt; } }
body { font-family: "Noto Sans", "Noto Sans Devanagari", "DejaVu Sans", sans-serif; font-size: 11pt;
       line-height: 1.45; }
h1 { font-size: 20pt; margin: 0 0 8mm; }
h2 { font-size: 14pt; margin: 8mm 0 3mm; page-break-after: avoid; }
.card { border: 0.6pt solid #999; border-radius: 3pt; padding: 3mm 4mm; margin: 0 0 3mm;
        page-break-inside: avoid; }
.title { font-weight: bold; }
code { font-family: "DejaVu Sans Mono", monospace; font-size: 10pt; }
table { border-collapse: collapse; width: 100%; }
td, th { border-bottom: 0.4pt solid #bbb; padding: 1.5mm 2mm; text-align: left; }
.hi { font-family: "Noto Sans Devanagari", "Noto Sans", sans-serif; }
"""


def _t(value: Any, lang: str) -> str:
    """One language of an i18n field, or both side by side."""
    if not isinstance(value, dict):
        return html.escape(str(value or ""))
    if lang == "both":
        en = html.escape(str(value.get("en") or ""))
        hi = html.escape(str(value.get("hi") or ""))
        return f'{en}<br><span class="hi">{hi}</span>' if hi and hi != en else en
    return html.escape(str(value.get(lang) or value.get("en") or ""))


def _doc(title: str, body: str, lang: str) -> str:
    return (
        f'<!doctype html><html lang="{"hi" if lang == "hi" else "en"}"><head><meta charset="utf-8">'
        f"<title>{html.escape(title)}</title><style>{CSS}</style></head>"
        f"<body><h1>{html.escape(title)}</h1>{body}</body></html>"
    )


def _content_file(source_path: str) -> dict[str, Any] | None:
    root = (REPO_ROOT / "content").resolve()
    path = (REPO_ROOT / source_path).resolve()
    if root not in path.parents or not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def formula_cards_html(lesson: dict[str, Any], lang: str) -> str:
    parts: list[str] = []
    for card in lesson.get("cards") or []:
        kind = card.get("type")
        if kind == "formula":
            rows = "".join(
                f"<tr><td><code>{html.escape(str(s.get('symbol', '')))}</code></td>"
                f"<td>{_t(s.get('meaning'), lang)}</td><td>{html.escape(str(s.get('unit') or ''))}</td></tr>"
                for s in card.get("symbols") or []
            )
            cond = card.get("conditions")
            parts.append(
                f'<div class="card"><div class="title">{_t(card.get("title"), lang)}</div>'
                f"<p><code>{html.escape(str(card.get('latex', '')))}</code></p>"
                + (f"<table>{rows}</table>" if rows else "")
                + (f"<p>{_t(cond, lang)}</p>" if cond else "")
                + "</div>"
            )
        elif kind == "summary":
            points = "".join(f"<li>{_t(p, lang)}</li>" for p in card.get("points") or [])
            if points:
                parts.append(f'<div class="card"><ul>{points}</ul></div>')
    return "".join(parts)


async def formula_sheet_html(session: AsyncSession, spec: dict[str, Any], locale: str) -> str:
    lang = str(spec.get("language") or locale)
    ui = "hi" if lang == "hi" else "en"
    topic_ids = list(spec.get("topic_ids") or [])
    rows = (
        await session.execute(
            text(
                "select t.id, t.name, t.sort, ci.source_path from content.topics t"
                " join content.content_items ci on ci.topic_id = t.id"
                " where t.id = any(:ids) and ci.kind = 'lesson' and ci.mode = 'deep_dive'"
                " and ci.status = 'published' order by t.chapter_id, t.sort"
            ),
            {"ids": topic_ids},
        )
    ).all()
    sections: list[str] = []
    for r in rows:
        lesson = _content_file(r.source_path)
        if lesson is None:
            continue
        cards = formula_cards_html(lesson, lang)
        if cards:
            sections.append(f"<h2>{_t(r.name, lang)}</h2>{cards}")
    return _doc(copy.text("me_money", "ME-01.pdf_books", ui), "".join(sections), lang)


async def progress_report_html(
    session: AsyncSession, user_id: uuid.UUID, locale: str, now: datetime
) -> str:
    ui = "hi" if locale == "hi" else "en"
    stats = (
        await session.execute(
            text("select xp_total, current_streak from game.user_stats where user_id = :u"),
            {"u": user_id},
        )
    ).one_or_none()
    since = (now - timedelta(days=7)).date()
    days = (
        await session.execute(
            text(
                "select day, minutes, lessons_completed, cards_reviewed, xp from learn.activity_days"
                " where user_id = :u and day > :since order by day"
            ),
            {"u": user_id, "since": since},
        )
    ).all()
    acc = (
        await session.execute(
            text(
                "select count(*) as n, count(*) filter (where is_correct) as ok from learn.question_attempts"
                " where user_id = :u and answered_at > :since"
            ),
            {"u": user_id, "since": now - timedelta(days=7)},
        )
    ).one()
    minutes = sum(int(d.minutes) for d in days)
    lessons = sum(int(d.lessons_completed) for d in days)
    streak = int(stats.current_streak) if stats else 0
    accuracy = f"{round(100 * int(acc.ok) / int(acc.n))}%" if int(acc.n) else "-"
    summary = copy.text(
        "me_money", "NTF-12.report_preview", ui, min=minutes, lessons=lessons, streak=streak
    )
    tiles = [
        ("ME-01.stat_streak", str(streak)),
        ("ME-01.stat_xp", str(int(stats.xp_total) if stats else 0)),
        ("ME-01.stat_lessons", str(lessons)),
        ("ME-01.stat_accuracy", accuracy),
    ]
    table = "".join(
        f"<tr><th>{html.escape(copy.text('me_money', k, ui))}</th><td>{html.escape(v)}</td></tr>"
        for k, v in tiles
    )
    daily = "".join(
        f"<tr><td>{d.day.strftime('%d/%m')}</td><td>{int(d.minutes)}</td>"
        f"<td>{int(d.lessons_completed)}</td><td>{int(d.cards_reviewed)}</td><td>{int(d.xp)}</td></tr>"
        for d in days
    )
    body = f"<p>{html.escape(summary)}</p><table>{table}</table>" + (
        f"<h2>{html.escape(copy.text('me_money', 'SET-14.weekly_report', ui))}</h2><table>{daily}</table>"
        if daily
        else ""
    )
    return _doc(copy.text("me_money", "SET-14.weekly_report", ui), body, ui)


def render_pdf(document: str) -> tuple[bytes, int]:
    """HTML to PDF with WeasyPrint. Imported lazily: it is a worker dependency."""
    from weasyprint import HTML  # type: ignore[import-untyped]

    doc = HTML(string=document, base_url=None).render()
    return doc.write_pdf(), len(doc.pages)


# --- API side ---------------------------------------------------------------------------------------


def _out(row: Any, url: str | None = None) -> x.ExportOut:
    spec = row.spec if isinstance(row.spec, dict) else {}
    return x.ExportOut(
        id=row.id,
        kind=row.kind,
        template=spec.get("template"),
        status=row.status,
        pages=row.pages,
        bytes=row.bytes,
        requested_at=row.requested_at,
        completed_at=row.completed_at,
        expires_at=row.expires_at,
        url=url,
    )


async def create_pdf(
    db: Database, jobs: JobQueue, auth: AuthContext, body: x.PdfExportCreate
) -> x.ExportOut:
    if body.template == "formula_sheet" and not body.topic_ids:
        raise ApiError(422, "topics_required", "Pick at least one topic")
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        if body.template == "formula_sheet":
            # PDF books are Pro (PRD §5.6, §11.1); books already made stay until they expire.
            ent = await billing.compute_entitlement(session, auth.user_id, now)
            if not ent.active:
                raise ApiError(
                    403, "pro_required", "PDF books are part of Pro", source="pdf_export"
                )
        today = (
            await session.execute(
                text(
                    "select count(*) from app.exports where user_id = :u and kind = 'pdf_book'"
                    " and requested_at > :since"
                ),
                {"u": auth.user_id, "since": now - timedelta(days=1)},
            )
        ).scalar_one()
        if int(today) >= BOOKS_PER_DAY:
            raise ApiError(
                429, "export_limit", "That's the most books for today", limit=BOOKS_PER_DAY
            )
        row = (
            await session.execute(
                text(
                    "insert into app.exports (user_id, kind, spec, status) values"
                    " (:u, 'pdf_book', cast(:spec as jsonb), 'queued') returning *"
                ),
                {"u": auth.user_id, "spec": body.model_dump_json()},
            )
        ).one()
    await jobs.enqueue("render_pdf", str(row.id), job_id=f"render_pdf:{row.id}")
    return _out(row)


async def get_export(
    db: Database, ints: Integrations | None, auth: AuthContext, export_id: uuid.UUID
) -> x.ExportOut:
    async with db.user_tx(auth.claims) as session:
        row = (
            await session.execute(
                text("select * from app.exports where id = :id and user_id = :u"),
                {"id": export_id, "u": auth.user_id},
            )
        ).one_or_none()
    if row is None:
        raise ApiError(404, "not_found", "No such export")
    url = None
    if row.status == "ready" and row.r2_key and ints is not None:
        if row.expires_at is not None and row.expires_at <= datetime.now(UTC):
            return _out(row._replace(status="expired"))
        url = ints.storage.signed_url("uploads", row.r2_key, SIGNED_URL_TTL_S)
    return _out(row, url)


async def list_exports(db: Database, auth: AuthContext, kind: str | None) -> x.ExportList:
    async with db.user_tx(auth.claims) as session:
        rows = (
            await session.execute(
                text(
                    "select * from app.exports where user_id = :u and (cast(:k as text) is null or kind = :k)"
                    " order by requested_at desc limit 50"
                ),
                {"u": auth.user_id, "k": kind},
            )
        ).all()
    return x.ExportList(exports=[_out(r) for r in rows])


# --- the job ----------------------------------------------------------------------------------------


async def render_export(deps: JobDeps, export_id: str) -> dict[str, Any]:
    ints = deps.integrations
    if ints is None:
        raise RuntimeError("render_pdf needs integrations (storage, push)")
    now = datetime.now(UTC)
    async with deps.db.system_tx() as session:
        row = (
            await session.execute(
                text(
                    "update app.exports set status = 'rendering' where id = :id"
                    " and status in ('queued','rendering') returning *"
                ),
                {"id": export_id},
            )
        ).one_or_none()
        if row is None:
            return {"status": "skipped"}
        locale = (
            await session.execute(
                text("select locale from app.profiles where user_id = :u"), {"u": row.user_id}
            )
        ).scalar_one_or_none() or "en"
        spec = row.spec if isinstance(row.spec, dict) else {}
        if spec.get("template") == "progress_report":
            document = await progress_report_html(session, row.user_id, locale, now)
        else:
            document = await formula_sheet_html(session, spec, locale)
    try:
        pdf, pages = render_pdf(document)
    except Exception:
        log.exception("pdf_render_failed", export=export_id)
        async with deps.db.system_tx() as session:
            await session.execute(
                text(
                    "update app.exports set status = 'failed', completed_at = :now where id = :id"
                ),
                {"id": export_id, "now": now},
            )
        return {"status": "failed"}
    key = f"exports/{row.user_id}/{export_id}.pdf"
    await ints.storage.put("uploads", key, pdf, "application/pdf")
    async with deps.db.system_tx() as session:
        await session.execute(
            text(
                "update app.exports set status = 'ready', r2_key = :k, pages = :p, bytes = :b,"
                " completed_at = :now, expires_at = :exp where id = :id"
            ),
            {
                "id": export_id,
                "k": key,
                "p": pages,
                "b": len(pdf),
                "now": now,
                "exp": now + timedelta(days=EXPIRES_DAYS),
            },
        )
        await notify.enqueue(
            session,
            user_id=row.user_id,
            kind="export_ready",
            payload={"export_id": export_id},
            dedupe_key=f"export_ready:{export_id}",
        )
    log.info("pdf_rendered", export=export_id, pages=pages, bytes=len(pdf))
    return {"status": "ready", "pages": pages, "bytes": len(pdf)}
