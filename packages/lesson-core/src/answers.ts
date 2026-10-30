/**
 * Answer checking for every question type in content-format §8. Shared by the lesson player and
 * the practice runner (learn §7.4): `checkAnswer(question, answer)` returns whether it is right,
 * how much of it is right, and the response to put in `answer_submitted`, which is option ids, a
 * number or matched keys and never the text a student typed.
 */
import type { BundleChildQuestion, BundleQuestion, MarkingRule } from "@smriti/content-schema";
import { convertUnit } from "@smriti/content-schema";

export type AnyQuestion = BundleQuestion | BundleChildQuestion;

/** What a renderer hands back. */
export type Answer =
  | { kind: "options"; optionIds: string[] }
  | { kind: "number"; value: number | string; unit?: string | null }
  | { kind: "pairs"; pairs: { left: string; right: string }[] }
  | { kind: "matrix"; rows: { row: string; columns: string[] }[] }
  | { kind: "blanks"; blanks: { blank: string; choiceId?: string; text?: string }[] }
  | { kind: "order"; order: string[] };

/** The response recorded in events: ids, a number or matched keys. Never free text. */
export type EventResponse =
  | { option_ids: string[] }
  | { value: number | null; unit: string | null }
  | { pairs: { left: string; right: string }[] }
  | { rows: { row: string; columns: string[] }[] }
  | { blanks: { blank: string; key: string | null }[] }
  | { order: string[] }
  | null;

export interface CheckResult {
  correct: boolean;
  /** Share of the answer that is right, 0..1 (1 when correct). */
  partial: number;
  response: EventResponse;
  detail: CheckDetail;
}

export type CheckDetail =
  | { kind: "options"; correctIds: string[]; chosenCorrect: string[]; chosenWrong: string[] }
  | { kind: "number"; parsed: number | null; expected: number; unitOk: boolean; reason: NumberReason }
  | { kind: "pairs"; right: string[]; wrong: string[] }
  | { kind: "blanks"; right: string[]; wrong: string[] }
  | { kind: "order"; inPlace: number }
  | { kind: "invalid"; reason: string };

export type NumberReason = "ok" | "unparsable" | "unit" | "out_of_tolerance";

const SINGLE_ANSWER = new Set(["mcq_single", "assertion_reason", "statement_based"]);

/** Single-answer types strike out the chosen wrong option after a first wrong try (learn §7.3). */
export function isSingleAnswer(q: AnyQuestion): boolean {
  return SINGLE_ANSWER.has(q.type) || (q.type === "match_list" && "option_ids" in q.answer);
}

const invalid = (reason: string): CheckResult => ({
  correct: false,
  partial: 0,
  response: null,
  detail: { kind: "invalid", reason },
});

export function checkAnswer(q: AnyQuestion, answer: Answer): CheckResult {
  switch (q.type) {
    case "mcq_single":
    case "assertion_reason":
    case "statement_based":
    case "mcq_multi":
      return answer.kind === "options" ? checkOptions(q.answer.option_ids, answer.optionIds, q.type === "mcq_multi") : invalid("expected options");
    case "match_list":
      if ("option_ids" in q.answer) {
        return answer.kind === "options" ? checkOptions(q.answer.option_ids, answer.optionIds, false) : invalid("expected options");
      }
      return answer.kind === "pairs" ? checkPairs(q.answer.pairs, answer.pairs) : invalid("expected pairs");
    case "numerical":
      return answer.kind === "number" ? checkNumber(q, answer) : invalid("expected a number");
    case "integer":
      return answer.kind === "number" ? checkInteger(q.answer.value, answer) : invalid("expected a number");
    case "matrix_match":
      return answer.kind === "matrix" ? checkMatrix(q.answer.pairs, answer.rows) : invalid("expected rows");
    case "fill_blank":
      return answer.kind === "blanks" ? checkBlanks(q, answer.blanks) : invalid("expected blanks");
    case "order_steps":
      return answer.kind === "order" ? checkOrder(q.answer.order, answer.order) : invalid("expected an order");
    case "paragraph":
      return invalid("answer each child question of a paragraph on its own");
  }
}

function checkOptions(key: string[], chosen: string[], multi: boolean): CheckResult {
  const keySet = new Set(key);
  const picked = [...new Set(chosen)];
  const chosenCorrect = picked.filter((id) => keySet.has(id));
  const chosenWrong = picked.filter((id) => !keySet.has(id));
  const correct = chosenWrong.length === 0 && chosenCorrect.length === keySet.size;
  // JEE-style partial credit: correct options chosen, only when no wrong one is chosen.
  const partial = correct ? 1 : multi && chosenWrong.length === 0 ? chosenCorrect.length / keySet.size : 0;
  return {
    correct,
    partial,
    response: { option_ids: picked.sort() },
    detail: { kind: "options", correctIds: [...keySet].sort(), chosenCorrect, chosenWrong },
  };
}

/** Parse what a student typed into a number: digits, one decimal point, a sign, optional exponent. */
export function parseNumber(raw: number | string, allowScientific = true): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = raw
    .normalize("NFKC")
    .trim()
    .replace(/[−–]/g, "-") // minus signs from keyboards
    .replace(/\s+/g, "")
    .replace(/,(?=\d{3}(\D|$))/g, ""); // thousands separators
  const re = allowScientific ? /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/ : /^[-+]?(\d+\.?\d*|\.\d+)$/;
  if (!re.test(s)) {
    // "1.5 × 10^3" and "1.5x10^3"
    const m = allowScientific ? s.match(/^([-+]?(?:\d+\.?\d*|\.\d+))[x×*]10\^([-+]?\d+)$/) : null;
    return m ? Number(m[1]) * 10 ** Number(m[2]) : null;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function withinTolerance(value: number, expected: number, tol: { abs?: number; rel?: number } | undefined, decimals?: number): boolean {
  const diff = Math.abs(value - expected);
  if (tol && (tol.abs !== undefined || tol.rel !== undefined)) {
    if (tol.abs !== undefined && diff <= tol.abs + 1e-12) return true;
    if (tol.rel !== undefined && diff <= Math.abs(expected) * tol.rel + 1e-12) return true;
    return false;
  }
  if (decimals !== undefined) return diff <= 0.5 * 10 ** -decimals + 1e-12;
  return diff <= Math.max(Math.abs(expected), 1) * 1e-9;
}

function checkNumber(
  q: Extract<AnyQuestion, { type: "numerical" }>,
  answer: Extract<Answer, { kind: "number" }>,
): CheckResult {
  const expected = q.answer.value;
  const keyUnit = q.answer.unit ?? null;
  const parsed = parseNumber(answer.value, q.answer_format?.allow_scientific ?? true);
  const given = answer.unit ?? null;
  const response = { value: parsed, unit: given ?? keyUnit };
  if (parsed === null) {
    return { correct: false, partial: 0, response, detail: { kind: "number", parsed, expected, unitOk: true, reason: "unparsable" } };
  }
  let value = parsed;
  let unitOk = true;
  if (given && keyUnit && given !== keyUnit) {
    const converted = convertUnit(parsed, given, keyUnit);
    if (converted === undefined) unitOk = false;
    else value = converted;
  } else if (given && !keyUnit) {
    unitOk = false;
  }
  if (!unitOk) {
    return { correct: false, partial: 0, response, detail: { kind: "number", parsed, expected, unitOk, reason: "unit" } };
  }
  const ok = withinTolerance(value, expected, q.answer.tolerance, q.answer_format?.decimals);
  return {
    correct: ok,
    partial: ok ? 1 : 0,
    response,
    detail: { kind: "number", parsed, expected, unitOk, reason: ok ? "ok" : "out_of_tolerance" },
  };
}

function checkInteger(expected: number, answer: Extract<Answer, { kind: "number" }>): CheckResult {
  const parsed = parseNumber(answer.value, false);
  const ok = parsed !== null && Number.isInteger(parsed) && parsed === expected;
  return {
    correct: ok,
    partial: ok ? 1 : 0,
    response: { value: parsed, unit: answer.unit ?? null },
    detail: { kind: "number", parsed, expected, unitOk: true, reason: parsed === null ? "unparsable" : ok ? "ok" : "out_of_tolerance" },
  };
}

function checkPairs(key: { left: string; right: string }[], given: { left: string; right: string }[]): CheckResult {
  const want = new Map(key.map((p) => [p.left, p.right]));
  const got = new Map(given.map((p) => [p.left, p.right]));
  const right = [...want.keys()].filter((l) => got.get(l) === want.get(l));
  const wrong = [...want.keys()].filter((l) => got.get(l) !== want.get(l));
  const extra = [...got.keys()].filter((l) => !want.has(l));
  const correct = wrong.length === 0 && extra.length === 0;
  return {
    correct,
    partial: correct ? 1 : right.length / want.size,
    response: { pairs: [...got.entries()].map(([left, r]) => ({ left, right: r })).sort((a, b) => a.left.localeCompare(b.left)) },
    detail: { kind: "pairs", right, wrong: [...wrong, ...extra] },
  };
}

function checkMatrix(key: { row: string; columns: string[] }[], given: { row: string; columns: string[] }[]): CheckResult {
  const got = new Map(given.map((r) => [r.row, new Set(r.columns)]));
  const right: string[] = [];
  const wrong: string[] = [];
  for (const { row, columns } of key) {
    const g = got.get(row) ?? new Set<string>();
    const same = g.size === columns.length && columns.every((c) => g.has(c));
    (same ? right : wrong).push(row);
  }
  const correct = wrong.length === 0;
  return {
    correct,
    partial: correct ? 1 : right.length / key.length,
    response: {
      rows: [...got.entries()]
        .map(([row, cols]) => ({ row, columns: [...cols].sort() }))
        .sort((a, b) => a.row.localeCompare(b.row)),
    },
    detail: { kind: "pairs", right, wrong },
  };
}

/** Normalise typed text for matching: Unicode NFKC, case, spaces and edge punctuation. */
export function normalizeTyped(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[​-‍﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s"'“”‘’.,;:!?।]+|[\s"'“”‘’.,;:!?।]+$/g, "");
}

function checkBlanks(
  q: Extract<AnyQuestion, { type: "fill_blank" }>,
  given: { blank: string; choiceId?: string; text?: string }[],
): CheckResult {
  const got = new Map(given.map((g) => [g.blank, g]));
  const right: string[] = [];
  const wrong: string[] = [];
  const response: { blank: string; key: string | null }[] = [];
  for (const k of q.answer.blanks) {
    const g = got.get(k.blank);
    let key: string | null = null;
    let ok = false;
    if ("choice_id" in k) {
      key = g?.choiceId ?? null;
      ok = key === k.choice_id;
    } else if (g?.text !== undefined) {
      const typed = normalizeTyped(g.text);
      const hit = k.accepted.find((a) => (a.text as string[]).some((t) => normalizeTyped(t) === typed));
      key = hit?.key ?? null;
      ok = hit !== undefined;
    }
    response.push({ blank: k.blank, key });
    (ok ? right : wrong).push(k.blank);
  }
  const correct = wrong.length === 0;
  return {
    correct,
    partial: correct ? 1 : right.length / q.answer.blanks.length,
    response: { blanks: response },
    detail: { kind: "blanks", right, wrong },
  };
}

function checkOrder(key: string[], given: string[]): CheckResult {
  const inPlace = key.filter((id, i) => given[i] === id).length;
  const correct = inPlace === key.length && given.length === key.length;
  return {
    correct,
    partial: correct ? 1 : inPlace / key.length,
    response: { order: [...given] },
    detail: { kind: "order", inPlace },
  };
}

/**
 * Marks for one answer under a blueprint marking rule (mock and chapter tests). `null` result
 * means unattempted. Partial marking applies to multi-select questions when the rule has it.
 */
export function scoreAnswer(q: AnyQuestion, result: CheckResult | null, rule: MarkingRule): number {
  if (!result || result.response === null) return rule.unattempted;
  if (result.correct) return rule.correct;
  if (q.type === "mcq_multi" && rule.partial && result.detail.kind === "options") {
    const { chosenCorrect, chosenWrong } = result.detail;
    if (chosenCorrect.length > 0 && (!rule.partial.requires_no_wrong || chosenWrong.length === 0)) {
      return rule.partial.per_correct_option * chosenCorrect.length;
    }
  }
  return rule.wrong;
}
