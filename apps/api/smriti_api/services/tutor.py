"""The AI tutor (docs/flows/tutor-social.md §A5 to §A7, TRD §9.2).

A message goes through, in order:

1. the keyword safety screen (crisis card, refusals), which never uses the free limit;
2. the exam-integrity guard: no tutor while a strict or live mock is running, and nothing about a
   question in an open mock paper or today's unanswered daily challenge (R24);
3. personal-data removal, then optional ``cheap``-tier moderation (flag ``ai.llm_moderation``);
4. the daily quota (``free.tutor_messages_per_day``; Pro has the ``pro.tutor_messages_per_day``
   fair-use cap), counted under an advisory lock so two devices can't both take the last message;
5. grounding: the context (card, question, topic or concept), the student's mastery for its
   concepts, and passages retrieved from published content (``tutor_retrieval``);
6. the ``tutor``-tier model, streamed to the client as server-sent events through the AI gateway;
7. the output screen, with one retry before a refusal.

Hints first: for a question the student hasn't answered, the key and solution never reach the
model, and the tutor is told to give a hint and ask the student to try (tutor-social §A5 step 5).

Messages are stored in ``ai.tutor_messages`` for continuity and review and purged after
``ai.tutor_retention_days`` (``purge_old_messages``). Message text is never logged and never goes
to analytics (AGENTS rule 6). Model names come only from ``AI_TIER_*_MODEL``.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass, field
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
from smriti_api.schemas import tutor as t
from smriti_api.schemas.practice import QuotaOut
from smriti_api.services import parent_mode, tutor_images, tutor_retrieval, tutor_safety
from smriti_api.services import question_bank as bank
from smriti_api.services.answers import AnswerFormatError, check_answer, parse_answer
from smriti_api.services.usage import (
    Flags,
    Learner,
    Quota,
    load_flags,
    load_learner,
    next_local_midnight,
    tutor_quota,
)

if TYPE_CHECKING:
    from smriti_api.services.jobs import JobDeps

log = structlog.get_logger(__name__)

HISTORY_MESSAGES = 10
RETRIEVED_PASSAGES = 5
MAX_ANSWER_TOKENS = 900
BACK_TO_STUDY_CHIPS = ("back_to_topic", "explain_simpler", "quiz_me")
_NS = uuid.UUID("b7d8b8a2-6f35-4b55-9d1e-2b8f61c1c0de")


def sse(event: str, data: Mapping[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


def _quota_out(q: Quota, learner: Learner, now: datetime) -> QuotaOut:
    return QuotaOut(
        unlimited=q.unlimited,
        limit=q.limit,
        used=q.used,
        remaining=q.remaining,
        resets_at=next_local_midnight(learner, now),
    )


def _localized(value: Any, locale: str) -> str:
    if isinstance(value, Mapping):
        return str(value.get(locale) or value.get("en") or "")
    return str(value or "")


# --- context ------------------------------------------------------------------------------------


@dataclass
class Context:
    kind: str
    ref: str
    topic_id: str | None = None
    title: dict[str, str] | None = None
    concepts: list[dict[str, Any]] = field(default_factory=list)
    question: dict[str, Any] | None = None
    question_id: str | None = None
    # Key and solution, only once the student has answered (hints first).
    revealed: dict[str, Any] | None = None
    answered: bool = False

    def out(self) -> t.ContextOut:
        return t.ContextOut(kind=self.kind, ref=self.ref, topic_id=self.topic_id, title=self.title)


async def _concepts(
    session: AsyncSession, *, topic: str | None = None, ids: Sequence[str] | None = None
) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            text(
                "select c.id, c.name, c.summary, c.key_points from content.concepts c"
                " join content.subtopics st on st.id = c.subtopic_id"
                " where (cast(:t as text) is null or st.topic_id = :t)"
                " and (cast(:ids as text[]) is null or c.id = any(cast(:ids as text[])))"
                " order by st.sort, c.sort, c.id limit 12"
            ),
            {"t": topic, "ids": list(ids) if ids is not None else None},
        )
    ).all()
    return [
        {"id": r.id, "name": dict(r.name), "summary": dict(r.summary), "key_points": r.key_points}
        for r in rows
    ]


async def _topic_title(session: AsyncSession, topic_id: str) -> dict[str, str] | None:
    name = (
        await session.execute(
            text("select name from content.topics where id = :t"), {"t": topic_id}
        )
    ).scalar_one_or_none()
    return dict(name) if name else None


async def _answered(session: AsyncSession, user_id: uuid.UUID, question_id: str) -> bool:
    """Whether the student has given an answer the server knows about: practice and lesson
    answers, a submitted mock that held the question, or a daily challenge result."""
    row = (
        await session.execute(
            text(
                """
                select exists (select 1 from learn.question_attempts
                                where user_id = :u and question_id = :q)
                    or exists (select 1 from learn.mock_answers a
                                 join learn.mock_attempts m on m.id = a.attempt_id
                                where m.user_id = :u and a.question_id = :q
                                  and m.status in ('submitted', 'auto_submitted'))
                    or exists (select 1 from game.daily_challenge_results r
                                 join game.daily_challenges c on c.id = r.challenge_id
                                where r.user_id = :u and c.question_id = :q)
                """
            ),
            {"u": user_id, "q": question_id},
        )
    ).scalar_one()
    return bool(row)


async def resolve_context(
    session: AsyncSession, user_id: uuid.UUID, ref: str, *, answered_now: bool = False
) -> Context:
    kind, _, ident = ref.partition(":")
    if kind == "card":
        # Card ids are "{topic_id}:{mode}:{n}". The card's own text lives in the bundle on the
        # device; the server grounds on the topic's concepts.
        topic_id = ident.split(":", 1)[0]
        title = await _topic_title(session, topic_id)
        if title is None:
            raise ApiError(404, "unknown_context", "This card isn't available")
        return Context(kind, ref, topic_id, title, await _concepts(session, topic=topic_id))
    if kind == "topic":
        title = await _topic_title(session, ident)
        if title is None:
            raise ApiError(404, "unknown_context", "This topic isn't available")
        return Context(kind, ref, ident, title, await _concepts(session, topic=ident))
    if kind == "concept":
        concepts = await _concepts(session, ids=[ident])
        if not concepts:
            raise ApiError(404, "unknown_context", "This concept isn't available")
        return Context(kind, ref, None, concepts[0]["name"], concepts)
    if kind == "question":
        body = await bank.find_body(session, ident)
        if body is None:
            raise ApiError(404, "unknown_context", "This question isn't available")
        concept_ids = (await bank.concepts_of(session, [ident])).get(ident, [])
        concepts = await _concepts(session, ids=concept_ids) if concept_ids else []
        answered = answered_now or await _answered(session, user_id, ident)
        return Context(
            kind,
            ref,
            None,
            None,
            concepts,
            question=bank.public_body(body),
            question_id=ident,
            revealed=bank.solution_view(body) if answered else None,
            answered=answered,
        )
    if kind == "lab":
        return Context(kind, ref)
    if kind == "doubt":
        # Photo doubt (§A10): the question the student confirmed on AI-18. Hints first until
        # they ask for the full solution.
        try:
            photo_id = uuid.UUID(ident)
        except ValueError as exc:
            raise ApiError(404, "unknown_context", "This photo isn't available") from exc
        photo = (
            await session.execute(
                text(
                    "select question_text, subject, revealed_at from ai.doubt_photos"
                    " where id = :id and user_id = :u"
                ),
                {"id": photo_id, "u": user_id},
            )
        ).one_or_none()
        if photo is None or not photo.question_text:
            raise ApiError(404, "unknown_context", "This photo isn't available")
        return Context(
            kind,
            ref,
            question={"text": photo.question_text, "subject": photo.subject},
            answered=photo.revealed_at is not None,
        )
    raise ApiError(422, "unknown_context", "This context isn't supported")


async def exam_guard(session: AsyncSession, user_id: uuid.UUID, question_id: str | None) -> bool:
    """True when the tutor must not help: a strict or live mock is running, or the question is
    in an open mock paper or today's daily challenge the student hasn't answered (R24)."""
    rows = (
        await session.execute(
            text(
                "select time_policy, paper from learn.mock_attempts"
                " where user_id = :u and status = 'in_progress'"
            ),
            {"u": user_id},
        )
    ).all()
    for r in rows:
        if r.time_policy in ("strict", "live"):
            return True
        if question_id and question_id in json.dumps(r.paper or {}):
            return True
    if question_id:
        open_challenge = (
            await session.execute(
                text(
                    "select 1 from game.daily_challenges c"
                    " join game.daily_challenge_starts s on s.challenge_id = c.id and s.user_id = :u"
                    " where c.question_id = :q and not exists (select 1 from game.daily_challenge_results r"
                    " where r.challenge_id = c.id and r.user_id = :u) limit 1"
                ),
                {"u": user_id, "q": question_id},
            )
        ).first()
        if open_challenge is not None:
            return True
    return False


# --- sessions -----------------------------------------------------------------------------------


def _message_out(r: Any) -> t.MessageOut:
    return t.MessageOut(
        id=r.id,
        role=r.role,
        content=r.content,
        status=r.status,
        citations=list(r.citations or []),
        created_at=r.created_at,
        images=list(getattr(r, "images", None) or []),
    )


async def _messages(session: AsyncSession, session_id: uuid.UUID, limit: int = 100) -> list[Any]:
    rows = (
        await session.execute(
            text(
                "select id, role, content, status, citations, created_at,"
                " (select coalesce(jsonb_agg(jsonb_build_object('generation_id', g.id,"
                " 'status', g.status, 'alt', g.alt) order by g.created_at), '[]'::jsonb)"
                " from ai.tutor_images g where g.message_id = m.id) as images"
                " from ai.tutor_messages m"
                " where session_id = :s and role in ('user', 'assistant')"
                " order by created_at desc limit :n"
            ),
            {"s": session_id, "n": limit},
        )
    ).all()
    return list(reversed(rows))


async def _session_row(session: AsyncSession, user_id: uuid.UUID, session_id: uuid.UUID) -> Any:
    row = (
        await session.execute(
            text(
                "select id, mode, context_ref, exam_profile_id, locale, started_at, ended_at,"
                " message_count, last_message_at from ai.tutor_sessions where id = :id and user_id = :u"
            ),
            {"id": session_id, "u": user_id},
        )
    ).one_or_none()
    if row is None:
        raise ApiError(404, "not_found", "This chat isn't here")
    return row


async def _session_out(
    session: AsyncSession,
    row: Any,
    learner: Learner,
    flags: Flags,
    now: datetime,
    *,
    resumed: bool,
    with_messages: bool,
) -> t.TutorSession:
    ctx = (
        (await resolve_context(session, learner.user_id, row.context_ref)).out()
        if row.context_ref
        else None
    )
    return t.TutorSession(
        id=row.id,
        mode=row.mode,
        context=ctx,
        exam_profile_id=row.exam_profile_id,
        locale=row.locale,
        started_at=row.started_at,
        last_message_at=row.last_message_at,
        message_count=row.message_count,
        resumed=resumed,
        messages=[_message_out(m) for m in await _messages(session, row.id)]
        if with_messages
        else [],
        quota=_quota_out(await tutor_quota(session, learner, flags, now), learner, now),
    )


def _tutor_locale(learner: Learner) -> str:
    """``app.profiles.settings.tutor_locale`` when the student picked one, else the UI language.
    "Match how I write" is the prompt's job (tutor-social §A5 step 10)."""
    return learner.tutor_locale or learner.locale


async def _open(
    session: AsyncSession,
    learner: Learner,
    flags: Flags,
    *,
    mode: str,
    context_ref: str | None,
    exam: str | None,
    now: datetime,
) -> tuple[Any, bool]:
    reuse_min = flags.int_or_none("ai.tutor_session_reuse_min") or 0
    row = (
        await session.execute(
            text(
                "select id, mode, context_ref, exam_profile_id, locale, started_at, ended_at,"
                " message_count, last_message_at from ai.tutor_sessions"
                " where user_id = :u and mode = :m and context_ref is not distinct from :c"
                " and ended_at is null and coalesce(last_message_at, started_at) > :since"
                " order by coalesce(last_message_at, started_at) desc limit 1"
            ),
            {
                "u": learner.user_id,
                "m": mode,
                "c": context_ref,
                "since": now - timedelta(minutes=reuse_min),
            },
        )
    ).one_or_none()
    if row is not None:
        return row, True
    exam_id = exam or learner.primary_exam
    row = (
        await session.execute(
            text(
                "insert into ai.tutor_sessions (user_id, mode, context_ref, exam_profile_id, locale)"
                " values (:u, :m, :c, :e, :l) returning id, mode, context_ref, exam_profile_id,"
                " locale, started_at, ended_at, message_count, last_message_at"
            ),
            {
                "u": learner.user_id,
                "m": mode,
                "c": context_ref,
                "e": exam_id,
                "l": _tutor_locale(learner),
            },
        )
    ).one()
    return row, False


async def open_doubt_session(
    session: AsyncSession,
    learner: Learner,
    flags: Flags,
    *,
    context_ref: str,
    exam: str | None,
    now: datetime,
) -> tuple[Any, bool]:
    """Photo doubt's chat (mode ``doubt_photo``), opened by ``doubt_photo.open_solve``."""
    return await _open(
        session, learner, flags, mode="doubt_photo", context_ref=context_ref, exam=exam, now=now
    )


async def open_session(db: Database, auth: AuthContext, body: t.SessionCreate) -> t.TutorSession:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        await parent_mode.check_tutor(session, learner)
        await parent_mode.check_study_time(session, learner)
        flags = await load_flags(session)
        if body.context_ref:
            await resolve_context(session, auth.user_id, body.context_ref)
        row, resumed = await _open(
            session,
            learner,
            flags,
            mode=body.mode,
            context_ref=body.context_ref,
            exam=body.exam,
            now=now,
        )
        return await _session_out(
            session, row, learner, flags, now, resumed=resumed, with_messages=resumed
        )


async def get_session(db: Database, auth: AuthContext, session_id: uuid.UUID) -> t.TutorSession:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        flags = await load_flags(session)
        row = await _session_row(session, auth.user_id, session_id)
        return await _session_out(
            session, row, learner, flags, now, resumed=False, with_messages=True
        )


async def list_sessions(
    db: Database, auth: AuthContext, limit: int, before: datetime | None
) -> list[t.SessionSummary]:
    async with db.user_tx(auth.claims) as session:
        rows = (
            await session.execute(
                text(
                    "select id, mode, context_ref, started_at, last_message_at, message_count"
                    " from ai.tutor_sessions where user_id = :u and message_count > 0"
                    " and (cast(:b as timestamptz) is null or coalesce(last_message_at, started_at) < :b)"
                    " order by coalesce(last_message_at, started_at) desc limit :n"
                ),
                {"u": auth.user_id, "b": before, "n": limit},
            )
        ).all()
    return [
        t.SessionSummary(
            id=r.id,
            mode=r.mode,
            context_ref=r.context_ref,
            started_at=r.started_at,
            last_message_at=r.last_message_at,
            message_count=r.message_count,
        )
        for r in rows
    ]


async def delete_session(db: Database, auth: AuthContext, session_id: uuid.UUID) -> None:
    """The student deletes a chat (AI-09): its messages and their feedback go with it."""
    async with db.user_tx(auth.claims) as session:
        await _session_row(session, auth.user_id, session_id)
        await session.execute(
            text(
                "delete from ai.message_feedback where user_id = :u and message_id in"
                " (select id from ai.tutor_messages where session_id = :s)"
            ),
            {"u": auth.user_id, "s": session_id},
        )
        await session.execute(
            text("delete from ai.tutor_messages where session_id = :s and user_id = :u"),
            {"s": session_id, "u": auth.user_id},
        )
        await session.execute(
            text("delete from ai.tutor_sessions where id = :s and user_id = :u"),
            {"s": session_id, "u": auth.user_id},
        )


# --- prompt -------------------------------------------------------------------------------------


_POLICY = """You are the study tutor in Smriti, a learning app for Indian students (school classes 1 to 12, JEE, NEET, UPSC, SSC and other exams).
Rules:
- Teach. Give a hint before a full answer, check understanding, and keep answers short and clear. Use numbered steps for working.
- Ground every fact in the STUDY MATERIAL below. If it does not cover the question, say so plainly and explain only what you are sure of; never invent facts, numbers, dates or exam patterns.
- Stay on study topics. Politely decline anything harmful, and never help anyone cheat in a live exam.
- Never ask for or repeat personal details (phone numbers, addresses, school names).
- Write maths with $...$ inline and $$...$$ for blocks. Use only bold, lists and numbered steps for formatting."""


def _language_rule(locale_pref: str | None) -> str:
    if locale_pref == "hi":
        return "Answer in Hindi (Devanagari)."
    if locale_pref == "en":
        return "Answer in English."
    return "Answer in the language the student writes in: Hindi, English or Hinglish."


def _age_rule(learner: Learner) -> str:
    if learner.under_13:
        return (
            "The student is under 13. Use simple words and short sentences. Talk only about "
            "studying; if asked about anything else, gently steer back to the topic."
        )
    if learner.is_minor:
        return "The student is a teenager. Keep the tone friendly and age-appropriate."
    return "The student is an adult learner."


def _material(ctx: Context | None, passages: Sequence[tutor_retrieval.Passage], locale: str) -> str:
    lines: list[str] = []
    if ctx is not None:
        if ctx.title:
            lines.append(f'Context: {ctx.kind} in topic "{_localized(ctx.title, locale)}".')
        for c in ctx.concepts:
            lines.append(
                f"- Concept {_localized(c['name'], locale)}: {_localized(c['summary'], locale)}"
            )
            for point in c.get("key_points") or []:
                lines.append(f"  - {_localized(point, locale)}")
        if ctx.question is not None:
            lines.append("Question the student is looking at:")
            lines.append(json.dumps(bank.localize(ctx.question, locale), ensure_ascii=False))
            if ctx.revealed is not None:
                lines.append("Answer key and solution (the student has already answered):")
                lines.append(json.dumps(bank.localize(ctx.revealed, locale), ensure_ascii=False))
    for p in passages:
        lines.append(f"- [{p.kind} {p.id}] {p.title}: {p.body[:800]}")
    return "\n".join(lines) if lines else "(no study material matched)"


async def _mastery_line(
    session: AsyncSession, user_id: uuid.UUID, ctx: Context | None
) -> str | None:
    if ctx is None or not ctx.concepts:
        return None
    rows = (
        await session.execute(
            text(
                "select concept_id, mastery from learn.concept_mastery"
                " where user_id = :u and concept_id = any(:c)"
            ),
            {"u": user_id, "c": [c["id"] for c in ctx.concepts]},
        )
    ).all()
    if not rows:
        return None
    return "Student mastery (0 to 1): " + ", ".join(
        f"{r.concept_id}={float(r.mastery):.2f}" for r in rows
    )


def _hints_first(ctx: Context | None) -> bool:
    return ctx is not None and ctx.question is not None and not ctx.answered


def system_prompt(
    learner: Learner,
    ctx: Context | None,
    passages: Sequence[tutor_retrieval.Passage],
    mastery: str | None,
    *,
    redirect: bool,
    your_answer: str | None,
) -> str:
    locale = _tutor_locale(learner)
    parts = [_POLICY, _language_rule(learner.tutor_locale), _age_rule(learner)]
    if _hints_first(ctx):
        parts.append(
            "The student has NOT answered this question yet. Give one hint only and ask them to "
            "try. Do not reveal the answer or the final result."
        )
    if your_answer:
        parts.append(
            f"The student's answer was {your_answer}. Explain kindly where it went wrong or why it is right."
        )
    if redirect:
        parts.append(
            "The last message was not about studying. Gently steer back to the topic in one or two sentences."
        )
    if mastery:
        parts.append(mastery)
    parts.append("STUDY MATERIAL:\n" + _material(ctx, passages, locale))
    return "\n\n".join(parts)


# --- a message ----------------------------------------------------------------------------------


@dataclass
class Plan:
    """What to send after the checks: either fixed events, or a model call."""

    session_id: uuid.UUID
    user_message_id: uuid.UUID
    events: list[str] = field(default_factory=list)
    messages: list[ChatMessage] = field(default_factory=list)
    citations: list[dict[str, Any]] = field(default_factory=list)
    chips: list[str] = field(default_factory=list)
    counted: bool = False
    learner: Learner | None = None
    flags: Flags | None = None
    # "Draw it" (tutor-social §A5 step 6): a picture for this answer, briefed from the material.
    draw: bool = False
    material: str = ""
    concept_id: str | None = None

    @property
    def assistant_id(self) -> uuid.UUID:
        return uuid.uuid5(_NS, f"reply:{self.user_message_id}")


async def _store(
    session: AsyncSession,
    *,
    message_id: uuid.UUID,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    role: str,
    content: str,
    status: str,
    counted: bool = False,
    flagged: bool = False,
    citations: Sequence[Mapping[str, Any]] = (),
    tokens_out: int | None = None,
) -> None:
    await session.execute(
        text(
            # clock_timestamp, not the transaction's now(): a question and its reply written in
            # one transaction must still sort in the order they were written.
            "insert into ai.tutor_messages (id, session_id, user_id, role, content, status, counted,"
            " flagged, citations, tokens_out, created_at) values (:id, :s, :u, :r, :c, :st, :cnt,"
            " :f, cast(:cit as jsonb), :to, clock_timestamp())"
        ),
        {
            "id": message_id,
            "s": session_id,
            "u": user_id,
            "r": role,
            "c": content,
            "st": status,
            "cnt": counted,
            "f": flagged,
            "cit": json.dumps(list(citations)),
            "to": tokens_out,
        },
    )
    await session.execute(
        text(
            "update ai.tutor_sessions set message_count = least(message_count + 1, 32767),"
            " last_message_at = now() where id = :s"
        ),
        {"s": session_id},
    )


async def _flag(
    session: AsyncSession, user_id: uuid.UUID, source_id: uuid.UUID, category: str, action: str
) -> None:
    await session.execute(
        text(
            "insert into ai.moderation_flags (user_id, source_kind, source_id, category, action)"
            " values (:u, 'tutor_message', :s, :c, :a)"
        ),
        {"u": user_id, "s": str(source_id), "c": category, "a": action},
    )


def _helplines(flags: Flags, locale: str) -> list[Any]:
    """``safety.helplines`` (owner config, verified against official sources). Never in code."""
    value = flags.get("safety.helplines")
    if isinstance(value, Mapping):
        lines = value.get(locale) or value.get("en") or []
        return list(lines) if isinstance(lines, list) else []
    return []


async def _replay(
    session: AsyncSession, user_id: uuid.UUID, message_id: uuid.UUID
) -> list[str] | None:
    """A retry of a message already sent: the stored reply comes back instead of a new answer."""
    row = (
        await session.execute(
            text(
                "select session_id from ai.tutor_messages where id = :id and user_id = :u and role = 'user'"
            ),
            {"id": message_id, "u": user_id},
        )
    ).one_or_none()
    if row is None:
        return None
    reply = (
        await session.execute(
            text(
                "select id, content, status, citations from ai.tutor_messages"
                " where id = :id and user_id = :u"
            ),
            {"id": uuid.uuid5(_NS, f"reply:{message_id}"), "u": user_id},
        )
    ).one_or_none()
    if reply is None:
        return [
            sse("error", {"code": "in_progress"}),
            sse("done", {"user_message_id": str(message_id)}),
        ]
    events = []
    if reply.content:
        events.append(sse("delta", {"text": reply.content}))
    events.append(sse("citations", {"items": reply.citations or []}))
    events.append(
        sse(
            "done",
            {
                "message_id": str(reply.id),
                "user_message_id": str(message_id),
                "status": reply.status,
                "replayed": True,
            },
        )
    )
    return events


async def prepare(
    db: Database,
    ai: AIGateway,
    auth: AuthContext,
    session_id: uuid.UUID,
    body: t.MessageIn,
    *,
    your_answer: str | None = None,
    answered_now: bool = False,
) -> Plan:
    """Every check before the model runs. Raises for a bad request; returns fixed events for a
    crisis, a refusal or a used-up limit."""
    now = datetime.now(UTC)
    plan = Plan(session_id=session_id, user_message_id=body.client_message_id)
    async with db.system_tx() as session:
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        await parent_mode.check_tutor(session, learner)
        flags = await load_flags(session)
        plan.learner, plan.flags = learner, flags
        row = await _session_row(session, auth.user_id, session_id)
        if row.mode == "roleplay":
            # A role-play chat has its own script, caps and goals (services/roleplay.py).
            raise ApiError(409, "use_roleplay", "Send role-play turns to /v1/roleplay")
        replay = await _replay(session, auth.user_id, body.client_message_id)
        if replay is not None:
            plan.events = replay
            return plan
        cap = flags.int_or_none("tutor.max_input_chars")
        if cap is not None and len(body.text) > cap:
            raise ApiError(422, "too_long", "That message is too long", limit=cap)
        ctx = (
            await resolve_context(session, auth.user_id, row.context_ref, answered_now=answered_now)
            if row.context_ref
            else None
        )
        guarded = await exam_guard(session, auth.user_id, ctx.question_id if ctx else None)

    verdict = tutor_safety.screen(body.text)
    clean, had_pii = tutor_safety.redact(body.text)
    if verdict == tutor_safety.Verdict() and not guarded and flags.bool("ai.llm_moderation"):
        verdict = await tutor_safety.moderate(ai, clean, auth.user_id, under_13=learner.under_13)

    if verdict.crisis:
        # The crisis card, even at the limit (tutor-social §A7). Counted only in an ops total.
        async with db.system_tx() as session:
            await _store(
                session,
                message_id=plan.user_message_id,
                session_id=session_id,
                user_id=auth.user_id,
                role="user",
                content=clean,
                status="crisis",
                flagged=True,
            )
            await _store(
                session,
                message_id=plan.assistant_id,
                session_id=session_id,
                user_id=auth.user_id,
                role="assistant",
                content="",
                status="crisis",
            )
            await _flag(session, auth.user_id, plan.user_message_id, "crisis", "queued")
        log.info("safety_crisis_total")
        plan.events = [
            sse(
                "safety", {"kind": "crisis", "helplines": _helplines(flags, _tutor_locale(learner))}
            ),
            sse(
                "done",
                {
                    "message_id": str(plan.assistant_id),
                    "user_message_id": str(plan.user_message_id),
                    "status": "crisis",
                },
            ),
        ]
        return plan
    if guarded or verdict.blocked:
        category = "cheating" if guarded else str(verdict.category)
        async with db.system_tx() as session:
            await _store(
                session,
                message_id=plan.user_message_id,
                session_id=session_id,
                user_id=auth.user_id,
                role="user",
                content=clean,
                status="refused",
                flagged=verdict.blocked,
            )
            await _store(
                session,
                message_id=plan.assistant_id,
                session_id=session_id,
                user_id=auth.user_id,
                role="assistant",
                content="",
                status="refused",
            )
            await _flag(session, auth.user_id, plan.user_message_id, category, "blocked")
        plan.events = [
            sse(
                "safety",
                {"kind": "refusal", "category": category, "chips": list(BACK_TO_STUDY_CHIPS)},
            ),
            sse(
                "done",
                {
                    "message_id": str(plan.assistant_id),
                    "user_message_id": str(plan.user_message_id),
                    "status": "refused",
                },
            ),
        ]
        return plan

    async with db.system_tx() as session:
        # One student's messages are counted one at a time, so two devices can't both take the
        # last free message.
        await session.execute(
            text("select pg_advisory_xact_lock(hashtextextended('tutor:' || :u, 0))"),
            {"u": str(auth.user_id)},
        )
        q = await tutor_quota(session, learner, flags, now)
        if not q.allowed:
            plan.events = [
                sse(
                    "quota_exhausted",
                    {
                        **_quota_out(q, learner, now).model_dump(mode="json"),
                        "tier": "pro_fair_use" if learner.is_pro else "free",
                        # Under-13s never see a price (R15): the app shows "Ask a grown-up".
                        "paywall_trigger": None
                        if learner.is_pro or learner.under_13
                        else "tutor_limit",
                    },
                ),
                sse(
                    "done",
                    {"user_message_id": str(plan.user_message_id), "status": "quota_exhausted"},
                ),
            ]
            return plan
        history = await _messages(session, session_id, HISTORY_MESSAGES)
        await _store(
            session,
            message_id=plan.user_message_id,
            session_id=session_id,
            user_id=auth.user_id,
            role="user",
            content=clean,
            status="ok",
            counted=True,
        )
        plan.counted = True
        retriever = await tutor_retrieval.pick(session, None)
        passages = await retriever.search(
            session,
            clean,
            exam=row.exam_profile_id,
            locale=_tutor_locale(learner),
            limit=RETRIEVED_PASSAGES,
        )
        mastery = await _mastery_line(session, auth.user_id, ctx)

    plan.citations = [c.citation() for c in passages]
    if ctx is not None:
        plan.citations = [
            {
                "kind": "concept",
                "id": c["id"],
                "title": _localized(c["name"], _tutor_locale(learner)),
            }
            for c in ctx.concepts[:3]
        ] + [
            c
            for c in plan.citations
            if c["kind"] != "concept" or c["id"] not in {x["id"] for x in ctx.concepts[:3]}
        ]
    redirect = verdict.category == "off_topic"
    system = system_prompt(
        learner, ctx, passages, mastery, redirect=redirect, your_answer=your_answer
    )
    plan.messages = (
        [ChatMessage("system", system)]
        + [
            ChatMessage("user" if m.role == "user" else "assistant", m.content)
            for m in history
            if m.status == "ok" and m.content
        ]
        + [ChatMessage("user", clean)]
    )
    if body.input == "chip" and body.chip_id == "draw_it":
        plan.draw = True
        plan.material = _material(ctx, passages, _tutor_locale(learner))[:3000]
        plan.concept_id = str(ctx.concepts[0]["id"]) if ctx and ctx.concepts else None
    # Two or three follow-ups from the fixed set (tutor-social §A5 step 7). "Draw it" makes a new
    # Agnes image, which is Pro (R35).
    if _hints_first(ctx):
        plan.chips = ["show_full_solution", "give_hint", "explain_simpler"]
    else:
        plan.chips = ["explain_simpler", "quiz_me", "draw_it" if learner.is_pro else "show_example"]
    if had_pii:
        plan.events.append(sse("safety", {"kind": "pii_removed"}))
    if redirect:
        plan.events.append(sse("safety", {"kind": "redirect"}))
    return plan


async def stream(
    db: Database,
    ai: AIGateway,
    auth: AuthContext,
    plan: Plan,
    images: tutor_images.ImageEnv | None = None,
) -> AsyncIterator[str]:
    """The SSE body: fixed events, or the model's answer as ``delta`` events, then (for "Draw
    it") ``image_ready``, ``image_pending`` or ``image_failed``, then ``citations``, ``chips``,
    ``quota`` and ``done``."""
    for event in plan.events:
        yield event
    if not plan.messages:
        return
    parts: list[str] = []
    status = "ok"
    flagged = False
    error: str | None = None
    try:
        async for chunk in ai.stream(
            feature="tutor_chat",
            tier="tutor",
            messages=plan.messages,
            user_id=auth.user_id,
            max_tokens=MAX_ANSWER_TOKENS,
        ):
            if chunk.delta:
                parts.append(chunk.delta)
                yield sse("delta", {"text": chunk.delta})
        answer = "".join(parts)
        if tutor_safety.screen(answer) != tutor_safety.Verdict():
            # The output check failed: replace the partial answer and retry once.
            yield sse("replace", {"text": ""})
            retry = await ai.complete(
                feature="tutor_chat_retry",
                tier="tutor",
                messages=[
                    *plan.messages,
                    ChatMessage(
                        "system",
                        "Your last draft broke the rules. Answer again, safely, about the study topic only.",
                    ),
                ],
                user_id=auth.user_id,
                max_tokens=MAX_ANSWER_TOKENS,
            )
            if tutor_safety.screen(retry.text) != tutor_safety.Verdict():
                parts, status, flagged = [], "refused", True
                yield sse(
                    "safety",
                    {"kind": "refusal", "category": "output", "chips": list(BACK_TO_STUDY_CHIPS)},
                )
            else:
                parts = [retry.text]
                yield sse("delta", {"text": retry.text})
    except BudgetExceeded:
        status, error = "error", "busy"
    except AIError:
        status, error = "error", "ai_unavailable"
    except asyncio.CancelledError:
        # The student tapped Stop (or the connection dropped): keep the partial answer.
        asyncio.get_running_loop().create_task(
            _finish(db, auth, plan, "".join(parts), "stopped", False)
        )
        raise
    if error is not None:
        yield sse("error", {"code": error, "retry": True})
    await _finish(db, auth, plan, "".join(parts), status, flagged)
    if status == "ok" and plan.draw and images is not None:
        yield await _draw(db, ai, auth, plan, images, "".join(parts))
    async with db.system_tx() as session:
        assert plan.learner is not None and plan.flags is not None
        now = datetime.now(UTC)
        q = await tutor_quota(session, plan.learner, plan.flags, now)
        quota = _quota_out(q, plan.learner, now).model_dump(mode="json")
    if status == "ok":
        yield sse("citations", {"items": plan.citations})
        yield sse("chips", {"items": plan.chips})
    yield sse("quota", quota)
    yield sse(
        "done",
        {
            "message_id": str(plan.assistant_id),
            "user_message_id": str(plan.user_message_id),
            "status": status,
        },
    )


async def _draw(
    db: Database,
    ai: AIGateway,
    auth: AuthContext,
    plan: Plan,
    images: tutor_images.ImageEnv,
    answer: str,
) -> str:
    """The picture for a "Draw it" answer. The brief comes from the answer and the course
    material, never from the student's message."""
    assert plan.learner is not None
    locale = _tutor_locale(plan.learner)
    planned = await tutor_images.brief_from_answer(
        ai, user_id=auth.user_id, answer=answer, material=plan.material, locale=locale
    )
    if planned is None:
        outcome = tutor_images.Outcome(None, "failed", "failed", "")
    else:
        brief, alt, style = planned
        outcome = await tutor_images.request_image(
            db,
            ai,
            images,
            user_id=auth.user_id,
            is_guest=auth.is_anonymous,
            source="tutor_chat",
            brief=brief,
            alt=alt,
            style=style,
            concept_id=plan.concept_id,
            tutor_session_id=plan.session_id,
            message_id=plan.assistant_id,
        )
    name, data = outcome.event()
    return sse(name, data)


async def _finish(
    db: Database, auth: AuthContext, plan: Plan, answer: str, status: str, flagged: bool
) -> None:
    async with db.system_tx() as session:
        exists = (
            await session.execute(
                text("select 1 from ai.tutor_messages where id = :id and user_id = :u"),
                {"id": plan.assistant_id, "u": auth.user_id},
            )
        ).first()
        if exists is not None:
            return
        await _store(
            session,
            message_id=plan.assistant_id,
            session_id=plan.session_id,
            user_id=auth.user_id,
            role="assistant",
            content=answer,
            status=status,
            flagged=flagged,
            citations=plan.citations if status == "ok" else (),
            tokens_out=len(answer.split()) or None,
        )
        if status == "error":
            # A server error never uses up a free message (tutor-social §A6).
            await session.execute(
                text(
                    "update ai.tutor_messages set counted = false where id = :id and user_id = :u"
                ),
                {"id": plan.user_message_id, "u": auth.user_id},
            )
        if flagged:
            await _flag(session, auth.user_id, plan.assistant_id, "output", "blocked")


async def open_for(
    db: Database,
    auth: AuthContext,
    context_ref: str,
    exam: str | None,
    *,
    answered_now: bool = False,
) -> tuple[uuid.UUID, bool]:
    """The session for ask-about-this-card or -question: the recent one for that context, or new."""
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        await parent_mode.check_tutor(session, learner)
        await parent_mode.check_study_time(session, learner)
        flags = await load_flags(session)
        await resolve_context(session, auth.user_id, context_ref, answered_now=answered_now)
        row, resumed = await _open(
            session, learner, flags, mode="chat", context_ref=context_ref, exam=exam, now=now
        )
        return row.id, resumed


async def check_your_answer(db: Database, question_id: str, answer: Any) -> tuple[str | None, bool]:
    """The student's own answer from LES-02 or PRC-05, checked on the server with the lesson-core
    rules, as a short line for the prompt. Never trusted as "answered" for server-only questions."""
    async with db.system_tx() as session:
        body = await bank.find_body(session, question_id)
        uses = (
            await session.execute(
                text("select uses from content.question_bodies where question_id = :q"),
                {"q": question_id},
            )
        ).scalar_one_or_none() or []
    if body is None or answer is None:
        return None, False
    try:
        result = check_answer(body, parse_answer(answer.model_dump()))
    except (AnswerFormatError, KeyError, TypeError, ValueError):
        return None, False
    server_only = bool(set(uses) & {"mock", "daily"})
    verdict = (
        "correct" if result.correct else ("partly correct" if result.partial else "not correct")
    )
    return f"{json.dumps(result.response, ensure_ascii=False)} ({verdict})", not server_only


# --- feedback and retention ---------------------------------------------------------------------

REVIEW_REASONS = {"wrong", "not_suitable"}


async def feedback(
    db: Database, auth: AuthContext, message_id: uuid.UUID, body: t.FeedbackIn
) -> t.FeedbackOut:
    """AI-05: reason codes only. "Wrong" and "Not suitable" queue the message for review."""
    reasons = sorted(set(body.reasons)) if body.rating == "down" else []
    async with db.user_tx(auth.claims) as session:
        found = (
            await session.execute(
                text(
                    "select 1 from ai.tutor_messages where id = :id and user_id = :u and role = 'assistant'"
                ),
                {"id": message_id, "u": auth.user_id},
            )
        ).first()
        if found is None:
            raise ApiError(404, "not_found", "This answer isn't here")
        await session.execute(
            text(
                "insert into ai.message_feedback (message_id, user_id, rating, reasons)"
                " values (:m, :u, :r, :rs) on conflict (message_id, user_id) do update"
                " set rating = excluded.rating, reasons = excluded.reasons, created_at = now()"
            ),
            {"m": message_id, "u": auth.user_id, "r": body.rating, "rs": reasons},
        )
    queued = bool(REVIEW_REASONS & set(reasons))
    if queued:
        async with db.system_tx() as session:
            for reason in sorted(REVIEW_REASONS & set(reasons)):
                await _flag(session, auth.user_id, message_id, f"feedback_{reason}", "queued")
    return t.FeedbackOut(
        message_id=message_id, rating=body.rating, reasons=reasons, queued_for_review=queued
    )


async def purge_old_messages(db: Database, now: datetime | None = None) -> int:
    """Retention (tutor-social §A7, §A14): messages, their feedback and idle sessions older than
    ``ai.tutor_retention_days`` are deleted."""
    now = now or datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        days = flags.int_or_none("ai.tutor_retention_days")
        if days is None:
            return 0
        cutoff = now - timedelta(days=days)
        await session.execute(
            text(
                "delete from ai.message_feedback f where exists (select 1 from ai.tutor_messages m"
                " where m.id = f.message_id and m.created_at < :c)"
            ),
            {"c": cutoff},
        )
        deleted = len(
            (
                await session.execute(
                    text("delete from ai.tutor_messages where created_at < :c returning id"),
                    {"c": cutoff},
                )
            ).all()
        )
        await session.execute(
            text(
                "delete from ai.tutor_sessions s where coalesce(s.last_message_at, s.started_at) < :c"
                " and not exists (select 1 from ai.tutor_messages m where m.session_id = s.id)"
            ),
            {"c": cutoff},
        )
    return deleted


async def purge_old_messages_job(deps: JobDeps) -> int:
    return await purge_old_messages(deps.db)
