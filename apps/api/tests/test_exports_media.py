"""PDF exports (me-money §3.9) with WeasyPrint, the dev signed file route, and the media worker's
image pipeline (Agnes through the gateway -> storage -> content.media_assets)."""

from __future__ import annotations

import base64
import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlsplit

import httpx
import pytest
from sqlalchemy import text

from smriti_api.ai.interfaces import GeneratedImage, ImageResult
from smriti_api.core.config import REPO_ROOT
from smriti_api.core.deps import AppServices
from smriti_api.services import exports, media
from smriti_api.services.jobs import InlineJobQueue
from tests.money_helpers import set_profile, signed_in
from tests.practice_helpers import flags

pytest.importorskip("weasyprint")


def key() -> dict[str, str]:
    return {"Idempotency-Key": f"export-{uuid.uuid4().hex}"}


async def test_progress_report_pdf(client: httpx.AsyncClient, services: AppServices) -> None:
    s = await signed_in(client)
    await set_profile(services, s.user_id, locale="hi")
    today = datetime.now(UTC).date()
    async with services.db.admin_tx() as session:
        await session.execute(
            text(
                "insert into learn.activity_days (user_id, day, xp, minutes, lessons_completed, qualified)"
                " values (:u, :d, 40, 12, 2, true) on conflict do nothing"
            ),
            {"u": s.user_id, "d": today - timedelta(days=1)},
        )
    r = await client.post(
        "/v1/exports/pdf", json={"template": "progress_report"}, headers={**s.headers, **key()}
    )
    assert r.status_code == 202, r.text
    export = r.json()
    assert export["status"] == "queued" and export["url"] is None
    assert isinstance(services.jobs, InlineJobQueue)
    await services.jobs.drain()
    got = (await client.get(f"/v1/exports/{export['id']}", headers=s.headers)).json()
    assert got["status"] == "ready" and got["pages"] >= 1 and got["bytes"] > 500
    assert got["template"] == "progress_report"
    url = urlsplit(got["url"])
    pdf = await client.get(f"{url.path}?{url.query}")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    tampered = await client.get(f"{url.path}?{url.query[:-4]}0000")
    assert tampered.status_code == 403
    listing = (await client.get("/v1/exports?kind=pdf_book", headers=s.headers)).json()
    assert [e["id"] for e in listing["exports"]] == [export["id"]]
    async with services.db.admin_tx() as session:
        kinds = (
            await session.execute(
                text("select kind, payload from notify.outbox where user_id = :u"),
                {"u": s.user_id},
            )
        ).all()
    assert [(k.kind, k.payload["export_id"]) for k in kinds] == [("export_ready", export["id"])]
    # Another student cannot read it.
    other = await signed_in(client)
    r = await client.get(f"/v1/exports/{export['id']}", headers=other.headers)
    assert r.status_code == 404


async def test_book_limit_and_expiry_come_from_flags(
    client: httpx.AsyncClient, services: AppServices
) -> None:
    s = await signed_in(client)
    body = {"template": "progress_report"}
    async with flags(services, {"export.books_per_day": 1, "export.expiry_days": 2}):
        r = await client.post("/v1/exports/pdf", json=body, headers={**s.headers, **key()})
        assert r.status_code == 202, r.text
        assert isinstance(services.jobs, InlineJobQueue)
        await services.jobs.drain()
        again = await client.post("/v1/exports/pdf", json=body, headers={**s.headers, **key()})
        assert again.status_code == 429 and again.json()["code"] == "export_limit"
    async with services.db.admin_tx() as session:
        row = (
            await session.execute(
                text("select completed_at, expires_at from app.exports where id = :id"),
                {"id": r.json()["id"]},
            )
        ).one()
    assert row.expires_at - row.completed_at == timedelta(days=2)


async def test_formula_book_is_pro(client: httpx.AsyncClient, services: AppServices) -> None:
    s = await signed_in(client)
    r = await client.post(
        "/v1/exports/pdf",
        json={"template": "formula_sheet", "topic_ids": ["fx.chapter-a.topic-b"]},
        headers={**s.headers, **key()},
    )
    assert r.status_code == 403 and r.json()["code"] == "pro_required"
    r = await client.post(
        "/v1/exports/pdf", json={"template": "formula_sheet"}, headers={**s.headers, **key()}
    )
    assert r.json()["code"] == "topics_required"


def test_formula_sheet_html_uses_published_text_in_both_languages() -> None:
    lesson = json.loads(
        (REPO_ROOT / "content/fixtures/lessons/fx/chapter-a/topic-b.deep_dive.json").read_text()
    )
    summaries = [c for c in lesson["cards"] if c["type"] == "summary"]
    first = summaries[0]["points"][0]
    body = exports.formula_cards_html(lesson, "both")
    assert first["en"] in body and first["hi"] in body
    pdf, pages = exports.render_pdf(exports._doc("Book", body, "both"))
    assert pdf.startswith(b"%PDF") and pages >= 1


class StubImages:
    """A gateway stand-in that returns fixed bytes with a PNG signature (not a picture)."""

    def __init__(self, payload: bytes) -> None:
        self.payload = payload
        self.calls = 0

    async def generate_image(self, **kw: Any) -> ImageResult:
        self.calls += 1
        return ImageResult(
            images=[GeneratedImage(b64_json=base64.b64encode(self.payload).decode())],
            model="stub-image",
        )


async def test_media_pipeline(services: AppServices) -> None:
    assert services.integrations is not None
    storage = services.integrations.storage
    payload = b"\x89PNG\r\n\x1a\n" + uuid.uuid4().bytes
    stub = StubImages(payload)
    prompt = f"test prompt {uuid.uuid4().hex}"
    alt = {"en": "Alt text", "hi": "वैकल्पिक पाठ"}
    rid = await media.create_request(
        services.db, ref="img.test.one", requested_by="test", prompt=prompt, alt=alt
    )
    async with httpx.AsyncClient() as http:
        res = await media.generate(services.db, stub, storage, http, rid)  # type: ignore[arg-type]
        assert res.status == "done" and res.asset_id is not None
        again = await media.generate(services.db, stub, storage, http, rid)  # type: ignore[arg-type]
        assert again.asset_id == res.asset_id
        # The same prompt again reuses the picture without a new generation.
        rid2 = await media.create_request(
            services.db, ref="img.test.two", requested_by="test", prompt=prompt, alt=alt
        )
        res2 = await media.generate(services.db, stub, storage, http, rid2)  # type: ignore[arg-type]
    assert res2.asset_id == res.asset_id and stub.calls == 1
    async with services.db.admin_tx() as session:
        asset = (
            await session.execute(
                text("select * from content.media_assets where id = :id"), {"id": res.asset_id}
            )
        ).one()
    assert (asset.source, asset.status, asset.mime, asset.kind) == (
        "agnes",
        "staging",
        "image/png",
        "image",
    )
    assert asset.alt == alt and "img.test.one" in asset.tags
    stored = await storage.get("assets", asset.variants["original"]["key"])
    assert stored == payload

    with pytest.raises(media.MediaError):
        await media.create_request(
            services.db, ref="img.x", requested_by="t", prompt="p", alt={"en": "only English"}
        )


async def test_media_without_bytes_fails_cleanly(services: AppServices) -> None:
    assert services.integrations is not None and services.ai is not None
    rid = await media.create_request(
        services.db,
        ref="img.test.fake",
        requested_by="test",
        prompt=f"fake {uuid.uuid4().hex}",
        alt={"en": "a", "hi": "क"},
    )
    async with httpx.AsyncClient() as http:
        res = await media.generate(
            services.db, services.ai, services.integrations.storage, http, rid
        )
    assert res.status == "failed" and res.error is not None
    async with services.db.admin_tx() as session:
        status = (
            await session.execute(
                text("select status, attempts from ops.media_requests where id = :id"), {"id": rid}
            )
        ).one()
    assert tuple(status) == ("queued", 1)
