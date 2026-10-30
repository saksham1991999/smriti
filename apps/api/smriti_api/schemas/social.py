"""Social models (docs/flows/tutor-social.md Part B): the gate, people as others see them, friends,
the inbox, Duos, squads, leagues, leaderboards, reactions, presets, reports and shared decks.

No free text between students anywhere (B2): messages are preset ids from the i18n catalogue,
squad and nickname names come from config word lists, and people are shown by the R31 rules.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

GateState = Literal[
    "ok",
    "guest",
    "age_unknown",
    "little_learner",
    "u13_no_scope",
    "minor_no_consent",
    "consent_pending",
    "consent_revoked",
]
Feature = Literal[
    "friends",
    "search",
    "league",
    "squad",
    "duo",
    "random_duel",
    "friend_duel",
    "cheer",
    "share_deck",
]
NameKind = Literal["display_name", "pet_name", "nickname", "hidden", "deleted"]
Handle = Annotated[str, Field(min_length=3, max_length=20, pattern=r"^[A-Za-z0-9_]+$")]
PresetId = Annotated[str, Field(min_length=1, max_length=40, pattern=r"^[a-z0-9_]+$")]
Reaction = Literal["clap", "star", "strong", "smile"]
AddVia = Literal["link", "qr"]


class Gate(BaseModel):
    """SOC-02 decides what to show from ``state``; ``features`` lists what this student may use."""

    state: GateState
    features: list[Feature] = Field(default_factory=list)
    first_visit: bool = False


class Name(BaseModel):
    """How a person is shown to the viewer (R31 amended): adults by display name; minors by the
    auto nickname, or by the pet name to friends added by invite link or QR."""

    kind: NameKind
    text: str | None = None


class Avatar(BaseModel):
    species: Literal["cat", "dog"] | None = None
    outfit_ids: list[str] = Field(default_factory=list)


class Person(BaseModel):
    user_id: uuid.UUID | None
    name: Name
    avatar: Avatar | None = None
    is_self: bool = False
    # False for minors' rows and for minors viewing anyone (B5: link or QR only).
    can_add_friend: bool = False


class Me(BaseModel):
    """SOC-03: the student's own handle, nickname and privacy."""

    handle: str | None
    public_name: Name
    discoverable: bool
    league_opt_out: bool
    presence_visible: bool
    board_school: bool
    board_city: bool
    handle_change_after: datetime | None = None


class HandleIn(BaseModel):
    handle: Handle


class HandleCheck(BaseModel):
    handle: str
    available: bool
    reason: Literal["ok", "taken", "reserved", "invalid", "blocked"] = "ok"


class PrivacyIn(BaseModel):
    discoverable: bool | None = None
    presence_visible: bool | None = None
    board_school: bool | None = None
    board_city: bool | None = None


class Invite(BaseModel):
    code: str
    path: str


class InvitePreview(BaseModel):
    state: Literal["ok", "self", "already_friends", "invalid"]
    inviter: Person | None = None


class InviteAccept(BaseModel):
    via: AddVia = "link"


class FriendRequestIn(BaseModel):
    user_id: uuid.UUID
    source: Literal["search", "league_row", "duel", "squad"] = "search"


class FriendRow(BaseModel):
    person: Person
    since: datetime | None
    streak: int
    studied_today: bool
    duo_id: uuid.UUID | None = None


class RequestOut(BaseModel):
    user_id: uuid.UUID
    status: Literal["pending", "accepted"]


class InboxItem(BaseModel):
    kind: Literal["friend_request", "duo_invite", "duel_challenge", "cheer", "nudge"]
    id: str
    sender: Person
    preset_id: str | None = None
    created_at: datetime
    unread: bool


class Inbox(BaseModel):
    items: list[InboxItem]
    unread: int


class MiniProfile(BaseModel):
    person: Person
    tier: int | None
    streak: int | None
    is_friend: bool
    request_pending: bool


class NudgeIn(BaseModel):
    to_user_id: uuid.UUID
    kind: Literal["cheer", "nudge"]
    preset_id: PresetId


class SquadCheerIn(BaseModel):
    preset_id: PresetId


class Sent(BaseModel):
    sent: bool
    queued_push: bool


class ReactionIn(BaseModel):
    item_id: uuid.UUID
    reaction: Reaction


class FeedItem(BaseModel):
    id: uuid.UUID
    person: Person
    kind: Literal["streak_milestone", "league_promoted", "badge_earned", "duo_milestone"]
    ref: str | None
    created_at: datetime
    reactions: dict[str, int]
    mine: Reaction | None = None


ReportReason = Literal[
    "inappropriate_username",
    "cheating",
    "bullying",
    "impersonation",
    "wrong_facts",
    "copied",
    "inappropriate_words",
    "spam",
    "other",
]


class ReportIn(BaseModel):
    """SOC-23. The note goes to the moderation team only, and only from adults (B11)."""

    target_kind: Literal["person", "deck"]
    user_id: uuid.UUID | None = None
    deck_code: Annotated[str, Field(max_length=40)] | None = None
    reason: ReportReason
    context: Literal["profile", "league_row", "duel", "squad_member", "duo", "deck"] = "profile"
    note: Annotated[str, Field(max_length=280)] | None = None


class ReportOut(BaseModel):
    id: uuid.UUID
    status: Literal["open", "actioned", "dismissed"]


class BlockIn(BaseModel):
    user_id: uuid.UUID


# --- Duos -----------------------------------------------------------------------------------------


class DuoInvite(BaseModel):
    friend_ids: list[uuid.UUID] = Field(min_length=1, max_length=10)


class DuoOut(BaseModel):
    id: uuid.UUID
    partner: Person
    status: Literal["invited", "active", "ended"]
    invited_by_me: bool
    shared_streak: int
    best_streak: int
    me_today: bool
    partner_today: bool
    started_at: datetime | None


class DuoInviteResult(BaseModel):
    invited: list[DuoOut]
    failed: list[dict[str, str]]
    used: int
    max: int


class DuoNudgeIn(BaseModel):
    preset_id: PresetId


# --- Squads ---------------------------------------------------------------------------------------


class SquadCreate(BaseModel):
    squad_id: uuid.UUID
    name_word_ids: list[Annotated[str, Field(max_length=40)]] = Field(
        default_factory=list, max_length=2
    )
    crest_id: Annotated[str, Field(max_length=60)] | None = None
    exam: Annotated[str, Field(max_length=200)] | None = None


class SquadJoin(BaseModel):
    via: Literal["link", "qr", "code"] = "link"


class SquadMember(BaseModel):
    person: Person
    role: Literal["owner", "admin", "member"]
    studied_today: bool
    week_xp: int


class SquadQuest(BaseModel):
    quest_id: str
    target: int
    progress: int
    completed: bool


class SquadOut(BaseModel):
    id: uuid.UUID
    name: str
    crest_id: str | None
    exam_profile_id: str | None
    invite_code: str | None
    my_role: Literal["owner", "admin", "member"] | None
    members: list[SquadMember] = Field(default_factory=list)
    member_count: int
    max_members: int
    quest: SquadQuest | None = None


class SquadPreview(BaseModel):
    id: uuid.UUID
    name: str
    crest_id: str | None
    member_count: int
    max_members: int
    already_member: bool


# --- Leagues and leaderboards ----------------------------------------------------------------


class TierName(BaseModel):
    en: str
    hi: str


class LeagueRow(BaseModel):
    rank: int
    person: Person
    xp: int
    zone: Literal["promote", "safe", "demote"]


class League(BaseModel):
    state: Literal["in_cohort", "not_joined", "opted_out", "join_available", "not_available"]
    week_start: date
    closes_at: datetime
    tier: int
    tier_name: TierName
    exam_group: str | None = None
    my_xp: int = 0
    my_rank: int | None = None
    rows: list[LeagueRow] = Field(default_factory=list)
    promote_count: int
    demote_count: int
    best_week: dict[str, int | str] | None = None
    updated_at: datetime


class LeagueResult(BaseModel):
    week_start: date
    result: Literal["promoted", "stayed", "demoted"]
    tier_before: int
    tier_now: int
    tier_name: TierName
    rank: int | None
    xp: int
    first_view: bool


class OptOutIn(BaseModel):
    on: bool


class BoardRow(BaseModel):
    rank: int
    person: Person
    xp: int


class Leaderboard(BaseModel):
    scope: Literal["friends", "squad", "school", "city", "all_india"]
    period: Literal["week", "all_time"]
    rows: list[BoardRow]
    me: BoardRow | None = None
    available: bool = True
    reason: str | None = None


# --- Shared decks -----------------------------------------------------------------------------


class DeckShareIn(BaseModel):
    title: Annotated[str, Field(min_length=1, max_length=80)]
    list_for_exam: Annotated[str, Field(max_length=200)] | None = None


class DeckShare(BaseModel):
    deck_id: uuid.UUID
    share_code: str | None
    share_status: Literal["checking", "shared", "blocked", "stopped"]
    path: str | None


class SharedDeckRow(BaseModel):
    code: str
    title: str
    card_count: int
    shared_by: Literal["friend", "student"]
    helpful: int
    i_found_helpful: bool = False
    topic_id: str | None = None


class SampleCard(BaseModel):
    front: str
    back: str


class SharedDeckPreview(SharedDeckRow):
    sample_cards: list[SampleCard]
    can_copy: bool
    is_mine: bool


class CopiedCard(BaseModel):
    id: uuid.UUID
    front: str
    back: str


class DeckCopy(BaseModel):
    """The copy belongs to the student (``source = 'shared_copy'``); the device stores it."""

    deck_id: uuid.UUID
    title: str
    cards: list[CopiedCard]


class HelpfulIn(BaseModel):
    on: bool


class Overview(BaseModel):
    """SOC-01 in one call; when locked, SOC-02 still shows the student's own numbers."""

    gate: Gate
    me: dict[str, int]
    league: League | None = None
    friends_today: list[FriendRow] = Field(default_factory=list)
    duos: list[DuoOut] = Field(default_factory=list)
    squads: list[SquadOut] = Field(default_factory=list)
    inbox_unread: int = 0


# --- Duels (B10) ------------------------------------------------------------------------------

DuelMode = Literal["live", "async", "solo"]
DuelStatus = Literal["pending", "live", "finished", "expired", "declined", "abandoned"]
DuelRelation = Literal["friend", "random", "solo"]
Outcome = Literal["me", "them", "draw", "none"]


class DuelCreate(BaseModel):
    """A friend duel (``opponent_id``) or a labelled solo round (``solo``), never both."""

    opponent_id: uuid.UUID | None = None
    solo: bool = False
    exam_profile_id: Annotated[str, Field(max_length=80)] | None = None
    subject_id: Annotated[str, Field(max_length=80)] | None = None


class RandomIn(BaseModel):
    exam_profile_id: Annotated[str, Field(max_length=80)] | None = None
    subject_id: Annotated[str, Field(max_length=80)] | None = None


class DuelPlayer(BaseModel):
    person: Person
    role: Literal["challenger", "opponent"]
    is_me: bool
    score: int | None = None  # hidden until revealed (live) or until the duel ends (async)
    correct: int | None = None
    answered_current: bool = False
    away: bool = False
    finished: bool = False


class DuelQuestion(BaseModel):
    index: int
    question_id: str
    body: dict[str, object]
    opens_at: datetime
    closes_at: datetime
    answered: bool = False


class DuelMyAnswer(BaseModel):
    index: int
    question_id: str
    correct: bool
    points: int
    key: object | None = None


class DuelRematch(BaseModel):
    available: bool
    requested_by_me: bool = False
    requested_by_them: bool = False
    open_until: datetime | None = None
    duel_id: uuid.UUID | None = None


class DuelResult(BaseModel):
    winner: Outcome
    xp_earned: int
    not_counted: bool = False  # the neutral SOC-19 line for a flagged player (A36)
    abandoned_by_me: bool = False
    abandoned_by_them: bool = False


class DuelState(BaseModel):
    id: uuid.UUID
    code: str | None
    mode: DuelMode
    relation: DuelRelation
    status: DuelStatus
    exam_profile_id: str
    subject_id: str | None
    question_count: int
    question_seconds: int
    start_at: datetime | None
    expires_at: datetime | None
    server_time: datetime
    invite_timed_out: bool = False
    players: list[DuelPlayer]
    current: DuelQuestion | None = None
    my_answers: list[DuelMyAnswer] = Field(default_factory=list)
    result: DuelResult | None = None
    rematch: DuelRematch | None = None
    last_event_id: int = 0


class DuelAnswerIn(BaseModel):
    """One answer to the open question; the server times it from the question's opening.
    Re-sending the same question returns the first answer's result (idempotent by question)."""

    question_id: Annotated[str, Field(max_length=120)]
    option_ids: list[Annotated[str, Field(max_length=64)]] | None = Field(
        default=None, max_length=26
    )
    client_ms: Annotated[int, Field(ge=0, le=3_600_000)] | None = None


class DuelAnswerOut(BaseModel):
    index: int
    correct: bool
    points: int
    key: object | None = None  # the correct choice, once this player's answer is in
    duel: DuelState


class DuelEventOut(BaseModel):
    id: int
    kind: str
    payload: dict[str, object]
    created_at: datetime


class DuelEvents(BaseModel):
    events: list[DuelEventOut]
    last_event_id: int


class QueueState(BaseModel):
    state: Literal["waiting", "matched", "idle"]
    enqueued_at: datetime | None = None
    timed_out: bool = False  # SOC-16 offers Keep looking, Practise solo, Challenge a friend
    duel: DuelState | None = None
    paused_until: datetime | None = None


class DuelListItem(BaseModel):
    id: uuid.UUID
    code: str | None
    mode: DuelMode
    relation: DuelRelation
    status: DuelStatus
    opponent: Person | None
    created_at: datetime
    winner: Outcome | None = None
    my_turn: bool = False
