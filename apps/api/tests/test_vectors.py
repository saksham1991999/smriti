"""The server's rules against app-core's golden vectors (``packages/app-core/test-vectors``).

app-core closes one day at a time; the server replays the whole history. For each step of a
vector the test replays every day up to and including that step's day, with "today" the next
day, so the step's day is closed exactly as app-core's ``closeDay`` closed it.

The vectors are app-core's output and are never edited here. A disagreement is a test failure,
to be settled in both packages in the same pull request (docs/contracts/sync.md).
"""

from __future__ import annotations

import json
import math
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from smriti_api.core.config import REPO_ROOT
from smriti_api.services.gamify import DayRecord, GameRules, compute_game_state
from smriti_api.services.srs import ReviewInput, make_scheduler, replay

VECTORS = REPO_ROOT / "packages" / "app-core" / "test-vectors"


def load(name: str) -> dict[str, Any]:
    path: Path = VECTORS / f"{name}.json"
    if not path.is_file():
        pytest.fail(f"missing golden vectors: {path}")
    data: dict[str, Any] = json.loads(path.read_text())
    assert data["version"] == 1, f"{name}.json: unknown vector version {data['version']}"
    return data


def ids(data: dict[str, Any]) -> list[str]:
    return [c["name"] for c in data["cases"]]


def d(value: str) -> date:
    return date.fromisoformat(value)


STREAK = load("streak")
PLANT = load("plant")
PET = load("pet")
FSRS = load("fsrs")


def test_vector_config_matches_server_defaults() -> None:
    rules = GameRules()
    assert STREAK["config"]["freeze_slots_max"] == rules.freeze_slots
    assert PLANT["config"]["stage_days"] == list(rules.stage_days)
    assert PLANT["config"]["health_missed_days"] == dict(rules.health_miss_days)
    assert PLANT["config"]["revival_days"] == dict(rules.revival_days)
    pet = PET["config"]
    assert pet["start"] == {"mood": rules.pet_start_mood, "energy": rules.pet_start_energy}
    assert pet["decayPerMissedDay"] == {
        "mood": rules.pet_decay_mood,
        "energy": rules.pet_decay_energy,
    }
    assert pet["studyGain"] == {"mood": rules.pet_study_mood, "energy": rules.pet_study_energy}
    assert pet["stateMinMood"] == dict(rules.pet_min_mood)
    assert pet["missingYouEnergyBelow"] == rules.missing_you_energy_below
    assert pet["careMoodCapPerDay"] == rules.care_daily_mood_cap
    assert pet["petMoodGain"] == rules.care_pet_mood
    assert (pet["playsPerDay"], pet["playEnergyGain"]) == (
        rules.care_play_per_day,
        rules.care_play_energy,
    )
    assert (pet["treatsPerDay"], pet["treatEnergyGain"]) == (
        rules.care_treat_per_day,
        rules.care_treat_energy,
    )


# --- streak --------------------------------------------------------------------------------------


@pytest.mark.parametrize("case", STREAK["cases"], ids=ids(STREAK))
def test_streak_vectors(case: dict[str, Any]) -> None:
    initial = case["initial"]
    assert initial["current"] == 0 and not initial["pendingFreezes"], "harness: streak starts empty"
    monthly = STREAK["config"]["monthly_freezes"]
    has_grants = any("grant" in s["input"] for s in case["steps"])
    days: dict[date, DayRecord] = {}
    incidents: set[date] = set()
    exams: set[date] = set()
    granted = 0
    start = d(case["steps"][0]["day"])
    problems: list[str] = []
    for step in case["steps"]:
        day = d(step["day"])
        inp = step["input"]
        days[day] = DayRecord(qualified=inp["qualified"], rest_day=bool(inp.get("restDay")))
        if inp.get("incident"):
            incidents.add(day)
        if inp.get("examDay"):
            exams.add(day)
        if "grant" in inp:
            # The server grants into game.streak_freezes (ensure_monthly_freezes); for the pure
            # replay a grant just adds to the freezes it may use from that day on.
            granted += monthly[inp["grant"]]
        rules = GameRules(incident_days=frozenset(incidents), exam_days=frozenset(exams))
        st = compute_game_state(
            days,
            day + timedelta(days=1),
            rules,
            freezes_equipped=initial["freezesEquipped"] + granted,
            since=start,
        )
        freeze_used = day in st.freezes_consumed
        if inp["qualified"]:
            status = "studied"
        elif rules.is_incident(day):
            status = "incident"
        elif inp.get("restDay"):
            status = "rest"
        elif rules.is_exam_day(day):
            status = "exam_day"
        elif freeze_used:
            status = "freeze"
        else:
            status = "missed"
        got = {
            "status": status,
            "freeze_used": freeze_used,
            "current": st.current_streak,
            "longest": st.longest_streak,
        }
        want = {k: step[k] for k in got}
        if not has_grants:
            # Grants live in the database, so the equipped count is only checked without them.
            got["freezes_equipped"] = initial["freezesEquipped"] - len(st.freezes_consumed)
            want["freezes_equipped"] = step["freezes_equipped"]
        if got != want:
            problems.append(f"{step['day']}: server {got} != app-core {want}")
    assert not problems, "\n".join(problems)


# --- plant ---------------------------------------------------------------------------------------


def plant_prefix(initial: dict[str, Any], start: date) -> tuple[dict[date, DayRecord], int, date]:
    """Days before ``start`` that put the server's replay in the vector's initial plant state.
    Returns (days, previous_growth, since)."""
    growth, missed, health = initial["growthPoints"], initial["missedStreak"], initial["health"]
    if health == "thriving" and missed == 0:
        return {}, growth, start
    first = start - timedelta(days=growth + missed)
    days = {first + timedelta(days=i): DayRecord(qualified=True) for i in range(growth)}
    return days, 0, first


@pytest.mark.parametrize("case", PLANT["cases"], ids=ids(PLANT))
def test_plant_vectors(case: dict[str, Any]) -> None:
    start = d(case["steps"][0]["day"])
    days, previous_growth, since = plant_prefix(case["initial"], start)
    rules = GameRules()
    if since < start:
        st = compute_game_state(days, start, rules, freezes_equipped=0, since=since)
        assert (st.health, st.growth_points, st.missed_streak) == (
            case["initial"]["health"],
            case["initial"]["growthPoints"],
            case["initial"]["missedStreak"],
        ), "harness: prefix did not reach the initial state"
    problems: list[str] = []
    for step in case["steps"]:
        day = d(step["day"])
        inp = step["input"]
        days[day] = DayRecord(
            qualified=inp["qualified"],
            rescue_done=bool(inp.get("rescue")),
            # A protected day in app-core: freeze used, rest day, exam day or incident.
            rest_day=bool(inp.get("protected")),
        )
        st = compute_game_state(
            days,
            day + timedelta(days=1),
            rules,
            freezes_equipped=0,
            previous_growth=previous_growth,
            since=since,
        )
        got = {
            "stage": st.stage,
            "health": st.health,
            "growth_points": st.growth_points,
            "revival_progress": st.revival_progress,
            "missed_streak": st.missed_streak,
        }
        want = {k: step[k] for k in got}
        if got != want:
            problems.append(f"{step['day']}: server {got} != app-core {want}")
    assert not problems, "\n".join(problems)


# --- pet -----------------------------------------------------------------------------------------


@pytest.mark.parametrize("case", PET["cases"], ids=ids(PET))
def test_pet_vectors(case: dict[str, Any]) -> None:
    initial = case["initial"]
    rules = replace(GameRules(), pet_start_mood=initial["mood"], pet_start_energy=initial["energy"])
    start = d(case["steps"][0]["day"])
    days: dict[date, DayRecord] = {}
    problems: list[str] = []
    for step in case["steps"]:
        day = d(step["day"])
        inp = step["input"]
        days[day] = DayRecord(
            qualified=inp["qualified"], rest_day=inp["healthDay"] and not inp["qualified"]
        )
        got: dict[str, Any] = {}
        for under10 in (False, True):
            st = compute_game_state(
                days,
                day + timedelta(days=1),
                rules,
                freezes_equipped=0,
                under10=under10,
                previous_growth=5,  # the vectors' plant starts as a sprout with 5 points
                since=start,
            )
            if under10:
                got["state_under10"] = st.pet_state
            else:
                got |= {
                    "plant_health": st.health,
                    "mood": st.pet_mood,
                    "energy": st.pet_energy,
                    "state": st.pet_state,
                }
        want = {k: step[k] for k in got}
        if got != want:
            problems.append(f"{step['day']}: server {got} != app-core {want}")
    assert not problems, "\n".join(problems)


# --- FSRS ----------------------------------------------------------------------------------------


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@pytest.mark.parametrize("case", FSRS["cases"], ids=ids(FSRS))
def test_fsrs_vectors(case: dict[str, Any]) -> None:
    params = case["params"]
    assert params["enable_fuzz"] is False and params["maximum_interval"] == 36500
    scheduler = make_scheduler(None, params["request_retention"])
    reviews: list[ReviewInput] = []
    problems: list[str] = []
    for i, step in enumerate(case["steps"]):
        at = datetime.fromisoformat(step["reviewed_at"].replace("Z", "+00:00"))
        reviews.append(ReviewInput(f"r{i:03d}", step["rating"], at))
        card, _ = replay(reviews, scheduler)
        got: dict[str, Any] = {
            "due": iso(card.due_at),
            "stability": round(card.stability, 6),
            "difficulty": round(card.difficulty, 6),
            "state": card.state,
            "reps": card.reps,
            "lapses": card.lapses,
            # ts-fsrs counts whole days on review cards and 0 in (re)learning steps.
            "scheduled_days": round((card.due_at - at).total_seconds() / 86400)
            if card.state == 2
            else 0,
        }
        want = {k: step[k] for k in got}
        for key in ("stability", "difficulty"):
            # ts-fsrs rounds some intermediate values to 8 decimal places and py-fsrs doesn't,
            # so the memory state can differ in the 8th significant digit after a few reviews.
            if math.isclose(got[key], want[key], rel_tol=1e-6):
                got[key] = want[key]
        for p in step["previews"]:
            later = [*reviews, ReviewInput(f"r{i:03d}z", p["rating"], at)]
            got[f"preview_{p['rating']}"] = iso(replay(later, scheduler)[0].due_at)
            want[f"preview_{p['rating']}"] = p["due"]
        if got != want:
            diff = {k: (got[k], want[k]) for k in got if got[k] != want[k]}
            problems.append(f"step {i + 1}: (server, app-core) {diff}")
    assert not problems, "\n".join(problems)
