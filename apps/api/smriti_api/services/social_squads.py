"""Squads (tutor-social B9): small groups for adults and teens with a weekly cooperative quest.

Names come from the name picker (``social.squad_name_words``, no free text); minors join only by
link or QR, after consent; members see each other by the R31 rules, and a member blocked by
another stays in the squad but shows as hidden to them. There is no chat: members send preset
cheers to the squad.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.auth import AuthContext
from smriti_api.core.db import Database
from smriti_api.core.errors import ApiError, not_found
from smriti_api.schemas import social as so
from smriti_api.services import game_ops, notify
from smriti_api.services import social_friends as sf
from smriti_api.services import social_people as sp
from smriti_api.services.usage import Flags, load_flags

if TYPE_CHECKING:
    from smriti_api.services.jobs import JobDeps


def week_start(now: datetime) -> date:
    """Leagues and squad quests run Monday to Sunday, IST (TRD §10)."""
    local = now.astimezone(sp.IST).date()
    return local - timedelta(days=local.weekday())


def _week_bounds(start: date) -> tuple[datetime, datetime]:
    begin = datetime(start.year, start.month, start.day, tzinfo=sp.IST)
    return begin.astimezone(UTC), (begin + timedelta(days=7)).astimezone(UTC)


def _name(flags: Flags, row: Any, locale: str) -> str:
    return sp.render_name(
        flags,
        "social.squad_name_words",
        "social.squad_name_fallback",
        list(row.name_word_ids or []),
        row.name_number,
        locale,
    )


async def _my_squads(session: AsyncSession, user_id: uuid.UUID) -> list[Any]:
    return list(
        (
            await session.execute(
                text(
                    "select s.*, m.role as my_role,"
                    " (select count(*) from social.squad_members x where x.squad_id = s.id) as n"
                    " from social.squads s join social.squad_members m on m.squad_id = s.id"
                    " where m.user_id = :u order by m.joined_at"
                ),
                {"u": user_id},
            )
        ).all()
    )


async def _week_xp(
    session: AsyncSession, ids: list[uuid.UUID], start: date
) -> dict[uuid.UUID, int]:
    if not ids:
        return {}
    lo, hi = _week_bounds(start)
    rows = (
        await session.execute(
            text(
                "select user_id, coalesce(sum(amount), 0) as xp from game.xp_ledger"
                " where user_id = any(:ids) and occurred_at >= :lo and occurred_at < :hi group by user_id"
            ),
            {"ids": ids, "lo": lo, "hi": hi},
        )
    ).all()
    return {r.user_id: int(r.xp) for r in rows}


async def _quest(
    session: AsyncSession, squad_id: uuid.UUID, members: list[uuid.UUID], now: datetime
) -> so.SquadQuest | None:
    """This week's squad quest from ``game.squad_quests`` (gamification config). The spec is
    ``{"metric": "xp" | "lessons" | "study_days", "target": n}``; progress is the members' sum."""
    start = week_start(now)
    quest = (
        await session.execute(
            text(
                "select id, spec, reward from game.squad_quests where active_from <= :d"
                " and (active_to is null or active_to >= :d) order by active_from desc, id limit 1"
            ),
            {"d": start},
        )
    ).one_or_none()
    if quest is None or not isinstance(quest.spec, dict):
        return None
    metric, target = quest.spec.get("metric"), quest.spec.get("target")
    if metric not in ("xp", "lessons", "study_days") or not isinstance(target, int) or target <= 0:
        return None
    end = start + timedelta(days=6)
    if metric == "xp":
        per = await _week_xp(session, members, start)
    else:
        column = "lessons_completed" if metric == "lessons" else "qualified::int"
        rows = (
            await session.execute(
                text(
                    f"select user_id, coalesce(sum({column}), 0) as v from learn.activity_days"  # noqa: S608 - fixed column
                    " where user_id = any(:ids) and day between :s and :e group by user_id"
                ),
                {"ids": members, "s": start, "e": end},
            )
        ).all()
        per = {r.user_id: int(r.v) for r in rows}
    progress = sum(per.values())
    contributors = [u for u, v in per.items() if v > 0]
    row = (
        await session.execute(
            text(
                """
                insert into game.squad_quest_progress (squad_id, quest_id, week_start, progress, target, contributors)
                values (:s, :q, :w, :p, :t, cast(:c as uuid[]))
                on conflict (squad_id, quest_id, week_start) do update
                  set progress = excluded.progress, contributors = excluded.contributors
                returning completed_at
                """
            ),
            {
                "s": squad_id,
                "q": quest.id,
                "w": start,
                "p": progress,
                "t": target,
                "c": contributors,
            },
        )
    ).one()
    completed = row.completed_at is not None
    if progress >= target and not completed:
        await session.execute(
            text(
                "update game.squad_quest_progress set completed_at = now()"
                " where squad_id = :s and quest_id = :q and week_start = :w and completed_at is null"
            ),
            {"s": squad_id, "q": quest.id, "w": start},
        )
        gems = quest.reward.get("gems") if isinstance(quest.reward, dict) else None
        for uid in contributors:
            if isinstance(gems, int) and gems > 0:
                await game_ops.add_gems(session, uid, gems, "squad_quest", f"{squad_id}:{start}")
            await notify.enqueue(
                session,
                user_id=uid,
                kind="squad_quest_done",
                payload={},
                dedupe_key=f"squad_quest_done:{squad_id}:{start}:{uid}",
            )
        completed = True
    return so.SquadQuest(quest_id=quest.id, target=target, progress=progress, completed=completed)


async def _out(
    session: AsyncSession,
    m: sp.Member,
    flags: Flags,
    row: Any,
    now: datetime,
    *,
    detail: bool,
) -> so.SquadOut:
    members: list[so.SquadMember] = []
    quest = None
    if detail:
        rows = (
            await session.execute(
                text(
                    "select user_id, role from social.squad_members where squad_id = :s order by joined_at"
                ),
                {"s": row.id},
            )
        ).all()
        ids = [r.user_id for r in rows]
        shown = await sp.people(session, m, ids, flags)
        today = await sp.studied_today(session, ids, now)
        xp = await _week_xp(session, ids, week_start(now))
        members = [
            so.SquadMember(
                person=shown[r.user_id],
                role=r.role,
                studied_today=today.get(r.user_id, False) if shown[r.user_id].user_id else False,
                week_xp=xp.get(r.user_id, 0) if shown[r.user_id].user_id else 0,
            )
            for r in rows
        ]
        members.sort(key=lambda x: -x.week_xp)
        quest = await _quest(session, row.id, ids, now)
    can_manage = row.my_role in ("owner", "admin")
    return so.SquadOut(
        id=row.id,
        name=_name(flags, row, m.locale),
        crest_id=row.crest_id,
        exam_profile_id=row.exam_profile_id,
        invite_code=row.invite_code if row.my_role else None,
        my_role=row.my_role if can_manage or row.my_role == "member" else None,
        members=members,
        member_count=int(row.n),
        max_members=int(row.max_members),
        quest=quest,
    )


async def squad_rows(
    session: AsyncSession, m: sp.Member, flags: Flags, now: datetime
) -> list[so.SquadOut]:
    return [
        await _out(session, m, flags, r, now, detail=False)
        for r in await _my_squads(session, m.user_id)
    ]


async def list_squads(db: Database, auth: AuthContext) -> list[so.SquadOut]:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "squad")
        return await squad_rows(session, m, flags, now)


async def _check_squad_limit(session: AsyncSession, flags: Flags, user_id: uuid.UUID) -> None:
    cap = flags.int_or_none("social.squads_per_user")
    if cap is None:
        return
    n = (
        await session.execute(
            text("select count(*) from social.squad_members where user_id = :u"), {"u": user_id}
        )
    ).scalar_one()
    if int(n) >= cap:
        raise ApiError(409, "squad_limit_reached", "You're in the most squads for now", max=cap)


async def _new_invite_code(session: AsyncSession) -> str:
    for _ in range(10):
        code = sp.new_code(8)
        taken = (
            await session.execute(
                text("select 1 from social.squads where invite_code = :c"), {"c": code}
            )
        ).first()
        if not taken:
            return code
    raise ApiError(500, "invite_code_failed", "Could not make an invite code")


async def _load(session: AsyncSession, squad_id: uuid.UUID, user_id: uuid.UUID) -> Any:
    row = (
        await session.execute(
            text(
                "select s.*, m.role as my_role,"
                " (select count(*) from social.squad_members x where x.squad_id = s.id) as n"
                " from social.squads s left join social.squad_members m"
                "   on m.squad_id = s.id and m.user_id = :u where s.id = :s"
            ),
            {"s": squad_id, "u": user_id},
        )
    ).one_or_none()
    if row is None or row.my_role is None:
        raise not_found("squad_not_found", "No such squad")
    return row


async def create(db: Database, auth: AuthContext, body: so.SquadCreate) -> so.SquadOut:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "squad")
        existing = (
            await session.execute(
                text("select owner_id from social.squads where id = :s"), {"s": body.squad_id}
            )
        ).one_or_none()
        if existing is not None:
            if existing.owner_id != m.user_id:
                raise ApiError(409, "squad_id_taken", "Try again")
            return await _out(
                session, m, flags, await _load(session, body.squad_id, m.user_id), now, detail=True
            )
        await _check_squad_limit(session, flags, m.user_id)
        ids = list(body.name_word_ids)
        if ids and not sp.valid_word_ids(flags, "social.squad_name_words", ids):
            raise ApiError(422, "unknown_name", "Pick a name from the list")
        if not ids:
            ids, _ = sp.generate_name(flags, "social.squad_name_words")
        number = sp.generate_name(flags, "social.squad_name_words")[1]
        code = await _new_invite_code(session)
        rendered = sp.render_name(
            flags, "social.squad_name_words", "social.squad_name_fallback", ids, number, "en"
        )
        await session.execute(
            text(
                "insert into social.squads (id, name, owner_id, exam_profile_id, invite_code,"
                " max_members, crest_id, name_word_ids, name_number)"
                " values (:id, :name, :o, :e, :c, :mx, :crest, cast(:w as text[]), :n)"
            ),
            {
                "id": body.squad_id,
                "name": rendered,
                "o": m.user_id,
                "e": body.exam,
                "c": code,
                "mx": flags.int_or("social.squad_max_members", 20),
                "crest": body.crest_id,
                "w": ids or None,
                "n": number,
            },
        )
        await session.execute(
            text(
                "insert into social.squad_members (squad_id, user_id, role, via)"
                " values (:s, :u, 'owner', 'create')"
            ),
            {"s": body.squad_id, "u": m.user_id},
        )
        return await _out(
            session, m, flags, await _load(session, body.squad_id, m.user_id), now, detail=True
        )


async def get(db: Database, auth: AuthContext, squad_id: uuid.UUID) -> so.SquadOut:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "squad")
        return await _out(
            session, m, flags, await _load(session, squad_id, m.user_id), now, detail=True
        )


async def _by_code(session: AsyncSession, code: str, user_id: uuid.UUID) -> Any:
    row = (
        await session.execute(
            text(
                "select s.*, (select count(*) from social.squad_members x where x.squad_id = s.id) as n,"
                " exists (select 1 from social.squad_members x where x.squad_id = s.id and x.user_id = :u) as mine"
                " from social.squads s where s.invite_code = :c"
            ),
            {"c": code, "u": user_id},
        )
    ).one_or_none()
    if row is None:
        raise not_found("squad_not_found", "This squad link doesn't work")
    return row


async def preview(db: Database, auth: AuthContext, code: str) -> so.SquadPreview:
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "squad")
        row = await _by_code(session, code, m.user_id)
        name = sp.render_name(
            flags,
            "social.squad_name_words",
            "social.squad_name_fallback",
            list(row.name_word_ids or []),
            row.name_number,
            m.locale,
        )
        return so.SquadPreview(
            id=row.id,
            name=name,
            crest_id=row.crest_id,
            member_count=int(row.n),
            max_members=int(row.max_members),
            already_member=bool(row.mine),
        )


async def join(db: Database, auth: AuthContext, code: str, body: so.SquadJoin) -> so.SquadOut:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "squad")
        if m.is_minor and body.via == "code":
            # Minors join only by link or QR: real-world contact (B9).
            raise ApiError(403, "invite_only", "Join with the squad's link or QR")
        row = await _by_code(session, code, m.user_id)
        if not row.mine:
            await session.execute(
                text("select id from social.squads where id = :s for update"), {"s": row.id}
            )
            n = (
                await session.execute(
                    text("select count(*) from social.squad_members where squad_id = :s"),
                    {"s": row.id},
                )
            ).scalar_one()
            if int(n) >= int(row.max_members):
                raise ApiError(409, "squad_full", "This squad is full")
            await _check_squad_limit(session, flags, m.user_id)
            await session.execute(
                text(
                    "insert into social.squad_members (squad_id, user_id, role, via)"
                    " values (:s, :u, 'member', :v) on conflict do nothing"
                ),
                {"s": row.id, "u": m.user_id, "v": body.via},
            )
        return await _out(
            session, m, flags, await _load(session, row.id, m.user_id), now, detail=True
        )


async def remove_member(
    db: Database, auth: AuthContext, squad_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    """Leave (yourself) or remove (owner and admins). An owner who leaves hands over to the
    longest-standing admin, or else member (B9)."""
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "squad")
        row = await _load(session, squad_id, m.user_id)
        target_role = (
            await session.execute(
                text("select role from social.squad_members where squad_id = :s and user_id = :u"),
                {"s": squad_id, "u": user_id},
            )
        ).scalar_one_or_none()
        if target_role is None:
            raise not_found("member_not_found", "Not in this squad")
        if user_id != m.user_id:
            if row.my_role not in ("owner", "admin") or target_role == "owner":
                raise ApiError(403, "not_allowed", "Only the squad's owner or admins can do this")
        await session.execute(
            text("delete from social.squad_members where squad_id = :s and user_id = :u"),
            {"s": squad_id, "u": user_id},
        )
        if target_role == "owner":
            heir = (
                await session.execute(
                    text(
                        "select user_id from social.squad_members where squad_id = :s"
                        " order by (role = 'admin') desc, joined_at limit 1"
                    ),
                    {"s": squad_id},
                )
            ).scalar_one_or_none()
            if heir is None:
                await session.execute(
                    text("delete from social.squads where id = :s"), {"s": squad_id}
                )
                return
            await session.execute(
                text(
                    "update social.squad_members set role = 'owner' where squad_id = :s and user_id = :u"
                ),
                {"s": squad_id, "u": heir},
            )
            await session.execute(
                text("update social.squads set owner_id = :u where id = :s"),
                {"s": squad_id, "u": heir},
            )


async def new_code(db: Database, auth: AuthContext, squad_id: uuid.UUID) -> so.SquadOut:
    now = datetime.now(UTC)
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "squad")
        row = await _load(session, squad_id, m.user_id)
        if row.my_role not in ("owner", "admin"):
            raise ApiError(403, "not_allowed", "Only the squad's owner or admins can do this")
        await session.execute(
            text("update social.squads set invite_code = :c where id = :s"),
            {"c": await _new_invite_code(session), "s": squad_id},
        )
        return await _out(
            session, m, flags, await _load(session, squad_id, m.user_id), now, detail=True
        )


async def cheer(db: Database, auth: AuthContext, squad_id: uuid.UUID, preset_id: str) -> so.Sent:
    """ "Let's go, squad!": an inbox item for every member who can see the sender; no push."""
    async with db.system_tx() as session:
        flags = await load_flags(session)
        m = await sp.gate(session, auth, flags, "squad")
        await _load(session, squad_id, m.user_id)
        if not sf.preset_ok("squad", preset_id):
            raise ApiError(422, "unknown_preset", "Pick one of the messages")
        ids = list(
            (
                await session.execute(
                    text(
                        "select user_id from social.squad_members where squad_id = :s and user_id <> :u"
                    ),
                    {"s": squad_id, "u": m.user_id},
                )
            ).scalars()
        )
        hidden = await sp.blocked_ids(session, m.user_id)
        visible = await sp.socially_visible(session, ids)
        for uid in ids:
            if uid in hidden or uid not in visible:
                continue
            await session.execute(
                text(
                    "insert into social.nudges (from_user, to_user, kind, preset_id)"
                    " values (:f, :t, 'cheer', :p)"
                ),
                {"f": m.user_id, "t": uid, "p": preset_id},
            )
        return so.Sent(sent=True, queued_push=False)


async def quests_job(deps: JobDeps) -> int:
    """Hourly: settles this week's squad quests, so rewards and pushes go out on time."""
    now = datetime.now(UTC)
    async with deps.db.system_tx() as session:
        squads = list((await session.execute(text("select id from social.squads"))).scalars())
    done = 0
    for squad_id in squads:
        async with deps.db.system_tx() as session:
            ids = list(
                (
                    await session.execute(
                        text("select user_id from social.squad_members where squad_id = :s"),
                        {"s": squad_id},
                    )
                ).scalars()
            )
            quest = await _quest(session, squad_id, ids, now)
            done += int(bool(quest and quest.completed))
    return done
