"""Server XP formula. The client's ``xp`` value in ``lesson_completed`` is a prediction only; the
server recomputes from the event (TRD §10 anti-cheat). Numbers come from the ``xp.rules`` flag."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

# Events that credit more than a point or two of XP. A sync batch carrying one is "XP-heavy" and
# needs device attestation when security.attestation_required is on (G-10, TRD §14); single
# reviews earn 1 XP each and stay under the hourly cap.
XP_HEAVY_TYPES = frozenset(
    {
        "lesson_completed",
        "practice_session_completed",
        "daily_challenge_completed",
        "mock_section_submitted",
    }
)


@dataclass(frozen=True)
class XpRules:
    lesson_base: int = 10
    lesson_per_correct: int = 2
    lesson_max: int = 40
    review: int = 1
    practice_per_correct: int = 2
    practice_max: int = 60
    challenge: int = 15
    mock_section: int = 20
    hourly_cap: int = 400

    @classmethod
    def from_flags(cls, flags: Mapping[str, Any]) -> XpRules:
        raw = flags.get("xp.rules")
        if not isinstance(raw, dict):
            return cls()
        known = {
            k: int(v)
            for k, v in raw.items()
            if k in cls.__dataclass_fields__ and isinstance(v, int)
        }
        return cls(**known)


def xp_for_event(
    event_type: str, payload: Mapping[str, Any], rules: XpRules
) -> tuple[int, str] | None:
    """Returns (amount, ledger source) or None when the event earns no XP."""
    if event_type == "lesson_completed":
        total = max(0, int(payload.get("total", 0)))
        correct = min(max(0, int(payload.get("correct", 0))), total)
        amount = min(rules.lesson_base + rules.lesson_per_correct * correct, rules.lesson_max)
        return amount, "lesson"
    if event_type == "review_rated":
        return rules.review, "review"
    if event_type == "practice_session_completed":
        answered = max(0, int(payload.get("answered", 0)))
        correct = min(max(0, int(payload.get("correct", 0))), answered)
        return min(rules.practice_per_correct * correct, rules.practice_max), "practice"
    if event_type == "daily_challenge_completed":
        return rules.challenge, "challenge"
    if event_type == "mock_section_submitted":
        return rules.mock_section, "mock"
    return None
