"""Age band precedence (R56) against app-core's golden vectors (``test-vectors/age_band.json``).

app-core's ``resolveAgeBand`` writes the vectors; the server's ``resolve_age_band`` must give the
same band for every case. A disagreement is settled in both packages in the same pull request.
"""

from __future__ import annotations

import json
from datetime import date
from typing import Any

import pytest

from smriti_api.core.config import REPO_ROOT
from smriti_api.services.profile_rules import band_for_class, parse_birth, resolve_age_band

VECTORS: dict[str, Any] = json.loads(
    (REPO_ROOT / "packages" / "app-core" / "test-vectors" / "age_band.json").read_text()
)
TODAY = date.fromisoformat(VECTORS["today"])


def test_vector_version() -> None:
    assert VECTORS["version"] == 1


@pytest.mark.parametrize("case", VECTORS["cases"], ids=[c["name"] for c in VECTORS["cases"]])
def test_resolve_age_band_matches_app_core(case: dict[str, Any]) -> None:
    given = case["input"]
    band = resolve_age_band(
        birth=given["birth"],
        school_class=given["schoolClass"],
        stored_band=given.get("storedBand"),
        stored_source=given.get("storedSource"),
        today=TODAY,
    )
    assert band == case["expected"]


def test_class_five_is_under_ten() -> None:
    assert [band_for_class(c) for c in (4, 5, 6)] == ["u10", "u10", "10_12"]


def test_unknown_birth_month_is_the_younger_option() -> None:
    assert parse_birth(2016, TODAY) == date(2016, 12, 1)
    assert parse_birth({"year": 2016}, TODAY) == date(2016, 12, 1)
    assert parse_birth({"year": 2016, "month": 3}, TODAY) == date(2016, 3, 1)
