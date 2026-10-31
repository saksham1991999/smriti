"""AI-21 role play (tutor-social §A11; LES-01.16): the student questions a lesson's character.

- The script (persona prompt, guardrails, goals, opening line, suggested replies) is the server's
  copy of the published role-play card (``content.roleplay_scripts``, filled by the publish job in
  the card-index pass). The client sends only the card id, so the prompt is always published
  content.
- A chat is a tutor session with ``mode = 'roleplay'`` and ``context_ref = card:{card_id}``, plus
  an ``ai.roleplay_chats`` row with the turns and the goals met. The opening line is stored as the
  character's first message, so history reads like the chat.
- Limits: role play never uses free tutor messages. Free students get
  ``free.roleplay_chats_per_day`` chats a day; Pro turns count against the shared fair-use cap
  (``pro.tutor_messages_per_day``). Each chat ends after ``roleplay.max_turns`` student turns, or
  when every goal is met, or on [Wrap up]. A chat in progress always finishes. Null flags mean no
  cap (the flags' convention).
- Under-13s send suggested replies only. Little learners don't get role play (AI-21 states).
- Safety: the tutor's screen and redaction on every student turn and on every reply. A crisis
  returns the helplines; anything else unsafe or off-topic makes the character step out.
- The summary lists the goals met and the card's concepts, from the script, never from the model.
- Logs carry ids and counts only, never the chat text (AGENTS rule 6).
"""

from __future__ import annotations

import json
import re
import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.ai.gateway import AIGateway
from smriti_api.ai.interfaces import AIError, BudgetExceeded, ChatMessage
from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError
from smriti_api.schemas import roleplay as r
from smriti_api.services import parent_mode, tutor, tutor_safety
from smriti_api.services.usage import (
    Flags,
    Learner,
    load_flags,
    load_learner,
    next_local_midnight,
    tutor_quota,
)

log = structlog.get_logger(__name__)

SCRIPT_KEYS = (
    "character",
    "persona_prompt",
    "goals",
    "guardrails",
    "opening_line",
    "suggested_replies",
)
HISTORY_LIMIT = 60  # messages sent back to the model: far above any turn cap the docs suggest

ROLEPLAY_RULES = """You are playing a character in a lesson for a student. Stay in character and \
in the character's time. Follow the persona and the guardrails below exactly. Help the student \
find out the goals by answering their questions; never list the goals or lecture. Keep each reply \
to two to four short sentences. If the student asks for something unsafe, personal or far off the \
lesson, do not answer it: set "step_out" to true and leave "reply" empty.
Reply with JSON only: {"reply": "<your reply in character>", "goals_met": [<indexes of goals the \
student has found out so far>], "step_out": false}"""


# --- the publish side ----------------------------------------------------------------------------


@dataclass(frozen=True)
class ScriptRow:
    card_id: str
    item_id: str
    topic_id: str
    concept_ids: tuple[str, ...]
    script: dict[str, Any]


def scripts_from_lesson(lesson: Mapping[str, Any]) -> list[ScriptRow]:
    rows = []
    for card in lesson.get("cards") or []:
        if card.get("type") != "roleplay" or not card.get("id") or not card.get("goals"):
            continue
        rows.append(
            ScriptRow(
                card_id=str(card["id"]),
                item_id=str(lesson["id"]),
                topic_id=str(lesson["topic"]),
                concept_ids=tuple(str(c) for c in card.get("concepts") or []),
                script={k: card[k] for k in SCRIPT_KEYS if k in card},
            )
        )
    return rows


async def index_scripts(
    session: AsyncSession, lessons: Iterable[Mapping[str, Any]]
) -> dict[str, int]:
    """Upserts the role-play cards of published lessons and retires those that left a lesson."""
    published = set(
        (
            await session.execute(
                text(
                    "select id from content.content_items where kind = 'lesson'"
                    " and status = 'published'"
                )
            )
        ).scalars()
    )
    rows: list[ScriptRow] = []
    items: set[str] = set()
    for lesson in lessons:
        if lesson.get("id") not in published:
            continue
        items.add(str(lesson["id"]))
        rows += scripts_from_lesson(lesson)
    for row in rows:
        await session.execute(
            text(
                """
                insert into content.roleplay_scripts
                  (card_id, item_id, topic_id, concept_ids, script, status, updated_at)
                values (:card, :item, :topic, :concepts, cast(:script as jsonb), 'published', now())
                on conflict (card_id) do update set
                  item_id = excluded.item_id, topic_id = excluded.topic_id,
                  concept_ids = excluded.concept_ids, script = excluded.script,
                  status = 'published', updated_at = now()
                """
            ),
            {
                "card": row.card_id,
                "item": row.item_id,
                "topic": row.topic_id,
                "concepts": list(row.concept_ids),
                "script": json.dumps(row.script),
            },
        )
    retired = 0
    if items:
        retired = (
            await session.execute(
                text(
                    "update content.roleplay_scripts set status = 'retired', updated_at = now()"
                    " where item_id = any(:items) and status = 'published'"
                    " and not (card_id = any(:keep))"
                ),
                {"items": sorted(items), "keep": [x.card_id for x in rows]},
            )
        ).rowcount or 0  # type: ignore[attr-defined]
    return {"roleplay": len(rows), "roleplay_retired": int(retired)}


# --- the chat ------------------------------------------------------------------------------------


def _loc(value: Any, locale: str) -> str:
    return tutor._localized(value, locale)


def _i18n(value: Any) -> dict[str, str]:
    if isinstance(value, Mapping):
        return {k: str(v) for k, v in value.items() if k in ("en", "hi")}
    return {"en": str(value or "")}


async def _script(session: AsyncSession, card_id: str, *, published: bool = True) -> Any:
    row = (
        await session.execute(
            text(
                "select card_id, topic_id, concept_ids, script from content.roleplay_scripts"
                " where card_id = :c and (not :p or status = 'published')"
            ),
            {"c": card_id, "p": published},
        )
    ).one_or_none()
    if row is None:
        raise ApiError(404, "unknown_card", "This role play isn't available")
    return row


def _gate_age(learner: Learner) -> None:
    if learner.age_band == "u10":
        raise ApiError(403, "roleplay_not_for_age", "Role play isn't part of this app")


async def _chat(session: AsyncSession, user_id: uuid.UUID, session_id: uuid.UUID) -> Any:
    row = (
        await session.execute(
            text(
                "select * from ai.roleplay_chats where session_id = :s and user_id = :u for update"
            ),
            {"s": session_id, "u": user_id},
        )
    ).one_or_none()
    if row is None:
        raise ApiError(404, "not_found", "No such chat")
    return row


async def _state(
    session: AsyncSession, chat: Any, script: Any, flags: Flags, locale: str
) -> dict[str, Any]:
    rows = (
        await session.execute(
            text(
                "select id, role, content, created_at from ai.tutor_messages"
                " where session_id = :s and status = 'ok' and role in ('user', 'assistant')"
                " order by created_at, id"
            ),
            {"s": chat.session_id},
        )
    ).all()
    summary = None
    if chat.status == "ended":
        goals = list(script.script.get("goals") or [])
        names = (
            await session.execute(
                text("select id, name from content.concepts where id = any(:ids)"),
                {"ids": list(script.concept_ids or [])},
            )
        ).all()
        by_id = {n.id: dict(n.name) for n in names}
        summary = r.RoleplaySummary(
            found_out=[_i18n(goals[i]) for i in sorted(chat.goals_met or []) if i < len(goals)],
            concepts=[
                r.SummaryConcept(id=c, name=by_id[c])
                for c in script.concept_ids or []
                if c in by_id
            ],
        )
    return {
        "session_id": chat.session_id,
        "card_id": chat.card_id,
        "status": chat.status,
        "end_reason": chat.end_reason,
        "turns": chat.turns,
        "max_turns": flags.int_or_none("roleplay.max_turns"),
        "goals_total": chat.goals_total,
        "goals_met": sorted(chat.goals_met or []),
        "messages": [
            r.RoleplayMessage(
                id=m.id,
                role="student" if m.role == "user" else "character",
                text=m.content,
                created_at=m.created_at,
            )
            for m in rows
        ],
        "summary": summary,
    }


async def _lock(session: AsyncSession, user_id: uuid.UUID) -> None:
    await session.execute(
        text("select pg_advisory_xact_lock(hashtextextended('roleplay:' || :u, 0))"),
        {"u": str(user_id)},
    )


async def start(db: Database, auth: AuthContext, body: r.RoleplayStart) -> r.RoleplayChat:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        _gate_age(learner)
        await parent_mode.check_tutor(session, learner)
        flags = await load_flags(session)
        script = await _script(session, body.card_id)
        if await tutor.exam_guard(session, auth.user_id, None):
            raise ApiError(409, "exam_in_progress", "The tutor is off while a timed mock runs")
        await _lock(session, auth.user_id)
        locale = tutor._tutor_locale(learner)
        open_chat = (
            await session.execute(
                text(
                    "select * from ai.roleplay_chats where user_id = :u and card_id = :c"
                    " and status = 'open' order by started_at desc limit 1 for update"
                ),
                {"u": auth.user_id, "c": body.card_id},
            )
        ).one_or_none()
        if open_chat is not None:
            return r.RoleplayChat(**await _state(session, open_chat, script, flags, locale))
        cap = None if learner.is_pro else flags.int_or_none("free.roleplay_chats_per_day")
        if cap is not None:
            start_at, end_at = learner.day_bounds(now)
            used = (
                await session.execute(
                    text(
                        "select count(*) from ai.roleplay_chats where user_id = :u"
                        " and started_at >= :s and started_at < :e"
                    ),
                    {"u": auth.user_id, "s": start_at, "e": end_at},
                )
            ).scalar_one()
            if int(used) >= cap:
                raise ApiError(
                    429,
                    "roleplay_daily_cap",
                    "That's today's role plays",
                    limit=cap,
                    under_13=learner.under_13,
                    resets_at=next_local_midnight(learner, now).isoformat(),
                )
        session_id = (
            await session.execute(
                text(
                    "insert into ai.tutor_sessions (user_id, mode, context_ref, exam_profile_id,"
                    " locale) values (:u, 'roleplay', :c, :e, :l) returning id"
                ),
                {
                    "u": auth.user_id,
                    "c": f"card:{body.card_id}",
                    "e": learner.primary_exam,
                    "l": locale,
                },
            )
        ).scalar_one()
        await tutor._store(
            session,
            message_id=uuid.uuid4(),
            session_id=session_id,
            user_id=auth.user_id,
            role="assistant",
            content=_loc(script.script.get("opening_line"), locale),
            status="ok",
        )
        await session.execute(
            text(
                "insert into ai.roleplay_chats (session_id, user_id, card_id, goals_total)"
                " values (:s, :u, :c, :g)"
            ),
            {
                "s": session_id,
                "u": auth.user_id,
                "c": body.card_id,
                "g": len(script.script.get("goals") or []),
            },
        )
        chat = await _chat(session, auth.user_id, session_id)
        state = await _state(session, chat, script, flags, locale)
    log.info("roleplay_started", card=body.card_id)
    return r.RoleplayChat(**state)


async def get(db: Database, auth: AuthContext, session_id: uuid.UUID) -> r.RoleplayChat:
    async with db.system_tx() as session:
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        flags = await load_flags(session)
        chat = await _chat(session, auth.user_id, session_id)
        script = await _script(session, chat.card_id, published=False)
        return r.RoleplayChat(
            **await _state(session, chat, script, flags, tutor._tutor_locale(learner))
        )


def system_prompt(script: Mapping[str, Any], learner: Learner, locale: str) -> str:
    goals = "\n".join(f"{i}. {_loc(g, locale)}" for i, g in enumerate(script.get("goals") or []))
    guardrails = "\n".join(f"- {g}" for g in script.get("guardrails") or [])
    character = script.get("character") or {}
    return "\n\n".join(
        [
            ROLEPLAY_RULES,
            f"Character: {_loc(character.get('name'), locale)} ({_loc(character.get('era'), locale)})",
            f"Persona:\n{script.get('persona_prompt', '')}",
            f"Guardrails:\n{guardrails}",
            f"Goals (the student should find these out):\n{goals}",
            tutor._age_rule(learner),
            tutor._language_rule(locale),
        ]
    )


_JSON = re.compile(r"\{.*\}", re.DOTALL)


def parse_reply(raw: str, goals_total: int) -> tuple[str, list[int], bool]:
    """The model's ``{"reply", "goals_met", "step_out"}``. Raises ValueError when unusable."""
    m = _JSON.search(raw or "")
    if m is None:
        raise ValueError("no json")
    doc = json.loads(m.group(0))
    if not isinstance(doc, dict):
        raise ValueError("not an object")
    step_out = doc.get("step_out") is True
    reply = str(doc.get("reply") or "").strip()
    if not reply and not step_out:
        raise ValueError("empty reply")
    met = doc.get("goals_met") or []
    goals = sorted(
        {
            int(i)
            for i in (met if isinstance(met, list) else [])
            if isinstance(i, int) and not isinstance(i, bool) and 0 <= i < goals_total
        }
    )
    return reply, goals, step_out


async def _replayed(session: AsyncSession, session_id: uuid.UUID, message_id: uuid.UUID) -> bool:
    return bool(
        (
            await session.execute(
                text(
                    "select exists (select 1 from ai.tutor_messages where id = :m"
                    " and session_id = :s)"
                ),
                {"m": message_id, "s": session_id},
            )
        ).scalar_one()
    )


async def turn(
    db: Database,
    ai: AIGateway,
    auth: AuthContext,
    session_id: uuid.UUID,
    body: r.RoleplayTurnIn,
) -> r.RoleplayTurnOut:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        _gate_age(learner)
        await parent_mode.check_tutor(session, learner)
        flags = await load_flags(session)
        chat = await _chat(session, auth.user_id, session_id)
        script = await _script(session, chat.card_id, published=False)
        locale = tutor._tutor_locale(learner)
        if await _replayed(session, session_id, body.client_message_id):
            return r.RoleplayTurnOut(**await _state(session, chat, script, flags, locale))
        if chat.status == "ended":
            raise ApiError(409, "roleplay_ended", "This chat has finished")
        if body.text is not None and learner.under_13:
            raise ApiError(422, "replies_only", "Pick one of the replies")
        if body.reply_index is not None:
            replies = list(script.script.get("suggested_replies") or [])
            if body.reply_index >= len(replies):
                raise ApiError(422, "unknown_reply", "That reply isn't on this card")
            said = _loc(replies[body.reply_index], locale)
        else:
            said = body.text or ""
            cap = flags.int_or_none("tutor.max_input_chars")
            if cap is not None and len(said) > cap:
                raise ApiError(422, "too_long", "That message is too long", limit=cap)
        quota = None
        if learner.is_pro:
            q = await tutor_quota(session, learner, flags, now)
            quota = tutor._quota_out(q, learner, now)
            if not q.allowed:
                raise ApiError(
                    429,
                    "quota_exhausted",
                    "That's today's fair-use limit",
                    quota=quota.model_dump(mode="json"),
                )
        history = (
            await session.execute(
                text(
                    "select role, content from ai.tutor_messages where session_id = :s"
                    " and status = 'ok' and role in ('user', 'assistant')"
                    " order by created_at desc, id desc limit :n"
                ),
                {"s": session_id, "n": HISTORY_LIMIT},
            )
        ).all()

    clean, _ = tutor_safety.redact(said)
    verdict = tutor_safety.screen(clean)
    if verdict == tutor_safety.Verdict() and flags.bool("ai.llm_moderation"):
        verdict = await tutor_safety.moderate(ai, clean, auth.user_id, under_13=learner.under_13)
    if verdict.category is not None:
        return await _stepped_out(db, auth, body, chat, script, flags, locale, clean, verdict)

    messages = [ChatMessage("system", system_prompt(script.script, learner, locale))]
    messages += [
        ChatMessage("user" if m.role == "user" else "assistant", m.content)
        for m in reversed(history)
    ]
    messages.append(ChatMessage("user", clean))
    try:
        result = await ai.complete(
            feature="roleplay",
            tier="tutor",
            messages=messages,
            user_id=auth.user_id,
            max_tokens=500,
        )
        reply, met, step_out = parse_reply(result.text, chat.goals_total)
    except BudgetExceeded as exc:
        raise ApiError(429, "ai_budget", "The tutor needs a break; try later") from exc
    except (AIError, ValueError, json.JSONDecodeError) as exc:
        log.warning("roleplay_reply_failed", error_type=type(exc).__name__)
        raise ApiError(503, "roleplay_unavailable", "Couldn't reply. Try again") from exc
    reply, _ = tutor_safety.redact(reply)
    if step_out or tutor_safety.screen(reply).category is not None:
        return await _stepped_out(db, auth, body, chat, script, flags, locale, clean, None)

    async with db.system_tx() as session:
        chat = await _chat(session, auth.user_id, session_id)
        if await _replayed(session, session_id, body.client_message_id):
            return r.RoleplayTurnOut(**await _state(session, chat, script, flags, locale))
        await tutor._store(
            session,
            message_id=body.client_message_id,
            session_id=session_id,
            user_id=auth.user_id,
            role="user",
            content=clean,
            status="ok",
            counted=learner.is_pro,
        )
        await tutor._store(
            session,
            message_id=uuid.uuid4(),
            session_id=session_id,
            user_id=auth.user_id,
            role="assistant",
            content=reply,
            status="ok",
            tokens_out=result.tokens_out,
        )
        goals_met = sorted(set(chat.goals_met or []) | set(met))
        turns = chat.turns + 1
        max_turns = flags.int_or_none("roleplay.max_turns")
        end_reason = (
            "goals_met"
            if len(goals_met) >= chat.goals_total
            else "turn_cap"
            if max_turns is not None and turns >= max_turns
            else None
        )
        await session.execute(
            text(
                "update ai.roleplay_chats set turns = :t, goals_met = :g,"
                " status = case when cast(:r as text) is null then status else 'ended' end,"
                " end_reason = coalesce(cast(:r as text), end_reason),"
                " ended_at = case when cast(:r as text) is null then ended_at else now() end"
                " where session_id = :s"
            ),
            {"t": turns, "g": goals_met, "r": end_reason, "s": session_id},
        )
        if end_reason is not None:
            await session.execute(
                text("update ai.tutor_sessions set ended_at = now() where id = :s"),
                {"s": session_id},
            )
        chat = await _chat(session, auth.user_id, session_id)
        state = await _state(session, chat, script, flags, locale)
        if learner.is_pro:
            quota = tutor._quota_out(await tutor_quota(session, learner, flags, now), learner, now)
    log.info("roleplay_turn", turns=turns, goals_met=len(goals_met), ended=end_reason is not None)
    return r.RoleplayTurnOut(**state, quota=quota)


async def _stepped_out(
    db: Database,
    auth: AuthContext,
    body: r.RoleplayTurnIn,
    chat: Any,
    script: Any,
    flags: Flags,
    locale: str,
    clean: str,
    verdict: tutor_safety.Verdict | None,
) -> r.RoleplayTurnOut:
    """The character steps out (or the crisis card shows). The turn isn't counted and the
    student's line is kept out of the chat the model sees."""
    crisis = verdict is not None and verdict.crisis
    async with db.system_tx() as session:
        if not await _replayed(session, chat.session_id, body.client_message_id):
            await tutor._store(
                session,
                message_id=body.client_message_id,
                session_id=chat.session_id,
                user_id=auth.user_id,
                role="user",
                content=clean,
                status="crisis" if crisis else "refused",
                flagged=verdict is not None,
            )
            if verdict is not None and verdict.category is not None:
                await tutor._flag(
                    session,
                    auth.user_id,
                    body.client_message_id,
                    str(verdict.category),
                    "queued" if crisis else "blocked",
                )
        chat = await _chat(session, auth.user_id, chat.session_id)
        state = await _state(session, chat, script, flags, locale)
    if crisis:
        log.info("safety_crisis_total")
        return r.RoleplayTurnOut(
            **state, safety="crisis", helplines=tutor._helplines(flags, locale)
        )
    return r.RoleplayTurnOut(**state, step_out=True)


async def wrap_up(db: Database, auth: AuthContext, session_id: uuid.UUID) -> r.RoleplayChat:
    """[Wrap up]: ends the chat now and returns the summary. Ending an ended chat is a no-op."""
    async with db.system_tx() as session:
        learner = await load_learner(session, auth.user_id, auth.is_anonymous)
        flags = await load_flags(session)
        chat = await _chat(session, auth.user_id, session_id)
        if chat.status == "open":
            await session.execute(
                text(
                    "update ai.roleplay_chats set status = 'ended', end_reason = 'wrap_up',"
                    " ended_at = now() where session_id = :s"
                ),
                {"s": session_id},
            )
            await session.execute(
                text("update ai.tutor_sessions set ended_at = now() where id = :s"),
                {"s": session_id},
            )
            chat = await _chat(session, auth.user_id, session_id)
        script = await _script(session, chat.card_id, published=False)
        return r.RoleplayChat(
            **await _state(session, chat, script, flags, tutor._tutor_locale(learner))
        )
