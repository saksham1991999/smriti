"""Weekly leagues and leaderboards (tutor-social B6, B7; R30, R31).

- The week runs Monday 00:00 to Sunday ``league.close_time`` IST for everyone (TRD §10). The
  ``close_time`` minute is the last one that counts.
- Adults are in leagues once signed in (with an opt-out); teens (13-17, with the ``social``
  consent scope) join by choice. Nobody under 13 has leagues; class 1-5 has no social at all.
- A student enters a cohort on their first XP of the week (lazily on read, and by the hourly
  ``league_assign`` job), in groups of ``league.group_size`` within one exam group (the primary
  exam), at their current tier. New students start at tier 1.
- League XP is the week's ``game.xp_ledger`` total, without XP from duels flagged for too-fast
  answers (A36). The same rule applies to every leaderboard.
- The ``league_rollover`` job closes each finished week: it ranks every cohort, promotes the top
  ``league.promote_count`` (not from the top tier) and demotes the bottom ``league.demote_count``
  (not from tier 1), records the best week and queues the result pushes through ``notify``.
- Tier names come from ``league.tier_names`` (EN and HI) so the owner can rename them.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Mapping
from datetime import UTC, date, datetime, time, timedelta
from typing import TYPE_CHECKING, Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError, not_found
from smriti_api.schemas import social as so
from smriti_api.services import game_ops
from smriti_api.services import social_friends as sf
from smriti_api.services import social_people as sp
from smriti_api.services.usage import Flags, load_flags

if TYPE_CHECKING:
    from smriti_api.services.jobs import JobDeps

log = structlog.get_logger(__name__)

TOP_TIER = 10
LEAGUE_BANDS = (sp.ADULT, sp.TEEN)
BOARD_LIMIT = 100
DEFAULT_GROUP = "general"
EPOCH = datetime(2020, 1, 1, tzinfo=UTC)

# League and board XP: the ledger without XP from duels flagged for too-fast answers (A36).
_COUNTED_XP = """
    not (l.source = 'duel' and exists (
          select 1 from social.duel_players dp
           where dp.user_id = l.user_id and dp.flagged_fast
             and l.ref = 'duel:' || dp.duel_id::text))
"""


# --- the week -------------------------------------------------------------------------------------


def week_start(now: datetime) -> date:
    local = now.astimezone(sp.IST).date()
    return local - timedelta(days=local.weekday())


def week_opens(start: date) -> datetime:
    return datetime.combine(start, time(0, 0), tzinfo=sp.IST).astimezone(UTC)


def closes_at(start: date, flags: Flags) -> datetime:
    """Sunday at ``league.close_time`` IST; that minute still counts."""
    raw = flags.get("league.close_time")
    hh, mm = 23, 59
    if isinstance(raw, str) and ":" in raw:
        h, m = raw.split(":", 1)
        if h.isdigit() and m.isdigit():
            hh, mm = int(h), int(m)
    sunday = start + timedelta(days=6)
    close = datetime.combine(sunday, time(hh, mm), tzinfo=sp.IST) + timedelta(minutes=1)
    return close.astimezone(UTC)


def tier_name(flags: Flags, tier: int) -> so.TierName:
    names = flags.get("league.tier_names")
    if isinstance(names, list) and 1 <= tier <= len(names) and isinstance(names[tier - 1], Mapping):
        entry = names[tier - 1]
        en = str(entry.get("en") or tier)
        return so.TierName(en=en, hi=str(entry.get("hi") or en))
    return so.TierName(en=str(tier), hi=str(tier))


def _counts(flags: Flags) -> tuple[int, int, int]:
    return (
        flags.int_or("league.group_size", 30),
        flags.int_or("league.promote_count", 7),
        flags.int_or("league.demote_count", 5),
    )


def zones(n: int, tier: int, promote: int, demote: int) -> dict[int, str]:
    """Rank -> zone for a cohort of ``n``: the top tier has no promotion, tier 1 no demotion, and
    a small cohort never puts one rank in both zones."""
    p = min(promote, n) if tier < TOP_TIER else 0
    first_demoted = max(p + 1, n - demote + 1) if tier > 1 else n + 1
    return {
        rank: ("promote" if rank <= p else "demote" if rank >= first_demoted else "safe")
        for rank in range(1, n + 1)
    }


# --- XP -------------------------------------------------------------------------------------------


async def counted_xp(
    session: AsyncSession, ids: Iterable[uuid.UUID], lo: datetime, hi: datetime
) -> dict[uuid.UUID, int]:
    wanted = list(set(ids))
    if not wanted:
        return {}
    rows = (
        await session.execute(
            text(
                "select l.user_id, coalesce(sum(l.amount), 0) as xp from game.xp_ledger l"  # noqa: S608 - fixed SQL fragments, values are bound
                " where l.user_id = any(:ids) and l.occurred_at >= :lo and l.occurred_at < :hi"
                f" and {_COUNTED_XP} group by l.user_id"
            ),
            {"ids": wanted, "lo": lo, "hi": hi},
        )
    ).all()
    out = {u: 0 for u in wanted}
    out.update({r.user_id: int(r.xp) for r in rows})
    return out


# --- who is in ------------------------------------------------------------------------------------


async def _league_player(session: AsyncSession, user_id: uuid.UUID) -> Any:
    await session.execute(
        text("insert into game.league_players (user_id) values (:u) on conflict do nothing"),
        {"u": user_id},
    )
    return (
        await session.execute(
            text("select * from game.league_players where user_id = :u"), {"u": user_id}
        )
    ).one()


def eligibility(m: sp.Member, member_row: Any, now: datetime) -> str:
    """``eligible``, or the League state that explains why not (B6 "Joining", "Opt out")."""
    if m.age_band not in LEAGUE_BANDS:
        return "not_available"
    if m.league_opt_out:
        return "opted_out"
    joined = member_row.league_joined_at
    if m.age_band == sp.TEEN and joined is None:
        return "join_available"
    if joined is not None and joined > now:
        return "opted_out"  # turned back on; back from next week
    return "eligible"


async def _my_cohort(session: AsyncSession, user_id: uuid.UUID, start: date) -> Any:
    return (
        await session.execute(
            text(
                "select c.id, c.tier, c.exam_group, c.status from game.league_members m"
                " join game.league_cohorts c on c.id = m.cohort_id"
                " where m.user_id = :u and c.week_start = :w"
            ),
            {"u": user_id, "w": start},
        )
    ).one_or_none()


async def assign(session: AsyncSession, m: sp.Member, flags: Flags, start: date, tier: int) -> Any:
    """Put the student in an open cohort of their exam group and tier for the week, filling the
    fullest cohort that still has room. Serialised per (week, exam group, tier)."""
    group = m.primary_exam or DEFAULT_GROUP
    size, _, _ = _counts(flags)
    await session.execute(
        text("select pg_advisory_xact_lock(hashtext(:k))"),
        {"k": f"league:{start.isoformat()}:{group}:{tier}"},
    )
    existing = await _my_cohort(session, m.user_id, start)
    if existing is not None:
        return existing
    cohort = (
        await session.execute(
            text(
                "select c.id from game.league_cohorts c"
                " where c.week_start = :w and c.exam_group = :g and c.tier = :t and c.status = 'open'"
                " and (select count(*) from game.league_members x where x.cohort_id = c.id) < :size"
                " order by (select count(*) from game.league_members x where x.cohort_id = c.id) desc,"
                " c.id limit 1"
            ),
            {"w": start, "g": group, "t": tier, "size": size},
        )
    ).scalar_one_or_none()
    if cohort is None:
        cohort = (
            await session.execute(
                text(
                    "insert into game.league_cohorts (week_start, tier, exam_group, status)"
                    " values (:w, :t, :g, 'open') returning id"
                ),
                {"w": start, "t": tier, "g": group},
            )
        ).scalar_one()
    await session.execute(
        text(
            "insert into game.league_members (cohort_id, user_id) values (:c, :u)"
            " on conflict do nothing"
        ),
        {"c": cohort, "u": m.user_id},
    )
    return await _my_cohort(session, m.user_id, start)


async def _place(
    session: AsyncSession, m: sp.Member, flags: Flags, now: datetime
) -> tuple[str, Any, Any]:
    """(state, cohort row or None, league_players row) for this week, joining on first XP."""
    member_row = await sf._member_row(session, m.user_id)
    player = await _league_player(session, m.user_id)
    start = week_start(now)
    cohort = await _my_cohort(session, m.user_id, start)
    if cohort is not None:
        return "in_cohort", cohort, player
    state = eligibility(m, member_row, now)
    if state != "eligible":
        return state, None, player
    if now >= closes_at(start, flags):
        return "not_joined", None, player
    xp = (await counted_xp(session, [m.user_id], week_opens(start), now))[m.user_id]
    if xp <= 0:
        return "not_joined", None, player
    cohort = await assign(session, m, flags, start, int(player.tier))
    return "in_cohort", cohort, player


async def _ranked(
    session: AsyncSession, cohort_id: uuid.UUID, lo: datetime, hi: datetime
) -> list[tuple[uuid.UUID, int]]:
    members = (
        await session.execute(
            text(
                "select user_id, joined_at from game.league_members where cohort_id = :c"
                " order by joined_at, user_id"
            ),
            {"c": cohort_id},
        )
    ).all()
    xp = await counted_xp(session, [r.user_id for r in members], lo, hi)
    order = {r.user_id: i for i, r in enumerate(members)}
    ranked = sorted(xp.items(), key=lambda kv: (-kv[1], order[kv[0]]))
    return ranked


def _best_week(player: Any) -> dict[str, int | str] | None:
    if player.best_week_start is None:
        return None
    return {
        "xp": int(player.best_week_xp or 0),
        "tier": int(player.best_week_tier or 1),
        "week_start": player.best_week_start.isoformat(),
    }


async def league_view(
    session: AsyncSession, m: sp.Member, flags: Flags, now: datetime
) -> so.League:
    state, cohort, player = await _place(session, m, flags, now)
    start = week_start(now)
    _, promote, demote = _counts(flags)
    tier = int(cohort.tier) if cohort is not None else int(player.tier)
    out = so.League(
        state=state,
        week_start=start,
        closes_at=closes_at(start, flags),
        tier=tier,
        tier_name=tier_name(flags, tier),
        exam_group=cohort.exam_group if cohort is not None else (m.primary_exam or DEFAULT_GROUP),
        promote_count=promote if tier < TOP_TIER else 0,
        demote_count=demote if tier > 1 else 0,
        best_week=_best_week(player),
        updated_at=now,
    )
    if cohort is None:
        return out
    hi = min(now, closes_at(start, flags))
    ranked = await _ranked(session, cohort.id, week_opens(start), hi)
    shown = await sp.people(session, m, [u for u, _ in ranked], flags)
    zone_of = zones(len(ranked), tier, promote, demote)
    for i, (uid, xp) in enumerate(ranked, start=1):
        out.rows.append(so.LeagueRow(rank=i, person=shown[uid], xp=xp, zone=zone_of[i]))
        if uid == m.user_id:
            out.my_xp, out.my_rank = xp, i
    return out


# --- endpoints --------------------------------------------------------------------------------


async def current(db: Database, auth: AuthContext) -> so.League:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "league")
        return await league_view(session, m, flags, now)


async def last_result(db: Database, auth: AuthContext) -> so.LeagueResult:
    """SOC-09 after rollover; ``first_view`` is true once, then the sheet is marked seen."""
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "league")
        player = await _league_player(session, m.user_id)
        if player.last_week_start is None or player.last_result is None:
            raise not_found("no_league_result", "No finished league week yet")
        first = player.result_seen_at is None
        if first:
            await session.execute(
                text("update game.league_players set result_seen_at = now() where user_id = :u"),
                {"u": m.user_id},
            )
        return so.LeagueResult(
            week_start=player.last_week_start,
            result=player.last_result,
            tier_before=int(player.last_tier or player.tier),
            tier_now=int(player.tier),
            tier_name=tier_name(flags, int(player.tier)),
            rank=player.last_rank,
            xp=int(player.last_xp or 0),
            first_view=first,
        )


async def _leave_week(session: AsyncSession, user_id: uuid.UUID, now: datetime) -> None:
    await session.execute(
        text(
            "delete from game.league_members m using game.league_cohorts c"
            " where m.cohort_id = c.id and m.user_id = :u and c.week_start = :w and c.status = 'open'"
        ),
        {"u": user_id, "w": week_start(now)},
    )


async def _turn_on(session: AsyncSession, m: sp.Member, now: datetime) -> None:
    member_row = await sf._member_row(session, m.user_id)
    if m.league_opt_out:
        # Back from next week (B6 "Join again next week").
        await session.execute(
            text("update app.profiles set league_opt_out = false where user_id = :u"),
            {"u": m.user_id},
        )
        await session.execute(
            text("update social.members set league_joined_at = :t where user_id = :u"),
            {"t": week_opens(week_start(now) + timedelta(days=7)), "u": m.user_id},
        )
    elif member_row.league_joined_at is None:
        await session.execute(
            text("update social.members set league_joined_at = :t where user_id = :u"),
            {"t": now, "u": m.user_id},
        )


async def join(db: Database, auth: AuthContext) -> so.League:
    """The teen [Join] card (R30); for anyone on a break it means "join again next week"."""
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "league")
        await _turn_on(session, m, now)
        m = await sp.load_member(session, m.user_id)
        return await league_view(session, m, flags, now)


async def opt_out(db: Database, auth: AuthContext, body: so.OptOutIn) -> so.League:
    """ "Take a break from leagues": leaves this week's cohort at once."""
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "league")
        if body.on:
            await session.execute(
                text("update app.profiles set league_opt_out = true where user_id = :u"),
                {"u": m.user_id},
            )
            await _leave_week(session, m.user_id, now)
        else:
            await _turn_on(session, m, now)
        m = await sp.load_member(session, m.user_id)
        return await league_view(session, m, flags, now)


# --- leaderboards (B7) ------------------------------------------------------------------------


async def _board_people(
    session: AsyncSession,
    m: sp.Member,
    flags: Flags,
    xp: Mapping[uuid.UUID, int],
    *,
    keep_zero: bool,
) -> tuple[list[so.BoardRow], so.BoardRow | None]:
    ids = [
        u for u, v in sorted(xp.items(), key=lambda kv: (-kv[1], str(kv[0]))) if keep_zero or v > 0
    ]
    shown = await sp.people(session, m, ids, flags)
    rows: list[so.BoardRow] = []
    me: so.BoardRow | None = None
    for uid in ids:
        person = shown[uid]
        if person.user_id is None:
            continue  # blocked either way, or a minor without consent: never on a board
        row = so.BoardRow(rank=len(rows) + 1, person=person, xp=xp[uid])
        if len(rows) < BOARD_LIMIT:
            rows.append(row)
        if uid == m.user_id:
            me = row
    return rows, me


async def _candidates(session: AsyncSession, where: str, params: dict[str, Any]) -> list[uuid.UUID]:
    """Adults and teens who passed the gate and haven't opted out, plus a scope filter."""
    rows = (
        await session.execute(
            text(
                "select p.user_id from app.profiles p left join social.members s on s.user_id = p.user_id"  # noqa: S608 - fixed SQL fragments, values are bound
                " where p.age_band in ('18p', '13_17') and p.signed_up_at is not null"
                f" and not p.league_opt_out and {where}"
            ),
            params,
        )
    ).scalars()
    return list(await sp.socially_visible(session, rows))


async def leaderboard(
    db: Database,
    auth: AuthContext,
    scope: str,
    period: str = "week",
    squad_id: uuid.UUID | None = None,
) -> so.Leaderboard:
    now = datetime.now(UTC)
    if period == "all_time" and scope != "all_india":
        raise ApiError(422, "period_not_offered", "Only the all-India board has an all-time view")
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "friends" if scope == "friends" else "league")
        start = week_start(now)
        lo, hi = (EPOCH, now) if period == "all_time" else (week_opens(start), now)
        empty = so.Leaderboard(scope=scope, period=period, rows=[])
        keep_zero = True
        ids: list[uuid.UUID]
        if scope == "friends":
            ids = [m.user_id, *await sp.friend_ids(session, m.user_id)]
        elif scope == "squad":
            params: dict[str, Any] = {"u": m.user_id}
            pick = "and m.squad_id = :s" if squad_id is not None else ""
            if squad_id is not None:
                params["s"] = squad_id
            sq = (
                await session.execute(
                    text(
                        "select m.squad_id from social.squad_members m where m.user_id = :u"  # noqa: S608 - fixed SQL fragments, values are bound
                        f" {pick} order by m.joined_at limit 1"
                    ),
                    params,
                )
            ).scalar_one_or_none()
            if sq is None:
                empty.available, empty.reason = False, "no_squad"
                return empty
            ids = list(
                (
                    await session.execute(
                        text("select user_id from social.squad_members where squad_id = :s"),
                        {"s": sq},
                    )
                ).scalars()
            )
        elif scope in ("school", "city"):
            col, toggle = (
                ("institution_id", "board_school") if scope == "school" else ("city", "board_city")
            )
            mine = (
                await session.execute(
                    text(
                        f"select p.{col} as v, coalesce(s.{toggle}, false) as on_board"  # noqa: S608 - fixed SQL fragments, values are bound
                        " from app.profiles p left join social.members s on s.user_id = p.user_id"
                        " where p.user_id = :u"
                    ),
                    {"u": m.user_id},
                )
            ).one()
            if mine.v is None:
                empty.available, empty.reason = False, f"{scope}_not_set"
                return empty
            if not mine.on_board:
                empty.available, empty.reason = False, "board_off"
                return empty
            ids = await _candidates(
                session, f"p.{col} = :v and coalesce(s.{toggle}, false)", {"v": mine.v}
            )
            keep_zero = False
        else:  # all_india: everyone in the exam group
            if m.primary_exam is None:
                empty.available, empty.reason = False, "exam_not_set"
                return empty
            ids = await _candidates(
                session, "p.primary_exam_profile_id = :e", {"e": m.primary_exam}
            )
            keep_zero = False
        if m.user_id not in ids:
            ids.append(m.user_id)
        xp = await counted_xp(session, ids, lo, hi)
        rows, me = await _board_people(session, m, flags, xp, keep_zero=keep_zero)
        if me is None and xp.get(m.user_id, 0) == 0:
            me = so.BoardRow(
                rank=len(rows) + 1, person=(await sp.person(session, m, m.user_id, flags)), xp=0
            )
        return so.Leaderboard(scope=scope, period=period, rows=rows, me=me)


# --- jobs -------------------------------------------------------------------------------------


async def assign_active(db: Database, now: datetime | None = None) -> int:
    """Hourly: put everyone who earned XP this week into a cohort, even without opening SOC-08."""
    now = now or datetime.now(UTC)
    start = week_start(now)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        if now >= closes_at(start, flags):
            return 0
        ids = list(
            (
                await session.execute(
                    text(
                        "select distinct l.user_id from game.xp_ledger l"
                        " join app.profiles p on p.user_id = l.user_id"
                        " where l.occurred_at >= :lo and l.occurred_at < :hi"
                        " and p.age_band in ('18p', '13_17') and not p.league_opt_out"
                        " and p.signed_up_at is not null and not exists ("
                        "   select 1 from game.league_members m join game.league_cohorts c"
                        "     on c.id = m.cohort_id where m.user_id = l.user_id and c.week_start = :w)"
                    ),
                    {"lo": week_opens(start), "hi": now, "w": start},
                )
            ).scalars()
        )
    placed = 0
    for uid in ids:
        async with db.system_tx() as session:
            m = await sp.load_member(session, uid)
            if await sp.gate_state(session, m) != "ok":
                continue
            state, _, _ = await _place(session, m, flags, now)
            placed += state == "in_cohort"
    return placed


async def _close_cohort(session: AsyncSession, cohort: Any, flags: Flags, now: datetime) -> int:
    start: date = cohort.week_start
    tier = int(cohort.tier)
    _, promote, demote = _counts(flags)
    ranked = await _ranked(session, cohort.id, week_opens(start), closes_at(start, flags))
    zone_of = zones(len(ranked), tier, promote, demote)
    gems = flags.int_or("game.economy.league_promotion_gems", 0)
    for rank, (uid, xp) in enumerate(ranked, start=1):
        zone = zone_of[rank]
        result = {"promote": "promoted", "demote": "demoted"}.get(zone, "stayed")
        new_tier = tier + 1 if result == "promoted" else tier - 1 if result == "demoted" else tier
        await session.execute(
            text(
                "update game.league_members set xp = :x, final_rank = :r, result = :res"
                " where cohort_id = :c and user_id = :u"
            ),
            {"x": xp, "r": rank, "res": result, "c": cohort.id, "u": uid},
        )
        player = await _league_player(session, uid)
        better = player.best_week_xp is None or xp > int(player.best_week_xp)
        await session.execute(
            text(
                "update game.league_players set tier = :t, last_week_start = :w, last_tier = :lt,"
                " last_rank = :r, last_xp = :x, last_result = :res, result_seen_at = null,"
                " best_week_xp = case when :b then :x else best_week_xp end,"
                " best_week_tier = case when :b then :lt else best_week_tier end,"
                " best_week_start = case when :b then :w else best_week_start end,"
                " updated_at = now() where user_id = :u"
            ),
            {
                "t": new_tier,
                "w": start,
                "lt": tier,
                "r": rank,
                "x": xp,
                "res": result,
                "b": better,
                "u": uid,
            },
        )
        member = await sp.load_member(session, uid)
        if result == "promoted":
            await session.execute(
                text(
                    "insert into social.activity_items (user_id, kind, ref, created_at)"
                    " values (:u, 'league_promoted', :ref, :t) on conflict do nothing"
                ),
                {"u": uid, "ref": f"week:{start.isoformat()}:tier:{new_tier}", "t": now},
            )
            if gems > 0:
                await game_ops.add_gems(
                    session, uid, gems, "league_promotion", f"league:{start.isoformat()}"
                )
            name = tier_name(flags, new_tier)
            await sp.push(
                session,
                to=uid,
                kind="league_promoted",
                sender=None,
                flags=flags,
                payload={"tier": name.hi if member.locale == "hi" else name.en},
                dedupe_key=f"league_result:{start.isoformat()}:{uid}",
            )
        else:
            await sp.push(
                session,
                to=uid,
                kind="league_result",
                sender=None,
                flags=flags,
                dedupe_key=f"league_result:{start.isoformat()}:{uid}",
            )
    await session.execute(
        text("update game.league_cohorts set status = 'closed' where id = :c"), {"c": cohort.id}
    )
    return len(ranked)


async def rollover(db: Database, now: datetime | None = None) -> int:
    """Sunday at close time (IST), and safe to re-run: closes every open cohort whose week ended,
    one cohort per transaction."""
    now = now or datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        weeks = list(
            (
                await session.execute(
                    text(
                        "select distinct week_start from game.league_cohorts where status = 'open'"
                    )
                )
            ).scalars()
        )
    due = [w for w in weeks if closes_at(w, flags) <= now]
    if not due:
        return 0
    async with db.system_tx() as session:
        ids = list(
            (
                await session.execute(
                    text(
                        "select id from game.league_cohorts where status = 'open'"
                        " and week_start = any(:w) order by week_start, tier, exam_group"
                    ),
                    {"w": due},
                )
            ).scalars()
        )
    ranked = 0
    for cohort_id in ids:
        async with db.system_tx() as session:
            cohort = (
                await session.execute(
                    text(
                        "select * from game.league_cohorts where id = :c and status = 'open'"
                        " for update skip locked"
                    ),
                    {"c": cohort_id},
                )
            ).one_or_none()
            if cohort is not None:
                ranked += await _close_cohort(session, cohort, flags, now)
    log.info("league_rollover", cohorts=len(ids), players=ranked)
    return ranked


async def assign_job(deps: JobDeps) -> int:
    return await assign_active(deps.db)


async def rollover_job(deps: JobDeps) -> int:
    return await rollover(deps.db)
