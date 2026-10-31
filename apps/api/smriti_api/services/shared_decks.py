"""Shared decks (tutor-social B12, R20, R39, R41) and the SOC-01 overview.

- Sharing needs sign-in; under-18s need the guardian's ``community`` scope; under-13s can't share.
- The title and card text are moderated before the link works: the keyword layer, a personal
  data check, then the ``cheap`` model tier through the AI gateway. A deck that fails stays
  ``blocked``; nothing a student typed is logged.
- The author is never named (R20): rows say "Shared by a friend" or "Shared by a student", and
  only the helpful count is shown, never who voted.
- Adults' decks open for anyone with the link (guests can preview) and are listed for their exam
  only behind ``social.deck_listing``. Teens' decks open only for the teen's friends and are
  never listed.
- [Add a copy] makes a deck the receiver owns (``source = 'shared_copy'``); the copy stays when
  the author stops sharing.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.ai.gateway import AIGateway
from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError, conflict, login_required, not_found
from smriti_api.schemas import social as so
from smriti_api.services import leagues, privacy, tutor_safety
from smriti_api.services import social_duos as sd
from smriti_api.services import social_friends as sf
from smriti_api.services import social_people as sp
from smriti_api.services import social_squads as ss
from smriti_api.services.usage import Flags, load_flags

if TYPE_CHECKING:
    from smriti_api.services.jobs import JobDeps

SHAREABLE_SOURCES = ("user", "note", "transcript", "tutor")
SAMPLE_CARDS = 3  # B12: "three sample cards"
MODERATION_CHARS = 8000
LIST_LIMIT = 50


def card_text(side: Any) -> str:
    """The words on one side of a card (``{"text": ...}`` from sync, or a richer shape)."""
    if isinstance(side, str):
        return side
    if isinstance(side, Mapping):
        if isinstance(side.get("text"), str):
            return str(side["text"])
        return " ".join(card_text(v) for v in side.values() if v is not None).strip()
    if isinstance(side, list):
        return " ".join(card_text(v) for v in side).strip()
    return ""


async def _sharer(session: AsyncSession, auth: AuthContext) -> sp.Member:
    if auth.is_anonymous:
        raise login_required("share_deck")
    m = await sp.load_member(session, auth.user_id)
    if m.is_guest:
        raise login_required("share_deck")
    if m.age_band is None:
        raise ApiError(403, "age_required", "Tell us your age first")
    if m.age_band in (sp.LITTLE, sp.CHILD):
        raise ApiError(403, "social_not_available", "Sharing decks isn't available for your age")
    if m.is_minor:
        await privacy.require_scope(session, m.user_id, "community")
    return m


async def _own_deck(session: AsyncSession, deck_id: uuid.UUID, user_id: uuid.UUID) -> Any:
    row = (
        await session.execute(
            text(
                "select * from learn.decks where id = :d and owner_user_id = :u and deleted_at is null"
            ),
            {"d": deck_id, "u": user_id},
        )
    ).one_or_none()
    if row is None:
        raise not_found("deck_not_found", "No such deck")
    return row


async def _cards(session: AsyncSession, deck_id: uuid.UUID, limit: int | None = None) -> list[Any]:
    return list(
        (
            await session.execute(
                text(
                    "select id, kind, front, back, concept_id from learn.cards"  # noqa: S608 - fixed SQL fragments, values are bound
                    " where deck_id = :d and deleted_at is null order by created_at, id"
                    + (" limit :n" if limit else "")
                ),
                {"d": deck_id, "n": limit},
            )
        ).all()
    )


Outcome = Literal["shared", "blocked", "retry"]


async def _moderate(ai: AIGateway, words: str, user_id: uuid.UUID, *, minor: bool) -> Outcome:
    """Personal data and the keyword screen block at once. The model check (``cheap`` tier) fails
    open for adults, as the tutor does, but closed for minors: if the model can't give a clear
    answer, a minor's deck stays unshared and the ``deck_moderation`` job tries again."""
    _, had_personal_data = tutor_safety.redact(words)
    if had_personal_data:
        return "blocked"
    verdict = tutor_safety.screen(words)
    if verdict.blocked or verdict.crisis:
        return "blocked"
    try:
        model = await tutor_safety.moderate_or_none(
            ai, words, user_id, under_13=False, feature="deck_moderation"
        )
    except ApiError:  # the AI budget said no: same as a failed call
        model = None
    if model is None:
        return "retry" if minor else "shared"
    return "blocked" if (model.blocked or model.crisis) else "shared"


async def _deck_words(session: AsyncSession, deck_id: uuid.UUID, title: str) -> str:
    cards = await _cards(session, deck_id)
    return " \n".join([title, *(f"{card_text(c.front)} {card_text(c.back)}" for c in cards)])[
        :MODERATION_CHARS
    ]


async def _settle(session: AsyncSession, deck_id: uuid.UUID, outcome: Outcome) -> None:
    """Writes a moderation outcome to a deck that is still waiting for one."""
    deck = (
        await session.execute(
            text("select share_code, share_status from learn.decks where id = :d for update"),
            {"d": deck_id},
        )
    ).one()
    if deck.share_status != "checking" or outcome == "retry":
        return  # stopped meanwhile, or still waiting
    if outcome == "blocked":
        await session.execute(
            text("update learn.decks set share_status = 'blocked' where id = :d"), {"d": deck_id}
        )
        return
    code = deck.share_code
    while code is None:
        candidate = sp.new_code(8)
        taken = (
            await session.execute(
                text("select 1 from learn.decks where share_code = :c"), {"c": candidate}
            )
        ).scalar_one_or_none()
        code = None if taken else candidate
    await session.execute(
        text("update learn.decks set share_status = 'shared', share_code = :c where id = :d"),
        {"c": code, "d": deck_id},
    )


async def share(
    db: Database, ai: AIGateway, auth: AuthContext, deck_id: uuid.UUID, body: so.DeckShareIn
) -> so.DeckShare:
    async with db.system_tx() as session:
        m = await _sharer(session, auth)
        deck = await _own_deck(session, deck_id, m.user_id)
        if deck.source not in SHAREABLE_SOURCES:
            raise conflict("deck_not_shareable", "This deck can't be shared")
        if not await _cards(session, deck_id, 1):
            raise conflict("deck_empty", "Add a card before sharing")
        listed = body.list_for_exam if m.is_adult else None
        await session.execute(
            text(
                "update learn.decks set title = :t, share_status = 'checking', listed_for_exam = :l"
                " where id = :d"
            ),
            {"t": body.title, "l": listed, "d": deck_id},
        )
        words = await _deck_words(session, deck_id, body.title)
    outcome = await _moderate(ai, words, m.user_id, minor=m.is_minor)
    async with db.system_tx() as session:
        await _settle(session, deck_id, outcome)
        return _share_out(await _own_deck(session, deck_id, m.user_id))


async def retry_checking(db: Database, ai: AIGateway, limit: int = 100) -> int:
    """Decks still ``checking`` (a minor's deck whose model check failed, or a crash between the
    two steps of :func:`share`) get another moderation pass. Returns how many were settled."""
    async with db.system_tx() as session:
        rows = (
            await session.execute(
                text(
                    "select d.id, d.title, d.owner_user_id, p.age_band from learn.decks d"
                    " join app.profiles p on p.user_id = d.owner_user_id"
                    " where d.share_status = 'checking' and d.deleted_at is null"
                    " order by d.created_at limit :n"
                ),
                {"n": limit},
            )
        ).all()
        work = [(r, await _deck_words(session, r.id, r.title)) for r in rows]
    settled = 0
    for r, words in work:
        outcome = await _moderate(ai, words, r.owner_user_id, minor=r.age_band != sp.ADULT)
        async with db.system_tx() as session:
            await _settle(session, r.id, outcome)
        settled += outcome != "retry"
    return settled


async def moderation_job(deps: JobDeps) -> int:
    if deps.ai is None:
        return 0
    return await retry_checking(deps.db, deps.ai)


def _share_out(row: Any) -> so.DeckShare:
    live = row.share_status == "shared" and row.share_code is not None
    return so.DeckShare(
        deck_id=row.id,
        share_code=row.share_code if live else None,
        share_status=row.share_status or "stopped",
        path=f"/deck/{row.share_code}" if live else None,
    )


async def stop_share(db: Database, auth: AuthContext, deck_id: uuid.UUID) -> so.DeckShare:
    async with db.system_tx() as session:
        if auth.is_anonymous:
            raise login_required("share_deck")
        deck = await _own_deck(session, deck_id, auth.user_id)
        if deck.share_status is not None:
            await session.execute(
                text("update learn.decks set share_status = 'stopped' where id = :d"),
                {"d": deck_id},
            )
        return _share_out(await _own_deck(session, deck_id, auth.user_id))


# --- finding and opening ------------------------------------------------------------------------


async def _shared(session: AsyncSession, code: str) -> Any:
    row = (
        await session.execute(
            text(
                "select d.*, p.age_band as owner_band,"
                " (select count(*) from learn.cards c where c.deck_id = d.id and c.deleted_at is null) as n"
                " from learn.decks d join app.profiles p on p.user_id = d.owner_user_id"
                " where d.share_code = :c and d.share_status = 'shared' and d.deleted_at is null"
            ),
            {"c": code},
        )
    ).one_or_none()
    if row is None:
        raise not_found("deck_not_found", "This deck isn't shared any more")
    return row


async def _viewer(
    session: AsyncSession, auth: AuthContext, flags: Flags, deck: Any, *, need_account: bool
) -> sp.Member | None:
    """Who may open a shared deck: anyone (guests too) for an adult's deck, only the author's
    friends for a teen's. Signed-in minors pass the consent gate first; a block hides it."""
    if auth.is_anonymous:
        if need_account or deck.owner_band != sp.ADULT:
            raise login_required("share_deck")
        return None
    m = await sp.load_member(session, auth.user_id)
    if m.is_guest:
        if need_account or deck.owner_band != sp.ADULT:
            raise login_required("share_deck")
        return None
    if m.user_id == deck.owner_user_id:
        return m
    m = await sp.gate(session, auth, flags)
    if deck.owner_user_id in await sp.blocked_ids(session, m.user_id):
        raise not_found("deck_not_found", "This deck isn't shared any more")
    if deck.owner_band != sp.ADULT and not await sp.are_friends(
        session, m.user_id, deck.owner_user_id
    ):
        raise not_found("deck_not_found", "This deck isn't shared any more")
    if deck.owner_user_id not in await sp.socially_visible(session, [deck.owner_user_id]):
        raise not_found("deck_not_found", "This deck isn't shared any more")
    return m


async def _voted(
    session: AsyncSession, deck_ids: list[uuid.UUID], user_id: uuid.UUID | None
) -> set[uuid.UUID]:
    if user_id is None or not deck_ids:
        return set()
    return set(
        (
            await session.execute(
                text(
                    "select deck_id from learn.deck_helpful_votes where user_id = :u and deck_id = any(:d)"
                ),
                {"u": user_id, "d": deck_ids},
            )
        ).scalars()
    )


def _row(
    deck: Any, viewer: sp.Member | None, friends: set[uuid.UUID], voted: set[uuid.UUID]
) -> so.SharedDeckRow:
    return so.SharedDeckRow(
        code=deck.share_code,
        title=deck.title,
        card_count=int(deck.n),
        shared_by="friend" if deck.owner_user_id in friends else "student",
        helpful=int(deck.helpful_count),
        i_found_helpful=deck.id in voted,
        topic_id=deck.topic_id,
    )


async def list_shared(
    db: Database, auth: AuthContext, scope: str, exam: str | None = None
) -> list[so.SharedDeckRow]:
    """SOC-21: "From friends", or "For {exam}" behind ``social.deck_listing``."""
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags)
        friends = set(await sp.friend_ids(session, m.user_id))
        blocked = await sp.blocked_ids(session, m.user_id)
        base = (
            "select d.*, p.age_band as owner_band,"
            " (select count(*) from learn.cards c where c.deck_id = d.id and c.deleted_at is null) as n"
            " from learn.decks d join app.profiles p on p.user_id = d.owner_user_id"
            " where d.share_status = 'shared' and d.share_code is not null and d.deleted_at is null"
        )
        if scope == "friends":
            rows = (
                await session.execute(
                    text(
                        base + " and d.owner_user_id = any(:f) order by d.created_at desc limit :n"
                    ),
                    {"f": list(friends), "n": LIST_LIMIT},
                )
            ).all()
        else:
            if not flags.bool("social.deck_listing"):
                raise ApiError(404, "listing_off", "Deck listings aren't open yet")
            target = exam or m.primary_exam
            if target is None:
                raise ApiError(422, "exam_required", "Pick an exam first")
            rows = (
                await session.execute(
                    text(
                        base + " and d.listed_for_exam = :e and p.age_band = '18p'"
                        " order by d.helpful_count desc, d.created_at desc limit :n"
                    ),
                    {"e": target, "n": LIST_LIMIT},
                )
            ).all()
        visible = await sp.socially_visible(session, [r.owner_user_id for r in rows])
        rows = [r for r in rows if r.owner_user_id in visible and r.owner_user_id not in blocked]
        voted = await _voted(session, [r.id for r in rows], m.user_id)
        return [_row(r, m, friends, voted) for r in rows]


async def preview(db: Database, auth: AuthContext, code: str) -> so.SharedDeckPreview:
    async with db.system_tx() as session:
        flags = await load_flags(session)
        deck = await _shared(session, code)
        viewer = await _viewer(session, auth, flags, deck, need_account=False)
        friends = set(await sp.friend_ids(session, viewer.user_id)) if viewer else set()
        voted = await _voted(session, [deck.id], viewer.user_id if viewer else None)
        sample = await _cards(session, deck.id, SAMPLE_CARDS)
        base = _row(deck, viewer, friends, voted)
        is_mine = viewer is not None and viewer.user_id == deck.owner_user_id
        return so.SharedDeckPreview(
            **base.model_dump(),
            sample_cards=[
                so.SampleCard(front=card_text(c.front), back=card_text(c.back)) for c in sample
            ],
            can_copy=viewer is not None and not is_mine,
            is_mine=is_mine,
        )


async def copy(db: Database, auth: AuthContext, code: str) -> so.DeckCopy:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        deck = await _shared(session, code)
        viewer = await _viewer(session, auth, flags, deck, need_account=True)
        assert viewer is not None
        if viewer.user_id == deck.owner_user_id:
            raise conflict("own_deck", "This deck is already yours")
        new_id = uuid.uuid4()
        await session.execute(
            text(
                "insert into learn.decks (id, owner_user_id, source, title, topic_id, created_at)"
                " values (:id, :u, 'shared_copy', :t, :topic, :n)"
            ),
            {"id": new_id, "u": viewer.user_id, "t": deck.title, "topic": deck.topic_id, "n": now},
        )
        copied: list[so.CopiedCard] = []
        for c in await _cards(session, deck.id):
            cid = uuid.uuid4()
            await session.execute(
                text(
                    "insert into learn.cards (id, deck_id, owner_user_id, kind, front, back, concept_id,"
                    " source_ref, created_at)"
                    " values (:id, :d, :u, :k, cast(:f as jsonb), cast(:b as jsonb), :cc, :ref, :n)"
                ),
                {
                    "id": cid,
                    "d": new_id,
                    "u": viewer.user_id,
                    "k": c.kind,
                    "f": _dump(c.front),
                    "b": _dump(c.back),
                    "cc": c.concept_id,
                    "ref": f"shared:{code}",
                    "n": now,
                },
            )
            copied.append(so.CopiedCard(id=cid, front=card_text(c.front), back=card_text(c.back)))
        return so.DeckCopy(deck_id=new_id, title=deck.title, cards=copied)


def _dump(value: Any) -> str:
    return json.dumps(value)


async def helpful(db: Database, auth: AuthContext, code: str, on: bool) -> so.SharedDeckRow:
    """One vote per student per deck; the count sorts the exam listing."""
    async with db.system_tx() as session:
        flags = await load_flags(session)
        deck = await _shared(session, code)
        viewer = await _viewer(session, auth, flags, deck, need_account=True)
        assert viewer is not None
        if viewer.user_id == deck.owner_user_id:
            raise conflict("own_deck", "You can't vote for your own deck")
        if on:
            await session.execute(
                text(
                    "insert into learn.deck_helpful_votes (deck_id, user_id) values (:d, :u)"
                    " on conflict do nothing"
                ),
                {"d": deck.id, "u": viewer.user_id},
            )
        else:
            await session.execute(
                text("delete from learn.deck_helpful_votes where deck_id = :d and user_id = :u"),
                {"d": deck.id, "u": viewer.user_id},
            )
        await session.execute(
            text(
                "update learn.decks set helpful_count ="
                " (select count(*) from learn.deck_helpful_votes v where v.deck_id = :d) where id = :d"
            ),
            {"d": deck.id},
        )
        deck = await _shared(session, code)
        friends = set(await sp.friend_ids(session, viewer.user_id))
        return _row(deck, viewer, friends, await _voted(session, [deck.id], viewer.user_id))


# --- SOC-01 in one call -----------------------------------------------------------------------


async def overview(db: Database, auth: AuthContext) -> so.Overview:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        if auth.is_anonymous:
            return so.Overview(gate=so.Gate(state="guest"), me={})
        m = await sp.load_member(session, auth.user_id)
        state = await sp.gate_state(session, m)
        stats = (
            await session.execute(
                text("select current_streak, xp_total from game.user_stats where user_id = :u"),
                {"u": m.user_id},
            )
        ).one_or_none()
        start = leagues.week_start(now)
        week_xp = (await leagues.counted_xp(session, [m.user_id], leagues.week_opens(start), now))[
            m.user_id
        ]
        mine = {
            "streak": int(stats.current_streak) if stats else 0,
            "xp_total": int(stats.xp_total) if stats else 0,
            "week_xp": week_xp,
        }
        feats = sp.features(m, state)
        gate = so.Gate(state=state, features=feats)
        if state != "ok":
            return so.Overview(gate=gate, me=mine)
        m = await sp.gate(session, auth, flags)
        league = await leagues.league_view(session, m, flags, now) if "league" in feats else None
        _, unread = await sf.inbox_items(session, m, flags, now)
        return so.Overview(
            gate=gate,
            me=mine,
            league=league,
            friends_today=await sf.friend_rows(session, m, flags, now),
            duos=await sd.duo_rows(session, m, flags, now) if "duo" in feats else [],
            squads=await ss.squad_rows(session, m, flags, now) if "squad" in feats else [],
            inbox_unread=unread,
        )
