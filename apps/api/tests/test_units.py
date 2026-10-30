"""Unit tests for XP, FSRS, flags, pagination, idempotency keys and auth helpers."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fsrs.scheduler import DEFAULT_PARAMETERS

from smriti_api.core.auth import AmrEntry, AuthContext
from smriti_api.core.errors import ApiError
from smriti_api.core.idempotency import body_fingerprint, validate_key
from smriti_api.core.pagination import clamp_limit, decode_cursor, encode_cursor, page_from_rows
from smriti_api.schemas.sync import PetNamed
from smriti_api.services.flags import FlagContext, FlagRow, evaluate, parse_version
from smriti_api.services.srs import (
    TS_FSRS_DEFAULT_RETENTION,
    TS_FSRS_LEARNING_STEPS,
    TS_FSRS_MAX_INTERVAL,
    TS_FSRS_RELEARNING_STEPS,
    ReviewInput,
    make_scheduler,
    replay,
)
from smriti_api.services.xp import XpRules, xp_for_event

# ts-fsrs 5.4.2 `default_w` (FSRS-6), copied from its dist/index.mjs, so both sides schedule alike.
TS_FSRS_DEFAULT_W = (
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796,
    1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
)  # fmt: skip


# --- XP ---------------------------------------------------------------------------------------


def test_lesson_xp_ignores_the_client_value() -> None:
    rules = XpRules()
    payload = {"total": 4, "correct": 3, "xp": 100000}
    assert xp_for_event("lesson_completed", payload, rules) == (16, "lesson")


def test_lesson_xp_is_capped_and_correct_never_exceeds_total() -> None:
    assert xp_for_event("lesson_completed", {"total": 2, "correct": 500}, XpRules()) == (
        14,
        "lesson",
    )
    assert xp_for_event("lesson_completed", {"total": 99, "correct": 99}, XpRules()) == (
        40,
        "lesson",
    )


def test_xp_rules_from_flags() -> None:
    rules = XpRules.from_flags({"xp.rules": {"review": 2, "hourly_cap": 100, "bogus": 3}})
    assert rules.review == 2
    assert rules.hourly_cap == 100
    assert xp_for_event("pet_care", {}, rules) is None


# --- FSRS -------------------------------------------------------------------------------------


def test_fsrs_defaults_match_ts_fsrs() -> None:
    assert tuple(DEFAULT_PARAMETERS) == pytest.approx(TS_FSRS_DEFAULT_W)
    sched = make_scheduler()
    assert sched.desired_retention == TS_FSRS_DEFAULT_RETENTION == 0.9
    assert sched.maximum_interval == TS_FSRS_MAX_INTERVAL == 36500
    assert tuple(sched.learning_steps) == TS_FSRS_LEARNING_STEPS
    assert tuple(sched.relearning_steps) == TS_FSRS_RELEARNING_STEPS
    assert sched.enable_fuzzing is False


def test_fsrs_replay_good_good() -> None:
    t0 = datetime(2026, 10, 1, 9, tzinfo=UTC)
    reviews = [ReviewInput("r1", 3, t0), ReviewInput("r2", 3, t0 + timedelta(minutes=10))]
    card, outcomes = replay(reviews)
    assert card.reps == 2
    assert card.state == 2  # Review
    assert card.due_at > t0 + timedelta(days=1)
    assert outcomes[0].state_before == 0  # new
    assert card.lapses == 0


def test_fsrs_replay_is_order_independent_and_counts_lapses() -> None:
    t0 = datetime(2026, 10, 1, 9, tzinfo=UTC)
    reviews = [
        ReviewInput("a", 4, t0),
        ReviewInput("b", 1, t0 + timedelta(days=10)),
        ReviewInput("c", 3, t0 + timedelta(days=10, minutes=10)),
    ]
    forward, _ = replay(reviews)
    backward, _ = replay(list(reversed(reviews)))
    assert forward == backward
    assert forward.lapses == 1


def test_fsrs_replay_needs_reviews() -> None:
    with pytest.raises(ValueError):
        replay([])


# --- flags ------------------------------------------------------------------------------------


def _flag(value: Any, rules: list[Any]) -> FlagRow:
    return FlagRow(key="k", value=value, rules=rules)


def test_flag_rules_first_match_wins() -> None:
    rows = {
        "k": _flag(
            1,
            [
                {"variant": "jee", "platform": "ios", "value": 2},
                {"variant": "jee", "value": 3},
                {"min_app_version": "1.2.0", "value": 4},
            ],
        )
    }
    assert evaluate(rows, FlagContext("jee", "ios", None))["k"] == 2
    assert evaluate(rows, FlagContext("jee", "android", None))["k"] == 3
    assert evaluate(rows, FlagContext("neet", None, "1.10.0"))["k"] == 4
    assert evaluate(rows, FlagContext("neet", None, "1.1.9"))["k"] == 1
    assert evaluate(rows, FlagContext())["k"] == 1


def test_parse_version() -> None:
    assert parse_version("1.10.2-beta") == (1, 10, 2)
    assert parse_version(None) == ()


# --- pagination and idempotency ----------------------------------------------------------------


def test_cursor_round_trip_and_rejects_junk() -> None:
    cursor = encode_cursor({"at": "2026-10-29T00:00:00+00:00", "id": "x"})
    assert decode_cursor(cursor) == {"at": "2026-10-29T00:00:00+00:00", "id": "x"}
    assert decode_cursor(None) is None
    with pytest.raises(ApiError):
        decode_cursor("%%%not-base64")
    assert clamp_limit(None) == 20
    assert clamp_limit(1000) == 100


def test_page_from_rows() -> None:
    page = page_from_rows([1, 2, 3], 2, lambda r: {"n": r})
    assert page.items == [1, 2]
    assert decode_cursor(page.next_cursor) == {"n": 2}
    assert page_from_rows([1], 2, lambda r: {"n": r}).next_cursor is None


def test_idempotency_keys() -> None:
    assert validate_key("abcd-1234") == "abcd-1234"
    assert validate_key(None, required=False) is None
    for bad in ("short", "has space in it", "x" * 129):
        with pytest.raises(ApiError):
            validate_key(bad)
    with pytest.raises(ApiError):
        validate_key(None)
    assert body_fingerprint({"a": 1, "b": 2}) == body_fingerprint({"b": 2, "a": 1})


# --- auth and display text ----------------------------------------------------------------------


def test_amr_freshness() -> None:
    now = 1_800_000_000
    ctx = AuthContext(
        user_id=uuid.UUID(int=1),
        is_anonymous=False,
        role="authenticated",
        amr=[AmrEntry(method="oauth", timestamp=now - 100)],
    )
    assert ctx.amr_fresh_within(300, now=now)
    assert not ctx.amr_fresh_within(60, now=now)
    guest = ctx.model_copy(update={"amr": [AmrEntry(method="anonymous", timestamp=now)]})
    assert not guest.amr_fresh_within(300, now=now)


@pytest.mark.parametrize("name", ["Miso", "मीसो", "Bubbles Two"])
def test_pet_names_accept_letters(name: str) -> None:
    assert PetNamed(species="cat", name=name).name == name


@pytest.mark.parametrize("name", ["", "a" * 13, "call 9999", "x@y.com", "<b>"])
def test_pet_names_reject_contact_details_and_symbols(name: str) -> None:
    with pytest.raises(ValueError):
        PetNamed(species="cat", name=name)
