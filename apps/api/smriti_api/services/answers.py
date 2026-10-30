"""Answer checking: a port of ``packages/lesson-core/src/answers.ts`` (``checkAnswer``,
``parseNumber``, ``normalizeTyped``, ``scoreAnswer``) and of ``convertUnit`` in
``packages/content-schema/src/units.ts``.

Both sides run the shared vectors in ``packages/lesson-core/test-vectors/answers.json``, so the
server (mocks, the daily challenge, online practice) and the device can never disagree on
whether an answer is right. The response this returns is option ids, a number or matched keys,
never the text a student typed.
"""

from __future__ import annotations

import math
import re
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

NumberReason = Literal["ok", "unparsable", "unit", "out_of_tolerance"]

SINGLE_ANSWER = frozenset({"mcq_single", "assertion_reason", "statement_based"})
OPTION_TYPES = frozenset({"mcq_single", "assertion_reason", "statement_based", "mcq_multi"})
QUESTION_TYPES = frozenset(
    {
        "mcq_single",
        "mcq_multi",
        "numerical",
        "integer",
        "matrix_match",
        "match_list",
        "assertion_reason",
        "statement_based",
        "paragraph",
        "fill_blank",
        "order_steps",
    }
)

# ── Units (content-schema/src/units.ts): exact SI factors, temperatures with an offset ─────────


@dataclass(frozen=True)
class UnitInfo:
    dimension: str
    factor: float
    offset: float | None = None


def _u(dimension: str, factor: float, offset: float | None = None) -> UnitInfo:
    return UnitInfo(dimension, factor, offset)


_UNITS: dict[str, UnitInfo] = {
    "m": _u("length", 1),
    "km": _u("length", 1e3),
    "cm": _u("length", 1e-2),
    "mm": _u("length", 1e-3),
    "µm": _u("length", 1e-6),
    "um": _u("length", 1e-6),
    "nm": _u("length", 1e-9),
    "kg": _u("mass", 1),
    "g": _u("mass", 1e-3),
    "mg": _u("mass", 1e-6),
    "t": _u("mass", 1e3),
    "s": _u("time", 1),
    "ms": _u("time", 1e-3),
    "µs": _u("time", 1e-6),
    "min": _u("time", 60),
    "h": _u("time", 3600),
    "m/s": _u("speed", 1),
    "km/h": _u("speed", 1000 / 3600),
    "cm/s": _u("speed", 1e-2),
    "m/s^2": _u("acceleration", 1),
    "m/s²": _u("acceleration", 1),
    "N": _u("force", 1),
    "kN": _u("force", 1e3),
    "dyn": _u("force", 1e-5),
    "J": _u("energy", 1),
    "kJ": _u("energy", 1e3),
    "MJ": _u("energy", 1e6),
    "eV": _u("energy", 1.602176634e-19),
    "cal": _u("energy", 4.184),
    "kcal": _u("energy", 4184),
    "kWh": _u("energy", 3.6e6),
    "W": _u("power", 1),
    "kW": _u("power", 1e3),
    "MW": _u("power", 1e6),
    "Pa": _u("pressure", 1),
    "kPa": _u("pressure", 1e3),
    "bar": _u("pressure", 1e5),
    "atm": _u("pressure", 101325),
    "C": _u("charge", 1),
    "mC": _u("charge", 1e-3),
    "µC": _u("charge", 1e-6),
    "uC": _u("charge", 1e-6),
    "V": _u("voltage", 1),
    "mV": _u("voltage", 1e-3),
    "kV": _u("voltage", 1e3),
    "A": _u("current", 1),
    "mA": _u("current", 1e-3),
    "Ω": _u("resistance", 1),
    "ohm": _u("resistance", 1),
    "kΩ": _u("resistance", 1e3),
    "MΩ": _u("resistance", 1e6),
    "K": _u("temperature", 1),
    "°C": _u("temperature", 1, 273.15),
    "mol": _u("amount", 1),
    "mmol": _u("amount", 1e-3),
    "m^3": _u("volume", 1),
    "m³": _u("volume", 1),
    "L": _u("volume", 1e-3),
    "mL": _u("volume", 1e-6),
    "cm^3": _u("volume", 1e-6),
    "cm³": _u("volume", 1e-6),
    "Hz": _u("frequency", 1),
    "kHz": _u("frequency", 1e3),
    "MHz": _u("frequency", 1e6),
    "rad": _u("angle", 1),
    "°": _u("angle", math.pi / 180),
    "deg": _u("angle", math.pi / 180),
    "M": _u("concentration", 1),
    "mol/L": _u("concentration", 1),
    "%": _u("ratio", 0.01),
}


def unit_info(unit: str) -> UnitInfo | None:
    return _UNITS.get(unit.strip())


def convert_unit(value: float, from_unit: str, to_unit: str) -> float | None:
    """Convert between units of one dimension; None when a unit is unknown or dimensions differ."""
    if from_unit.strip() == to_unit.strip():
        return value
    a, b = unit_info(from_unit), unit_info(to_unit)
    if a is None or b is None or a.dimension != b.dimension:
        return None
    base = value * a.factor + (a.offset or 0)
    return (base - (b.offset or 0)) / b.factor


# ── Answers ───────────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class OptionsAnswer:
    option_ids: list[str]
    kind: Literal["options"] = "options"


@dataclass(frozen=True)
class NumberAnswer:
    value: float | int | str
    unit: str | None = None
    kind: Literal["number"] = "number"


@dataclass(frozen=True)
class PairsAnswer:
    pairs: list[tuple[str, str]]
    kind: Literal["pairs"] = "pairs"


@dataclass(frozen=True)
class MatrixAnswer:
    rows: list[tuple[str, list[str]]]
    kind: Literal["matrix"] = "matrix"


@dataclass(frozen=True)
class BlankAnswer:
    blank: str
    choice_id: str | None = None
    text: str | None = None


@dataclass(frozen=True)
class BlanksAnswer:
    blanks: list[BlankAnswer]
    kind: Literal["blanks"] = "blanks"


@dataclass(frozen=True)
class OrderAnswer:
    order: list[str]
    kind: Literal["order"] = "order"


Answer = OptionsAnswer | NumberAnswer | PairsAnswer | MatrixAnswer | BlanksAnswer | OrderAnswer


class AnswerFormatError(ValueError):
    """The answer object doesn't have the shape its ``kind`` needs."""


def _strs(value: Any, what: str) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise AnswerFormatError(f"{what} must be a list of strings")
    return list(value)


def parse_answer(raw: Mapping[str, Any]) -> Answer:
    """An answer from the wire (snake_case) or from lesson-core's shape (camelCase)."""
    kind = raw.get("kind")
    if kind == "options":
        return OptionsAnswer(_strs(raw.get("option_ids", raw.get("optionIds")), "option_ids"))
    if kind == "number":
        value = raw.get("value")
        if isinstance(value, bool) or not isinstance(value, int | float | str):
            raise AnswerFormatError("value must be a number or a string")
        unit = raw.get("unit")
        if unit is not None and not isinstance(unit, str):
            raise AnswerFormatError("unit must be a string")
        return NumberAnswer(value, unit)
    if kind == "pairs":
        pairs = raw.get("pairs")
        if not isinstance(pairs, list):
            raise AnswerFormatError("pairs must be a list")
        return PairsAnswer([(str(p["left"]), str(p["right"])) for p in pairs])
    if kind == "matrix":
        rows = raw.get("rows")
        if not isinstance(rows, list):
            raise AnswerFormatError("rows must be a list")
        return MatrixAnswer([(str(r["row"]), _strs(r["columns"], "columns")) for r in rows])
    if kind == "blanks":
        blanks = raw.get("blanks")
        if not isinstance(blanks, list):
            raise AnswerFormatError("blanks must be a list")
        out = []
        for b in blanks:
            choice = b.get("choice_id", b.get("choiceId"))
            text = b.get("text")
            out.append(
                BlankAnswer(
                    str(b["blank"]),
                    str(choice) if choice is not None else None,
                    str(text) if text is not None else None,
                )
            )
        return BlanksAnswer(out)
    if kind == "order":
        return OrderAnswer(_strs(raw.get("order"), "order"))
    raise AnswerFormatError("unknown answer kind")


@dataclass(frozen=True)
class CheckResult:
    correct: bool
    partial: float
    # The response for events and storage: ids, a number or matched keys. None when invalid.
    response: dict[str, Any] | None
    detail: dict[str, Any] = field(default_factory=dict)

    @property
    def attempted(self) -> bool:
        return self.response is not None


def _invalid(reason: str) -> CheckResult:
    return CheckResult(False, 0.0, None, {"kind": "invalid", "reason": reason})


def is_single_answer(q: Mapping[str, Any]) -> bool:
    answer = q.get("answer") or {}
    return q.get("type") in SINGLE_ANSWER or (
        q.get("type") == "match_list" and "option_ids" in answer
    )


def check_answer(q: Mapping[str, Any], answer: Answer) -> CheckResult:
    """``q`` is a bundle question (localized) or a source question (``{en, hi}`` texts); only
    ``type``, ``answer`` and ``answer_format`` are read."""
    qtype = q.get("type")
    key: Mapping[str, Any] = q.get("answer") or {}
    if qtype in OPTION_TYPES:
        if not isinstance(answer, OptionsAnswer):
            return _invalid("expected options")
        return _check_options(key.get("option_ids") or [], answer.option_ids, qtype == "mcq_multi")
    if qtype == "match_list":
        if "option_ids" in key:
            if not isinstance(answer, OptionsAnswer):
                return _invalid("expected options")
            return _check_options(key["option_ids"], answer.option_ids, False)
        if not isinstance(answer, PairsAnswer):
            return _invalid("expected pairs")
        return _check_pairs(key.get("pairs") or [], answer.pairs)
    if qtype == "numerical":
        if not isinstance(answer, NumberAnswer):
            return _invalid("expected a number")
        return _check_number(q, answer)
    if qtype == "integer":
        if not isinstance(answer, NumberAnswer):
            return _invalid("expected a number")
        return _check_integer(key.get("value"), answer)
    if qtype == "matrix_match":
        if not isinstance(answer, MatrixAnswer):
            return _invalid("expected rows")
        return _check_matrix(key.get("pairs") or [], answer.rows)
    if qtype == "fill_blank":
        if not isinstance(answer, BlanksAnswer):
            return _invalid("expected blanks")
        return _check_blanks(key.get("blanks") or [], answer.blanks)
    if qtype == "order_steps":
        if not isinstance(answer, OrderAnswer):
            return _invalid("expected an order")
        return _check_order(key.get("order") or [], answer.order)
    if qtype == "paragraph":
        return _invalid("answer each child question of a paragraph on its own")
    return _invalid("unknown question type")


def _unique(items: Sequence[str]) -> list[str]:
    seen: dict[str, None] = {}
    for i in items:
        seen.setdefault(i, None)
    return list(seen)


def _check_options(key: Sequence[str], chosen: Sequence[str], multi: bool) -> CheckResult:
    key_set = _unique(key)
    keys = set(key_set)
    picked = _unique(chosen)
    chosen_correct = [i for i in picked if i in keys]
    chosen_wrong = [i for i in picked if i not in keys]
    correct = not chosen_wrong and len(chosen_correct) == len(keys)
    if correct:
        partial = 1.0
    elif multi and not chosen_wrong and keys:
        partial = len(chosen_correct) / len(keys)
    else:
        partial = 0.0
    return CheckResult(
        correct,
        partial,
        {"option_ids": sorted(picked)},
        {
            "kind": "options",
            "correct_ids": sorted(key_set),
            "chosen_correct": chosen_correct,
            "chosen_wrong": chosen_wrong,
        },
    )


_DIGITS = r"(?:[0-9]+\.?[0-9]*|\.[0-9]+)"
_PLAIN = re.compile(rf"^[-+]?{_DIGITS}$")
_SCI = re.compile(rf"^[-+]?{_DIGITS}(?:[eE][-+]?[0-9]+)?$")
_TIMES_TEN = re.compile(rf"^([-+]?{_DIGITS})[x\u00d7*]10\^([-+]?[0-9]+)$")
_THOUSANDS = re.compile(r",(?=[0-9]{3}(?:[^0-9]|$))")


def parse_number(raw: float | int | str, allow_scientific: bool = True) -> float | None:
    """Parse what a student typed: digits, one decimal point, a sign, an optional exponent."""
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int | float):
        value = float(raw)
        return value if math.isfinite(value) else None
    s = unicodedata.normalize("NFKC", raw).strip()
    s = re.sub("[\u2212\u2013]", "-", s)
    s = re.sub(r"\s+", "", s)
    s = _THOUSANDS.sub("", s)
    if not (_SCI if allow_scientific else _PLAIN).match(s):
        m = _TIMES_TEN.match(s) if allow_scientific else None
        if m is None:
            return None
        value = float(m.group(1)) * 10.0 ** int(m.group(2))
        return value if math.isfinite(value) else None
    try:
        value = float(s)
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def _within_tolerance(
    value: float, expected: float, tol: Mapping[str, Any] | None, decimals: int | None
) -> bool:
    diff = abs(value - expected)
    if tol and (tol.get("abs") is not None or tol.get("rel") is not None):
        if tol.get("abs") is not None and diff <= float(tol["abs"]) + 1e-12:
            return True
        return tol.get("rel") is not None and diff <= abs(expected) * float(tol["rel"]) + 1e-12
    if decimals is not None:
        return diff <= 0.5 * 10.0 ** (-decimals) + 1e-12
    return diff <= max(abs(expected), 1) * 1e-9


def _check_number(q: Mapping[str, Any], answer: NumberAnswer) -> CheckResult:
    key = q.get("answer") or {}
    expected = float(key["value"])
    key_unit: str | None = key.get("unit") or None
    fmt = q.get("answer_format") or {}
    parsed = parse_number(answer.value, bool(fmt.get("allow_scientific", True)))
    given = answer.unit or None
    response = {"value": parsed, "unit": given or key_unit}
    if parsed is None:
        detail = {"kind": "number", "parsed": None, "expected": expected, "unit_ok": True}
        return CheckResult(False, 0.0, response, {**detail, "reason": "unparsable"})
    value = parsed
    unit_ok = True
    if given and key_unit and given != key_unit:
        converted = convert_unit(parsed, given, key_unit)
        if converted is None:
            unit_ok = False
        else:
            value = converted
    elif given and not key_unit:
        unit_ok = False
    if not unit_ok:
        return CheckResult(
            False,
            0.0,
            response,
            {
                "kind": "number",
                "parsed": parsed,
                "expected": expected,
                "unit_ok": False,
                "reason": "unit",
            },
        )
    decimals = fmt.get("decimals")
    ok = _within_tolerance(
        value, expected, key.get("tolerance"), int(decimals) if decimals is not None else None
    )
    return CheckResult(
        ok,
        1.0 if ok else 0.0,
        response,
        {
            "kind": "number",
            "parsed": parsed,
            "expected": expected,
            "unit_ok": True,
            "reason": "ok" if ok else "out_of_tolerance",
        },
    )


def _check_integer(expected: Any, answer: NumberAnswer) -> CheckResult:
    parsed = parse_number(answer.value, False)
    ok = (
        parsed is not None
        and expected is not None
        and parsed.is_integer()
        and parsed == float(expected)
    )
    reason = "unparsable" if parsed is None else "ok" if ok else "out_of_tolerance"
    return CheckResult(
        ok,
        1.0 if ok else 0.0,
        {"value": parsed, "unit": answer.unit or None},
        {
            "kind": "number",
            "parsed": parsed,
            "expected": expected,
            "unit_ok": True,
            "reason": reason,
        },
    )


def _sort_key(s: str) -> tuple[str, str]:
    # lesson-core sorts with localeCompare; ids are lower-case ASCII, where this matches it.
    return (s.casefold(), s)


def _check_pairs(key: Sequence[Mapping[str, Any]], given: Sequence[tuple[str, str]]) -> CheckResult:
    want = {str(p["left"]): str(p["right"]) for p in key}
    got: dict[str, str] = {}
    for left, right in given:
        got[left] = right
    right_ = [left for left in want if got.get(left) == want[left]]
    wrong = [left for left in want if got.get(left) != want[left]]
    extra = [left for left in got if left not in want]
    correct = not wrong and not extra
    partial = 1.0 if correct else (len(right_) / len(want) if want else 0.0)
    pairs = sorted(
        ({"left": k, "right": v} for k, v in got.items()), key=lambda p: _sort_key(p["left"])
    )
    return CheckResult(
        correct,
        partial,
        {"pairs": pairs},
        {"kind": "pairs", "right": right_, "wrong": wrong + extra},
    )


def _check_matrix(
    key: Sequence[Mapping[str, Any]], given: Sequence[tuple[str, list[str]]]
) -> CheckResult:
    got: dict[str, set[str]] = {}
    for row, cols in given:
        got[row] = set(cols)
    right: list[str] = []
    wrong: list[str] = []
    for k in key:
        row = str(k["row"])
        columns = [str(c) for c in k["columns"]]
        g = got.get(row, set())
        same = len(g) == len(columns) and all(c in g for c in columns)
        (right if same else wrong).append(row)
    correct = not wrong
    partial = 1.0 if correct else (len(right) / len(key) if key else 0.0)
    rows = sorted(
        ({"row": r, "columns": sorted(cols)} for r, cols in got.items()),
        key=lambda r: _sort_key(str(r["row"])),
    )
    return CheckResult(
        correct, partial, {"rows": rows}, {"kind": "pairs", "right": right, "wrong": wrong}
    )


_ZERO_WIDTH = re.compile("[\u200b-\u200d\ufeff]")
_PUNCT = "\\s\"'\u201c\u201d\u2018\u2019.,;:!?\u0964"
_EDGE_PUNCT = re.compile(f"^[{_PUNCT}]+|[{_PUNCT}]+$")


def normalize_typed(text: str) -> str:
    """Normalise typed text for matching: Unicode NFKC, case, spaces and edge punctuation."""
    s = unicodedata.normalize("NFKC", text).lower()
    s = _ZERO_WIDTH.sub("", s)
    s = re.sub(r"\s+", " ", s).strip()
    return _EDGE_PUNCT.sub("", s)


def _accepted_texts(accepted: Any) -> list[str]:
    # Bundles carry the localized list; source questions carry {en: [...], hi: [...]}.
    if isinstance(accepted, list):
        return [str(t) for t in accepted]
    if isinstance(accepted, Mapping):
        return [str(t) for texts in accepted.values() if isinstance(texts, list) for t in texts]
    return []


def _check_blanks(key: Sequence[Mapping[str, Any]], given: Sequence[BlankAnswer]) -> CheckResult:
    got = {g.blank: g for g in given}
    right: list[str] = []
    wrong: list[str] = []
    response: list[dict[str, Any]] = []
    for k in key:
        blank = str(k["blank"])
        g = got.get(blank)
        matched: str | None = None
        ok = False
        if "choice_id" in k:
            matched = g.choice_id if g else None
            ok = matched == k["choice_id"]
        elif g is not None and g.text is not None:
            typed = normalize_typed(g.text)
            for acc in k.get("accepted") or []:
                if any(normalize_typed(t) == typed for t in _accepted_texts(acc.get("text"))):
                    matched = str(acc["key"])
                    ok = True
                    break
        response.append({"blank": blank, "key": matched})
        (right if ok else wrong).append(blank)
    correct = not wrong
    partial = 1.0 if correct else (len(right) / len(key) if key else 0.0)
    return CheckResult(
        correct, partial, {"blanks": response}, {"kind": "blanks", "right": right, "wrong": wrong}
    )


def _check_order(key: Sequence[str], given: Sequence[str]) -> CheckResult:
    in_place = sum(1 for i, step in enumerate(key) if i < len(given) and given[i] == step)
    correct = in_place == len(key) and len(given) == len(key)
    partial = 1.0 if correct else (in_place / len(key) if key else 0.0)
    return CheckResult(
        correct, partial, {"order": list(given)}, {"kind": "order", "in_place": in_place}
    )


def score_answer(
    q: Mapping[str, Any], result: CheckResult | None, rule: Mapping[str, Any]
) -> float:
    """Marks for one answer under a blueprint marking rule. ``None`` means unattempted. Partial
    marking applies to multi-select questions when the rule has it."""
    if result is None or result.response is None:
        return float(rule["unattempted"])
    if result.correct:
        return float(rule["correct"])
    partial = rule.get("partial")
    if q.get("type") == "mcq_multi" and partial and result.detail.get("kind") == "options":
        chosen_correct = result.detail["chosen_correct"]
        chosen_wrong = result.detail["chosen_wrong"]
        if chosen_correct and (not partial.get("requires_no_wrong") or not chosen_wrong):
            return float(partial["per_correct_option"]) * len(chosen_correct)
    return float(rule["wrong"])


def event_response(response: Mapping[str, Any] | None) -> list[str] | str | float | None:
    """The sync contract's flat ``answer_submitted.response``: ids, a number or keys."""
    if response is None:
        return None
    if "option_ids" in response:
        return list(response["option_ids"])
    if "value" in response:
        value = response["value"]
        return float(value) if value is not None else None
    if "pairs" in response:
        return [f"{p['left']}:{p['right']}" for p in response["pairs"]]
    if "rows" in response:
        return [f"{r['row']}:{c}" for r in response["rows"] for c in r["columns"]]
    if "blanks" in response:
        return [f"{b['blank']}:{b['key']}" for b in response["blanks"] if b["key"] is not None]
    if "order" in response:
        return list(response["order"])
    return None
