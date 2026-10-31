"""The realtime voice tutor (IMPLEMENTATION_PLAN G-2, TRD §9.4, tutor-social §A9).

``POST /v1/voice/sessions`` checks, in order: the ``feature.voice_tutor`` switch, Pro (voice is a
Pro tool, R35), age (little learners have no voice), the guardian's ``voice`` scope for minors
(audio goes to a third-party processor, auth flow §6.10), the exam-integrity guard (no tutor in a
strict or live mock, R24) and the daily fair-use seconds. It then builds the same grounded system
prompt as the text tutor (policy, language, age rule, context, mastery) plus the voice rules, and
mints a single-use Gemini Live token locked to that setup through the AI gateway. The device
streams audio to Gemini directly; the key never reaches it and the server never stores the token.

The model's tool calls come back to ``/tools`` and run here against published content and the
student's own data. At the end the device uploads the transcript: personal data is removed, the
text tutor's safety screen runs on every turn (a crisis signal returns the helplines and queues a
review flag), and the transcript is stored privately in object storage under the tutor's
retention (``ai.tutor_retention_days``). Transcript text is never logged.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.ai.gateway import AIGateway
from smriti_api.ai.interfaces import AIConfigError, AIError, BudgetExceeded, ToolSpec, VoiceContext
from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.integrations.storage import ObjectStorage, StorageError
from smriti_api.schemas import sync as s
from smriti_api.schemas import voice as v
from smriti_api.services import privacy, tutor, tutor_images, tutor_retrieval, tutor_safety
from smriti_api.services.usage import Flags, Learner, load_flags, load_learner, next_local_midnight

if TYPE_CHECKING:
    from smriti_api.services.jobs import JobDeps

log = structlog.get_logger(__name__)

TRANSCRIPT_PREFIX = "voice-transcripts"
# Abuse guards, not product numbers: a real session makes a handful of tool calls.
MAX_TOOL_CALLS = 200
TOKEN_MARGIN_S = 30
WARN_BEFORE_S = 120  # tutor-social §A9 step 5: "At 2 minutes left the banner says so"
_NS = uuid.UUID("5d3f0b8e-2a51-4f8e-9a57-3c1f2f0b7a11")

VOICE_RULES = """You are speaking, not writing. Keep each turn to two or three short sentences, \
then check the student is with you. If they talk while you are speaking, stop and listen.
Never read long equations aloud: call show_formula with the concept id so the formula appears on \
the board, then explain it in words. Use look_up_concept before stating a fact you are unsure of, \
get_mastery to pitch the explanation, queue_cards when the student asks to review a concept \
later, and make_flashcard when they ask to save something as a flashcard. When a picture would \
really help, call generate_image with a short brief written from the course content (never the \
student's own words, name or details) and describe it while it appears on the board. Say goodbye \
briefly when told the time is up."""

TOOLS: tuple[ToolSpec, ...] = (
    ToolSpec(
        "look_up_concept",
        "Look up a concept in the published course by id, or search it by words. Returns the "
        "concept's name, summary and key points from the course.",
        {
            "type": "object",
            "properties": {
                "concept_id": {"type": "string", "description": "A concept id, if known"},
                "query": {"type": "string", "description": "Words to search for"},
            },
        },
    ),
    ToolSpec(
        "show_formula",
        "Show a concept's formula and key points on the student's board.",
        {
            "type": "object",
            "properties": {"concept_id": {"type": "string"}},
            "required": ["concept_id"],
        },
    ),
    ToolSpec(
        "queue_cards",
        "Add the review cards of these concepts to the student's reviews.",
        {
            "type": "object",
            "properties": {"concept_ids": {"type": "array", "items": {"type": "string"}}},
            "required": ["concept_ids"],
        },
    ),
    ToolSpec(
        "make_flashcard",
        'Save a flashcard to the student\'s "From the tutor" deck (AI-04): the front is the '
        "question as the student asked it, the back a short answer.",
        {
            "type": "object",
            "properties": {
                "front": {"type": "string"},
                "back": {"type": "string"},
                "concept_id": {
                    "type": "string",
                    "description": "The concept it is about, if known",
                },
            },
            "required": ["front", "back"],
        },
    ),
    ToolSpec(
        "get_mastery",
        "The student's mastery (0 to 1) of these concepts.",
        {
            "type": "object",
            "properties": {"concept_ids": {"type": "array", "items": {"type": "string"}}},
            "required": ["concept_ids"],
        },
    ),
    ToolSpec(
        "generate_image",
        "Show a teaching picture on the student's board (AI-14). The brief says what to draw, in "
        "plain English, from the course content; no text or labels in the picture.",
        {
            "type": "object",
            "properties": {
                "brief": {"type": "string", "description": "What to draw, one or two sentences"},
                "alt": {
                    "type": "string",
                    "description": "One sentence describing the picture, in the student's language",
                },
                "style": {"type": "string", "enum": ["diagram", "scene"]},
                "concept_id": {"type": "string", "description": "The concept it shows, if known"},
            },
            "required": ["brief", "alt"],
        },
    ),
)


def unavailable(reason: str) -> ApiError:
    return ApiError(503, "voice_unavailable", "Voice isn't available right now", reason=reason)


# --- gates shared with dictation and Feynman --------------------------------------------------------


def require_pro(learner: Learner, source: str) -> None:
    """Voice, dictation and Feynman are Pro tools (R35, tutor-social §A6). Under-13s never see a
    price (R15): no paywall trigger for them."""
    if not learner.is_pro:
        raise ApiError(
            403,
            "pro_required",
            "This is part of Pro",
            paywall_trigger=None if learner.under_13 else "tutor_tool",
            paywall_source=source,
        )


async def require_voice_audio(session: AsyncSession, learner: Learner) -> None:
    """Audio goes to a third-party processor: little learners have no voice, and minors need the
    guardian's ``voice`` scope (tutor-social §A9 step 1)."""
    if learner.age_band == "u10":
        raise ApiError(403, "voice_not_for_age", "Voice isn't available for little learners")
    await privacy.require_scope(session, learner.user_id, "voice")


# --- quota ------------------------------------------------------------------------------------------


async def used_seconds(session: AsyncSession, learner: Learner, now: datetime) -> int:
    """Talk time today: ended sessions count their seconds; an open one counts the time since it
    started (up to its cap), so two devices can't both spend the same minutes."""
    start, end = learner.day_bounds(now)
    value = (
        await session.execute(
            text(
                """
                select coalesce(sum(least(
                         coalesce(seconds,
                                  greatest(0, extract(epoch from (least(:now, token_expires_at) - started_at)))::int),
                         coalesce(max_seconds, 2147483647))), 0)
                  from ai.voice_sessions
                 where user_id = :u and started_at >= :s and started_at < :e
                """
            ),
            {"u": learner.user_id, "s": start, "e": end, "now": now},
        )
    ).scalar_one()
    return int(value)


async def quota(
    session: AsyncSession, learner: Learner, flags: Flags, now: datetime
) -> v.VoiceQuota:
    daily = flags.int_or_none("pro.voice_daily_seconds")
    used = await used_seconds(session, learner, now)
    remaining = None if daily is None else max(0, daily - used)
    reason: str | None = None
    if not flags.bool("feature.voice_tutor"):
        reason = "feature_off"
    elif not learner.is_pro:
        reason = "pro_required"
    elif learner.age_band == "u10":
        reason = "not_for_age"
    elif daily is None:
        # The fair-use cap is an owner number (PRD §5.5); voice stays off until it is set.
        reason = "limit_not_set"
    elif remaining == 0:
        reason = "daily_limit"
    return v.VoiceQuota(
        available=reason is None,
        reason=reason,
        daily_seconds=daily,
        used_seconds=used,
        remaining_seconds=remaining,
        session_max_seconds=flags.int_or_none("voice.session_max_seconds"),
        reconnect_seconds=flags.int_or_none("voice.reconnect_seconds"),
        background_grace_seconds=flags.int_or_none("voice.background_grace_seconds"),
        resets_at=next_local_midnight(learner, now),
    )


async def get_quota(db: Database, auth: AuthContext) -> v.VoiceQuota:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        return await quota(session, learner, await load_flags(session), now)


# --- sessions ---------------------------------------------------------------------------------------


def _declarations() -> list[v.ToolDeclaration]:
    return [
        v.ToolDeclaration(name=t.name, description=t.description, parameters=t.parameters)
        for t in TOOLS
    ]


async def _instructions(session: AsyncSession, learner: Learner, context_ref: str | None) -> str:
    ctx = (
        await tutor.resolve_context(session, learner.user_id, context_ref) if context_ref else None
    )
    mastery = await tutor._mastery_line(session, learner.user_id, ctx)
    base = tutor.system_prompt(learner, ctx, [], mastery, redirect=False, your_answer=None)
    return base + "\n\n" + VOICE_RULES


async def _end_open(
    session: AsyncSession, user_id: uuid.UUID, keep: uuid.UUID | None, now: datetime
) -> None:
    """A new session closes any other open one (an app killed mid-call never sent /end)."""
    await session.execute(
        text(
            """
            update ai.voice_sessions
               set status = 'expired', end_reason = 'expired', ended_at = :now,
                   seconds = least(greatest(0, extract(epoch from (least(:now, token_expires_at) - started_at)))::int,
                                   coalesce(max_seconds, 2147483647))
             where user_id = :u and status = 'minted' and id is distinct from :keep
            """
        ),
        {"u": user_id, "keep": keep, "now": now},
    )


async def create_session(
    db: Database, ai: AIGateway, auth: AuthContext, body: v.VoiceSessionCreate
) -> v.VoiceSessionOut:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        flags = await load_flags(session)
        if not flags.bool("feature.voice_tutor"):
            raise unavailable("feature_off")
        require_pro(learner, "tutor_voice")
        await require_voice_audio(session, learner)
        if await tutor.exam_guard(session, auth.user_id, None):
            raise ApiError(409, "exam_in_progress", "The tutor is off while a timed mock runs")
        if body.context_ref:
            await tutor.resolve_context(session, auth.user_id, body.context_ref)
        await session.execute(
            text("select pg_advisory_xact_lock(hashtextextended('voice:' || :u, 0))"),
            {"u": str(auth.user_id)},
        )
        existing = (
            await session.execute(
                text(
                    "select * from ai.voice_sessions where user_id = :u and client_session_id = :c"
                ),
                {"u": auth.user_id, "c": body.client_session_id},
            )
        ).one_or_none()
        if existing is not None and existing.status != "minted":
            raise ApiError(409, "voice_session_ended", "That voice session has ended")
        await _end_open(session, auth.user_id, existing.id if existing else None, now)
        q = await quota(session, learner, flags, now)
        if q.reason == "limit_not_set":
            raise unavailable("limit_not_set")
        if existing is not None:
            # Reconnect: a fresh token for the time this session has left (§A9 step 6).
            spent = max(0, int((now - existing.started_at).total_seconds()))
            reconnect = flags.int_or_none("voice.reconnect_seconds") or 0
            if now > existing.token_expires_at + timedelta(seconds=reconnect):
                raise ApiError(409, "voice_session_ended", "That voice session has ended")
            left = int(existing.max_seconds or 0) - spent
            if left <= 0:
                raise ApiError(409, "voice_session_ended", "That voice session has ended")
            row_id, tutor_session_id, max_seconds = (
                existing.id,
                existing.tutor_session_id,
                int(existing.max_seconds),
            )
            ttl = left + TOKEN_MARGIN_S
            context_ref = existing.context_ref
        else:
            if q.remaining_seconds is not None and q.remaining_seconds <= 0:
                raise ApiError(
                    429,
                    "voice_daily_limit",
                    "Today's voice time is used up",
                    resets_at=q.resets_at.isoformat(),
                )
            cap = q.session_max_seconds
            max_seconds = min(x for x in (cap, q.remaining_seconds) if x is not None)
            ttl = max_seconds + TOKEN_MARGIN_S
            context_ref = body.context_ref
            row, _ = await tutor._open(
                session,
                learner,
                flags,
                mode="voice",
                context_ref=context_ref,
                exam=body.exam,
                now=now,
            )
            tutor_session_id = row.id
            row_id = uuid.uuid5(_NS, f"{auth.user_id}:{body.client_session_id}")
        instructions = await _instructions(session, learner, context_ref)
        locale = tutor._tutor_locale(learner)
    try:
        minted = await ai.voice_session(
            feature="voice_tutor",
            context=VoiceContext(instructions, locale, TOOLS, ttl_s=ttl),
            user_id=auth.user_id,
        )
    except AIConfigError as exc:
        raise unavailable("not_configured") from exc
    except BudgetExceeded as exc:
        raise ApiError(429, "ai_budget", "The tutor needs a break; try later") from exc
    except AIError as exc:
        raise unavailable("provider_error") from exc
    async with db.system_tx() as session:
        if existing is not None:
            await session.execute(
                text(
                    "update ai.voice_sessions set token_expires_at = :exp,"
                    " tokens_minted = least(tokens_minted + 1, 32767) where id = :id"
                ),
                {"id": row_id, "exp": minted.expires_at},
            )
        else:
            await session.execute(
                text(
                    """
                    insert into ai.voice_sessions
                      (id, user_id, tutor_session_id, provider, token_expires_at, started_at,
                       client_session_id, context_ref, locale, max_seconds)
                    values (:id, :u, :ts, :p, :exp, :now, :c, :ctx, :l, :max)
                    """
                ),
                {
                    "id": row_id,
                    "u": auth.user_id,
                    "ts": tutor_session_id,
                    "p": minted.provider,
                    "exp": minted.expires_at,
                    "now": now,
                    "c": body.client_session_id,
                    "ctx": context_ref,
                    "l": locale,
                    "max": max_seconds,
                },
            )
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        q = await quota(session, learner, await load_flags(session), now)
    log.info("voice_session_minted", resumed=existing is not None, max_seconds=max_seconds)
    return v.VoiceSessionOut(
        id=row_id,
        tutor_session_id=tutor_session_id,
        token=minted.token,
        token_expires_at=minted.expires_at,
        provider=minted.provider,
        model=minted.model,
        max_seconds=max_seconds,
        warn_at_seconds=max(0, max_seconds - WARN_BEFORE_S),
        locale=locale,
        tools=_declarations(),
        resumed=existing is not None,
        quota=q,
    )


async def _owned(session: AsyncSession, user_id: uuid.UUID, session_id: uuid.UUID) -> Any:
    row = (
        await session.execute(
            text("select * from ai.voice_sessions where id = :id and user_id = :u"),
            {"id": session_id, "u": user_id},
        )
    ).one_or_none()
    if row is None:
        raise ApiError(404, "voice_session_not_found", "No such voice session")
    return row


# --- tool relay ------------------------------------------------------------------------------------


def _strings(value: Any, limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(x)[:200] for x in value if isinstance(x, str) and x][:limit]


async def _concept_view(
    session: AsyncSession, concept_id: str, locale: str
) -> dict[str, Any] | None:
    concepts = await tutor._concepts(session, ids=[concept_id])
    if not concepts:
        return None
    c = concepts[0]
    return {
        "id": c["id"],
        "name": tutor._localized(c["name"], locale),
        "summary": tutor._localized(c["summary"], locale),
        "key_points": [tutor._localized(p, locale) for p in c.get("key_points") or []],
    }


async def _run_tool(
    db: Database,
    row: Any,
    auth: AuthContext,
    call: v.ToolCallIn,
    client: Mapping[str, Any],
    ai: AIGateway | None = None,
    images: tutor_images.ImageEnv | None = None,
) -> dict[str, Any]:
    locale = row.locale or "en"
    if call.name == "generate_image":
        # The board picture (tutor-social §A9 step 4): the same pipeline as "Draw it".
        if ai is None or images is None:
            return {"error": "ai_unavailable"}
        concept = call.args.get("concept_id")
        outcome = await tutor_images.request_image(
            db,
            ai,
            images,
            user_id=auth.user_id,
            is_guest=auth.is_anonymous,
            source="voice_board",
            brief=str(call.args.get("brief") or ""),
            alt=str(call.args.get("alt") or ""),
            style=str(call.args.get("style") or "diagram"),
            concept_id=concept[:200] if isinstance(concept, str) and concept else None,
            tutor_session_id=row.tutor_session_id,
            voice_session_id=row.id,
        )
        return outcome.board()
    if call.name in ("look_up_concept", "show_formula", "get_mastery"):
        async with db.system_tx() as session:
            if call.name == "get_mastery":
                ids = _strings(call.args.get("concept_ids"), 20)
                rows = (
                    await session.execute(
                        text(
                            "select concept_id, mastery from learn.concept_mastery"
                            " where user_id = :u and concept_id = any(:c)"
                        ),
                        {"u": auth.user_id, "c": ids},
                    )
                ).all()
                found = {r.concept_id: round(float(r.mastery), 2) for r in rows}
                return {"mastery": {c: found.get(c) for c in ids}}
            concept_id = call.args.get("concept_id")
            if isinstance(concept_id, str) and concept_id:
                view = await _concept_view(session, concept_id[:200], locale)
                if view is None:
                    return {"error": "unknown_concept"}
                if call.name == "show_formula":
                    return {
                        "board": {
                            "kind": "formula",
                            "concept_id": view["id"],
                            "title": view["name"],
                            "lines": view["key_points"],
                        }
                    }
                return {"concepts": [view]}
            if call.name == "show_formula":
                return {"error": "concept_id_required"}
            query = str(call.args.get("query") or "")[:300]
            if not query:
                return {"error": "query_required"}
            passages = await tutor_retrieval.FullTextRetriever().search(
                session, query, exam=None, locale=locale, limit=3
            )
            return {
                "results": [
                    {"kind": p.kind, "id": p.id, "title": p.title, "text": p.body[:600]}
                    for p in passages
                ]
            }
    if call.name == "make_flashcard":
        return await _flashcard(db, call, locale)
    # queue_cards: the same cards_queued event the device writes (R52), so the result matches.
    from smriti_api.services.sync import apply_batch

    ids = _strings(call.args.get("concept_ids"), 50)
    if not ids:
        return {"error": "concept_ids_required"}
    async with db.system_tx() as session:
        tz = (
            await session.execute(
                text("select timezone from app.profiles where user_id = :u"), {"u": auth.user_id}
            )
        ).scalar_one_or_none()
    result = await apply_batch(
        db,
        user_id=auth.user_id,
        device_id=client.get("device_id"),
        events=[
            s.SyncEventIn(
                event_id=uuid.uuid5(_NS, f"tool:{row.id}:{call.call_id}"),
                type="cards_queued",
                occurred_at=datetime.now(UTC),
                tz=tz or "Asia/Kolkata",
                payload={"source": "lesson", "concept_ids": ids, "card_refs": []},
            )
        ],
    )
    if result.rejected:
        return {"error": result.rejected[0].code}
    return {"queued": len(result.srs_changed), "state_version": result.state_version}


# Abuse guards on the model's card text, not product numbers.
FLASHCARD_FRONT_MAX = 500
FLASHCARD_BACK_MAX = 1000


async def _flashcard(db: Database, call: v.ToolCallIn, locale: str) -> dict[str, Any]:
    """AI-04 from voice: the card the device saves to "From the tutor" through its outbox (decks
    live on the device), with the toast and [Edit]. The model's text is screened like any tutor
    output and personal data is removed. Nothing is stored here."""
    front, back = (str(call.args.get(k) or "").strip() for k in ("front", "back"))
    if not front or not back:
        return {"error": "front_and_back_required"}
    front, _ = tutor_safety.redact(front[:FLASHCARD_FRONT_MAX])
    back, _ = tutor_safety.redact(back[:FLASHCARD_BACK_MAX])
    if any(tutor_safety.screen(x).category is not None for x in (front, back)):
        return {"error": "not_allowed"}
    concept = call.args.get("concept_id")
    concept_id: str | None = None
    if isinstance(concept, str) and concept:
        async with db.system_tx() as session:
            view = await _concept_view(session, concept[:200], locale)
        concept_id = view["id"] if view else None
    return {
        "flashcard": {
            "deck": "from_tutor",
            "front": front,
            "back": back,
            "concept_id": concept_id,
            "source": "voice",
        }
    }


async def relay_tool(
    db: Database,
    auth: AuthContext,
    session_id: uuid.UUID,
    call: v.ToolCallIn,
    device_id: uuid.UUID | None = None,
    *,
    ai: AIGateway | None = None,
    images: tutor_images.ImageEnv | None = None,
) -> v.ToolCallOut:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        row = await _owned(session, auth.user_id, session_id)
        flags = await load_flags(session)
        reconnect = flags.int_or_none("voice.reconnect_seconds") or 0
        if row.status != "minted" or now > row.token_expires_at + timedelta(seconds=reconnect):
            raise ApiError(409, "voice_session_ended", "That voice session has ended")
        if row.tool_calls >= MAX_TOOL_CALLS:
            raise ApiError(429, "too_many_tool_calls", "Too many tool calls in one session")
        await session.execute(
            text("update ai.voice_sessions set tool_calls = tool_calls + 1 where id = :id"),
            {"id": session_id},
        )
    result = await _run_tool(db, row, auth, call, {"device_id": device_id}, ai, images)
    log.info("voice_tool_call", tool=call.name, ok="error" not in result)
    return v.ToolCallOut(call_id=call.call_id, name=call.name, result=result)


# --- end and transcript ------------------------------------------------------------------------------


def _key(user_id: uuid.UUID, session_id: uuid.UUID) -> str:
    return f"{TRANSCRIPT_PREFIX}/{user_id}/{session_id}.json"


def _summary(row: Any, safety: dict[str, Any] | None = None) -> v.VoiceSummary:
    return v.VoiceSummary(
        id=row.id,
        tutor_session_id=row.tutor_session_id,
        context_ref=row.context_ref,
        started_at=row.started_at,
        ended_at=row.ended_at,
        seconds=row.seconds,
        flashcards_made=row.flashcards_made,
        has_transcript=row.transcript_key is not None,
        status=row.status,
        safety=safety,
    )


def screen_turns(
    turns: Sequence[v.TranscriptTurn],
) -> tuple[list[v.TranscriptTurn], str | None, bool]:
    """Removes personal data and runs the text tutor's keyword screen on every turn. Returns the
    clean turns, the worst category (``crisis`` first) and whether anything was blocked."""
    clean: list[v.TranscriptTurn] = []
    crisis = False
    blocked: str | None = None
    for turn in turns:
        redacted, _ = tutor_safety.redact(turn.text)
        verdict = tutor_safety.screen(redacted)
        if verdict.crisis and turn.role == "student":
            crisis = True
        elif verdict.blocked and blocked is None:
            blocked = str(verdict.category)
        clean.append(v.TranscriptTurn(role=turn.role, text=redacted, at_ms=turn.at_ms))
    return clean, "crisis" if crisis else blocked, blocked is not None or crisis


async def end_session(
    db: Database,
    storage: ObjectStorage,
    auth: AuthContext,
    session_id: uuid.UUID,
    body: v.VoiceSessionEnd,
) -> v.VoiceSummary:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        row = await _owned(session, auth.user_id, session_id)
        if row.status != "minted":
            return _summary(row)
        flags = await load_flags(session)
    elapsed = max(0, int((now - row.started_at).total_seconds()))
    seconds = min(body.seconds, elapsed + 5, int(row.max_seconds or body.seconds))
    turns, category, flagged = screen_turns(body.turns)
    key: str | None = None
    if turns:
        payload = {
            "session_id": str(session_id),
            "locale": row.locale,
            "turns": [t.model_dump() for t in turns],
        }
        key = _key(auth.user_id, session_id)
        try:
            await storage.put(
                "uploads", key, json.dumps(payload, ensure_ascii=False).encode(), "application/json"
            )
        except StorageError:
            log.warning("voice_transcript_store_failed")
            key = None
    safety: dict[str, Any] | None = None
    async with db.system_tx() as session:
        await session.execute(
            text(
                """
                update ai.voice_sessions
                   set status = 'ended', ended_at = :now, seconds = :sec, end_reason = :r,
                       flashcards_made = :f, transcript_key = :k, transcript_turns = :n,
                       flagged = :flag
                 where id = :id and status = 'minted'
                """
            ),
            {
                "id": session_id,
                "now": now,
                "sec": seconds,
                "r": body.end_reason,
                "f": body.flashcards_made,
                "k": key,
                "n": min(len(turns), 32767),
                "flag": flagged,
            },
        )
        if category is not None:
            await session.execute(
                text(
                    "insert into ai.moderation_flags (user_id, source_kind, source_id, category, action)"
                    " values (:u, 'voice_transcript', :s, :c, :a)"
                ),
                {
                    "u": auth.user_id,
                    "s": str(session_id),
                    "c": category,
                    "a": "queued" if category == "crisis" else "blocked",
                },
            )
        if category == "crisis":
            learner = await load_learner(session, auth.user_id, auth.is_anonymous)
            safety = {
                "kind": "crisis",
                "helplines": tutor._helplines(flags, tutor._tutor_locale(learner)),
            }
            log.info("safety_crisis_total")
        await session.execute(
            text(
                "update ai.tutor_sessions set ended_at = :now where id = :ts and ended_at is null"
            ),
            {"ts": row.tutor_session_id, "now": now},
        )
        row = await _owned(session, auth.user_id, session_id)
    log.info("voice_session_ended", seconds=seconds, reason=body.end_reason, turns=len(turns))
    return _summary(row, safety)


async def list_sessions(db: Database, auth: AuthContext, limit: int) -> list[v.VoiceSummary]:
    async with db.system_tx() as session:
        rows = (
            await session.execute(
                text(
                    "select * from ai.voice_sessions where user_id = :u"
                    " order by started_at desc limit :n"
                ),
                {"u": auth.user_id, "n": limit},
            )
        ).all()
    return [_summary(r) for r in rows]


async def transcript(
    db: Database, storage: ObjectStorage, auth: AuthContext, session_id: uuid.UUID
) -> v.VoiceTranscript:
    async with db.system_tx() as session:
        row = await _owned(session, auth.user_id, session_id)
    if row.transcript_key is None:
        raise ApiError(404, "no_transcript", "There is no transcript for this session")
    try:
        data = json.loads(await storage.get("uploads", row.transcript_key))
    except StorageError as exc:
        raise ApiError(404, "no_transcript", "There is no transcript for this session") from exc
    return v.VoiceTranscript(
        session_id=session_id,
        locale=data.get("locale"),
        turns=[v.TranscriptTurn.model_validate(t) for t in data.get("turns") or []],
    )


# --- retention ---------------------------------------------------------------------------------------


async def purge_old_transcripts(
    db: Database, storage: ObjectStorage, now: datetime | None = None
) -> int:
    """Voice sessions and their transcripts follow the text tutor's retention
    (``ai.tutor_retention_days``, tutor-social §A9 step 8)."""
    now = now or datetime.now(UTC)
    async with db.system_tx() as session:
        days = (await load_flags(session)).int_or_none("ai.tutor_retention_days")
        if days is None:
            return 0
        rows = (
            await session.execute(
                text(
                    "select id, transcript_key from ai.voice_sessions where started_at < :c"
                    " order by started_at limit 5000"
                ),
                {"c": now - timedelta(days=days)},
            )
        ).all()
    removed = 0
    for r in rows:
        if r.transcript_key:
            try:
                await storage.delete("uploads", r.transcript_key)
            except StorageError:
                log.warning("voice_transcript_delete_failed")
                continue
        async with db.system_tx() as session:
            await session.execute(
                text("delete from ai.voice_sessions where id = :id"), {"id": r.id}
            )
        removed += 1
    return removed


async def purge_job(deps: JobDeps) -> int:
    if deps.integrations is None:
        return 0
    return await purge_old_transcripts(deps.db, deps.integrations.storage)
