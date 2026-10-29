"""Streak, plant and pet rules as pure functions (TRD §10, me-money flow §3.3-3.5, R1, R2, R12,
R23, R28, R36, R37). The sync handler and the nightly roll-up both call ``compute_game_state``
over the student's activity days, so the result never depends on which of them ran first.

Day model (one pass, oldest to newest, in the student's local dates):

* A **study day** is ``qualified`` (one lesson, 10 reviews, a mock section or the daily
  challenge). It adds 1 to the streak and 1 growth point, and counts toward a plant revival.
* A **protected day** is a rest day, a day with an equipped freeze, or an incident day. The
  streak pauses (no +1, no break) and the plant and pet don't decay.
* A **rescue day** (2-minute rescue) is a plant health day but never a streak day.
* Any other closed day is **missed**: the streak resets, plant health worsens with the count of
  missed days in a row, and pet energy decays.
* Today is never missed: until local midnight it can still become a study day.

A missed closed day uses an equipped freeze automatically when there is a streak to protect.
If events for that day arrive later (an offline phone), the freeze is refunded.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

HEALTH_ORDER = ("thriving", "droopy", "dry", "wilted", "dormant")
STAGES = ("seed", "sprout", "sapling", "flowering", "tree")
PET_STATE_BY_HEALTH = {
    "thriving": "happy",
    "droopy": "content",
    "dry": "sleepy",
    "wilted": "tired",
    "dormant": "resting",
}
UNDER10_ALLOWED_STATES = ("happy", "content", "sleepy")


def _as_int(value: Any, default: int) -> int:
    return int(value) if isinstance(value, int | float) and not isinstance(value, bool) else default


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


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
    mood_by_health: Mapping[str, int] = field(
        default_factory=lambda: {
            "thriving": 85,
            "droopy": 70,
            "dry": 55,
            "wilted": 40,
            "dormant": 25,
        }
    )
    energy_start: int = 80
    energy_study_gain: int = 20
    energy_missed_decay: int = 10
    energy_low: int = 30
    care_pet_mood: int = 1
    care_play_energy: int = 5
    care_play_per_day: int = 3
    care_treat_energy: int = 10
    care_treat_per_day: int = 1
    care_daily_mood_cap: int = 5
    incident_days: frozenset[date] = frozenset()
    incident_active_since: date | None = None

    @classmethod
    def from_flags(cls, flags: Mapping[str, Any]) -> GameRules:
        d = cls()
        stage_days = flags.get("game.plant.stage_days")
        energy = _as_dict(flags.get("game.pet.energy"))
        care = _as_dict(flags.get("game.pet.care"))
        incident = _as_dict(flags.get("streak.incident_freeze"))
        incident_days: set[date] = set()
        for window in incident.get("windows", []) or []:
            try:
                lo = date.fromisoformat(str(window["from"]))
                hi = date.fromisoformat(str(window["to"]))
            except (KeyError, ValueError):
                continue
            day = lo
            while day <= hi and len(incident_days) < 3660:
                incident_days.add(day)
                day += timedelta(days=1)
        since: date | None = None
        if incident.get("active"):
            try:
                since = date.fromisoformat(str(incident.get("since")))
            except ValueError:
                since = None
        return cls(
            reviews_to_qualify=_as_int(
                flags.get("streak.reviews_to_qualify"), d.reviews_to_qualify
            ),
            freeze_slots=_as_int(flags.get("streak.freeze_slots"), d.freeze_slots),
            stage_days=tuple(int(x) for x in stage_days)
            if isinstance(stage_days, list) and len(stage_days) == 4
            else d.stage_days,
            health_miss_days={
                **d.health_miss_days,
                **_as_dict(flags.get("game.plant.health_miss_days")),
            },
            revival_days={**d.revival_days, **_as_dict(flags.get("game.plant.revival_days"))},
            mood_by_health={**d.mood_by_health, **_as_dict(flags.get("game.pet.mood_by_health"))},
            energy_start=_as_int(energy.get("start"), d.energy_start),
            energy_study_gain=_as_int(energy.get("study_day_gain"), d.energy_study_gain),
            energy_missed_decay=_as_int(energy.get("missed_day_decay"), d.energy_missed_decay),
            energy_low=_as_int(energy.get("low"), d.energy_low),
            care_pet_mood=_as_int(_as_dict(care.get("pet")).get("mood"), d.care_pet_mood),
            care_play_energy=_as_int(_as_dict(care.get("play")).get("energy"), d.care_play_energy),
            care_play_per_day=_as_int(
                _as_dict(care.get("play")).get("per_day"), d.care_play_per_day
            ),
            care_treat_energy=_as_int(
                _as_dict(care.get("treat")).get("energy"), d.care_treat_energy
            ),
            care_treat_per_day=_as_int(
                _as_dict(care.get("treat")).get("per_day"), d.care_treat_per_day
            ),
            care_daily_mood_cap=_as_int(care.get("daily_mood_cap"), d.care_daily_mood_cap),
            incident_days=frozenset(incident_days),
            incident_active_since=since,
        )

    def is_incident(self, day: date) -> bool:
        if day in self.incident_days:
            return True
        return self.incident_active_since is not None and day >= self.incident_active_since


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
    last_watered_day: date | None = None
    pet_mood: int = 85
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


def pet_state_for(health: str, energy: int, rules: GameRules, under10: bool) -> str:
    state = PET_STATE_BY_HEALTH[health]
    if state == "tired" and energy < rules.energy_low:
        state = "missing_you"
    if under10 and state not in UNDER10_ALLOWED_STATES:
        state = "sleepy"
    return state


def _clamp(value: int) -> int:
    return max(0, min(100, value))


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
) -> GameState:
    care = care or {}
    st = GameState(longest_streak=previous_longest, pet_energy=rules.energy_start)
    starts = [d for d, r in days.items() if r.qualified or r.rescue_done] + list(care)
    starts = [d for d in starts if d <= today]
    freezes_left = max(0, freezes_equipped)
    streak = 0
    misses = 0
    growth = 0
    health = "thriving"
    revival = 0
    energy = rules.energy_start

    if starts:
        day = min(starts)
        while day <= today:
            rec = days.get(day, DayRecord())
            is_today = day == today
            care_day = care.get(day, CareDay())
            if rec.qualified:
                if rec.freeze_used:
                    st.freezes_refunded.append(day)
                streak += 1
                st.longest_streak = max(st.longest_streak, streak)
                st.streak_last_day = day
                st.last_watered_day = day
                growth += 1
                misses = 0
                energy += rules.energy_study_gain
                if health != "thriving":
                    revival += 1
                    if revival >= int(rules.revival_days.get(health, 1)):
                        health = "thriving"
                        revival = 0
            elif not is_today:
                freeze_active = rec.freeze_used
                if rec.freeze_used and (rec.rest_day or rules.is_incident(day) or streak == 0):
                    # The rest day (or an incident) wins and the freeze is kept (me-money edge
                    # case 18); a freeze on a day with no streak left to protect goes back too.
                    st.freezes_refunded.append(day)
                    freeze_active = False
                protected = freeze_active or rec.rest_day or rules.is_incident(day)
                if not protected and streak > 0 and freezes_left > 0:
                    freezes_left -= 1
                    st.freezes_consumed.append(day)
                    protected = True
                if protected:
                    misses = 0
                elif rec.rescue_done:
                    streak = 0
                    misses = 0
                else:
                    streak = 0
                    misses += 1
                    health = worse(health, health_for_misses(misses, rules.health_miss_days))
                    energy -= rules.energy_missed_decay
            energy = _clamp(energy + care_day.energy_bonus)
            day += timedelta(days=1)

    today_rec = days.get(today, DayRecord())
    st.current_streak = streak
    st.today_qualified = today_rec.qualified
    st.at_risk = (
        streak > 0
        and not today_rec.qualified
        and not today_rec.rest_day
        and not rules.is_incident(today)
    )
    st.growth_points = max(previous_growth, growth)
    st.stage, st.next_stage_at = stage_for(st.growth_points, rules.stage_days)
    st.health = health
    st.revival_progress = revival
    st.revival_target = None if health == "thriving" else int(rules.revival_days.get(health, 1))
    st.pet_energy = _clamp(energy)
    mood = int(rules.mood_by_health.get(health, 85)) + care.get(today, CareDay()).mood_bonus
    if under10:
        mood = max(mood, int(rules.mood_by_health.get("dry", 55)))
    st.pet_mood = _clamp(mood)
    st.pet_state = pet_state_for(health, st.pet_energy, rules, under10)
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
