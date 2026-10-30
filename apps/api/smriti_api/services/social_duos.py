"""Duos: a shared streak with one friend, up to ``social.duo_max_partners`` at once (R32, B8).

A Duo day counts when both partners have a qualifying streak day (one lesson, 10 reviews, a mock
section or the daily challenge, R1), each by their own local midnight (R23). A missed day resets
the Duo streak to 0 unless that partner's freeze or rest day covered it (R28). The streak is
settled lazily for each finished calendar day (on read) and by the nightly ``duo_rollup`` job.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError, not_found
from smriti_api.schemas import social as so
from smriti_api.services import social_friends as sf
from smriti_api.services import social_people as sp
from smriti_api.services.recompute import zone
from smriti_api.services.usage import Flags, load_flags

if TYPE_CHECKING:
    from smriti_api.services.jobs import JobDeps

ENDED_SHOWN_DAYS = 7
DUO_BANDS = (sp.ADULT, sp.TEEN)


def _cap(flags: Flags) -> int:
    return flags.int_or("social.duo_max_partners", 5)


async def _open_count(session: AsyncSession, user_id: uuid.UUID) -> int:
    return int(
        (
            await session.execute(
                text(
                    "select count(*) from social.duos where status <> 'ended'"
                    " and :u in (user_a, user_b)"
                ),
                {"u": user_id},
            )
        ).scalar_one()
    )


async def _days(
    session: AsyncSession, user_id: uuid.UUID, start: date, end: date
) -> dict[date, Any]:
    rows = (
        await session.execute(
            text(
                "select day, qualified, rest_day, freeze_used from learn.activity_days"
                " where user_id = :u and day between :s and :e"
            ),
            {"u": user_id, "s": start, "e": end},
        )
    ).all()
    return {r.day: r for r in rows}


async def _local_today(session: AsyncSession, user_id: uuid.UUID, now: datetime) -> date:
    tz = (
        await session.execute(
            text("select timezone from app.profiles where user_id = :u"), {"u": user_id}
        )
    ).scalar_one_or_none()
    return now.astimezone(zone(tz or "Asia/Kolkata")).date()


async def settle(session: AsyncSession, duo: Any, flags: Flags, now: datetime) -> None:
    """Brings an active Duo's streak up to the last calendar day both partners have finished."""
    if duo.status != "active":
        return
    visible = await sp.socially_visible(session, [duo.user_a, duo.user_b])
    if len(visible) < 2:
        # A withdrawn consent (or a deleted account) ends the Duo; nobody's own streak changes.
        await session.execute(
            text("update social.duos set status = 'ended', ended_at = :t where id = :d"),
            {"t": now, "d": duo.id},
        )
        return
    today_a = await _local_today(session, duo.user_a, now)
    today_b = await _local_today(session, duo.user_b, now)
    last = min(today_a, today_b) - timedelta(days=1)
    started = duo.started_at.astimezone(UTC).date() if duo.started_at else last
    first = (duo.evaluated_through + timedelta(days=1)) if duo.evaluated_through else started
    if first > last:
        return
    days_a = await _days(session, duo.user_a, first, last)
    days_b = await _days(session, duo.user_b, first, last)
    streak, best, both = int(duo.shared_streak), int(duo.best_streak), duo.last_both_active
    milestones = {
        int(x) for x in (flags.get("share.streak_milestones") or []) if isinstance(x, int)
    }
    reached: list[int] = []
    day = first
    while day <= last:
        a, b = days_a.get(day), days_b.get(day)
        qa, qb = bool(a and a.qualified), bool(b and b.qualified)
        ca = qa or bool(a and (a.rest_day or a.freeze_used))
        cb = qb or bool(b and (b.rest_day or b.freeze_used))
        if qa and qb:
            streak += 1
            both = day
            if streak in milestones:
                reached.append(streak)
        elif not (ca and cb):
            streak = 0
        best = max(best, streak)
        day += timedelta(days=1)
    await session.execute(
        text(
            "update social.duos set shared_streak = :s, best_streak = :b, last_both_active = :l,"
            " evaluated_through = :e where id = :d"
        ),
        {"s": streak, "b": best, "l": both, "e": last, "d": duo.id},
    )
    for n in reached:
        for uid in (duo.user_a, duo.user_b):
            await session.execute(
                text(
                    "insert into social.activity_items (user_id, kind, ref) values (:u, 'duo_milestone', :r)"
                    " on conflict do nothing"
                ),
                {"u": uid, "r": f"{duo.id}:{n}"},
            )


_DUO_COLS = (
    "id, user_a, user_b, status, shared_streak, best_streak, last_both_active, started_at,"
    " ended_at, invited_by, invited_at, evaluated_through"
)


async def _mine(session: AsyncSession, user_id: uuid.UUID, now: datetime) -> list[Any]:
    return list(
        (
            await session.execute(
                text(
                    f"select {_DUO_COLS} from social.duos where :u in (user_a, user_b)"  # noqa: S608 - fixed columns
                    " and (status <> 'ended' or ended_at > :since) order by started_at nulls last, invited_at"
                ),
                {"u": user_id, "since": now - timedelta(days=ENDED_SHOWN_DAYS)},
            )
        ).all()
    )


async def _expire_invites(session: AsyncSession, flags: Flags, now: datetime) -> None:
    ttl = flags.int_or_none("social.duo_invite_ttl_days")
    if ttl is not None:
        await session.execute(
            text("delete from social.duos where status = 'invited' and invited_at < :t"),
            {"t": now - timedelta(days=ttl)},
        )


async def duo_rows(
    session: AsyncSession, m: sp.Member, flags: Flags, now: datetime
) -> list[so.DuoOut]:
    await _expire_invites(session, flags, now)
    for duo in await _mine(session, m.user_id, now):
        await settle(session, duo, flags, now)
    rows = await _mine(session, m.user_id, now)
    partners = {r.id: (r.user_b if r.user_a == m.user_id else r.user_a) for r in rows}
    shown = await sp.people(session, m, partners.values(), flags)
    today = await sp.studied_today(session, [m.user_id, *partners.values()], now)
    out = []
    for r in rows:
        partner = partners[r.id]
        if shown[partner].user_id is None:
            continue
        mine_today, theirs = today.get(m.user_id, False), today.get(partner, False)
        live = int(r.shared_streak) + (1 if r.status == "active" and mine_today and theirs else 0)
        out.append(
            so.DuoOut(
                id=r.id,
                partner=shown[partner],
                status=r.status,
                invited_by_me=r.invited_by == m.user_id,
                shared_streak=live,
                best_streak=max(int(r.best_streak), live),
                me_today=mine_today,
                partner_today=theirs,
                started_at=r.started_at,
            )
        )
    return out


async def list_duos(db: Database, auth: AuthContext) -> list[so.DuoOut]:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "duo")
        return await duo_rows(session, m, flags, now)


async def invite(db: Database, auth: AuthContext, body: so.DuoInvite) -> so.DuoInviteResult:
    """Each friend is a separate pair; both need a free slot (B8 "Limits")."""
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "duo")
        cap = _cap(flags)
        failed: list[dict[str, str]] = []
        created: list[uuid.UUID] = []
        bands = {
            r.user_id: r.age_band
            for r in (
                await session.execute(
                    text("select user_id, age_band from app.profiles where user_id = any(:ids)"),
                    {"ids": list(body.friend_ids)},
                )
            ).all()
        }
        visible = await sp.socially_visible(session, body.friend_ids)
        for fid in dict.fromkeys(body.friend_ids):
            if await _open_count(session, m.user_id) >= cap:
                failed.append({"user_id": str(fid), "code": "duo_cap_reached"})
                continue
            if (
                not await sp.are_friends(session, m.user_id, fid)
                or fid not in visible
                or bands.get(fid) not in DUO_BANDS
            ):
                failed.append({"user_id": str(fid), "code": "not_available"})
                continue
            if await _open_count(session, fid) >= cap:
                failed.append({"user_id": str(fid), "code": "partner_cap_reached"})
                continue
            try:
                async with session.begin_nested():
                    duo_id = (
                        await session.execute(
                            text(
                                "insert into social.duos (user_a, user_b, status, invited_by, invited_at)"
                                " values (:a, :b, 'invited', :me, :t) returning id"
                            ),
                            {"a": m.user_id, "b": fid, "me": m.user_id, "t": now},
                        )
                    ).scalar_one()
            except DBAPIError:
                failed.append({"user_id": str(fid), "code": "duo_exists"})
                continue
            created.append(duo_id)
            await sp.push(
                session,
                to=fid,
                kind="duo_invite",
                sender=m.user_id,
                flags=flags,
                dedupe_key=f"duo_invite:{duo_id}",
            )
        rows = [d for d in await duo_rows(session, m, flags, now) if d.id in created]
        return so.DuoInviteResult(
            invited=rows, failed=failed, used=await _open_count(session, m.user_id), max=cap
        )


async def _load(session: AsyncSession, duo_id: uuid.UUID, user_id: uuid.UUID) -> Any:
    row = (
        await session.execute(
            text(f"select {_DUO_COLS} from social.duos where id = :d and :u in (user_a, user_b)"),  # noqa: S608 - fixed columns
            {"d": duo_id, "u": user_id},
        )
    ).one_or_none()
    if row is None:
        raise not_found("duo_not_found", "No such Duo")
    return row


async def respond(
    db: Database, auth: AuthContext, duo_id: uuid.UUID, accept: bool
) -> so.DuoOut | None:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "duo")
        await _expire_invites(session, flags, now)
        duo = await _load(session, duo_id, m.user_id)
        if duo.status != "invited" or duo.invited_by == m.user_id:
            raise ApiError(409, "duo_not_invited", "There's no Duo invite to answer")
        if not accept:
            # "Not now" is silent (B8).
            await session.execute(text("delete from social.duos where id = :d"), {"d": duo_id})
            return None
        cap = _cap(flags)
        for uid in (duo.user_a, duo.user_b):
            if await _open_count(session, uid) > cap:
                raise ApiError(409, "duo_cap_reached", "No free Duo slot now", max=cap)
        try:
            async with session.begin_nested():
                await session.execute(
                    text("update social.duos set status = 'active', started_at = :t where id = :d"),
                    {"t": now, "d": duo_id},
                )
        except DBAPIError as exc:
            raise ApiError(409, "duo_cap_reached", "No free Duo slot now", max=cap) from exc
        rows = await duo_rows(session, m, flags, now)
        return next(r for r in rows if r.id == duo_id)


async def end(db: Database, auth: AuthContext, duo_id: uuid.UUID) -> None:
    """Either partner can end it, with no blame; a student's own streak never changes (B8)."""
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "duo")
        duo = await _load(session, duo_id, m.user_id)
        if duo.status == "invited":
            await session.execute(text("delete from social.duos where id = :d"), {"d": duo_id})
            return
        await session.execute(
            text(
                "update social.duos set status = 'ended', ended_at = now(), ended_by = :u"
                " where id = :d and status <> 'ended'"
            ),
            {"u": m.user_id, "d": duo_id},
        )


async def nudge(db: Database, auth: AuthContext, duo_id: uuid.UUID, preset_id: str) -> so.Sent:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "duo")
        duo = await _load(session, duo_id, m.user_id)
        partner = duo.user_b if duo.user_a == m.user_id else duo.user_a
        return await sf.duo_nudge(session, m, flags, partner, preset_id, now)


async def rollup(db: Database, now: datetime | None = None) -> int:
    """Nightly: settles every active Duo (so a streak resets even if neither partner opens it)."""
    now = now or datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        duos = (
            await session.execute(
                text(f"select {_DUO_COLS} from social.duos where status = 'active'")  # noqa: S608 - fixed SQL fragments, values are bound
            )
        ).all()
    for duo in duos:
        async with db.system_tx() as session:
            await settle(session, duo, flags, now)
    return len(duos)


async def rollup_job(deps: JobDeps) -> int:
    return await rollup(deps.db)
