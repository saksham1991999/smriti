"""Who may use social features and how people appear to each other (tutor-social B1, B4, R31).

- :func:`load_member` and :func:`gate` run the social gate (B4) for every social surface: guests
  sign in, little learners (class 1-5) have no social features (R14), minors need guardian consent
  with the ``social`` scope (:mod:`smriti_api.services.consent`, the consent gate).
- :func:`people` is the one place that decides how a person shows to a viewer (R31 amended):
  adults by display name; minors by the pet avatar and an auto nickname, or by the pet name to
  friends added by invite link or QR; blocked people and unconsented minors are hidden.
- :func:`nickname_text` renders the nickname from the ``social.nickname_words`` config list. That
  list needs an owner and a safety review (Q-B11) and ships empty, so until it is set a minor
  appears as ``social.nickname_fallback`` plus their number ("Learner 27").
"""

from __future__ import annotations

import secrets
import uuid
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from smriti_api.core.auth import AuthContext
from smriti_api.core.errors import ApiError, login_required
from smriti_api.schemas import social as so
from smriti_api.services import consent, notify
from smriti_api.services.recompute import zone
from smriti_api.services.usage import Flags

IST = ZoneInfo("Asia/Kolkata")
ADULT = "18p"
TEEN = "13_17"
CHILD = "10_12"
LITTLE = "u10"
# What each age band may use once the gate passes (B13 "Minor vs adult", "Under-13 (managed)").
FEATURES: dict[str, tuple[str, ...]] = {
    ADULT: (
        "friends",
        "search",
        "league",
        "squad",
        "duo",
        "random_duel",
        "friend_duel",
        "cheer",
        "share_deck",
    ),
    TEEN: (
        "friends",
        "search",
        "league",
        "squad",
        "duo",
        "random_duel",
        "friend_duel",
        "cheer",
        "share_deck",
    ),
    CHILD: ("friends", "friend_duel", "cheer"),
}
PET_NAME_METHODS = ("invite", "qr")


@dataclass(frozen=True)
class Member:
    user_id: uuid.UUID
    is_guest: bool
    age_band: str | None
    consent_state: str
    locale: str
    timezone: str
    primary_exam: str | None
    handle: str | None
    discoverable: bool
    league_opt_out: bool
    nickname_word_ids: tuple[str, ...]
    nickname_number: int | None
    referral_code: str | None
    signed_up: bool

    @property
    def is_adult(self) -> bool:
        return self.age_band == ADULT

    @property
    def is_minor(self) -> bool:
        return self.age_band != ADULT

    @property
    def tz(self) -> ZoneInfo:
        return zone(self.timezone)

    def today(self, now: datetime) -> date:
        return now.astimezone(self.tz).date()

    def age_group(self) -> str:
        return "adult" if self.is_adult else "teen"


_MEMBER_SQL = """
select p.user_id, p.age_band, p.guardian_consent_state, p.locale, p.timezone,
       p.primary_exam_profile_id, p.handle::text as handle, p.discoverable, p.league_opt_out,
       p.nickname_word_ids, p.nickname_number, p.referral_code, p.signed_up_at,
       coalesce(u.is_anonymous, true) as is_anonymous
  from app.profiles p
  left join auth.users u on u.id = p.user_id
 where p.user_id = :u
"""


def _member(r: Any) -> Member:
    return Member(
        user_id=r.user_id,
        is_guest=bool(r.is_anonymous) or r.signed_up_at is None,
        age_band=r.age_band,
        consent_state=r.guardian_consent_state,
        locale=r.locale if r.locale in ("en", "hi") else "en",
        timezone=r.timezone or "Asia/Kolkata",
        primary_exam=r.primary_exam_profile_id,
        handle=r.handle,
        discoverable=bool(r.discoverable),
        league_opt_out=bool(r.league_opt_out),
        nickname_word_ids=tuple(r.nickname_word_ids or ()),
        nickname_number=r.nickname_number,
        referral_code=r.referral_code,
        signed_up=r.signed_up_at is not None,
    )


async def load_member(session: AsyncSession, user_id: uuid.UUID) -> Member:
    row = (await session.execute(text(_MEMBER_SQL), {"u": user_id})).one_or_none()
    if row is None:
        raise ApiError(404, "profile_not_found", "No profile for this account")
    return _member(row)


async def parent_turned_off(session: AsyncSession, user_id: uuid.UUID) -> bool:
    """A guardian switched social off for this child in parent mode (SET-14)."""
    value = (
        await session.execute(
            text("select not social_enabled from app.parental_controls where learner_user_id = :u"),
            {"u": user_id},
        )
    ).scalar_one_or_none()
    return bool(value)


async def gate_state(session: AsyncSession, m: Member) -> str:
    """B4 in order: guest, age, little learner, then consent for minors, then the parent's
    social switch (parent mode, SET-14)."""
    if m.is_guest:
        return "guest"
    if m.age_band is None:
        return "age_unknown"
    if m.age_band == LITTLE:
        return "little_learner"
    if m.is_adult:
        return "ok"
    if await consent.has_social_consent(session, m.user_id):
        return "parent_off" if await parent_turned_off(session, m.user_id) else "ok"
    if m.consent_state == "pending":
        return "consent_pending"
    if m.consent_state == "revoked":
        return "consent_revoked"
    return "u13_no_scope" if m.age_band == CHILD else "minor_no_consent"


def features(m: Member, state: str) -> list[str]:
    if state != "ok" or m.age_band is None:
        return []
    return list(FEATURES.get(m.age_band, ()))


async def gate(
    session: AsyncSession,
    auth: AuthContext,
    flags: Flags,
    feature: str | None = None,
) -> Member:
    """Passes, or raises what SOC-02 needs: 401 ``login_required`` (reason ``social``) for guests,
    403 ``age_required``, 403 ``social_not_available`` (little learners, or a feature the age band
    doesn't have), 403 ``guardian_consent_required`` from the consent gate, 403
    ``parent_turned_off`` when a guardian switched social off in parent mode."""
    if auth.is_anonymous:
        raise login_required("social")
    m = await load_member(session, auth.user_id)
    state = await gate_state(session, m)
    if state == "guest":
        raise login_required("social")
    if state == "age_unknown":
        raise ApiError(403, "age_required", "Tell us your age first", gate_state=state)
    if state == "little_learner":
        raise ApiError(403, "social_not_available", "Friends aren't part of this app yet")
    if state == "parent_off":
        raise ApiError(403, "parent_turned_off", "A grown-up turned this off", feature="social")
    if state != "ok":
        # The consent gate decides (and words) this one.
        await consent.require_social_consent(session, m.user_id)
    if feature is not None and feature not in features(m, "ok"):
        raise ApiError(
            403, "social_not_available", "This isn't available for your age", feature=feature
        )
    if m.is_minor and (
        m.nickname_number is None
        or (not m.nickname_word_ids and all(_words(flags, "social.nickname_words")))
    ):
        m = await ensure_nickname(session, m, flags)
    return m


# --- nicknames ------------------------------------------------------------------------------------


def _words(flags: Flags, key: str) -> tuple[list[Mapping[str, Any]], list[Mapping[str, Any]]]:
    value = flags.get(key)
    if not isinstance(value, Mapping):
        return [], []
    first = [w for w in value.get("first") or [] if isinstance(w, Mapping) and w.get("id")]
    second = [w for w in value.get("second") or [] if isinstance(w, Mapping) and w.get("id")]
    return first, second


def generate_name(flags: Flags, key: str) -> tuple[list[str], int]:
    """Two word ids from the config list (none while the list is empty) and a number 1-99."""
    first, second = _words(flags, key)
    ids = (
        [str(secrets.choice(first)["id"]), str(secrets.choice(second)["id"])]
        if first and second
        else []
    )
    return ids, secrets.randbelow(99) + 1


def render_name(
    flags: Flags,
    key: str,
    fallback_key: str,
    ids: Sequence[str],
    number: int | None,
    locale: str,
) -> str:
    """ "{first} {second} {n}" from the word list, or "{fallback} {n}" while the list is unset."""
    first, second = _words(flags, key)
    by_id = {str(w["id"]): w for w in [*first, *second]}
    n = number if number is not None else 0
    if len(ids) == 2 and ids[0] in by_id and ids[1] in by_id:
        words = [str(by_id[i].get(locale) or by_id[i].get("en")) for i in ids]
        return f"{words[0]} {words[1]} {n}"
    fallback = flags.get(fallback_key)
    label = ""
    if isinstance(fallback, Mapping):
        label = str(fallback.get(locale) or fallback.get("en") or "")
    return f"{label} {n}".strip()


def nickname_text(flags: Flags, ids: Sequence[str], number: int | None, locale: str) -> str:
    return render_name(
        flags, "social.nickname_words", "social.nickname_fallback", ids, number, locale
    )


def valid_word_ids(flags: Flags, key: str, ids: Sequence[str]) -> bool:
    first, second = _words(flags, key)
    return (
        len(ids) == 2
        and ids[0] in {str(w["id"]) for w in first}
        and ids[1] in {str(w["id"]) for w in second}
    )


async def ensure_nickname(session: AsyncSession, m: Member, flags: Flags) -> Member:
    """Fixed per account once set (B1); only a moderator resets it. A student who got the
    "Learner 27" fallback while the word list was empty gets words, with the same number, once
    the owner sets the list."""
    ids, number = generate_name(flags, "social.nickname_words")
    await session.execute(
        text(
            "update app.profiles set nickname_number = coalesce(nickname_number, :n),"
            " nickname_word_ids = case when cardinality(coalesce(nickname_word_ids, '{}')) = 0"
            " then cast(:w as text[]) else nickname_word_ids end"
            " where user_id = :u"
        ),
        {"n": number, "w": ids or None, "u": m.user_id},
    )
    return await load_member(session, m.user_id)


# --- pairs, blocks and friendships -------------------------------------------------------------


def pair(a: uuid.UUID, b: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    return (a, b) if str(a) < str(b) else (b, a)


async def relation(session: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> Any:
    """The friendships row between two people (status, requested_by, method), or None."""
    lo, hi = pair(a, b)
    return (
        await session.execute(
            text(
                "select status, requested_by, method, created_at, accepted_at"
                " from social.friendships where user_a = :a and user_b = :b"
            ),
            {"a": lo, "b": hi},
        )
    ).one_or_none()


async def are_friends(session: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> bool:
    r = await relation(session, a, b)
    return r is not None and r.status == "accepted"


async def blocked_ids(session: AsyncSession, user_id: uuid.UUID) -> set[uuid.UUID]:
    """Everyone this student blocked or was blocked by: each is hidden from the other (B11)."""
    rows = (
        await session.execute(
            text(
                "select case when user_a = :u then user_b else user_a end as other"
                " from social.friendships where status = 'blocked' and :u in (user_a, user_b)"
            ),
            {"u": user_id},
        )
    ).scalars()
    return set(rows)


async def friend_ids(session: AsyncSession, user_id: uuid.UUID) -> list[uuid.UUID]:
    return list(
        (
            await session.execute(
                text(
                    "select case when user_a = :u then user_b else user_a end"
                    " from social.friendships where status = 'accepted' and :u in (user_a, user_b)"
                ),
                {"u": user_id},
            )
        ).scalars()
    )


async def socially_visible(session: AsyncSession, ids: Iterable[uuid.UUID]) -> set[uuid.UUID]:
    """Adults, and minors (13-17, 10-12) whose guardian gave the ``social`` scope (R31: minors
    appear nowhere social before consent; a withdrawn consent hides them at once). A child whose
    parent switched social off (SET-14) is hidden too."""
    wanted = list(set(ids))
    if not wanted:
        return set()
    rows = (
        await session.execute(
            text(
                """
                select p.user_id
                  from app.profiles p
                 where p.user_id = any(:ids) and p.signed_up_at is not null
                   and (p.age_band = '18p'
                        or (p.age_band in ('13_17', '10_12') and exists (
                              select 1 from app.guardian_consents c
                               where c.user_id = p.user_id and c.revoked_at is null
                                 and c.superseded_by is null
                                 and coalesce((c.scope ->> 'account')::boolean, false)
                                 and coalesce((c.scope ->> 'social')::boolean, false))
                        and not exists (
                              select 1 from app.parental_controls pc
                               where pc.learner_user_id = p.user_id and not pc.social_enabled)))
                """
            ),
            {"ids": wanted},
        )
    ).scalars()
    return set(rows)


# --- how people appear ----------------------------------------------------------------------------


async def people(
    session: AsyncSession,
    viewer: Member,
    ids: Iterable[uuid.UUID],
    flags: Flags,
    *,
    ignore_block: bool = False,
) -> dict[uuid.UUID, so.Person]:
    """Each id as the viewer may see it (R31 amended, DB_SCHEMA §12 "Social"). ``ignore_block``
    is for the blocker's own list (SET-11), never for anything another student sees."""
    wanted = list(dict.fromkeys(ids))
    if not wanted:
        return {}
    rows = {
        r.user_id: r
        for r in (
            await session.execute(
                text(
                    """
                    select p.user_id, p.age_band, p.display_name, p.handle::text as handle,
                           p.nickname_word_ids, p.nickname_number, pet.species, pet.name as pet_name,
                           pet.outfit_ids,
                           f.status as rel, f.method
                      from app.profiles p
                      left join game.pets pet on pet.user_id = p.user_id
                      left join social.friendships f
                        on f.user_a = least(p.user_id, :v) and f.user_b = greatest(p.user_id, :v)
                     where p.user_id = any(:ids)
                    """
                ),
                {"ids": wanted, "v": viewer.user_id},
            )
        ).all()
    }
    visible = await socially_visible(session, wanted)
    out: dict[uuid.UUID, so.Person] = {}
    for uid in wanted:
        r = rows.get(uid)
        if r is None:
            out[uid] = so.Person(user_id=None, name=so.Name(kind="deleted"))
            continue
        is_self = uid == viewer.user_id
        avatar = so.Avatar(species=r.species, outfit_ids=list(r.outfit_ids or []))
        if not is_self and ((r.rel == "blocked" and not ignore_block) or uid not in visible):
            out[uid] = so.Person(user_id=None, name=so.Name(kind="hidden"))
            continue
        minor = r.age_band != ADULT
        if not minor:
            label = r.display_name or r.handle
            name = (
                so.Name(kind="display_name", text=label)
                if label
                else so.Name(
                    kind="nickname",
                    text=nickname_text(flags, (), r.nickname_number, viewer.locale),
                )
            )
        elif not is_self and r.rel == "accepted" and r.method in PET_NAME_METHODS and r.pet_name:
            name = so.Name(kind="pet_name", text=r.pet_name)
        else:
            name = so.Name(
                kind="nickname",
                text=nickname_text(
                    flags, r.nickname_word_ids or (), r.nickname_number, viewer.locale
                ),
            )
        can_add = (
            not is_self
            and viewer.is_adult
            and not minor
            and r.rel is None
            and "friends" in FEATURES.get(viewer.age_band or "", ())
        )
        out[uid] = so.Person(
            user_id=uid, name=name, avatar=avatar, is_self=is_self, can_add_friend=can_add
        )
    return out


async def person(
    session: AsyncSession, viewer: Member, user_id: uuid.UUID, flags: Flags
) -> so.Person:
    return (await people(session, viewer, [user_id], flags))[user_id]


# --- pushes ---------------------------------------------------------------------------------------


async def push(
    session: AsyncSession,
    *,
    to: uuid.UUID,
    kind: str,
    sender: uuid.UUID | None,
    flags: Flags,
    payload: Mapping[str, Any] | None = None,
    dedupe_key: str | None = None,
) -> bool:
    """Queues a social push in ``notify.outbox``. ``notify.decide`` applies the caps, quiet hours
    and the minors rules (consent, R34, R45: a minor's friend pushes wait for their own reminder
    window). The sender's name is rendered as the recipient sees them, in their language."""
    body: dict[str, Any] = dict(payload or {})
    if sender is not None:
        recipient = await load_member(session, to)
        shown = await person(session, recipient, sender, flags)
        if shown.name.kind in ("hidden", "deleted"):
            return False
        body["friend"] = shown.name.text or ""
    return await notify.enqueue(session, user_id=to, kind=kind, payload=body, dedupe_key=dedupe_key)


# --- small helpers ------------------------------------------------------------------------------


def day_bounds(day: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    start = datetime(day.year, day.month, day.day, tzinfo=tz)
    return start.astimezone(UTC), (start + timedelta(days=1)).astimezone(UTC)


async def studied_today(
    session: AsyncSession, ids: Iterable[uuid.UUID], now: datetime
) -> dict[uuid.UUID, bool]:
    """Whether each student has a qualifying streak day today, by their own clock (R1, R23)."""
    wanted = list(set(ids))
    if not wanted:
        return {}
    rows = (
        await session.execute(
            text(
                """
                select p.user_id, coalesce(d.qualified, false) as q
                  from app.profiles p
                  left join learn.activity_days d
                    on d.user_id = p.user_id
                   and d.day = (cast(:now as timestamptz) at time zone p.timezone)::date
                 where p.user_id = any(:ids)
                """
            ),
            {"ids": wanted, "now": now},
        )
    ).all()
    return {r.user_id: bool(r.q) for r in rows}


async def streaks(session: AsyncSession, ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, int]:
    wanted = list(set(ids))
    if not wanted:
        return {}
    rows = (
        await session.execute(
            text("select user_id, current_streak from game.user_stats where user_id = any(:ids)"),
            {"ids": wanted},
        )
    ).all()
    return {r.user_id: int(r.current_streak) for r in rows}


def new_code(length: int = 8) -> str:
    """Share codes for links (no 0/O or 1/l, so a code read aloud survives)."""
    alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))
