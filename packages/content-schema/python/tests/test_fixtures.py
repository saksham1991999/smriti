"""The generated models accept the fixture course and reject bad documents."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from smriti_content import DOCUMENT_MODELS, parse_document

FIXTURES = Path(__file__).resolve().parents[4] / "content" / "fixtures"


def _documents() -> list[Path]:
    return sorted(p for p in FIXTURES.rglob("*.json") if "coverage" not in p.parts)


def _load(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(data, dict)
    return data


def test_fixture_folder_exists() -> None:
    assert len(_documents()) > 30


@pytest.mark.parametrize("path", _documents(), ids=lambda p: str(p.relative_to(FIXTURES)))
def test_fixture_parses(path: Path) -> None:
    doc = _load(path)
    assert doc.get("fixture") is True
    model = parse_document(doc)
    assert type(model) is DOCUMENT_MODELS[doc["schema"]]


def test_unknown_schema_is_refused() -> None:
    with pytest.raises(KeyError):
        parse_document({"schema": "nope@1"})


def test_bad_card_type_is_refused() -> None:
    doc = _load(FIXTURES / "lessons" / "fx" / "chapter-a" / "topic-a.deep_dive.json")
    bad = copy.deepcopy(doc)
    bad["cards"][0]["type"] = "not_a_card"
    with pytest.raises(ValidationError):
        parse_document(bad)


def test_bad_question_id_is_refused() -> None:
    doc = _load(FIXTURES / "questions" / "fx" / "chapter-a" / "topic-a.json")
    bad = copy.deepcopy(doc)
    bad["questions"][0]["id"] = "Q 1"
    with pytest.raises(ValidationError):
        parse_document(bad)


CONTENT = FIXTURES.parent


def _real(folder: str) -> list[Path]:
    return sorted((CONTENT / folder).rglob("*.json"))


@pytest.mark.parametrize(
    "path",
    _real("exams") + _real("blueprints") + _real("coverage/inventory/math"),
    ids=lambda p: str(p.relative_to(CONTENT)),
)
def test_real_exam_files_parse(path: Path) -> None:
    """Official exam data, with its "not stated in the notice" nulls, parses with the generated models."""
    doc = _load(path)
    model = parse_document(doc)
    assert model.model_dump(by_alias=True)["schema"] == doc["schema"]


def test_inventory_shapes() -> None:
    chapter = parse_document(_load(CONTENT / "coverage" / "inventory" / "math" / "sets.json"))
    excluded = parse_document(
        _load(CONTENT / "coverage" / "inventory" / "math" / "excluded-chapters.json")
    )
    assert getattr(chapter, "items", None)
    assert getattr(excluded, "excluded_chapters", None)


def test_unstated_marks_stay_none() -> None:
    doc = _load(CONTENT / "blueprints" / "upsc-cse-2026" / "prelims-gs1.v1.json")
    model = parse_document(doc).model_dump(mode="json")
    rule = model["sections"][0]["marking"]["mcq_single"]
    assert rule["correct"] is None
    assert rule["wrong"]["fraction_of_question_marks"] == pytest.approx(1 / 3)
    fields = {q["field"] for q in model["open_questions"]}
    assert "sections.gs1.marking.mcq_single.correct" in fields
