"""Pure streak, plant and pet rules (TRD §10, R1, R12, R23, me-money §3.3-3.5)."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from smriti_api.services.gamify import (
    CareDay,
    DayRecord,
    GameRules,
    cap_care,
    compute_game_state,
    health_for_misses,
    is_qualified,
    pet_state_for,
    stage_for,
)

RULES = GameRules()
TODAY = date(2026, 10, 29)


def days_before(n: int) -> date:
    return TODAY - timedelta(days=n)


def study(*offsets: int) -> dict[date, DayRecord]:
    return {days_before(o): DayRecord(qualified=True) for o in offsets}


def test_first_lesson_gives_streak_one_and_a_sprout() -> None:
    st = compute_game_state(study(0), TODAY, RULES, freezes_equipped=0)
    assert st.current_streak == 1
    assert st.today_qualified
    assert st.stage == "sprout"
    assert st.next_stage_at == 7
    assert st.health == "thriving"


def test_no_activity_is_a_seed() -> None:
    st = compute_game_state({}, TODAY, RULES, freezes_equipped=0)
    assert (st.current_streak, st.stage, st.growth_points) == (0, "seed", 0)


def test_consecutive_days_build_the_streak() -> None:
    st = compute_game_state(study(4, 3, 2, 1, 0), TODAY, RULES, freezes_equipped=0)
    assert st.current_streak == 5
    assert st.longest_streak == 5


def test_today_not_done_yet_keeps_the_streak_and_flags_risk() -> None:
    st = compute_game_state(study(3, 2, 1), TODAY, RULES, freezes_equipped=0)
    assert st.current_streak == 3
    assert st.at_risk
    assert not st.today_qualified


def test_missed_day_resets_streak_and_droops_plant() -> None:
    st = compute_game_state(study(3, 2), TODAY, RULES, freezes_equipped=0)
    assert st.current_streak == 0
    assert st.longest_streak == 2
    assert st.health == "droopy"
    assert st.growth_points == 2  # growth is never lost


def test_equipped_freeze_is_used_on_a_missed_day() -> None:
    st = compute_game_state(study(3, 2, 0), TODAY, RULES, freezes_equipped=1)
    assert st.freezes_consumed == [days_before(1)]
    assert st.current_streak == 3
    assert st.health == "thriving"


def test_two_misses_need_two_freezes() -> None:
    st = compute_game_state(study(4, 3, 0), TODAY, RULES, freezes_equipped=1)
    assert st.freezes_consumed == [days_before(2)]
    assert st.current_streak == 1


def test_freeze_not_used_without_a_streak() -> None:
    days = {days_before(5): DayRecord(rescue_done=True)}
    st = compute_game_state(days, TODAY, RULES, freezes_equipped=2)
    assert st.freezes_consumed == []


def test_freeze_refunded_when_late_events_qualify_the_day() -> None:
    days = study(2, 0) | {days_before(1): DayRecord(qualified=True, freeze_used=True)}
    st = compute_game_state(days, TODAY, RULES, freezes_equipped=0)
    assert st.freezes_refunded == [days_before(1)]
    assert st.current_streak == 3


def test_rest_day_pauses_and_keeps_the_freeze() -> None:
    days = study(2, 0) | {days_before(1): DayRecord(rest_day=True, freeze_used=True)}
    st = compute_game_state(days, TODAY, RULES, freezes_equipped=0)
    assert st.freezes_refunded == [days_before(1)]
    assert st.current_streak == 2  # paused, not broken, not increased


def test_incident_freeze_protects_the_streak() -> None:
    rules = GameRules(incident_days=frozenset({days_before(1)}))
    st = compute_game_state(study(2, 0), TODAY, rules, freezes_equipped=0)
    assert st.current_streak == 2
    assert st.health == "thriving"


def test_rescue_day_waters_the_plant_but_breaks_the_streak() -> None:
    days = study(3, 2) | {days_before(1): DayRecord(rescue_done=True)}
    st = compute_game_state(days, TODAY, RULES, freezes_equipped=0)
    assert st.current_streak == 0
    assert st.health == "thriving"


@pytest.mark.parametrize(
    ("misses", "health"),
    [
        (0, "thriving"),
        (1, "droopy"),
        (2, "droopy"),
        (3, "dry"),
        (7, "wilted"),
        (21, "dormant"),
        (40, "dormant"),
    ],
)
def test_health_thresholds(misses: int, health: str) -> None:
    assert health_for_misses(misses, RULES.health_miss_days) == health


@pytest.mark.parametrize(
    ("points", "stage", "next_at"),
    [
        (0, "seed", 1),
        (1, "sprout", 7),
        (6, "sprout", 7),
        (7, "sapling", 30),
        (30, "flowering", 100),
        (100, "tree", None),
    ],
)
def test_plant_stage_transitions(points: int, stage: str, next_at: int | None) -> None:
    assert stage_for(points, RULES.stage_days) == (stage, next_at)


def test_stage_transitions_from_study_days() -> None:
    st = compute_game_state(study(*range(7)), TODAY, RULES, freezes_equipped=0)
    assert (st.growth_points, st.stage) == (7, "sapling")
    st = compute_game_state(study(*range(30)), TODAY, RULES, freezes_equipped=0)
    assert st.stage == "flowering"


def test_revival_after_wilting() -> None:
    days = study(20) | study(2, 1, 0)  # 17 missed days in between: wilted, then 3 study days
    st = compute_game_state(days, TODAY, RULES, freezes_equipped=0)
    assert st.health == "thriving"
    days = study(20) | study(1, 0)
    st = compute_game_state(days, TODAY, RULES, freezes_equipped=0)
    assert st.health == "wilted"
    assert (st.revival_progress, st.revival_target) == (2, 3)


def test_growth_never_drops_below_previous() -> None:
    st = compute_game_state(study(0), TODAY, RULES, freezes_equipped=0, previous_growth=12)
    assert st.growth_points == 12
    assert st.stage == "sapling"


def test_pet_energy_and_mood() -> None:
    # Start 80/80; each study day +20 mood (capped by the band) and +15 energy.
    st = compute_game_state(study(1, 0), TODAY, RULES, freezes_equipped=0)
    assert (st.pet_mood, st.pet_energy, st.pet_state) == (100, 100, "happy")
    # Nine missed days after one study day: mood falls into the wilted band, energy to 5.
    st = compute_game_state(study(10), TODAY, RULES, freezes_equipped=0)
    assert st.health == "wilted"
    assert st.pet_energy == 5  # 80 + 15 - 9 * 10
    assert st.pet_mood == 15  # 100 - 90, held at the wilted floor
    assert st.pet_state == "missing_you"


def test_mood_stays_inside_the_plant_band() -> None:
    st = compute_game_state(study(1), TODAY, RULES, freezes_equipped=0)
    assert st.health == "thriving"
    assert st.pet_mood == 100  # yesterday's study; today is still open, so no decay yet
    st = compute_game_state(study(2), TODAY, RULES, freezes_equipped=0)
    assert st.health == "droopy"
    lo, hi = RULES.mood_band("droopy")
    assert lo <= st.pet_mood <= hi


def test_under10_pet_is_never_sad() -> None:
    st = compute_game_state(study(25), TODAY, RULES, freezes_equipped=0, under10=True)
    assert st.health == "dormant"
    assert st.pet_state == "sleepy"
    st = compute_game_state(study(25), TODAY, RULES, freezes_equipped=0)
    assert st.pet_state == "resting"


def test_care_is_capped_per_day() -> None:
    care = cap_care(["pet"] * 20 + ["play"] * 10 + ["feed"] * 3, RULES)
    assert care.mood_bonus == RULES.care_daily_mood_cap
    assert care.energy_bonus == 3 * RULES.care_play_energy + RULES.care_treat_energy


def test_care_today_lifts_mood_within_the_band() -> None:
    days = study(2)  # yesterday missed: droopy, mood 70 -> 69 band ceiling
    base = compute_game_state(days, TODAY, RULES, freezes_equipped=0)
    st = compute_game_state(
        days, TODAY, RULES, freezes_equipped=0, care={TODAY: CareDay(mood_bonus=5, energy_bonus=3)}
    )
    assert st.pet_mood == min(base.pet_mood + 5, RULES.mood_band("droopy")[1])
    assert st.pet_energy == base.pet_energy + 3


def test_pet_state_mapping() -> None:
    assert pet_state_for(85, 50, RULES, under10=False) == "happy"
    assert pet_state_for(55, 50, RULES, under10=False) == "content"
    assert pet_state_for(35, 50, RULES, under10=False) == "sleepy"
    assert pet_state_for(20, 50, RULES, under10=False) == "tired"
    assert pet_state_for(20, 10, RULES, under10=False) == "missing_you"
    assert pet_state_for(5, 10, RULES, under10=False) == "resting"
    assert pet_state_for(5, 10, RULES, under10=True) == "sleepy"


def test_dry_revival_needs_days_in_a_row_but_a_quest_keeps_its_dots() -> None:
    dry = study(15, 14) | study(10, 8)  # 3 missed (dry), study, miss, study
    st = compute_game_state(dry, days_before(7), RULES, freezes_equipped=0)
    assert (st.health, st.revival_progress) == ("dry", 1)
    wilted = study(20) | study(12, 10)  # 7+ missed (wilted), study, miss, study
    st = compute_game_state(wilted, days_before(9), RULES, freezes_equipped=0)
    assert (st.health, st.revival_progress) == ("wilted", 2)


def test_exam_day_pauses_the_streak() -> None:
    rules = GameRules(exam_days=frozenset({days_before(1)}))
    st = compute_game_state(study(2, 0), TODAY, rules, freezes_equipped=1)
    assert st.current_streak == 2
    assert st.freezes_consumed == []
    off = GameRules(exam_days=frozenset({days_before(1)}), exam_day_protected=False)
    assert compute_game_state(study(2, 0), TODAY, off, freezes_equipped=0).current_streak == 1


@pytest.mark.parametrize(
    ("kw", "expected"),
    [
        (
            {
                "lessons_completed": 1,
                "cards_reviewed": 0,
                "mock_sections": 0,
                "daily_challenge": False,
            },
            True,
        ),
        (
            {
                "lessons_completed": 0,
                "cards_reviewed": 9,
                "mock_sections": 0,
                "daily_challenge": False,
            },
            False,
        ),
        (
            {
                "lessons_completed": 0,
                "cards_reviewed": 10,
                "mock_sections": 0,
                "daily_challenge": False,
            },
            True,
        ),
        (
            {
                "lessons_completed": 0,
                "cards_reviewed": 0,
                "mock_sections": 1,
                "daily_challenge": False,
            },
            True,
        ),
        (
            {
                "lessons_completed": 0,
                "cards_reviewed": 0,
                "mock_sections": 0,
                "daily_challenge": True,
            },
            True,
        ),
    ],
)
def test_qualifying_activity(kw: dict[str, int | bool], expected: bool) -> None:
    assert is_qualified(**kw, reviews_to_qualify=10) is expected  # type: ignore[arg-type]


def test_rules_from_flags() -> None:
    rules = GameRules.from_flags(
        {
            "streak.reviews_to_qualify": 12,
            "game.plant.stage_days": [1, 5, 20, 50],
            "streak.incident_freeze": False,
            "streak.incident_freeze_windows": [
                {"from": "2026-10-01", "to": "2026-10-03"},
                {"from": "2026-10-20", "to": None},
            ],
            "game.pet.study_gain": {"mood": 10, "energy": 5},
        }
    )
    assert rules.reviews_to_qualify == 12
    assert rules.stage_days == (1, 5, 20, 50)
    assert rules.is_incident(date(2026, 10, 2))
    assert not rules.is_incident(date(2026, 10, 4))
    assert rules.is_incident(date(2026, 10, 25))  # an open window
    assert (rules.pet_study_mood, rules.pet_study_energy) == (10, 5)
    legacy = GameRules.from_flags(
        {"streak.freeze_slots": 3, "game.plant.health_miss_days": {"dry": 4}}
    )
    assert (legacy.freeze_slots, legacy.health_miss_days["dry"]) == (3, 4)
