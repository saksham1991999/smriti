"""Tutor safety checks (tutor-social §A7, TRD §9.2, PRD §5.5 and §16.4).

Three layers, cheapest first:

1. **Crisis signals** (self-harm, suicidal thoughts, abuse) in English, Hindi and Hinglish. A hit
   shows the crisis card and is never counted against the free limit. The same list runs on the
   device so the card also works offline.
2. **Blocked requests** (weapons, drugs, sexual content involving minors, cheating in a live exam,
   others' personal data): a short, calm refusal with "Back to studying" chips.
3. **Optional model moderation** with the ``cheap`` tier (flag ``ai.llm_moderation``), which adds
   the off-topic redirect for under-13s and catches what the lists miss.

Personal data the student types (phone numbers, email addresses, Aadhaar-like numbers) is removed
before any model sees it. Nothing here logs message text (AGENTS rule 6).

The keyword lists are a first line only. They are safety screening terms, not study content.
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass
from typing import Literal

from smriti_api.ai.gateway import AIGateway
from smriti_api.ai.interfaces import AIError, ChatMessage

Category = Literal[
    "crisis", "violence", "weapons", "drugs", "sexual", "cheating", "personal_data", "off_topic"
]
Action = Literal["allowed", "blocked", "queued"]


@dataclass(frozen=True)
class Verdict:
    category: Category | None = None
    action: Action = "allowed"

    @property
    def crisis(self) -> bool:
        return self.category == "crisis"

    @property
    def blocked(self) -> bool:
        return self.action == "blocked"


_CRISIS = [
    r"\bkill(ing)?\s+my\s*self\b",
    r"\bsuicid(e|al)\b",
    r"\bwant\s+to\s+die\b",
    r"\bend\s+(my|this)\s+life\b",
    r"\bself[\s-]?harm\b",
    r"\b(hurt|cut)(ting)?\s+my\s*self\b",
    r"\bno\s+reason\s+to\s+live\b",
    r"\b(he|she|they|someone)\s+(is\s+)?(abusing|abuses|hits|beats)\s+me\b",
    r"\bkhud\s*kushi\b",
    r"\bjeena\s+nahi\s+chaht[aei]\b",
    r"\bmarna\s+chaht[aei]\b",
    r"\bmar\s+jana\s+chaht[aei]\b",
    "आत्महत्या",
    "ख़ुदकुशी",
    "खुदकुशी",
    r"मरना\s*चाहत[ाीे]",
    r"जीना\s*नहीं\s*चाहत[ाीे]",
    r"खुद\s*को\s*(मार|नुकसान)",
]
_BLOCKED: list[tuple[Category, str]] = [
    ("weapons", r"\b(make|build|assemble)\s+(a\s+)?(bomb|explosive|gun|pistol)s?\b"),
    ("weapons", r"\bbomb\s+(banana|kaise\s+banaye)\b"),
    ("drugs", r"\b(buy|sell|get|make)\s+(weed|ganja|cocaine|heroin|meth|mdma|lsd)\b"),
    ("violence", r"\bhow\s+to\s+(kill|poison|stab|hurt)\s+(someone|a\s+person|my\s+\w+|him|her)\b"),
    ("sexual", r"\b(porn|nudes?|sexting)\b"),
    ("cheating", r"\b(leaked|leak)\s+(paper|question\s+paper|answer\s+key)\b"),
    ("cheating", r"\b(during|in)\s+(my\s+)?(live\s+)?(exam|test)\s+(right\s+)?now\b"),
    (
        "personal_data",
        r"\b(phone\s+number|address|aadhaar)\s+of\s+(my\s+)?(teacher|classmate|friend|someone)\b",
    ),
]
_CRISIS_RE = [re.compile(p, re.IGNORECASE) for p in _CRISIS]
_BLOCKED_RE = [(c, re.compile(p, re.IGNORECASE)) for c, p in _BLOCKED]

_PII = [
    # Indian mobile numbers, with or without +91 / 0, spaces or dashes.
    re.compile(r"(?<![0-9])(?:\+?91[\s-]?|0)?[6-9][0-9]{4}[\s-]?[0-9]{5}(?![0-9])"),
    re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
    # 12-digit Aadhaar-like numbers.
    re.compile(r"(?<![0-9])[2-9][0-9]{3}[\s-]?[0-9]{4}[\s-]?[0-9]{4}(?![0-9])"),
]
PII_MARK = "[removed]"


def redact(text: str) -> tuple[str, bool]:
    """Removes personal data before the prompt is built. Returns the text and whether anything
    was removed (the tutor then reminds the student not to share personal details)."""
    out = text
    for pattern in _PII:
        out = pattern.sub(PII_MARK, out)
    return out, out != text


def screen(text: str) -> Verdict:
    """The keyword layer, used on input and on output."""
    if any(p.search(text) for p in _CRISIS_RE):
        return Verdict("crisis", "queued")
    for category, pattern in _BLOCKED_RE:
        if pattern.search(text):
            return Verdict(category, "blocked")
    return Verdict()


_MODERATION_PROMPT = (
    "You check messages sent to a study tutor for Indian school and exam students. "
    'Reply with JSON only: {"category": one of "ok", "crisis", "violence", "weapons", "drugs", '
    '"sexual", "cheating", "personal_data", "off_topic"}. "off_topic" means not about studying '
    "at all. Never repeat the message."
)


async def moderate(ai: AIGateway, text: str, user_id: uuid.UUID, *, under_13: bool) -> Verdict:
    """The model layer (``cheap`` tier). A reply that isn't the expected JSON allows the message:
    the keyword layer has already run, and the tutor prompt keeps to study topics."""
    try:
        result = await ai.complete(
            feature="tutor_moderation",
            tier="cheap",
            messages=[
                ChatMessage("system", _MODERATION_PROMPT),
                ChatMessage("user", text),
            ],
            user_id=user_id,
            max_tokens=20,
            temperature=0,
        )
    except AIError:
        return Verdict()
    try:
        category = json.loads(result.text).get("category")
    except (json.JSONDecodeError, AttributeError):
        return Verdict()
    if category == "crisis":
        return Verdict("crisis", "queued")
    if category in ("violence", "weapons", "drugs", "sexual", "cheating", "personal_data"):
        return Verdict(category, "blocked")
    if category == "off_topic" and under_13:
        # Under-13s are steered back to the topic (tutor-social §A7), not refused.
        return Verdict("off_topic", "allowed")
    return Verdict()
