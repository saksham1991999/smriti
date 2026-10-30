"""Friends and everything between two people (tutor-social B5, B11, B14): the handle and privacy,
exact username search, invite links and QR, requests, the inbox, mini profiles, presets (cheers
and Duo nudges), reactions on friend activity, report and block.

Contacts are never read. Adults and minors become friends only by invite link or QR (real-world
contact). Requests are declined silently, blocks are never announced, and nothing a student
types reaches another student (B2): messages are preset ids from the i18n catalogue.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError, not_found
from smriti_api.schemas import social as so
from smriti_api.services import copy
from smriti_api.services import social_people as sp
from smriti_api.services.usage import Flags, load_flags

PRESET_NS = "tutor_social"
REACTIONS = ("clap", "star", "strong", "smile")
FEED_DAYS = 14
PERSON_REASONS = {"inappropriate_username", "cheating", "bullying", "impersonation", "other"}
DECK_REASONS = {"wrong_facts", "copied", "inappropriate_words", "spam", "other"}


def preset_ok(kind: str, preset_id: str) -> bool:
    """Preset messages live in the SOC-22 catalogue: cheers are ``message_*`` (and the squad line),
    Duo nudges are ``nudge_*`` (B11)."""
    prefixes = {"cheer": ("message_",), "nudge": ("nudge_",), "squad": ("squad_message",)}[kind]
    return preset_id.startswith(prefixes) and copy.has(PRESET_NS, f"SOC-22.{preset_id}")


async def _member_row(session: AsyncSession, user_id: uuid.UUID) -> Any:
    await session.execute(
        text("insert into social.members (user_id) values (:u) on conflict do nothing"),
        {"u": user_id},
    )
    return (
        await session.execute(
            text("select * from social.members where user_id = :u"), {"u": user_id}
        )
    ).one()


async def _local_day_start(session: AsyncSession, m: sp.Member, now: datetime) -> datetime:
    return sp.day_bounds(m.today(now), m.tz)[0]


# --- the gate and SOC-03 ------------------------------------------------------------------------


async def gate_view(db: Database, auth: AuthContext) -> so.Gate:
    async with db.system_tx() as session:
        if auth.is_anonymous:
            return so.Gate(state="guest")
        m = await sp.load_member(session, auth.user_id)
        state = await sp.gate_state(session, m)
        first = False
        if state == "ok":
            row = (
                await session.execute(
                    text("select first_visit_at from social.members where user_id = :u"),
                    {"u": auth.user_id},
                )
            ).one_or_none()
            first = row is None or row.first_visit_at is None
        return so.Gate(state=state, features=sp.features(m, state), first_visit=first)


async def me(db: Database, auth: AuthContext, *, first_visit_done: bool = False) -> so.Me:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags)
        row = await _member_row(session, m.user_id)
        if first_visit_done and row.first_visit_at is None:
            await session.execute(
                text("update social.members set first_visit_at = :t where user_id = :u"),
                {"t": now, "u": m.user_id},
            )
        shown = await sp.person(session, m, m.user_id, flags)
        days = flags.int_or_none("social.handle_change_days")
        after = (
            row.handle_changed_at + timedelta(days=days)
            if days and row.handle_changed_at is not None
            else None
        )
        return so.Me(
            handle=m.handle,
            public_name=shown.name,
            discoverable=m.discoverable,
            league_opt_out=m.league_opt_out,
            presence_visible=bool(row.presence_visible),
            board_school=bool(row.board_school),
            board_city=bool(row.board_city),
            handle_change_after=after if after and after > now else None,
        )


async def _handle_state(
    session: AsyncSession, user_id: uuid.UUID, handle: str, flags: Flags, now: datetime
) -> str:
    taken = (
        await session.execute(
            text("select user_id from app.profiles where handle = :h"), {"h": handle}
        )
    ).scalar_one_or_none()
    if taken is not None and taken != user_id:
        return "taken"
    keep = flags.int_or("social.handle_reserve_days", 30)
    reserved = (
        await session.execute(
            text(
                "select user_id from social.handle_reservations where handle = :h"
                " and released_at > :since"
            ),
            {"h": handle, "since": now - timedelta(days=keep)},
        )
    ).scalar_one_or_none()
    if reserved is not None and reserved != user_id:
        return "reserved"
    return "ok"


async def check_handle(db: Database, auth: AuthContext, handle: str) -> so.HandleCheck:
    async with db.system_tx() as session:
        flags = await load_flags(session)
        await sp.gate(session, auth, flags)
        state = await _handle_state(session, auth.user_id, handle, flags, datetime.now(UTC))
    return so.HandleCheck(handle=handle, available=state == "ok", reason=state)


async def set_handle(db: Database, auth: AuthContext, body: so.HandleIn) -> so.Me:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags)
        if m.handle is not None and m.handle.lower() == body.handle.lower():
            pass
        else:
            row = await _member_row(session, m.user_id)
            days = flags.int_or_none("social.handle_change_days")
            if (
                days
                and m.handle is not None
                and row.handle_changed_at is not None
                and row.handle_changed_at + timedelta(days=days) > now
            ):
                raise ApiError(
                    409,
                    "handle_change_too_soon",
                    "You can change your username again later",
                    retry_at=(row.handle_changed_at + timedelta(days=days)).isoformat(),
                )
            state = await _handle_state(session, m.user_id, body.handle, flags, now)
            if state != "ok":
                raise ApiError(409, f"handle_{state}", "That username isn't available")
            if m.handle is not None:
                await session.execute(
                    text(
                        "insert into social.handle_reservations (handle, user_id, released_at)"
                        " values (:h, :u, :t) on conflict (handle) do update"
                        " set user_id = excluded.user_id, released_at = excluded.released_at"
                    ),
                    {"h": m.handle, "u": m.user_id, "t": now},
                )
            await session.execute(
                text("update app.profiles set handle = :h where user_id = :u"),
                {"h": body.handle, "u": m.user_id},
            )
            await session.execute(
                text("update social.members set handle_changed_at = :t where user_id = :u"),
                {"t": now, "u": m.user_id},
            )
    return await me(db, auth)


async def set_privacy(db: Database, auth: AuthContext, body: so.PrivacyIn) -> so.Me:
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags)
        await _member_row(session, m.user_id)
        if body.discoverable is not None:
            # Under-13s are never discoverable (B13); teens may turn it on, adults may turn it off.
            if body.discoverable and m.age_band == sp.CHILD:
                raise ApiError(403, "social_not_available", "This isn't available for your age")
            await session.execute(
                text("update app.profiles set discoverable = :d where user_id = :u"),
                {"d": body.discoverable, "u": m.user_id},
            )
        if body.presence_visible is not None:
            # "Studying now" is adults only (Q-B5).
            if body.presence_visible and not m.is_adult:
                raise ApiError(403, "social_not_available", "This isn't available for your age")
            await session.execute(
                text("update social.members set presence_visible = :v where user_id = :u"),
                {"v": body.presence_visible, "u": m.user_id},
            )
        for col in ("board_school", "board_city"):
            value = getattr(body, col)
            if value is not None:
                if value and m.age_band == sp.CHILD:
                    raise ApiError(403, "social_not_available", "This isn't available for your age")
                await session.execute(
                    text(f"update social.members set {col} = :v where user_id = :u"),  # noqa: S608 - fixed column names
                    {"v": value, "u": m.user_id},
                )
    return await me(db, auth)


# --- search, invites and requests --------------------------------------------------------------


async def by_handle(db: Database, auth: AuthContext, handle: str) -> so.Person:
    """Exact, case-insensitive match on discoverable profiles only: no partial results (B5).
    Adults find adults; teens find adults and teens; under-13s can't search."""
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "search")
        row = (
            await session.execute(
                text(
                    "select user_id, age_band from app.profiles where handle = :h and discoverable"
                    " and signed_up_at is not null"
                ),
                {"h": handle},
            )
        ).one_or_none()
        allowed = ("18p",) if m.is_adult else ("18p", "13_17")
        if (
            row is None
            or row.user_id == m.user_id
            or row.age_band not in allowed
            or row.user_id in await sp.blocked_ids(session, m.user_id)
        ):
            raise not_found("user_not_found", "No one with that username")
        shown = await sp.person(session, m, row.user_id, flags)
        if shown.user_id is None:
            raise not_found("user_not_found", "No one with that username")
        return shown


async def invite(db: Database, auth: AuthContext) -> so.Invite:
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "friends")
        code = m.referral_code
        if code is None:
            for _ in range(5):
                candidate = sp.new_code(8)
                done = (
                    await session.execute(
                        text(
                            "update app.profiles set referral_code = :c where user_id = :u"
                            " and referral_code is null and not exists"
                            " (select 1 from app.profiles where referral_code = :c) returning referral_code"
                        ),
                        {"c": candidate, "u": m.user_id},
                    )
                ).scalar_one_or_none()
                if done:
                    code = done
                    break
        if code is None:
            raise ApiError(500, "invite_code_failed", "Could not make an invite link")
        return so.Invite(code=code, path=f"/invite/{code}")


async def _inviter(session: AsyncSession, code: str) -> Any:
    return (
        await session.execute(
            text(
                "select p.user_id, p.age_band, pet.name as pet_name, pet.species, pet.outfit_ids"
                " from app.profiles p left join game.pets pet on pet.user_id = p.user_id"
                " where p.referral_code = :c"
            ),
            {"c": code},
        )
    ).one_or_none()


async def _invite_state(session: AsyncSession, m: sp.Member, code: str) -> tuple[str, Any]:
    row = await _inviter(session, code)
    if row is None or row.age_band == sp.LITTLE:
        return "invalid", None
    if row.user_id == m.user_id:
        return "self", row
    if row.user_id not in await sp.socially_visible(session, [row.user_id]):
        return "invalid", None
    rel = await sp.relation(session, m.user_id, row.user_id)
    if rel is not None and rel.status == "blocked":
        return "invalid", None  # no sign of the block (B14)
    if rel is not None and rel.status == "accepted":
        return "already_friends", row
    return "ok", row


async def invite_preview(db: Database, auth: AuthContext, code: str) -> so.InvitePreview:
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "friends")
        state, row = await _invite_state(session, m, code)
        if row is None:
            return so.InvitePreview(state=state)
        shown = await sp.person(session, m, row.user_id, flags)
        if row.age_band != sp.ADULT and row.pet_name and state == "ok":
            # An invite is real-world contact: the pet name, as it will show once added (R31).
            shown = shown.model_copy(update={"name": so.Name(kind="pet_name", text=row.pet_name)})
        return so.InvitePreview(state=state, inviter=shown)


async def _friend_count(session: AsyncSession, user_id: uuid.UUID) -> int:
    return int(
        (
            await session.execute(
                text(
                    "select count(*) from social.friendships where status = 'accepted'"
                    " and :u in (user_a, user_b)"
                ),
                {"u": user_id},
            )
        ).scalar_one()
    )


async def _check_friend_cap(session: AsyncSession, flags: Flags, *users: uuid.UUID) -> None:
    cap = flags.int_or_none("social.max_friends")
    if cap is None:
        return
    for u in users:
        if await _friend_count(session, u) >= cap:
            raise ApiError(409, "friend_limit_reached", "That's the most friends for now", max=cap)


async def accept_invite(
    db: Database, auth: AuthContext, code: str, body: so.InviteAccept
) -> so.FriendRow:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "friends")
        state, row = await _invite_state(session, m, code)
        if state == "invalid":
            raise not_found("invite_not_found", "This invite link doesn't work")
        if state == "self":
            raise ApiError(409, "own_invite", "This is your own invite link")
        if state == "ok":
            await _check_friend_cap(session, flags, m.user_id, row.user_id)
            lo, hi = sp.pair(m.user_id, row.user_id)
            await session.execute(
                text(
                    """
                    insert into social.friendships (user_a, user_b, status, requested_by, method, accepted_at)
                    values (:a, :b, 'accepted', :r, :m, :t)
                    on conflict (user_a, user_b) do update
                      set status = 'accepted', method = excluded.method, accepted_at = excluded.accepted_at
                    """
                ),
                {
                    "a": lo,
                    "b": hi,
                    "r": row.user_id,
                    "m": "qr" if body.via == "qr" else "invite",
                    "t": now,
                },
            )
            await sp.push(
                session,
                to=row.user_id,
                kind="friend_accepted",
                sender=m.user_id,
                flags=flags,
                dedupe_key=f"friend_accepted:{lo}:{hi}",
            )
        rows = await _friend_rows(session, m, flags, now, only=[row.user_id])
    return rows[0]


async def request(db: Database, auth: AuthContext, body: so.FriendRequestIn) -> so.RequestOut:
    """A request the other person must accept. From search: the B5 search rules. From a league
    row, a duel result or a squad: adults to adults only."""
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        feature = "search" if body.source == "search" else "friends"
        m = await sp.gate(session, auth, flags, feature)
        target = body.user_id
        if target == m.user_id:
            raise ApiError(409, "own_account", "That's you")
        t = (
            await session.execute(
                text("select age_band, discoverable from app.profiles where user_id = :u"),
                {"u": target},
            )
        ).one_or_none()
        visible = await sp.socially_visible(session, [target])
        rel = await sp.relation(session, m.user_id, target)
        if t is None or target not in visible or (rel is not None and rel.status == "blocked"):
            raise not_found("user_not_found", "No one to add")
        if body.source == "search":
            allowed = ("18p",) if m.is_adult else ("18p", "13_17")
            if t.age_band not in allowed or not t.discoverable:
                raise not_found("user_not_found", "No one to add")
        elif not (m.is_adult and t.age_band == sp.ADULT):
            raise ApiError(403, "invite_only", "Add this friend with an invite link or QR")
        if rel is not None and rel.status == "accepted":
            raise ApiError(409, "already_friends", "You're already friends")
        lo, hi = sp.pair(m.user_id, target)
        if rel is not None and rel.status == "pending":
            if rel.requested_by == m.user_id:
                return so.RequestOut(user_id=target, status="pending")
            # They asked first: this is a yes.
            await _check_friend_cap(session, flags, m.user_id, target)
            await session.execute(
                text(
                    "update social.friendships set status = 'accepted', accepted_at = :t"
                    " where user_a = :a and user_b = :b"
                ),
                {"t": now, "a": lo, "b": hi},
            )
            await sp.push(
                session,
                to=target,
                kind="friend_accepted",
                sender=m.user_id,
                flags=flags,
                dedupe_key=f"friend_accepted:{lo}:{hi}",
            )
            return so.RequestOut(user_id=target, status="accepted")
        per_day = flags.int_or_none("social.friend_requests_per_day")
        if per_day is not None:
            sent = (
                await session.execute(
                    text(
                        "select count(*) from social.friendships where requested_by = :u"
                        " and created_at >= :since and method is distinct from 'invite'"
                        " and method is distinct from 'qr'"
                    ),
                    {"u": m.user_id, "since": await _local_day_start(session, m, now)},
                )
            ).scalar_one()
            if int(sent) >= per_day:
                raise ApiError(429, "request_limit_reached", "That's enough requests for today")
        await _check_friend_cap(session, flags, m.user_id)
        await session.execute(
            text(
                "insert into social.friendships (user_a, user_b, status, requested_by, method)"
                " values (:a, :b, 'pending', :r, :m)"
            ),
            {"a": lo, "b": hi, "r": m.user_id, "m": body.source},
        )
        await sp.push(
            session,
            to=target,
            kind="friend_request",
            sender=m.user_id,
            flags=flags,
            dedupe_key=f"friend_request:{lo}:{hi}:{now.date()}",
        )
        return so.RequestOut(user_id=target, status="pending")


def _expired(created_at: datetime, flags: Flags, now: datetime) -> bool:
    ttl = flags.int_or_none("social.friend_request_ttl_days")
    return ttl is not None and created_at + timedelta(days=ttl) < now


async def answer_request(
    db: Database, auth: AuthContext, requester: uuid.UUID, accept: bool
) -> so.RequestOut | None:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "friends")
        rel = await sp.relation(session, m.user_id, requester)
        lo, hi = sp.pair(m.user_id, requester)
        if (
            rel is None
            or rel.status != "pending"
            or rel.requested_by != requester
            or _expired(rel.created_at, flags, now)
        ):
            if rel is not None and rel.status == "pending" and _expired(rel.created_at, flags, now):
                await session.execute(
                    text("delete from social.friendships where user_a = :a and user_b = :b"),
                    {"a": lo, "b": hi},
                )
            raise not_found("request_not_found", "This request isn't there any more")
        if not accept:
            # Declined silently: the sender is not told (B5).
            await session.execute(
                text("delete from social.friendships where user_a = :a and user_b = :b"),
                {"a": lo, "b": hi},
            )
            return None
        await _check_friend_cap(session, flags, m.user_id, requester)
        await session.execute(
            text(
                "update social.friendships set status = 'accepted', accepted_at = :t"
                " where user_a = :a and user_b = :b"
            ),
            {"t": now, "a": lo, "b": hi},
        )
        await sp.push(
            session,
            to=requester,
            kind="friend_accepted",
            sender=m.user_id,
            flags=flags,
            dedupe_key=f"friend_accepted:{lo}:{hi}",
        )
        return so.RequestOut(user_id=requester, status="accepted")


async def end_pair(session: AsyncSession, a: uuid.UUID, b: uuid.UUID, by: uuid.UUID) -> None:
    """Removing or blocking a friend ends their Duo and any open duel invite (B8, B11)."""
    now = datetime.now(UTC)
    await session.execute(
        text(
            "update social.duos set status = 'ended', ended_at = :t, ended_by = :by"
            " where status <> 'ended' and least(user_a, user_b) = least(cast(:a as uuid), cast(:b as uuid))"
            " and greatest(user_a, user_b) = greatest(cast(:a as uuid), cast(:b as uuid))"
        ),
        {"t": now, "by": by, "a": a, "b": b},
    )
    await session.execute(
        text(
            "update social.duels set status = 'declined', finished_at = :t where status = 'pending'"
            " and ((challenger_id = :a and opponent_id = :b) or (challenger_id = :b and opponent_id = :a))"
        ),
        {"t": now, "a": a, "b": b},
    )


async def remove_friend(db: Database, auth: AuthContext, other: uuid.UUID) -> None:
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "friends")
        lo, hi = sp.pair(m.user_id, other)
        await session.execute(
            text(
                "delete from social.friendships where user_a = :a and user_b = :b"
                " and status in ('accepted', 'pending')"
            ),
            {"a": lo, "b": hi},
        )
        await end_pair(session, m.user_id, other, m.user_id)


# --- lists --------------------------------------------------------------------------------------


async def _friend_rows(
    session: AsyncSession,
    m: sp.Member,
    flags: Flags,
    now: datetime,
    only: Sequence[uuid.UUID] | None = None,
) -> list[so.FriendRow]:
    rows = (
        await session.execute(
            text(
                "select case when user_a = :u then user_b else user_a end as other, accepted_at"
                " from social.friendships where status = 'accepted' and :u in (user_a, user_b)"
            ),
            {"u": m.user_id},
        )
    ).all()
    since = {r.other: r.accepted_at for r in rows if only is None or r.other in only}
    shown = await sp.people(session, m, since, flags)
    today = await sp.studied_today(session, since, now)
    streak = await sp.streaks(session, since)
    duos = {
        r.other: r.id
        for r in (
            await session.execute(
                text(
                    "select id, case when user_a = :u then user_b else user_a end as other"
                    " from social.duos where status <> 'ended' and :u in (user_a, user_b)"
                ),
                {"u": m.user_id},
            )
        ).all()
    }
    out = [
        so.FriendRow(
            person=shown[uid],
            since=at,
            streak=streak.get(uid, 0),
            studied_today=today.get(uid, False),
            duo_id=duos.get(uid),
        )
        for uid, at in since.items()
        if shown[uid].user_id is not None
    ]
    # Today's activity first, then streak (B5).
    out.sort(key=lambda f: (not f.studied_today, -f.streak, f.person.name.text or ""))
    return out


async def friends(db: Database, auth: AuthContext) -> list[so.FriendRow]:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "friends")
        return await _friend_rows(session, m, flags, now)


async def friend_rows(
    session: AsyncSession, m: sp.Member, flags: Flags, now: datetime
) -> list[so.FriendRow]:
    return await _friend_rows(session, m, flags, now)


async def inbox_items(
    session: AsyncSession, m: sp.Member, flags: Flags, now: datetime
) -> tuple[list[so.InboxItem], int]:
    seen = (
        await session.execute(
            text("select inbox_seen_at from social.members where user_id = :u"), {"u": m.user_id}
        )
    ).scalar_one_or_none()
    raw: list[tuple[str, str, uuid.UUID, str | None, datetime]] = []
    for r in (
        await session.execute(
            text(
                "select requested_by, created_at from social.friendships where status = 'pending'"
                " and :u in (user_a, user_b) and requested_by <> :u"
            ),
            {"u": m.user_id},
        )
    ).all():
        if not _expired(r.created_at, flags, now):
            raw.append(("friend_request", str(r.requested_by), r.requested_by, None, r.created_at))
    for r in (
        await session.execute(
            text(
                "select id, invited_by, invited_at from social.duos where status = 'invited'"
                " and :u in (user_a, user_b) and invited_by <> :u"
            ),
            {"u": m.user_id},
        )
    ).all():
        raw.append(("duo_invite", str(r.id), r.invited_by, None, r.invited_at))
    for r in (
        await session.execute(
            text(
                "select id, challenger_id, created_at from social.duels where status = 'pending'"
                " and opponent_id = :u and (expires_at is null or expires_at > :now)"
            ),
            {"u": m.user_id, "now": now},
        )
    ).all():
        raw.append(("duel_challenge", str(r.id), r.challenger_id, None, r.created_at))
    for r in (
        await session.execute(
            text(
                "select id, from_user, kind, preset_id, created_at from social.nudges"
                " where to_user = :u and kind in ('cheer', 'nudge') and created_at > :since"
                " order by created_at desc limit 100"
            ),
            {"u": m.user_id, "since": now - timedelta(days=7)},
        )
    ).all():
        raw.append((r.kind, str(r.id), r.from_user, r.preset_id, r.created_at))
    shown = await sp.people(session, m, [x[2] for x in raw], flags)
    items = [
        so.InboxItem(
            kind=kind,
            id=ident,
            sender=shown[sender],
            preset_id=preset,
            created_at=at,
            unread=seen is None or at > seen,
        )
        for kind, ident, sender, preset, at in raw
        if shown[sender].user_id is not None
    ]
    items.sort(key=lambda i: i.created_at, reverse=True)
    return items, sum(1 for i in items if i.unread)


async def inbox(db: Database, auth: AuthContext) -> so.Inbox:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "friends")
        items, unread = await inbox_items(session, m, flags, now)
    return so.Inbox(items=items, unread=unread)


async def inbox_seen(db: Database, auth: AuthContext) -> None:
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "friends")
        await _member_row(session, m.user_id)
        await session.execute(
            text("update social.members set inbox_seen_at = now() where user_id = :u"),
            {"u": m.user_id},
        )


async def profile(db: Database, auth: AuthContext, user_id: uuid.UUID) -> so.MiniProfile:
    """SOC-07 mini profile: pet, tier and streak, never more (DB_SCHEMA §12 friend profile view)."""
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags)
        shown = await sp.person(session, m, user_id, flags)
        if shown.user_id is None:
            raise not_found("user_not_found", "This profile isn't available")
        rel = await sp.relation(session, m.user_id, user_id)
        tier = (
            await session.execute(
                text("select tier from game.league_players where user_id = :u"), {"u": user_id}
            )
        ).scalar_one_or_none()
        streak = (await sp.streaks(session, [user_id])).get(user_id)
        return so.MiniProfile(
            person=shown,
            tier=int(tier) if tier is not None else None,
            streak=streak,
            is_friend=rel is not None and rel.status == "accepted",
            request_pending=rel is not None and rel.status == "pending",
        )


# --- presets, reactions and the feed ------------------------------------------------------------


async def send_preset(
    session: AsyncSession,
    m: sp.Member,
    flags: Flags,
    *,
    to: uuid.UUID,
    kind: str,
    preset_id: str,
    now: datetime,
    limit_keys: Sequence[str],
    push_kind: str,
) -> so.Sent:
    if to == m.user_id:
        raise ApiError(409, "own_account", "That's you")
    since = await _local_day_start(session, m, now)
    sent_today = int(
        (
            await session.execute(
                text(
                    "select count(*) from social.nudges where from_user = :f and to_user = :t"
                    " and kind = :k and created_at >= :since"
                ),
                {"f": m.user_id, "t": to, "k": kind, "since": since},
            )
        ).scalar_one()
    )
    for key in limit_keys:
        cap = flags.int_or_none(key)
        if cap is not None and sent_today >= cap:
            raise ApiError(429, "preset_limit_reached", "That's enough for today", limit=cap)
    nudge_id = (
        await session.execute(
            text(
                "insert into social.nudges (from_user, to_user, kind, preset_id)"
                " values (:f, :t, :k, :p) returning id"
            ),
            {"f": m.user_id, "t": to, "k": kind, "p": preset_id},
        )
    ).scalar_one()
    queued = await sp.push(
        session,
        to=to,
        kind=push_kind,
        sender=m.user_id,
        flags=flags,
        dedupe_key=f"{push_kind}:{nudge_id}",
    )
    return so.Sent(sent=True, queued_push=queued)


async def nudge(db: Database, auth: AuthContext, body: so.NudgeIn) -> so.Sent:
    """Cheers go to friends; nudges go to a Duo partner who hasn't counted today (B8, B11)."""
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "cheer")
        if not preset_ok(body.kind, body.preset_id):
            raise ApiError(422, "unknown_preset", "Pick one of the messages")
        if not await sp.are_friends(session, m.user_id, body.to_user_id):
            raise not_found("friend_not_found", "You can send this to friends only")
        if body.kind == "cheer":
            return await send_preset(
                session,
                m,
                flags,
                to=body.to_user_id,
                kind="cheer",
                preset_id=body.preset_id,
                now=now,
                limit_keys=("social.cheers_per_friend_per_day",),
                push_kind="friend_cheer",
            )
        return await duo_nudge(session, m, flags, body.to_user_id, body.preset_id, now)


async def duo_nudge(
    session: AsyncSession,
    m: sp.Member,
    flags: Flags,
    partner: uuid.UUID,
    preset_id: str,
    now: datetime,
) -> so.Sent:
    if not preset_ok("nudge", preset_id):
        raise ApiError(422, "unknown_preset", "Pick one of the messages")
    duo = (
        await session.execute(
            text(
                "select id from social.duos where status = 'active'"
                " and least(user_a, user_b) = least(cast(:a as uuid), cast(:b as uuid))"
                " and greatest(user_a, user_b) = greatest(cast(:a as uuid), cast(:b as uuid))"
            ),
            {"a": m.user_id, "b": partner},
        )
    ).scalar_one_or_none()
    if duo is None:
        raise not_found("duo_not_found", "Nudges are for Duo partners")
    if (await sp.studied_today(session, [partner], now)).get(partner):
        raise ApiError(409, "partner_counted_today", "Your partner has already studied today")
    return await send_preset(
        session,
        m,
        flags,
        to=partner,
        kind="nudge",
        preset_id=preset_id,
        now=now,
        limit_keys=("social.nudges_per_friend_per_day", "social.duo_nudges_per_day"),
        push_kind="duo_nudge",
    )


async def _materialise_activity(
    session: AsyncSession, ids: Sequence[uuid.UUID], flags: Flags, now: datetime
) -> None:
    """Friend activity comes from what the server already has (B11, G-S2): badges earned and
    streak milestones. League promotions and Duo milestones are written where they happen."""
    if not ids:
        return
    since = now - timedelta(days=FEED_DAYS)
    await session.execute(
        text(
            "insert into social.activity_items (user_id, kind, ref, created_at)"
            " select user_id, 'badge_earned', badge_id, earned_at from game.user_badges"
            " where user_id = any(:ids) and earned_at > :since on conflict do nothing"
        ),
        {"ids": list(ids), "since": since},
    )
    milestones = [
        int(x) for x in (flags.get("share.streak_milestones") or []) if isinstance(x, int)
    ]
    if milestones:
        await session.execute(
            text(
                "insert into social.activity_items (user_id, kind, ref, created_at)"
                " select user_id, 'streak_milestone', current_streak || ':' || streak_last_day, :now"
                " from game.user_stats where user_id = any(:ids) and current_streak = any(:ms)"
                " and streak_last_day >= cast(:since as date) on conflict do nothing"
            ),
            {"ids": list(ids), "ms": milestones, "now": now, "since": since.date()},
        )


async def feed(db: Database, auth: AuthContext) -> list[so.FeedItem]:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "friends")
        ids = [m.user_id, *await sp.friend_ids(session, m.user_id)]
        await _materialise_activity(session, ids, flags, now)
        rows = (
            await session.execute(
                text(
                    """
                    select i.id, i.user_id, i.kind, i.ref, i.created_at,
                           coalesce(jsonb_object_agg(r.reaction, r.n) filter (where r.reaction is not null), '{}') as counts,
                           (select reaction from social.reactions x where x.item_id = i.id and x.user_id = :me) as mine
                      from social.activity_items i
                      left join (select item_id, reaction, count(*) as n from social.reactions group by 1, 2) r
                        on r.item_id = i.id
                     where i.user_id = any(:ids) and i.created_at > :since
                     group by i.id
                     order by i.created_at desc
                     limit 50
                    """
                ),
                {"ids": ids, "me": m.user_id, "since": now - timedelta(days=FEED_DAYS)},
            )
        ).all()
        shown = await sp.people(session, m, [r.user_id for r in rows], flags)
        return [
            so.FeedItem(
                id=r.id,
                person=shown[r.user_id],
                kind=r.kind,
                ref=r.ref,
                created_at=r.created_at,
                reactions={k: int(v) for k, v in dict(r.counts).items()},
                mine=r.mine,
            )
            for r in rows
            if shown[r.user_id].user_id is not None
        ]


async def react(db: Database, auth: AuthContext, body: so.ReactionIn) -> None:
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "friends")
        owner = (
            await session.execute(
                text("select user_id from social.activity_items where id = :i"), {"i": body.item_id}
            )
        ).scalar_one_or_none()
        if (
            owner is None
            or owner == m.user_id
            or not await sp.are_friends(session, m.user_id, owner)
        ):
            raise not_found("item_not_found", "You can cheer friends' moments only")
        await session.execute(
            text(
                "insert into social.reactions (item_id, user_id, reaction) values (:i, :u, :r)"
                " on conflict (item_id, user_id) do update set reaction = excluded.reaction"
            ),
            {"i": body.item_id, "u": m.user_id, "r": body.reaction},
        )


async def unreact(db: Database, auth: AuthContext, item_id: uuid.UUID) -> None:
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "friends")
        await session.execute(
            text("delete from social.reactions where item_id = :i and user_id = :u"),
            {"i": item_id, "u": m.user_id},
        )


# --- report and block ---------------------------------------------------------------------------


async def report(db: Database, auth: AuthContext, body: so.ReportIn) -> so.ReportOut:
    """SOC-23. The note is for the moderation team only and only from adults; it is stored on the
    report and never logged or sent to analytics (B11, AGENTS rule 6)."""
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags)
        note = body.note.strip() if body.note and body.note.strip() else None
        if note is not None and not m.is_adult:
            raise ApiError(
                422, "note_not_allowed", "Pick a reason; a grown-up you trust can help too"
            )
        deck_id = None
        if body.target_kind == "person":
            if body.user_id is None or body.reason not in PERSON_REASONS:
                raise ApiError(422, "invalid_report", "Pick a reason for this person")
            exists = (
                await session.execute(
                    text("select 1 from app.profiles where user_id = :u"), {"u": body.user_id}
                )
            ).first()
            if exists is None or body.user_id == m.user_id:
                raise not_found("user_not_found", "No one to report")
        else:
            if body.deck_code is None or body.reason not in DECK_REASONS:
                raise ApiError(422, "invalid_report", "Pick a reason for this deck")
            deck_id = (
                await session.execute(
                    text("select id from learn.decks where share_code = :c"), {"c": body.deck_code}
                )
            ).scalar_one_or_none()
            if deck_id is None:
                raise not_found("deck_not_found", "No such shared deck")
        row = (
            await session.execute(
                text(
                    "insert into social.user_reports (reporter_id, target_kind, target_id, deck_id, reason, note)"
                    " values (:r, :k, :t, :d, :reason, :n) returning id, status"
                ),
                {
                    "r": m.user_id,
                    "k": body.target_kind,
                    "t": body.user_id if body.target_kind == "person" else None,
                    "d": deck_id,
                    "reason": body.reason,
                    "n": note,
                },
            )
        ).one()
        return so.ReportOut(id=row.id, status=row.status)


async def block(db: Database, auth: AuthContext, other: uuid.UUID) -> None:
    """Silent (B11): ends the friendship and Duo, stops duel invites, nudges and deck shares, and
    hides each from the other's leagues and boards."""
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags)
        if other == m.user_id:
            raise ApiError(409, "own_account", "That's you")
        exists = (
            await session.execute(text("select 1 from auth.users where id = :u"), {"u": other})
        ).first()
        if exists is None:
            raise not_found("user_not_found", "No one to block")
        lo, hi = sp.pair(m.user_id, other)
        await session.execute(
            text(
                """
                insert into social.friendships (user_a, user_b, status, requested_by)
                values (:a, :b, 'blocked', :me)
                on conflict (user_a, user_b) do update
                  set status = 'blocked', requested_by = excluded.requested_by, accepted_at = null
                  where social.friendships.status <> 'blocked'
                """
            ),
            {"a": lo, "b": hi, "me": m.user_id},
        )
        await end_pair(session, m.user_id, other, m.user_id)


async def unblock(db: Database, auth: AuthContext, other: uuid.UUID) -> None:
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags)
        lo, hi = sp.pair(m.user_id, other)
        await session.execute(
            text(
                "delete from social.friendships where user_a = :a and user_b = :b"
                " and status = 'blocked' and requested_by = :me"
            ),
            {"a": lo, "b": hi, "me": m.user_id},
        )


async def blocks(db: Database, auth: AuthContext) -> list[so.Person]:
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags)
        ids = list(
            (
                await session.execute(
                    text(
                        "select case when user_a = :u then user_b else user_a end"
                        " from social.friendships where status = 'blocked' and requested_by = :u"
                    ),
                    {"u": m.user_id},
                )
            ).scalars()
        )
        shown = await sp.people(session, m, ids, flags, ignore_block=True)
        return [shown[i] for i in ids]
