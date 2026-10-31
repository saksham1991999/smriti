"""Photo doubt (tutor-social §A10, AI-16 to AI-19; R58).

1. ``POST /v1/ai/doubt-photos`` takes one compressed photo of one question. The gates are the
   tutor's plus photo doubt's own: Pro (R35), not for under-13s, a minor needs the guardian's
   ``uploads`` scope, and Parent mode's tutor switch. The photo goes to the private ``uploads``
   bucket through the storage interface.
2. The vision tier (``AI_TIER_VISION_MODEL``, through the AI gateway) reads the question as text
   with LaTeX (AI-18). A blurry photo, no question, more than one, or not a study photo comes back
   with a ``reason`` for Retake. A face or a personal document is rejected and deleted at once.
3. ``POST /v1/ai/doubt-photos/{id}/solve`` opens a tutor session (mode ``doubt_photo``, context
   ``doubt:{id}``) and the answer streams through the tutor: the same safety screens, quota, SSE
   events and retention. Hints come first until the student asks for the full solution.

Logs carry ids, sizes and outcomes only: never the image, the recognised text or the prompt.
Photos follow the tutor's retention (``ai.tutor_retention_days``).
"""

from __future__ import annotations

import base64
import json
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.ai.gateway import AIGateway
from smriti_api.ai.interfaces import AIError, BudgetExceeded, ChatMessage
from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.core.logging import hash_user_id
from smriti_api.integrations.storage import ObjectStorage, StorageError
from smriti_api.schemas import tutor as t
from smriti_api.services import parent_mode, privacy, tutor, tutor_safety
from smriti_api.services.usage import Learner, load_flags, load_learner, tutor_quota

if TYPE_CHECKING:
    from smriti_api.services.jobs import JobDeps

log = structlog.get_logger(__name__)

# The app compresses to 2048 px on the long edge (§A10 step 5); this is the server's ceiling.
MAX_PHOTO_BYTES = 4 * 1024 * 1024
MAX_READ_TOKENS = 700
_MIME_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
_REASONS = {"blurry", "no_question", "multiple", "unreadable", "not_study", "personal"}

_READ_PROMPT = """You read photos of study questions for Smriti, a learning app for Indian students.
Look at the photo and answer with one JSON object only, no other text:
{"status": "ok" | "blurry" | "no_question" | "multiple" | "unreadable" | "not_study" | "personal",
 "question": "the full question exactly as written, with maths in $...$ (only when status is ok)",
 "subject": "one word such as physics, chemistry, maths, biology (only when status is ok)"}
Rules:
- "multiple" when more than one separate question is in the photo.
- "personal" when the photo shows a face, an ID card, a document with personal details, or anything that is not a page, screen or board with a question.
- "not_study" when it is not a study question at all.
- Copy the question; do not solve it and do not add anything."""


def sniff_mime(data: bytes) -> str | None:
    """The image type from its first bytes (the Content-Type header is not trusted)."""
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def require_photo_doubt(learner: Learner) -> None:
    """Pro only (R35), and not for under-13s in Phase 1 (§A10 step 1). Under-13s never see a
    price (R15)."""
    if learner.under_13:
        raise ApiError(403, "photo_doubt_not_for_age", "Photo doubt isn't available yet for you")
    if not learner.is_pro:
        raise ApiError(
            403,
            "pro_required",
            "This is part of Pro",
            paywall_trigger="tutor_tool",
            paywall_source="photo_doubt",
        )


async def _gate(session: AsyncSession, auth: AuthContext) -> Learner:
    learner = await load_learner(session, auth.user_id, auth.is_anonymous)
    require_photo_doubt(learner)
    await privacy.require_scope(session, auth.user_id, "uploads")
    await parent_mode.check_tutor(session, learner)
    return learner


def parse_read(raw: str) -> tuple[str, str | None, str | None]:
    """(status, question, subject) from the model's answer; anything odd is ``unreadable``."""
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match is None:
        return "unreadable", None, None
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return "unreadable", None, None
    if not isinstance(data, dict):
        return "unreadable", None, None
    status = data.get("status")
    if status in _REASONS:
        return str(status), None, None
    question = data.get("question")
    if status != "ok" or not isinstance(question, str) or not question.strip():
        return "unreadable", None, None
    subject = data.get("subject")
    subject = subject.strip().lower()[:40] if isinstance(subject, str) and subject.strip() else None
    return "ok", question.strip()[: t.MAX_INPUT_CHARS], subject


def _out(r: Any) -> t.DoubtPhotoOut:
    return t.DoubtPhotoOut(
        id=r.id,
        status=r.status,
        reason=r.reason,
        question_text=r.question_text,
        subject=r.subject,
        session_id=r.session_id,
        created_at=r.created_at,
    )


async def _delete_object(storage: ObjectStorage, key: str) -> bool:
    try:
        await storage.delete("uploads", key)
    except StorageError:
        log.warning("doubt_photo_delete_failed")
        return False
    return True


async def upload(
    db: Database,
    ai: AIGateway,
    storage: ObjectStorage,
    auth: AuthContext,
    data: bytes,
    exam: str | None,
) -> t.DoubtPhotoOut:
    now = datetime.now(UTC)
    if not data:
        raise ApiError(422, "empty_photo", "Add a photo of the question")
    if len(data) > MAX_PHOTO_BYTES:
        raise ApiError(413, "photo_too_large", "That photo is too large", limit=MAX_PHOTO_BYTES)
    mime = sniff_mime(data)
    if mime is None:
        raise ApiError(415, "unsupported_photo", "Use a JPEG, PNG or WebP photo")
    async with db.system_tx() as session:
        learner = await _gate(session, auth)
        flags = await load_flags(session)
        if not (await tutor_quota(session, learner, flags, now)).allowed:
            raise ApiError(429, "quota_exhausted", "You've used today's tutor limit")
    photo_id = uuid.uuid4()
    key = f"doubt/{photo_id}.{_MIME_EXT[mime]}"
    try:
        await storage.put("uploads", key, data, mime)
    except StorageError as exc:
        raise ApiError(503, "upload_failed", "Couldn't save the photo. Try again.") from exc

    status, reason, question, subject = "read", None, None, None
    try:
        result = await ai.complete(
            feature="doubt_photo_read",
            tier="vision",
            messages=[
                ChatMessage("system", _READ_PROMPT),
                ChatMessage(
                    "user",
                    [
                        {"type": "text", "text": "Read the question in this photo."},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime};base64,{base64.b64encode(data).decode()}"
                            },
                        },
                    ],
                ),
            ],
            user_id=auth.user_id,
            max_tokens=MAX_READ_TOKENS,
            temperature=0,
        )
        verdict, question, subject = parse_read(result.text)
        if verdict != "ok":
            status, reason = ("rejected" if verdict == "personal" else "unreadable"), verdict
    except (AIError, BudgetExceeded):
        status, reason = "unreadable", "ai_unavailable"
    if question is not None:
        # The tutor's own screens: a photo of something unsafe goes no further.
        if tutor_safety.screen(question) != tutor_safety.Verdict():
            status, reason, question, subject = "rejected", "unsafe", None, None
        else:
            question, _ = tutor_safety.redact(question)
    kept: str | None = key
    if status == "rejected" and await _delete_object(storage, key):
        # "We only need the question." (§A10 step 6): personal and unsafe photos are not kept.
        kept = None
    async with db.system_tx() as session:
        row = (
            await session.execute(
                text(
                    "insert into ai.doubt_photos (id, user_id, storage_key, mime, bytes, status,"
                    " reason, question_text, subject, exam_profile_id, deleted_at)"
                    " values (:id, :u, :k, :m, :b, :st, :r, :q, :sub, :e, :del)"
                    " returning id, status, reason, question_text, subject, session_id, created_at"
                ),
                {
                    "id": photo_id,
                    "u": auth.user_id,
                    "k": kept,
                    "m": mime,
                    "b": len(data),
                    "st": status,
                    "r": reason,
                    "q": question,
                    "sub": subject,
                    "e": exam or learner.primary_exam,
                    "del": now if kept is None else None,
                },
            )
        ).one()
    log.info(
        "doubt_photo_read",
        user=hash_user_id(auth.user_id),
        bytes=len(data),
        status=status,
        reason=reason,
    )
    return _out(row)


async def _photo(session: AsyncSession, user_id: uuid.UUID, photo_id: uuid.UUID) -> Any:
    row = (
        await session.execute(
            text(
                "select id, status, reason, question_text, subject, session_id, created_at,"
                " revealed_at, exam_profile_id from ai.doubt_photos"
                " where id = :id and user_id = :u for update"
            ),
            {"id": photo_id, "u": user_id},
        )
    ).one_or_none()
    if row is None:
        raise ApiError(404, "not_found", "No such photo")
    return row


async def get(db: Database, auth: AuthContext, photo_id: uuid.UUID) -> t.DoubtPhotoOut:
    async with db.system_tx() as session:
        return _out(await _photo(session, auth.user_id, photo_id))


async def open_solve(
    db: Database, auth: AuthContext, photo_id: uuid.UUID, body: t.DoubtSolve
) -> tuple[uuid.UUID, bool]:
    """The tutor session for this photo (reused while it is recent), after the student's edit
    and their choice of hint or full solution are saved."""
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        learner = await _gate(session, auth)
        await parent_mode.check_study_time(session, learner)
        flags = await load_flags(session)
        row = await _photo(session, auth.user_id, photo_id)
        if row.status not in ("read", "solved") or not (body.question_text or row.question_text):
            raise ApiError(409, "photo_not_read", "Retake the photo first")
        await session.execute(
            text(
                "update ai.doubt_photos set question_text = coalesce(:q, question_text),"
                " revealed_at = case when :rev then coalesce(revealed_at, :now) else revealed_at end"
                " where id = :id"
            ),
            {"id": photo_id, "q": body.question_text, "rev": body.reveal, "now": now},
        )
        sess, resumed = await tutor.open_doubt_session(
            session,
            learner,
            flags,
            context_ref=f"doubt:{photo_id}",
            exam=body.exam or row.exam_profile_id,
            now=now,
        )
        await session.execute(
            text("update ai.doubt_photos set session_id = :s, status = 'solved' where id = :id"),
            {"id": photo_id, "s": sess.id},
        )
    return sess.id, resumed


SIMILAR_CONCEPTS = 3  # the best-matching course concepts the chips show


async def similar(
    db: Database, auth: AuthContext, photo_id: uuid.UUID, count: int
) -> t.DoubtSimilarOut:
    """Published practice questions on the concepts the confirmed question matches (tutor-social
    §A10 step 7), ordered stably per photo. Concepts come from the course's own search, never
    from the model, so every chip and question is real published content (AGENTS rule 3)."""
    from smriti_api.services import question_bank as bank
    from smriti_api.services import tutor_retrieval
    from smriti_api.services.practice import PRACTICE_USES, SERVER_ONLY_USES

    async with db.system_tx() as session:
        await _gate(session, auth)
        row = await _photo(session, auth.user_id, photo_id)
        if row.status not in ("read", "solved") or not row.question_text:
            raise ApiError(409, "photo_not_read", "Retake the photo first")
        locale = (
            await session.execute(
                text("select coalesce(locale, 'en') from app.profiles where user_id = :u"),
                {"u": auth.user_id},
            )
        ).scalar_one_or_none() or "en"
        passages = await tutor_retrieval.FullTextRetriever().search(
            session, row.question_text, exam=row.exam_profile_id, locale=locale, limit=12
        )
        concept_ids = list(dict.fromkeys(p.id for p in passages if p.kind == "concept"))
        concept_ids = concept_ids[:SIMILAR_CONCEPTS]
        concepts: list[t.SimilarConcept] = []
        if concept_ids:
            rows = (
                await session.execute(
                    text(
                        "select c.id, c.name, st.topic_id from content.concepts c"
                        " join content.subtopics st on st.id = c.subtopic_id"
                        " where c.id = any(:ids)"
                    ),
                    {"ids": concept_ids},
                )
            ).all()
            by_id = {r.id: r for r in rows}
            concepts = [
                t.SimilarConcept(id=c, name=dict(by_id[c].name), topic_id=by_id[c].topic_id)
                for c in concept_ids
                if c in by_id
            ]
        questions = (
            await bank.pool(
                session,
                exam=row.exam_profile_id,
                uses=list(PRACTICE_USES),
                exclude_uses=list(SERVER_ONLY_USES),
                concepts=[c.id for c in concepts],
            )
            if concepts
            else []
        )
    ranked = sorted(questions, key=lambda q: bank.stable_rank(str(photo_id), q.id))
    return t.DoubtSimilarOut(
        photo_id=photo_id, concepts=concepts, question_ids=[q.id for q in ranked[:count]]
    )


async def purge_old_photos(
    db: Database, storage: ObjectStorage, now: datetime | None = None
) -> int:
    """Photos older than ``ai.tutor_retention_days`` (the tutor thread's retention) are deleted
    with their recognised text; so are photos whose chat the student deleted."""
    now = now or datetime.now(UTC)
    async with db.system_tx() as session:
        days = (await load_flags(session)).int_or_none("ai.tutor_retention_days")
        if days is None:
            return 0
        rows = (
            await session.execute(
                text(
                    "select id, storage_key from ai.doubt_photos where created_at < :c"
                    " or (status = 'solved' and session_id is null)"
                    " order by created_at limit 5000"
                ),
                {"c": now - timedelta(days=days)},
            )
        ).all()
    removed = 0
    for r in rows:
        if r.storage_key and not await _delete_object(storage, r.storage_key):
            continue
        async with db.system_tx() as session:
            await session.execute(text("delete from ai.doubt_photos where id = :id"), {"id": r.id})
        removed += 1
    return removed


async def purge_job(deps: JobDeps) -> int:
    if deps.integrations is None:
        return 0
    return await purge_old_photos(deps.db, deps.integrations.storage)
