"""The image-request pipeline (skills/visual-director; TRD §5 media queue; AGENTS rule 2).

``ops.media_requests`` row -> Agnes image generation through the AI gateway (never a provider SDK)
-> the file stored behind :class:`ObjectStorage` (R2 ``assets``; local disk in development) ->
a ``content.media_assets`` row in ``staging`` for a reviewer. Every step is idempotent: a request
that already has an asset is done, and an identical image (same sha256) is reused.
"""

from __future__ import annotations

import base64
import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

import httpx
import structlog
from sqlalchemy import text

from smriti_api.ai.interfaces import AIError, GeneratedImage
from smriti_api.core.db import Database
from smriti_api.integrations.storage import ObjectStorage

if TYPE_CHECKING:
    from smriti_api.ai.gateway import AIGateway

log = structlog.get_logger(__name__)

MAX_ATTEMPTS = 3
MAX_BYTES = 15 * 1024 * 1024
_MAGIC = (
    (b"\x89PNG\r\n\x1a\n", "image/png", "png"),
    (b"\xff\xd8\xff", "image/jpeg", "jpg"),
    (b"RIFF", "image/webp", "webp"),
)


class MediaError(Exception):
    pass


def sniff(data: bytes) -> tuple[str, str]:
    for magic, mime, ext in _MAGIC:
        if data.startswith(magic) and (ext != "webp" or data[8:12] == b"WEBP"):
            return mime, ext
    raise MediaError("not an image the app can show (png, jpeg or webp)")


async def image_bytes(image: GeneratedImage, http: httpx.AsyncClient) -> bytes:
    if image.b64_json:
        return base64.b64decode(image.b64_json)
    if image.url and image.url.startswith("https://"):
        r = await http.get(image.url, timeout=60)
        r.raise_for_status()
        if len(r.content) > MAX_BYTES:
            raise MediaError("image too large")
        return r.content
    raise MediaError("the image provider returned no downloadable file")


def prompt_hash(prompt: str, style: str | None, size: str, ratio: str, seed: int | None) -> str:
    return hashlib.sha256(
        json.dumps([prompt, style, size, ratio, seed], separators=(",", ":")).encode()
    ).hexdigest()


@dataclass(frozen=True)
class MediaResult:
    status: str
    asset_id: uuid.UUID | None = None
    error: str | None = None


async def create_request(
    db: Database,
    *,
    ref: str,
    requested_by: str,
    prompt: str,
    alt: dict[str, str],
    style_preset: str | None = None,
    size: str = "1K",
    ratio: str = "1:1",
    tags: list[str] | None = None,
    seed: int | None = None,
) -> uuid.UUID:
    if not alt.get("en") or not alt.get("hi"):
        raise MediaError("alt text is needed in English and Hindi (AGENTS rules 7 and 9)")
    async with db.system_tx() as session:
        rid = (
            await session.execute(
                text(
                    "insert into ops.media_requests (ref, requested_by, prompt, style_preset, size, ratio,"
                    " alt, tags, seed) values (:ref, :by, :p, :st, :sz, :ra, cast(:alt as jsonb), :tags, :seed)"
                    " returning id"
                ),
                {
                    "ref": ref,
                    "by": requested_by,
                    "p": prompt,
                    "st": style_preset,
                    "sz": size,
                    "ra": ratio,
                    "alt": json.dumps(alt),
                    "tags": tags or [],
                    "seed": seed,
                },
            )
        ).scalar_one()
    return uuid.UUID(str(rid))


async def generate(
    db: Database,
    ai: AIGateway,
    storage: ObjectStorage,
    http: httpx.AsyncClient,
    request_id: uuid.UUID,
) -> MediaResult:
    async with db.system_tx() as session:
        req = (
            await session.execute(
                text("select * from ops.media_requests where id = :id for update skip locked"),
                {"id": request_id},
            )
        ).one_or_none()
        if req is None:
            return MediaResult("skipped")
        if req.status == "done":
            return MediaResult("done", req.asset_id)
        if req.attempts >= MAX_ATTEMPTS:
            return MediaResult("failed", error=req.error)
        await session.execute(
            text(
                "update ops.media_requests set status = 'generating', attempts = attempts + 1 where id = :id"
            ),
            {"id": request_id},
        )
    phash = prompt_hash(req.prompt, req.style_preset, req.size, req.ratio, req.seed)
    async with db.system_tx() as session:
        # The same prompt and settings were generated before: reuse that picture.
        existing = (
            await session.execute(
                text(
                    "select id from content.media_assets where prompt_hash = :h and visibility = 'public'"
                ),
                {"h": phash},
            )
        ).scalar_one_or_none()
        if existing is not None:
            await session.execute(
                text(
                    "update ops.media_requests set status = 'done', asset_id = :a, completed_at = now()"
                    " where id = :id"
                ),
                {"id": request_id, "a": existing},
            )
            return MediaResult("done", uuid.UUID(str(existing)))
    try:
        result = await ai.generate_image(
            feature="visual_director",
            prompt=req.prompt,
            size=req.size,
            ratio=req.ratio,
            seed=req.seed,
        )
        if not result.images:
            raise MediaError("no image returned")
        data = await image_bytes(result.images[0], http)
        mime, ext = sniff(data)
    except (AIError, MediaError, httpx.HTTPError) as exc:
        error = type(exc).__name__ if not isinstance(exc, MediaError) else str(exc)
        async with db.system_tx() as session:
            await session.execute(
                text(
                    "update ops.media_requests set status = case when attempts >= :max then 'failed'"
                    " else 'queued' end, error = :e where id = :id"
                ),
                {"id": request_id, "e": error[:200], "max": MAX_ATTEMPTS},
            )
        log.warning("media_generate_failed", request=str(request_id), reason=error[:80])
        return MediaResult("failed", error=error)
    sha = hashlib.sha256(data).hexdigest()
    key = f"media/{sha[:2]}/{sha}.{ext}"
    await storage.put("assets", key, data, mime)
    async with db.system_tx() as session:
        asset_id = (
            await session.execute(
                text(
                    """
                    insert into content.media_assets
                      (sha256, kind, mime, bytes, variants, source, licence, attribution, prompt,
                       prompt_hash, style_preset, model_version, alt, tags, visibility, status)
                    values (:sha, 'image', :mime, :bytes, cast(:variants as jsonb), 'agnes',
                            'agnes-generated', null, :prompt, :ph, :style, :model, cast(:alt as jsonb),
                            :tags, 'public', 'staging')
                    on conflict (sha256) do update set tags = content.media_assets.tags
                    returning id
                    """
                ),
                {
                    "sha": sha,
                    "mime": mime,
                    "bytes": len(data),
                    "variants": json.dumps({"original": {"bucket": "assets", "key": key}}),
                    "prompt": req.prompt,
                    "ph": phash,
                    "style": req.style_preset,
                    "model": result.model,
                    "alt": json.dumps(req.alt),
                    "tags": [*(req.tags or []), req.ref],
                },
            )
        ).scalar_one()
        await session.execute(
            text(
                "update ops.media_requests set status = 'done', asset_id = :a, error = null,"
                " completed_at = :now where id = :id"
            ),
            {"id": request_id, "a": asset_id, "now": datetime.now(UTC)},
        )
    log.info("media_generated", request=str(request_id), bytes=len(data))
    return MediaResult("done", uuid.UUID(str(asset_id)))


async def pending(db: Database, limit: int = 20) -> list[uuid.UUID]:
    async with db.system_tx() as session:
        rows = (
            await session.execute(
                text(
                    "select id from ops.media_requests where status = 'queued' and attempts < :max"
                    " order by created_at limit :n"
                ),
                {"max": MAX_ATTEMPTS, "n": limit},
            )
        ).scalars()
        return [uuid.UUID(str(r)) for r in rows]


async def generate_job(deps: Any, request_id: str) -> dict[str, str | None]:
    """The ``media_generate`` job (media queue)."""
    if deps.integrations is None or deps.ai is None:
        raise RuntimeError("media_generate needs the AI gateway and storage")
    async with httpx.AsyncClient(timeout=60) as http:
        res = await generate(
            deps.db, deps.ai, deps.integrations.storage, http, uuid.UUID(request_id)
        )
    return {"status": res.status, "asset_id": str(res.asset_id) if res.asset_id else None}
