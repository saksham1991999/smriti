"""The server's answer checking runs lesson-core's golden vectors
(``packages/lesson-core/test-vectors``), so the device and the server agree on every answer."""

from __future__ import annotations

import json
import math
from typing import Any

import pytest

from smriti_api.core.config import REPO_ROOT
from smriti_api.services.answers import (
    AnswerFormatError,
    check_answer,
    convert_unit,
    normalize_typed,
    parse_answer,
    parse_number,
    score_answer,
)

VECTORS = REPO_ROOT / "packages" / "lesson-core" / "test-vectors"


def _load(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((VECTORS / f"{name}.json").read_text(encoding="utf-8"))
    return data


def _same(a: Any, b: Any) -> bool:
    """Deep equality with numbers compared as floats (JSON has no int/float split)."""
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b
    if isinstance(a, int | float) and isinstance(b, int | float):
        return math.isclose(float(a), float(b), rel_tol=1e-12, abs_tol=1e-12)
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_same(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_same(x, y) for x, y in zip(a, b, strict=True))
    return bool(a == b)


@pytest.mark.parametrize("case", _load("answers")["cases"], ids=lambda c: c["name"])
def test_check_answer_vectors(case: dict[str, Any]) -> None:
    result = check_answer(case["question"], parse_answer(case["answer"]))
    want = case["expect"]
    assert result.correct is want["correct"]
    assert math.isclose(result.partial, want["partial"], abs_tol=1e-12)
    assert _same(result.response, want["response"]), (result.response, want["response"])
    reason = result.detail.get("reason") if result.detail.get("kind") == "number" else None
    if result.detail.get("kind") == "invalid":
        reason = "invalid"
    assert reason == want["reason"]


@pytest.mark.parametrize("case", _load("scoring")["cases"], ids=lambda c: c["name"])
def test_score_answer_vectors(case: dict[str, Any]) -> None:
    q = case["question"]
    result = check_answer(q, parse_answer(case["answer"])) if case["answer"] else None
    assert math.isclose(score_answer(q, result, case["rule"]), case["expect"]["marks"])


def test_parse_and_normalize_vectors() -> None:
    data = _load("parsing")
    for c in data["parse"]:
        got = parse_number(c["raw"], c["allowScientific"])
        assert _same(got, c["expect"]), (c["raw"], got)
    for c in data["normalize"]:
        assert normalize_typed(c["text"]) == c["expect"], c["text"]


def test_wire_answers_and_units() -> None:
    assert parse_answer({"kind": "options", "option_ids": ["a"]}) == parse_answer(
        {"kind": "options", "optionIds": ["a"]}
    )
    with pytest.raises(AnswerFormatError):
        parse_answer({"kind": "options", "option_ids": "a"})
    with pytest.raises(AnswerFormatError):
        parse_answer({"kind": "number", "value": True})
    with pytest.raises(AnswerFormatError):
        parse_answer({"kind": "telepathy"})
    assert convert_unit(1, "km", "m") == 1000
    assert convert_unit(1, "kg", "m") is None
    # Source questions carry accepted blank texts per locale; any locale's text matches.
    q = {
        "type": "fill_blank",
        "answer": {
            "blanks": [
                {"blank": "b", "accepted": [{"key": "k", "text": {"en": ["x"], "hi": ["य"]}}]}
            ]
        },
    }
    assert check_answer(
        q, parse_answer({"kind": "blanks", "blanks": [{"blank": "b", "text": "य"}]})
    ).correct
