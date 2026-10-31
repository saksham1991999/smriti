"""Tutor images: "Draw it" in the chat and the voice board (tutor-social §A5 step 6, §A9 step 4,
§A14; TRD §9.3).

The model writes a short brief of what to draw from the course content, never from the student's
own words. The server removes personal data and runs the text tutor's safety screen on the brief
and the alt text, then builds the style-preset prompt (``skills/visual-director/presets``) and
looks, in order, for:

1. an approved image in the index (``content.media_assets``) with the same prompt hash;
2. an exact hit in the tutor image cache (``ai.image_cache``), reused across students at once
   because prompts never carry student text (Q-A2). Not for under-13s: they see reviewed images
   only;
3. a new Agnes image through the AI gateway's image tier (``AI_TIER_IMAGE_MODEL``), on the media
   queue. Pro only (R35), never for under-13s, and capped per hour and per day even for Pro
   (``pro.tutor_images_per_hour``, ``pro.tutor_images_per_day``).

Files are private (the ``uploads`` bucket) and reach the app as short-lived signed URLs from
``GET /v1/ai/generations/{id}``. A failed generation can be retried once. Rows and cached files
follow the tutor's retention (``ai.tutor_retention_days``). Prompts, briefs and alt text are never
logged: only ids, statuses and sizes.

Semantic reuse of index images (search by meaning) waits for the embedding provider (TRD §9.5,
D2); until then the index is matched on the exact prompt hash only.
"""

from __future__ import annotations

import hashlib
import json
import unicodedata
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any, Literal

import httpx
import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.ai.interfaces import AIConfigError, AIError, BudgetExceeded, ChatMessage
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.integrations.storage import ObjectStorage, StorageError
from smriti_api.schemas import tutor_images as ti
from smriti_api.services import media, tutor_safety
from smriti_api.services.usage import Learner, load_flags, load_learner

if TYPE_CHECKING:
    from smriti_api.ai.gateway import AIGateway
    from smriti_api.core.deps import AppServices
    from smriti_api.services.jobs import JobDeps, JobQueue

log = structlog.get_logger(__name__)

JOB = "tutor_image"
# Signed links are short-lived: the app asks again when one expires (the export link's lifetime).
URL_TTL_S = 15 * 60
# Abuse guards on the model's text, not product numbers.
BRIEF_MAX = 400
ALT_MAX = 300

Style = Literal["diagram", "scene"]
# The visual-director presets a runtime tutor picture may use, with the Agnes size and ratio
# their preset files give.
PRESETS: dict[str, tuple[str, str, str]] = {
    "diagram": ("sunny-diagram", "2K", "3:2"),
    "scene": ("sunny-scene", "2K", "3:2"),
}

# DESIGN.md §6.2: the shared sunny base prompt and negative guidance, with the preset lines from
# skills/visual-director/presets/sunny-diagram.md and sunny-scene.md.
_BASE = (
    "Soft 3D illustration of {subject}, rounded friendly shapes, clean minimal composition, soft "
    "key light from the top left, gentle ambient occlusion, subtle contact shadow, saturated "
    "palette, {background}, Indian context where people or places appear, no text, no letters, "
    "no numbers, no logos, high detail, centred, generous padding."
)
_PRESET_LINES = {
    "diagram": (
        "white or very light tint background",
        "a clear educational diagram of {brief}, accurate proportions, every part clearly "
        "separated, no labels, no arrows with text.",
    ),
    "scene": (
        "soft gradient background",
        "a simple scene showing {brief}, soft gradient background, rounded simplified scenery.",
    ),
}
_NEGATIVE = (
    "Avoid: text, watermark, logo, signature, letters, numbers, photorealistic faces, clutter, "
    "harsh shadows, neon glow, dark horror tones, distorted hands, extra limbs."
)


@dataclass(frozen=True)
class ImageEnv:
    """What the image steps need from the app: the job queue, private storage and the image
    tier's model (part of the cache key, TRD §9.3)."""

    jobs: JobQueue
    storage: ObjectStorage | None
    model_version: str
    url_ttl_s: int = URL_TTL_S


def env(services: AppServices) -> ImageEnv:
    settings = services.settings
    return ImageEnv(
        jobs=services.jobs,
        storage=services.integrations.storage if services.integrations is not None else None,
        model_version=settings.ai_tier_image_model or settings.ai_provider,
    )


def _normalize(value: str) -> str:
    return " ".join(unicodedata.normalize("NFC", value).split()).lower()


def compose(brief: str, style: str) -> str:
    background, line = _PRESET_LINES[style]
    return " ".join(
        [_BASE.format(subject=brief, background=background), line.format(brief=brief), _NEGATIVE]
    )


def cache_key(brief: str, preset: str, size: str, ratio: str, model_version: str) -> str:
    """``sha256(normalized_prompt + style_preset + size + model_version)`` (TRD §9.3)."""
    return hashlib.sha256(
        json.dumps(
            [_normalize(brief), preset, size, ratio, model_version], separators=(",", ":")
        ).encode()
    ).hexdigest()


@dataclass(frozen=True)
class Outcome:
    """What the chat stream or the voice board gets back for one picture."""

    generation_id: uuid.UUID | None
    status: ti.ImageStatus
    reason: ti.ImageReason | None
    alt: str
    url: str | None = None
    url_expires_at: datetime | None = None
    can_retry: bool = False

    def event(self) -> tuple[str, dict[str, Any]]:
        """The SSE event: ``image_ready``, ``image_pending`` or ``image_failed``."""
        gid = str(self.generation_id) if self.generation_id else None
        if self.status == "ready":
            return "image_ready", {
                "generation_id": gid,
                "url": self.url,
                "url_expires_at": self.url_expires_at.isoformat() if self.url_expires_at else None,
                "alt": self.alt,
            }
        if self.status == "pending":
            return "image_pending", {"generation_id": gid, "alt": self.alt}
        return "image_failed", {
            "generation_id": gid,
            "reason": self.reason,
            "retry": self.can_retry,
        }

    def board(self) -> dict[str, Any]:
        """The voice tool's result: a board item, or an error the voice model can explain."""
        if self.status in ("ready", "pending"):
            item: dict[str, Any] = {
                "kind": "image",
                "generation_id": str(self.generation_id),
                "status": self.status,
                "alt": self.alt,
            }
            if self.url:
                item["url"] = self.url
            return {"board": item}
        return {"error": self.reason or "failed"}


def _signed(
    env_: ImageEnv, bucket: str | None, key: str | None
) -> tuple[str | None, datetime | None]:
    if env_.storage is None or not bucket or not key:
        return None, None
    url = env_.storage.signed_url(
        "assets" if bucket == "assets" else "uploads", key, env_.url_ttl_s
    )
    return url, datetime.now(UTC) + timedelta(seconds=env_.url_ttl_s)


async def _cost_row(session: AsyncSession, user_id: uuid.UUID, provider: str, phash: str) -> None:
    # Every picture shown is one ai.generations row (TRD §9.1); hits cost nothing.
    await session.execute(
        text(
            "insert into ai.generations (user_id, kind, provider, model, input_hash, cache_hit, status)"
            " values (:u, 'image', :p, '', :h, true, 'ok')"
        ),
        {"u": user_id, "p": provider, "h": phash},
    )


async def _index_hit(session: AsyncSession, prompt: str, preset: str, size: str, ratio: str) -> Any:
    return (
        await session.execute(
            text(
                "select id, variants from content.media_assets where kind = 'image'"
                " and status = 'approved' and visibility = 'public' and prompt_hash = :h limit 1"
            ),
            {"h": media.prompt_hash(prompt, preset, size, ratio, None)},
        )
    ).one_or_none()


async def _over_caps(session: AsyncSession, learner: Learner, flags: Any, now: datetime) -> bool:
    start, end = learner.day_bounds(now)
    row = (
        await session.execute(
            text(
                "select count(*) filter (where created_at >= :h) as hour,"
                " count(*) filter (where created_at >= :s and created_at < :e) as day"
                " from ai.tutor_images where user_id = :u and origin = 'generated'"
                " and created_at >= least(:h, :s)"
            ),
            {"u": learner.user_id, "h": now - timedelta(hours=1), "s": start, "e": end},
        )
    ).one()
    hour_cap = flags.int_or_none("pro.tutor_images_per_hour")
    day_cap = flags.int_or_none("pro.tutor_images_per_day")
    return (hour_cap is not None and int(row.hour) >= hour_cap) or (
        day_cap is not None and int(row.day) >= day_cap
    )


async def request_image(
    db: Database,
    ai: AIGateway,
    env_: ImageEnv,
    *,
    user_id: uuid.UUID,
    is_guest: bool,
    source: Literal["tutor_chat", "voice_board"],
    brief: str,
    alt: str,
    style: str = "diagram",
    concept_id: str | None = None,
    tutor_session_id: uuid.UUID | None = None,
    message_id: uuid.UUID | None = None,
    voice_session_id: uuid.UUID | None = None,
) -> Outcome:
    now = datetime.now(UTC)
    style = style if style in PRESETS else "diagram"
    preset, size, ratio = PRESETS[style]
    brief, _ = tutor_safety.redact(" ".join(brief.split())[:BRIEF_MAX])
    alt, _ = tutor_safety.redact(" ".join(alt.split())[:ALT_MAX])
    if not brief or not alt:
        return Outcome(None, "failed", "failed", alt)
    if env_.storage is None:
        return Outcome(None, "failed", "ai_unavailable", alt)
    async with db.system_tx() as session:
        learner = await load_learner(session, user_id, is_guest)
        flags = await load_flags(session)
    verdict = tutor_safety.screen(brief)
    if verdict == tutor_safety.Verdict():
        verdict = tutor_safety.screen(alt)
    if verdict == tutor_safety.Verdict() and flags.bool("ai.llm_moderation"):
        verdict = await tutor_safety.moderate(ai, brief, user_id, under_13=learner.under_13)
    prompt = compose(brief, style)
    phash = cache_key(brief, preset, size, ratio, env_.model_version)
    base = {
        "u": user_id,
        "src": source,
        "ts": tutor_session_id,
        "m": message_id,
        "vs": voice_session_id,
        "c": concept_id,
        "st": preset,
        "sz": size,
        "ra": ratio,
        "p": prompt,
        "h": phash,
        "alt": alt,
        "l": learner.tutor_locale or learner.locale,
    }
    insert = (
        "insert into ai.tutor_images (user_id, source, tutor_session_id, message_id, voice_session_id,"
        " concept_id, style_preset, size, ratio, prompt, prompt_hash, alt, locale, status, reason,"
        " origin, asset_id, storage_bucket, storage_key, finished_at) values (:u, :src, :ts, :m, :vs,"
        " :c, :st, :sz, :ra, :p, :h, :alt, :l, :status, :reason, :origin, :asset, :bucket, :key,"
        " :done) returning id"
    )
    async with db.system_tx() as session:
        # One picture at a time per student, so the caps hold under parallel requests.
        await session.execute(
            text("select pg_advisory_xact_lock(hashtextextended('tutor_image:' || :u, 0))"),
            {"u": str(user_id)},
        )
        if verdict != tutor_safety.Verdict():
            gid = (
                await session.execute(
                    text(insert),
                    {
                        **base,
                        "status": "blocked",
                        "reason": "policy",
                        "origin": None,
                        "asset": None,
                        "bucket": None,
                        "key": None,
                        "done": now,
                    },
                )
            ).scalar_one()
            await session.execute(
                text(
                    "insert into ai.moderation_flags (user_id, source_kind, source_id, category, action)"
                    " values (:u, 'tutor_image', :s, :c, 'blocked')"
                ),
                {"u": user_id, "s": str(gid), "c": verdict.category or "unsafe"},
            )
            log.info("tutor_image", generation=str(gid), status="blocked", source=source)
            return Outcome(uuid.UUID(str(gid)), "blocked", "policy", alt)

        hit: tuple[str, str, Any, str] | None = None
        index = await _index_hit(session, prompt, preset, size, ratio)
        original = (index.variants or {}).get("original") if index is not None else None
        if isinstance(original, dict) and original.get("key"):
            hit = (str(original.get("bucket") or "assets"), str(original["key"]), index.id, "index")
        if hit is None and not learner.under_13:
            cached = (
                await session.execute(
                    text(
                        "update ai.image_cache set last_used_at = :now where prompt_hash = :h"
                        " returning storage_key"
                    ),
                    {"h": phash, "now": now},
                )
            ).scalar_one_or_none()
            if cached is not None:
                hit = ("uploads", str(cached), None, "cache")
        if hit is not None:
            bucket, key, asset_id, origin = hit
            gid = (
                await session.execute(
                    text(insert),
                    {
                        **base,
                        "status": "ready",
                        "reason": None,
                        "origin": origin,
                        "asset": asset_id,
                        "bucket": bucket,
                        "key": key,
                        "done": now,
                    },
                )
            ).scalar_one()
            await _cost_row(session, user_id, origin, phash)
            url, expires = _signed(env_, bucket, key)
            log.info("tutor_image", generation=str(gid), status="ready", origin=origin)
            return Outcome(uuid.UUID(str(gid)), "ready", None, alt, url, expires)

        # A new picture: Pro only (R35), never for under-13s, and within the caps.
        if learner.under_13:
            return Outcome(None, "failed", "not_for_age", alt)
        if not learner.is_pro:
            return Outcome(None, "failed", "pro_required", alt)
        if await _over_caps(session, learner, flags, now):
            return Outcome(None, "failed", "limit_reached", alt)
        gid = (
            await session.execute(
                text(insert),
                {
                    **base,
                    "status": "pending",
                    "reason": None,
                    "origin": "generated",
                    "asset": None,
                    "bucket": None,
                    "key": None,
                    "done": None,
                },
            )
        ).scalar_one()
    generation_id = uuid.UUID(str(gid))
    await env_.jobs.enqueue(JOB, str(generation_id), job_id=f"{JOB}:{generation_id}:0")
    log.info("tutor_image", generation=str(generation_id), status="pending", source=source)
    return Outcome(generation_id, "pending", None, alt)


# --- the chat's "Draw it" -------------------------------------------------------------------------

_BRIEF_PROMPT = (
    "You plan one teaching picture for a study app. Reply with JSON only: "
    '{{"brief": "...", "alt": "...", "style": "diagram" or "scene"}}. '
    '"brief" says in plain English what to draw, in one or two sentences, from the course '
    "material and the tutor's answer below. Never copy the student's words, names or personal "
    'details, and never ask for text, labels or numbers in the picture. Use "diagram" for parts, '
    'processes and structures, and "scene" for events and situations. "alt" is one short sentence '
    "describing the picture for a screen reader, {language}"
)


def _alt_language(locale: str) -> str:
    if locale == "hi":
        return "in Hindi (Devanagari)."
    if locale == "en":
        return "in English."
    return "in the language of the tutor's answer."


async def brief_from_answer(
    ai: AIGateway,
    *,
    user_id: uuid.UUID,
    answer: str,
    material: str,
    locale: str,
) -> tuple[str, str, str] | None:
    """The ``cheap`` tier writes the picture brief for "Draw it" from the answer and the course
    material (the student's message is not sent). ``None`` when the reply is not usable."""
    clean, _ = tutor_safety.redact(answer[:4000])
    try:
        result = await ai.complete(
            feature="tutor_image_brief",
            tier="cheap",
            messages=[
                ChatMessage("system", _BRIEF_PROMPT.format(language=_alt_language(locale))),
                ChatMessage("user", f"COURSE MATERIAL:\n{material}\n\nTUTOR'S ANSWER:\n{clean}"),
            ],
            user_id=user_id,
            max_tokens=300,
        )
    except AIError:
        return None
    raw = result.text.strip()
    start, end = raw.find("{"), raw.rfind("}")
    try:
        data = json.loads(raw[start : end + 1]) if start >= 0 and end > start else None
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    brief, alt, style = (str(data.get(k) or "").strip() for k in ("brief", "alt", "style"))
    if not brief or not alt:
        return None
    return brief, alt, style if style in PRESETS else "diagram"


# --- reading and retrying -------------------------------------------------------------------------

# Every column but the prompt, which never leaves the server.
_SELECT_OWN = (
    "select id, source, status, reason, origin, alt, locale, message_id, tutor_session_id,"
    " storage_bucket, storage_key, retries, created_at, finished_at"
    " from ai.tutor_images where id = :id and user_id = :u"
)
_RETRY = (
    "update ai.tutor_images set status = 'pending', reason = null, finished_at = null,"
    " retries = retries + 1 where id = :id returning id, source, status, reason, origin, alt,"
    " locale, message_id, tutor_session_id, storage_bucket, storage_key, retries, created_at,"
    " finished_at"
)


def _out(env_: ImageEnv, r: Any) -> ti.GenerationOut:
    url, expires = (None, None)
    if r.status == "ready":
        url, expires = _signed(env_, r.storage_bucket, r.storage_key)
    return ti.GenerationOut(
        id=r.id,
        source=r.source,
        status=r.status,
        reason=r.reason,
        origin=r.origin,
        alt=r.alt,
        locale=r.locale,
        url=url,
        url_expires_at=expires,
        message_id=r.message_id,
        tutor_session_id=r.tutor_session_id,
        can_retry=r.status == "failed" and r.origin == "generated" and r.retries < 1,
        created_at=r.created_at,
        finished_at=r.finished_at,
    )


async def get_generation(
    db: Database,
    env_: ImageEnv,
    user_id: uuid.UUID,
    claims: dict[str, Any],
    generation_id: uuid.UUID,
) -> ti.GenerationOut:
    async with db.user_tx(claims) as session:
        row = (
            await session.execute(
                text(_SELECT_OWN),
                {"id": generation_id, "u": user_id},
            )
        ).one_or_none()
    if row is None:
        raise ApiError(404, "not_found", "No such picture")
    return _out(env_, row)


async def retry(
    db: Database, env_: ImageEnv, user_id: uuid.UUID, generation_id: uuid.UUID
) -> ti.GenerationOut:
    """[Try again] after a failure: once per picture, and it never counts as a new message."""
    async with db.system_tx() as session:
        row = (
            await session.execute(
                text(_SELECT_OWN + " for update"),
                {"id": generation_id, "u": user_id},
            )
        ).one_or_none()
        if row is None:
            raise ApiError(404, "not_found", "No such picture")
        if row.status == "pending":
            return _out(env_, row)
        if not (row.status == "failed" and row.origin == "generated" and row.retries < 1):
            raise ApiError(409, "cannot_retry", "This picture can't be tried again")
        row = (
            await session.execute(
                text(_RETRY),
                {"id": generation_id},
            )
        ).one()
    await env_.jobs.enqueue(JOB, str(generation_id), job_id=f"{JOB}:{generation_id}:{row.retries}")
    log.info("tutor_image_retry", generation=str(generation_id))
    return _out(env_, row)


# --- the media-queue job --------------------------------------------------------------------------


async def _fail(db: Database, generation_id: uuid.UUID, reason: str) -> dict[str, str]:
    async with db.system_tx() as session:
        await session.execute(
            text(
                "update ai.tutor_images set status = 'failed', reason = :r, finished_at = now()"
                " where id = :id and status = 'pending'"
            ),
            {"id": generation_id, "r": reason},
        )
    log.warning("tutor_image_failed", generation=str(generation_id), reason=reason)
    return {"status": "failed", "reason": reason}


async def generate(
    db: Database,
    ai: AIGateway,
    storage: ObjectStorage,
    http: httpx.AsyncClient,
    generation_id: uuid.UUID,
) -> dict[str, str]:
    async with db.system_tx() as session:
        row = (
            await session.execute(
                text(
                    "select id, user_id, prompt, prompt_hash, style_preset, size, ratio, status"
                    " from ai.tutor_images where id = :id for update skip locked"
                ),
                {"id": generation_id},
            )
        ).one_or_none()
        if row is None or row.status != "pending":
            return {"status": "skipped"}
        # Someone drew the same picture meanwhile: reuse it.
        cached = (
            await session.execute(
                text(
                    "update ai.image_cache set last_used_at = now() where prompt_hash = :h"
                    " returning storage_key"
                ),
                {"h": row.prompt_hash},
            )
        ).scalar_one_or_none()
        if cached is not None:
            await session.execute(
                text(
                    "update ai.tutor_images set status = 'ready', storage_bucket = 'uploads',"
                    " storage_key = :k, finished_at = now() where id = :id"
                ),
                {"id": generation_id, "k": cached},
            )
            return {"status": "ready"}
    try:
        result = await ai.generate_image(
            feature="tutor_image",
            prompt=row.prompt,
            user_id=row.user_id,
            size=row.size,
            ratio=row.ratio,
        )
        if not result.images:
            raise media.MediaError("no image returned")
        data = await media.image_bytes(result.images[0], http)
        mime, ext = media.sniff(data)
    except BudgetExceeded:
        return await _fail(db, generation_id, "busy")
    except AIConfigError:
        return await _fail(db, generation_id, "ai_unavailable")
    except (AIError, media.MediaError, httpx.HTTPError):
        return await _fail(db, generation_id, "failed")
    key = f"tutor-images/{row.prompt_hash[:2]}/{row.prompt_hash}.{ext}"
    try:
        await storage.put("uploads", key, data, mime)
    except StorageError:
        return await _fail(db, generation_id, "failed")
    async with db.system_tx() as session:
        stored = (
            await session.execute(
                text(
                    "insert into ai.image_cache (prompt_hash, storage_key, mime, bytes, model, style_preset)"
                    " values (:h, :k, :m, :b, :model, :st) on conflict (prompt_hash) do update"
                    " set last_used_at = now() returning storage_key"
                ),
                {
                    "h": row.prompt_hash,
                    "k": key,
                    "m": mime,
                    "b": len(data),
                    "model": result.model,
                    "st": row.style_preset,
                },
            )
        ).scalar_one()
        await session.execute(
            text(
                "update ai.tutor_images set status = 'ready', storage_bucket = 'uploads',"
                " storage_key = :k, finished_at = now() where id = :id"
            ),
            {"id": generation_id, "k": stored},
        )
    log.info("tutor_image_ready", generation=str(generation_id), bytes=len(data))
    return {"status": "ready"}


async def generate_job(deps: JobDeps, generation_id: str) -> dict[str, str]:
    """The ``tutor_image`` job (media queue)."""
    if deps.integrations is None or deps.ai is None:
        raise RuntimeError("tutor_image needs the AI gateway and storage")
    async with httpx.AsyncClient(timeout=60) as http:
        return await generate(
            deps.db, deps.ai, deps.integrations.storage, http, uuid.UUID(generation_id)
        )


# --- retention ------------------------------------------------------------------------------------


async def purge(db: Database, storage: ObjectStorage, now: datetime | None = None) -> int:
    """Pictures older than ``ai.tutor_retention_days`` go with the tutor thread; cached files no
    picture still points at, and unused for as long, are deleted from storage too."""
    now = now or datetime.now(UTC)
    async with db.system_tx() as session:
        days = (await load_flags(session)).int_or_none("ai.tutor_retention_days")
        if days is None:
            return 0
        cutoff = now - timedelta(days=days)
        removed = len(
            (
                await session.execute(
                    text("delete from ai.tutor_images where created_at < :c returning id"),
                    {"c": cutoff},
                )
            ).all()
        )
        stale = (
            await session.execute(
                text(
                    "select prompt_hash, storage_key from ai.image_cache c where last_used_at < :c"
                    " and not exists (select 1 from ai.tutor_images g where g.prompt_hash = c.prompt_hash"
                    " and g.storage_bucket = 'uploads') order by last_used_at limit 5000"
                ),
                {"c": cutoff},
            )
        ).all()
    for r in stale:
        try:
            await storage.delete("uploads", r.storage_key)
        except StorageError:
            continue
        async with db.system_tx() as session:
            await session.execute(
                text("delete from ai.image_cache where prompt_hash = :h and last_used_at < :c"),
                {"h": r.prompt_hash, "c": cutoff},
            )
        removed += 1
    return removed


async def purge_job(deps: JobDeps) -> int:
    if deps.integrations is None:
        return 0
    return await purge(deps.db, deps.integrations.storage)
