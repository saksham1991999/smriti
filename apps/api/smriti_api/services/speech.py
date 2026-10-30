"""Read-aloud (Deepgram TTS) and dictation (Deepgram STT) through the AI gateway (TRD §9.4).

Read-aloud is not a Pro tool (R35): free users get ``free.tutor_read_aloud_per_day``, Pro has no
cap. Audio is cached by ``sha256(text, voice, locale)`` in private storage, so a repeated answer
costs nothing and needs no provider call; every read-aloud, cached or not, is one
``ai.generations`` row (``kind = 'tts'``), which is what the daily count reads.

Dictation (voice answers, spoken Feynman explanations) sends audio to a third-party processor, so
it follows the voice gates: Pro, no little learners, and the guardian's ``voice`` scope for
minors. The audio is not stored after transcription (tutor-social §A8), and neither the audio
nor the text is logged.
"""

from __future__ import annotations

import hashlib
import unicodedata
from datetime import UTC, datetime

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.ai.gateway import AIGateway
from smriti_api.ai.interfaces import AIConfigError, AIError, BudgetExceeded
from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.integrations.storage import ObjectStorage, StorageError
from smriti_api.schemas import voice as v
from smriti_api.schemas.practice import QuotaOut
from smriti_api.services import voice
from smriti_api.services.usage import Learner, Quota, load_flags, load_learner, next_local_midnight
from smriti_api.services.usage import quota as make_quota

log = structlog.get_logger(__name__)

MAX_AUDIO_BYTES = 10 * 1024 * 1024
AUDIO_TYPES = (
    "audio/webm",
    "audio/ogg",
    "audio/mpeg",
    "audio/mp4",
    "audio/wav",
    "audio/x-wav",
    "audio/aac",
    "audio/m4a",
    "audio/x-m4a",
    "audio/flac",
)
TTS_VOICE = "default"  # the provider's configured voice (DEEPGRAM_TTS_MODEL); never a name here


def speech_unavailable(exc: Exception) -> ApiError:
    return ApiError(503, "speech_unavailable", "Audio isn't available right now")


def _quota_out(q: Quota, learner: Learner, now: datetime) -> QuotaOut:
    return QuotaOut(
        unlimited=q.unlimited,
        limit=q.limit,
        used=q.used,
        remaining=q.remaining,
        resets_at=next_local_midnight(learner, now),
    )


async def _count_today(session: AsyncSession, learner: Learner, kind: str, now: datetime) -> int:
    start, end = learner.day_bounds(now)
    value = (
        await session.execute(
            text(
                "select count(*) from ai.generations where user_id = :u and kind = :k"
                " and status = 'ok' and created_at >= :s and created_at < :e"
            ),
            {"u": learner.user_id, "k": kind, "s": start, "e": end},
        )
    ).scalar_one()
    return int(value)


def cache_key(text_in: str, locale: str, voice_name: str = TTS_VOICE) -> str:
    normalized = " ".join(unicodedata.normalize("NFC", text_in).split())
    return hashlib.sha256(f"{normalized}\x1f{voice_name}\x1f{locale}".encode()).hexdigest()


async def read_aloud(
    db: Database,
    ai: AIGateway,
    storage: ObjectStorage,
    auth: AuthContext,
    body: v.ReadAloudIn,
    url_ttl_s: int,
) -> v.ReadAloudOut:
    now = datetime.now(UTC)
    digest = cache_key(body.text, body.locale)
    async with db.system_tx() as session:
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        flags = await load_flags(session)
        await session.execute(
            text("select pg_advisory_xact_lock(hashtextextended('tts:' || :u, 0))"),
            {"u": str(auth.user_id)},
        )
        used = await _count_today(session, learner, "tts", now)
        q = make_quota(used, flags.int_or_none("free.tutor_read_aloud_per_day"), learner.is_pro)
        if not q.allowed:
            # At the cap the button shows a toast with the reset time, never a paywall (R35).
            raise ApiError(
                429,
                "read_aloud_limit",
                "Read-aloud is back tomorrow",
                resets_at=next_local_midnight(learner, now).isoformat(),
            )
        cached = (
            await session.execute(
                text("select storage_key, mime from ai.tts_cache where key_hash = :h"),
                {"h": digest},
            )
        ).one_or_none()
        if cached is not None:
            await session.execute(
                text("update ai.tts_cache set last_used_at = :now where key_hash = :h"),
                {"h": digest, "now": now},
            )
            await session.execute(
                text(
                    "insert into ai.generations (user_id, kind, provider, model, input_hash,"
                    " cache_hit, status) values (:u, 'tts', 'cache', '', :h, true, 'ok')"
                ),
                {"u": auth.user_id, "h": digest},
            )
            q = make_quota(used + 1, q.limit, learner.is_pro)
            return v.ReadAloudOut(
                url=storage.signed_url("uploads", cached.storage_key, url_ttl_s),
                mime=cached.mime,
                cached=True,
                quota=_quota_out(q, learner, now),
            )
    try:
        audio = await ai.tts(
            feature="read_aloud", text_in=body.text, locale=body.locale, user_id=auth.user_id
        )
    except BudgetExceeded as exc:
        raise ApiError(429, "ai_budget", "Read-aloud needs a break; try later") from exc
    except (AIConfigError, AIError) as exc:
        raise speech_unavailable(exc) from exc
    key = f"tts/{digest[:2]}/{digest}.mp3"
    try:
        await storage.put("uploads", key, audio.audio, audio.mime)
    except StorageError as exc:
        raise speech_unavailable(exc) from exc
    async with db.system_tx() as session:
        await session.execute(
            text(
                "insert into ai.tts_cache (key_hash, storage_key, mime, bytes, locale)"
                " values (:h, :k, :m, :b, :l) on conflict (key_hash) do update set last_used_at = now()"
            ),
            {"h": digest, "k": key, "m": audio.mime, "b": len(audio.audio), "l": body.locale},
        )
    q = make_quota(used + 1, q.limit, learner.is_pro)
    return v.ReadAloudOut(
        url=storage.signed_url("uploads", key, url_ttl_s),
        mime=audio.mime,
        cached=False,
        quota=_quota_out(q, learner, now),
    )


def check_audio(data: bytes, mime: str) -> str:
    base = mime.split(";", 1)[0].strip().lower()
    if base not in AUDIO_TYPES:
        raise ApiError(415, "unsupported_audio", "Send the recording as an audio file")
    if not data:
        raise ApiError(422, "empty_audio", "The recording is empty")
    if len(data) > MAX_AUDIO_BYTES:
        raise ApiError(413, "audio_too_large", "The recording is too long", limit=MAX_AUDIO_BYTES)
    return base


async def dictate(
    db: Database, ai: AIGateway, auth: AuthContext, data: bytes, mime: str, locale: str
) -> v.DictationOut:
    now = datetime.now(UTC)
    base = check_audio(data, mime)
    async with db.system_tx() as session:
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        flags = await load_flags(session)
        voice.require_pro(learner, "tutor_voice")
        await voice.require_voice_audio(session, learner)
        used = await _count_today(session, learner, "stt", now)
        # Pro has a fair-use cap here too, so is_pro is never "unlimited".
        q = make_quota(used, flags.int_or_none("pro.dictation_per_day"), False)
        if not q.allowed:
            raise ApiError(
                429,
                "dictation_limit",
                "Voice typing is back tomorrow",
                resets_at=next_local_midnight(learner, now).isoformat(),
            )
    try:
        result = await ai.stt(
            feature="dictation", audio=data, mime=base, locale=locale, user_id=auth.user_id
        )
    except BudgetExceeded as exc:
        raise ApiError(429, "ai_budget", "Voice typing needs a break; try later") from exc
    except (AIConfigError, AIError) as exc:
        raise speech_unavailable(exc) from exc
    q = make_quota(used + 1, q.limit, False)
    return v.DictationOut(
        text=result.text, confidence=result.confidence, quota=_quota_out(q, learner, now)
    )
