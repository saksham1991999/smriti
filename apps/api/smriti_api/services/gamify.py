"""Streak, plant and pet rules as pure functions (TRD §10, me-money flow §3.3-3.5, R1, R2, R12,
R23, R28, R36, R37). The sync handler and the nightly roll-up both call ``compute_game_state``
over the student's activity days, so the result never depends on which of them ran first.

These rules match ``packages/app-core/src/rules`` day for day; ``tests/test_vectors.py`` runs
them against app-core's golden vectors (``packages/app-core/test-vectors``). Flag keys and
defaults are the ones in ``packages/config/src/flags.ts``.

Day model (one pass, oldest to newest, in the student's local dates):

* A **study day** is ``qualified`` (one lesson, 10 reviews, a mock section or the daily
  challenge). It adds 1 to the streak and 1 growth point, and counts toward a plant revival.
* A **protected day** is, in this order, an incident day, a rest day, the protected exam day,
  or a day with an equipped freeze. The streak pauses (no +1, no break) and the plant and pet
  don't decay.
* A **rescue day** (2-minute rescue) waters the plant but is never a streak day.
* Any other closed day is **missed**: the streak resets, plant health worsens with the count of
  missed days in a row, and pet mood and energy decay.
* Today is never missed: until local midnight it can still become a study day. A study day
  today counts at once (it can't be undone, so the nightly close would give the same result).

A missed closed day uses an equipped freeze automatically when there is a streak to protect.
If events for that day arrive later (an offline phone), the freeze is refunded.

Revival (R12): droopy needs 1 study day, dry 2 in a row, wilted 3 and dormant 5. Wilted and
dormant are a revival quest whose dots survive a missed day; droopy and dry start over.

The pet's mood stays inside the band of the plant's health (``game.pet.state_min_mood``), so
the pet and the plant tell the same story; its state label comes from mood and energy.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

HEALTH_ORDER = ("thriving", "droopy", "dry", "wilted", "dormant")
STAGES = ("seed", "sprout", "sapling", "flowering", "tree")
QUEST_HEALTH = ("wilted", "dormant")
UNDER10_ALLOWED_STATES = ("happy", "content", "sleepy")


def _as_int(value: Any, default: int) -> int:
    return int(value) if isinstance(value, int | float) and not isinstance(value, bool) else default


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _first(flags: Mapping[str, Any], *keys: str) -> Any:
    """The first key present: shared ``packages/config`` names first, then older aliases."""
    for key in keys:
        if key in flags and flags[key] is not None:
            return flags[key]
    return None


def _date_or_none(value: Any) -> date | None:
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        return None


@dataclass(frozen=True)
class GameRules:
    reviews_to_qualify: int = 10
    freeze_slots: int = 2
    stage_days: tuple[int, ...] = (1, 7, 30, 100)
    health_miss_days: Mapping[str, int] = field(
        default_factory=lambda: {"droopy": 1, "dry": 3, "wilted": 7, "dormant": 21}
    )
    revival_days: Mapping[str, int] = field(
        default_factory=lambda: {"droopy": 1, "dry": 2, "wilted": 3, "dormant": 5}
    )
    pet_start_mood: int = 80
    pet_start_energy: int = 80
    pet_decay_mood: int = 10
    pet_decay_energy: int = 10
    pet_study_mood: int = 20
    pet_study_energy: int = 15
    pet_min_mood: Mapping[str, int] = field(
        default_factory=lambda: {"happy": 70, "content": 50, "sleepy": 30, "tired": 15}
    )
    missing_you_energy_below: int = 30
    care_pet_mood: int = 2
    care_play_energy: int = 3
    care_play_per_day: int = 3
    care_treat_energy: int = 8
    care_treat_per_day: int = 1
    care_daily_mood_cap: int = 5
    # Incident freeze (R28): closed windows plus open ones (``to`` null) from
    # ``streak.incident_freeze_windows``.
    incident_days: frozenset[date] = frozenset()
    incident_active_since: date | None = None
    exam_day_protected: bool = True
    exam_days: frozenset[date] = frozenset()
    # R36 monthly grants (streak.monthly_freezes), for ENT-08's "Next free freeze on {date}".
    monthly_freezes_free: int = 1
    monthly_freezes_pro: int = 2

    @classmethod
    def from_flags(cls, flags: Mapping[str, Any]) -> GameRules:
        d = cls()
        stage_days = _first(flags, "game.plant.stage_days", "plant.thresholds")
        incident_days: set[date] = set()
        since: date | None = None
        windows: list[Any] = []
        raw_windows = flags.get("streak.incident_freeze_windows")
        if isinstance(raw_windows, list):
            windows += raw_windows
        legacy = flags.get("streak.incident_freeze")
        if isinstance(legacy, dict):  # the older object form {active, since, windows}
            windows += legacy.get("windows") or []
            if legacy.get("active"):
                since = _date_or_none(legacy.get("since"))
        for window in windows:
            if not isinstance(window, dict):
                continue
            lo = _date_or_none(window.get("from"))
            hi = _date_or_none(window.get("to")) if window.get("to") is not None else None
            if lo is None:
                continue
            if hi is None:
                since = lo if since is None else min(since, lo)
                continue
            day = lo
            while day <= hi and len(incident_days) < 3660:
                incident_days.add(day)
                day += timedelta(days=1)
        start = _as_dict(flags.get("game.pet.start"))
        decay = _as_dict(flags.get("game.pet.decay_per_missed_day"))
        gain = _as_dict(flags.get("game.pet.study_gain"))
        min_mood = _as_dict(flags.get("game.pet.state_min_mood"))
        monthly = _as_dict(flags.get("streak.monthly_freezes"))
        return cls(
            reviews_to_qualify=_as_int(
                flags.get("streak.reviews_to_qualify"), d.reviews_to_qualify
            ),
            freeze_slots=_as_int(
                _first(flags, "streak.freeze_slots_max", "streak.freeze_slots"), d.freeze_slots
            ),
            stage_days=tuple(int(x) for x in stage_days)
            if isinstance(stage_days, list) and len(stage_days) == 4
            else d.stage_days,
            health_miss_days={
                **d.health_miss_days,
                **_as_dict(
                    _first(flags, "game.plant.health_missed_days", "game.plant.health_miss_days")
                ),
            },
            revival_days={**d.revival_days, **_as_dict(flags.get("game.plant.revival_days"))},
            pet_start_mood=_as_int(start.get("mood"), d.pet_start_mood),
            pet_start_energy=_as_int(start.get("energy"), d.pet_start_energy),
            pet_decay_mood=_as_int(decay.get("mood"), d.pet_decay_mood),
            pet_decay_energy=_as_int(decay.get("energy"), d.pet_decay_energy),
            pet_study_mood=_as_int(gain.get("mood"), d.pet_study_mood),
            pet_study_energy=_as_int(gain.get("energy"), d.pet_study_energy),
            pet_min_mood={**d.pet_min_mood, **{k: int(v) for k, v in min_mood.items()}},
            missing_you_energy_below=_as_int(
                flags.get("game.pet.missing_you_energy_below"), d.missing_you_energy_below
            ),
            care_pet_mood=_as_int(flags.get("game.pet.pet_mood_gain"), d.care_pet_mood),
            care_play_energy=_as_int(flags.get("game.pet.play_energy_gain"), d.care_play_energy),
            care_play_per_day=_as_int(flags.get("game.pet.plays_per_day"), d.care_play_per_day),
            care_treat_energy=_as_int(flags.get("game.pet.treat_energy_gain"), d.care_treat_energy),
            care_treat_per_day=_as_int(flags.get("game.pet.treats_per_day"), d.care_treat_per_day),
            care_daily_mood_cap=_as_int(
                flags.get("game.pet.care_mood_cap_per_day"), d.care_daily_mood_cap
            ),
            incident_days=frozenset(incident_days),
            incident_active_since=since,
            exam_day_protected=flags.get("streak.exam_day_protected", True) is not False,
            monthly_freezes_free=_as_int(monthly.get("free"), d.monthly_freezes_free),
            monthly_freezes_pro=_as_int(monthly.get("pro"), d.monthly_freezes_pro),
        )

    def is_incident(self, day: date) -> bool:
        if day in self.incident_days:
            return True
        return self.incident_active_since is not None and day >= self.incident_active_since

    def is_exam_day(self, day: date) -> bool:
        return self.exam_day_protected and day in self.exam_days

    def mood_band(self, health: str) -> tuple[int, int]:
        """The pet's mood floor and ceiling for a plant health (app-core ``moodBand``)."""
        m = self.pet_min_mood
        if health == "thriving":
            return m["happy"], 100
        if health == "droopy":
            return m["content"], m["happy"] - 1
        if health == "dry":
            return m["sleepy"], m["content"] - 1
        if health == "wilted":
            return m["tired"], m["sleepy"] - 1
        return 0, m["tired"] - 1


@dataclass(frozen=True)
class DayRecord:
    qualified: bool = False
    rescue_done: bool = False
    rest_day: bool = False
    freeze_used: bool = False


@dataclass(frozen=True)
class CareDay:
    """Care effects already capped per day (see ``cap_care``)."""

    mood_bonus: int = 0
    energy_bonus: int = 0


@dataclass
class GameState:
    current_streak: int = 0
    longest_streak: int = 0
    streak_last_day: date | None = None
    today_qualified: bool = False
    at_risk: bool = False
    freezes_consumed: list[date] = field(default_factory=list)
    freezes_refunded: list[date] = field(default_factory=list)
    growth_points: int = 0
    stage: str = "seed"
    next_stage_at: int | None = 1
    health: str = "thriving"
    revival_progress: int = 0
    revival_target: int | None = None
    missed_streak: int = 0
    last_watered_day: date | None = None
    pet_mood: int = 80
    pet_energy: int = 80
    pet_state: str = "happy"


def stage_for(points: int, stage_days: tuple[int, ...]) -> tuple[str, int | None]:
    stage = "seed"
    next_at: int | None = stage_days[0] if stage_days else None
    for i, threshold in enumerate(stage_days):
        if points >= threshold:
            stage = STAGES[i + 1]
            next_at = stage_days[i + 1] if i + 1 < len(stage_days) else None
    return stage, next_at


def health_for_misses(misses: int, thresholds: Mapping[str, int]) -> str:
    for state in HEALTH_ORDER[:0:-1]:
        if misses >= int(thresholds.get(state, 10**6)):
            return state
    return "thriving"


def worse(a: str, b: str) -> str:
    return a if HEALTH_ORDER.index(a) >= HEALTH_ORDER.index(b) else b


def cap_care(actions: list[str], rules: GameRules) -> CareDay:
    """Apply the daily care limits (me-money §3.3) to one day's care actions, in order."""
    mood = 0
    energy = 0
    plays = 0
    treats = 0
    for action in actions:
        if action == "pet":
            mood += rules.care_pet_mood
        elif action == "play" and plays < rules.care_play_per_day:
            plays += 1
            energy += rules.care_play_energy
        elif action == "feed" and treats < rules.care_treat_per_day:
            treats += 1
            energy += rules.care_treat_energy
    return CareDay(mood_bonus=min(mood, rules.care_daily_mood_cap), energy_bonus=energy)


def pet_state_for(mood: int, energy: int, rules: GameRules, under10: bool) -> str:
    """The state label from mood and energy (app-core ``derivePetState``)."""
    m = rules.pet_min_mood
    if mood >= m["happy"]:
        state = "happy"
    elif mood >= m["content"]:
        state = "content"
    elif mood >= m["sleepy"]:
        state = "sleepy"
    elif mood >= m["tired"]:
        state = "missing_you" if energy < rules.missing_you_energy_below else "tired"
    else:
        state = "resting"
    if under10 and state not in UNDER10_ALLOWED_STATES:
        state = "sleepy"
    return state


def _clamp(value: int, lo: int = 0, hi: int = 100) -> int:
    return max(lo, min(hi, value))


def compute_game_state(
    days: Mapping[date, DayRecord],
    today: date,
    rules: GameRules,
    *,
    freezes_equipped: int,
    care: Mapping[date, CareDay] | None = None,
    under10: bool = False,
    previous_longest: int = 0,
    previous_growth: int = 0,
    since: date | None = None,
) -> GameState:
    """Replay the days from ``since`` (or the first activity) through ``today``."""
    care = care or {}
    st = GameState(longest_streak=previous_longest)
    starts = [d for d, r in days.items() if r.qualified or r.rescue_done] + list(care)
    if since is not None:
        starts.append(since)
    starts = [d for d in starts if d <= today]
    freezes_left = max(0, freezes_equipped)
    streak = 0
    misses = 0
    growth = 0
    health = "thriving"
    revival = 0
    mood = rules.pet_start_mood
    energy = rules.pet_start_energy

    if starts:
        day = min(starts)
        while day <= today:
            rec = days.get(day, DayRecord())
            is_today = day == today
            care_day = care.get(day, CareDay())
            if care_day.mood_bonus or care_day.energy_bonus:
                lo, hi = rules.mood_band(health)
                mood = _clamp(mood + care_day.mood_bonus, lo, hi)
                energy = _clamp(energy + care_day.energy_bonus)
            if rec.qualified:
                if rec.freeze_used:
                    st.freezes_refunded.append(day)
                streak += 1
                st.longest_streak = max(st.longest_streak, streak)
                st.streak_last_day = day
                st.last_watered_day = day
                growth += 1
                misses = 0
                if health != "thriving":
                    revival += 1
                    if revival >= int(rules.revival_days.get(health, 1)):
                        health = "thriving"
                        revival = 0
                mood += rules.pet_study_mood
                energy += rules.pet_study_energy
            elif not is_today:
                freeze_active = rec.freeze_used
                paused = rec.rest_day or rules.is_incident(day) or rules.is_exam_day(day)
                if rec.freeze_used and (paused or streak == 0):
                    # The rest day, incident or exam day wins and the freeze is kept (me-money
                    # edge case 18); a freeze on a day with no streak left to protect goes back.
                    st.freezes_refunded.append(day)
                    freeze_active = False
                protected = freeze_active or paused
                if not protected and streak > 0 and freezes_left > 0:
                    freezes_left -= 1
                    st.freezes_consumed.append(day)
                    protected = True
                if protected or rec.rescue_done:
                    misses = 0
                    st.last_watered_day = day
                    if not protected:
                        streak = 0
                else:
                    streak = 0
                    misses += 1
                    target = health_for_misses(misses, rules.health_miss_days)
                    if HEALTH_ORDER.index(target) > HEALTH_ORDER.index(health):
                        health = target
                        revival = 0
                    elif health not in QUEST_HEALTH:
                        revival = 0  # droopy and dry need study days in a row
                    mood -= rules.pet_decay_mood
                    energy -= rules.pet_decay_energy
            if rec.qualified or not is_today:
                lo, hi = rules.mood_band(health)
                mood = _clamp(mood, lo, hi)
                energy = _clamp(energy)
            day += timedelta(days=1)

    today_rec = days.get(today, DayRecord())
    st.current_streak = streak
    st.today_qualified = today_rec.qualified
    st.at_risk = (
        streak > 0
        and not today_rec.qualified
        and not today_rec.rest_day
        and not rules.is_incident(today)
        and not rules.is_exam_day(today)
    )
    st.growth_points = max(previous_growth, growth)
    st.stage, st.next_stage_at = stage_for(st.growth_points, rules.stage_days)
    st.health = health
    st.revival_progress = revival
    st.revival_target = None if health == "thriving" else int(rules.revival_days.get(health, 1))
    st.missed_streak = misses
    st.pet_mood = _clamp(mood)
    st.pet_energy = _clamp(energy)
    st.pet_state = pet_state_for(st.pet_mood, st.pet_energy, rules, under10)
    return st


def is_qualified(
    *,
    lessons_completed: int,
    cards_reviewed: int,
    mock_sections: int,
    daily_challenge: bool,
    reviews_to_qualify: int,
) -> bool:
    """R1 + R23: one lesson, or N reviews, or one mock section, or the daily challenge."""
    return (
        lessons_completed >= 1
        or cards_reviewed >= reviews_to_qualify
        or mock_sections >= 1
        or daily_challenge
    )
