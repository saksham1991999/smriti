/**
 * Golden answer-checking vectors shared with the server (`apps/api/smriti_api/services/answers.py`).
 * The server checks mock answers, the daily challenge and online practice with its port of
 * `checkAnswer` and `scoreAnswer`; its tests load `test-vectors/answers.json` and must get the same
 * results, so the device and the server never disagree on whether an answer is right.
 *
 * The questions here are synthetic shapes (ids and keys only, no study text). Regenerate after an
 * intended rule change: `UPDATE_VECTORS=1 pnpm --filter @smriti/lesson-core test`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { MarkingRule } from "@smriti/content-schema";
import { describe, expect, it } from "vitest";

import { checkAnswer, normalizeTyped, parseNumber, scoreAnswer, type AnyQuestion, type Answer } from "../src/index.js";

const DIR = join(__dirname, "..", "test-vectors");
const UPDATE = process.env["UPDATE_VECTORS"] === "1";

function golden(name: string, data: unknown) {
  const file = join(DIR, `${name}.json`);
  const text = `${JSON.stringify(data, null, 2)}\n`;
  if (UPDATE || !existsSync(file)) {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(file, text);
  }
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(JSON.parse(text));
}

type QShape = { id: string; type: string; answer?: unknown; answer_format?: unknown };
const Q = (type: string, answer: unknown, extra: Partial<QShape> = {}): QShape => ({ id: `q.vector.${type}`, type, answer, ...extra });

const single = Q("mcq_single", { option_ids: ["c"] });
const ar = Q("assertion_reason", { option_ids: ["a"] });
const multi = Q("mcq_multi", { option_ids: ["a", "c", "d"] });
const matchOpts = Q("match_list", { option_ids: ["b"] });
const matchPairs = Q("match_list", { pairs: [{ left: "p", right: "two" }, { left: "q", right: "one" }] });
const numAbs = Q("numerical", { value: 2.5, unit: "m", tolerance: { abs: 0.1 } });
const numRel = Q("numerical", { value: 1500, unit: "g", tolerance: { rel: 0.01 } });
const numDecimals = Q("numerical", { value: 0.33, unit: null }, { answer_format: { decimals: 2 } });
const numNoSci = Q("numerical", { value: 1200, unit: null }, { answer_format: { allow_scientific: false } });
const numExact = Q("numerical", { value: 9.81, unit: "m/s^2" });
const numTemp = Q("numerical", { value: 300, unit: "K", tolerance: { abs: 0.5 } });
const integer = Q("integer", { value: 7, unit: null });
const negInt = Q("integer", { value: -3, unit: null });
const matrix = Q("matrix_match", { pairs: [{ row: "p", columns: ["one", "three"] }, { row: "q", columns: ["two"] }] });
const blanks = Q("fill_blank", {
  blanks: [
    { blank: "b1", choice_id: "c2" },
    { blank: "b2", accepted: [{ key: "word-key", text: ["alpha", "alphas"] }, { key: "alt-key", text: ["अल्फ़ा"] }] },
  ],
});
const order = Q("order_steps", { order: ["s2", "s1", "s4", "s3"] });
const paragraph = Q("paragraph", undefined);

const opts = (...optionIds: string[]): Answer => ({ kind: "options", optionIds });
const num = (value: number | string, unit?: string | null): Answer => (unit === undefined ? { kind: "number", value } : { kind: "number", value, unit });

const CHECK_CASES: { name: string; question: QShape; answer: Answer }[] = [
  { name: "single right", question: single, answer: opts("c") },
  { name: "single wrong", question: single, answer: opts("b") },
  { name: "single duplicate ids", question: single, answer: opts("c", "c") },
  { name: "single two picked", question: single, answer: opts("c", "a") },
  { name: "single nothing picked", question: single, answer: opts() },
  { name: "single wrong kind", question: single, answer: num("3") },
  { name: "assertion reason right", question: ar, answer: opts("a") },
  { name: "multi all right any order", question: multi, answer: opts("d", "a", "c") },
  { name: "multi two of three", question: multi, answer: opts("a", "c") },
  { name: "multi one wrong picked", question: multi, answer: opts("a", "b") },
  { name: "match list by option", question: matchOpts, answer: opts("b") },
  { name: "match pairs right", question: matchPairs, answer: { kind: "pairs", pairs: [{ left: "q", right: "one" }, { left: "p", right: "two" }] } },
  { name: "match pairs half", question: matchPairs, answer: { kind: "pairs", pairs: [{ left: "p", right: "two" }, { left: "q", right: "two" }] } },
  { name: "match pairs extra left", question: matchPairs, answer: { kind: "pairs", pairs: [{ left: "p", right: "two" }, { left: "q", right: "one" }, { left: "r", right: "one" }] } },
  { name: "match pairs as options", question: matchPairs, answer: opts("a") },
  { name: "numerical in tolerance", question: numAbs, answer: num("2.45") },
  { name: "numerical edge of tolerance", question: numAbs, answer: num("2.6") },
  { name: "numerical out of tolerance", question: numAbs, answer: num("2.7") },
  { name: "numerical as a number", question: numAbs, answer: num(2.5) },
  { name: "numerical converted unit", question: numAbs, answer: num("250", "cm") },
  { name: "numerical wrong dimension", question: numAbs, answer: num("2.5", "s") },
  { name: "numerical unknown unit", question: numAbs, answer: num("2.5", "furlong") },
  { name: "numerical unparsable", question: numAbs, answer: num("two") },
  { name: "numerical empty", question: numAbs, answer: num("") },
  { name: "numerical relative kg", question: numRel, answer: num("1.5", "kg") },
  { name: "numerical exponent", question: numRel, answer: num("1.5e3") },
  { name: "numerical times ten", question: numRel, answer: num("1.5×10^3") },
  { name: "numerical thousands separator", question: numRel, answer: num("1,500") },
  { name: "numerical relative out", question: numRel, answer: num("1520") },
  { name: "numerical spaces and plus", question: numRel, answer: num(" +1 500 ") },
  { name: "numerical decimals rule in", question: numDecimals, answer: num("0.334") },
  { name: "numerical decimals rule out", question: numDecimals, answer: num("0.336") },
  { name: "numerical leading dot", question: numDecimals, answer: num(".33") },
  { name: "numerical no scientific", question: numNoSci, answer: num("1.2e3") },
  { name: "numerical no scientific plain", question: numNoSci, answer: num("1200") },
  { name: "numerical exact no tolerance", question: numExact, answer: num("9.81") },
  { name: "numerical exact off", question: numExact, answer: num("9.8") },
  { name: "numerical unit given without key unit", question: numDecimals, answer: num("0.33", "m") },
  { name: "numerical celsius to kelvin", question: numTemp, answer: num("26.85", "°C") },
  { name: "numerical full width digits", question: numAbs, answer: num("２.５") },
  { name: "integer right", question: integer, answer: num("7") },
  { name: "integer decimal zero", question: integer, answer: num("7.0") },
  { name: "integer near", question: integer, answer: num("7.0001") },
  { name: "integer exponent refused", question: integer, answer: num("7e0") },
  { name: "integer unicode minus", question: negInt, answer: num("−3") },
  { name: "integer en dash minus", question: negInt, answer: num("–3") },
  { name: "matrix right", question: matrix, answer: { kind: "matrix", rows: [{ row: "q", columns: ["two"] }, { row: "p", columns: ["three", "one"] }] } },
  { name: "matrix one row short", question: matrix, answer: { kind: "matrix", rows: [{ row: "p", columns: ["one"] }, { row: "q", columns: ["two"] }] } },
  { name: "matrix missing row", question: matrix, answer: { kind: "matrix", rows: [{ row: "p", columns: ["one", "three"] }] } },
  { name: "blanks right", question: blanks, answer: { kind: "blanks", blanks: [{ blank: "b1", choiceId: "c2" }, { blank: "b2", text: "alpha" }] } },
  { name: "blanks typed normalised", question: blanks, answer: { kind: "blanks", blanks: [{ blank: "b1", choiceId: "c2" }, { blank: "b2", text: "  “ALPHAS.”  " }] } },
  { name: "blanks zero width and danda", question: blanks, answer: { kind: "blanks", blanks: [{ blank: "b1", choiceId: "c2" }, { blank: "b2", text: "अल्‍फ़ा।" }] } },
  { name: "blanks wrong choice", question: blanks, answer: { kind: "blanks", blanks: [{ blank: "b1", choiceId: "c1" }, { blank: "b2", text: "alpha" }] } },
  { name: "blanks wrong text", question: blanks, answer: { kind: "blanks", blanks: [{ blank: "b1", choiceId: "c2" }, { blank: "b2", text: "beta" }] } },
  { name: "blanks missing", question: blanks, answer: { kind: "blanks", blanks: [] } },
  { name: "order right", question: order, answer: { kind: "order", order: ["s2", "s1", "s4", "s3"] } },
  { name: "order two in place", question: order, answer: { kind: "order", order: ["s2", "s1", "s3", "s4"] } },
  { name: "order too long", question: order, answer: { kind: "order", order: ["s2", "s1", "s4", "s3", "s5"] } },
  { name: "paragraph parent", question: paragraph, answer: opts("a") },
];

const jee: MarkingRule = { correct: 4, wrong: -1, unattempted: 0 };
const advPartial: MarkingRule = { correct: 4, wrong: -2, unattempted: 0, partial: { per_correct_option: 1, requires_no_wrong: true } };
const lenientPartial: MarkingRule = { correct: 4, wrong: -2, unattempted: 0, partial: { per_correct_option: 1, requires_no_wrong: false } };
const thirds: MarkingRule = { correct: 2, wrong: -0.66, unattempted: 0 };

const SCORE_CASES: { name: string; question: QShape; answer: Answer | null; rule: MarkingRule }[] = [
  { name: "right", question: single, answer: opts("c"), rule: jee },
  { name: "wrong", question: single, answer: opts("a"), rule: jee },
  { name: "unattempted", question: single, answer: null, rule: jee },
  { name: "invalid counts as unattempted", question: single, answer: num("1"), rule: jee },
  { name: "unparsable number is wrong", question: numAbs, answer: num("x"), rule: jee },
  { name: "multi partial two", question: multi, answer: opts("a", "c"), rule: advPartial },
  { name: "multi partial with a wrong option", question: multi, answer: opts("a", "b"), rule: advPartial },
  { name: "multi lenient partial with a wrong option", question: multi, answer: opts("a", "b"), rule: lenientPartial },
  { name: "multi only wrong", question: multi, answer: opts("b"), rule: advPartial },
  { name: "multi full", question: multi, answer: opts("a", "c", "d"), rule: advPartial },
  { name: "partial ignored for single", question: single, answer: opts("a"), rule: advPartial },
  { name: "fractional negative", question: single, answer: opts("b"), rule: thirds },
];

const PARSE_CASES: { raw: string; allowScientific: boolean }[] = [
  { raw: "42", allowScientific: true },
  { raw: "-0.5", allowScientific: true },
  { raw: "1.", allowScientific: true },
  { raw: ".5", allowScientific: true },
  { raw: "1e-3", allowScientific: true },
  { raw: "1e-3", allowScientific: false },
  { raw: "2x10^-2", allowScientific: true },
  { raw: "2*10^4", allowScientific: true },
  { raw: "12,345,678", allowScientific: true },
  { raw: "1,23", allowScientific: true },
  { raw: "abc", allowScientific: true },
  { raw: "", allowScientific: true },
  { raw: "--1", allowScientific: true },
  { raw: "١٢", allowScientific: true },
];

const NORMALIZE_CASES = ["  Hello   World ", "“Quoted.”", "ﬁne", "नमस्ते।", "a​b", "Ａｌｐｈａ"];

describe("shared answer vectors", () => {
  it("checkAnswer", () => {
    const cases = CHECK_CASES.map(({ name, question, answer }) => {
      const r = checkAnswer(question as unknown as AnyQuestion, answer);
      const reason = r.detail.kind === "number" ? r.detail.reason : r.detail.kind === "invalid" ? "invalid" : null;
      return { name, question, answer, expect: { correct: r.correct, partial: r.partial, response: r.response, reason } };
    });
    golden("answers", { version: 1, cases });
  });

  it("scoreAnswer", () => {
    const cases = SCORE_CASES.map(({ name, question, answer, rule }) => {
      const q = question as unknown as AnyQuestion;
      const marks = scoreAnswer(q, answer ? checkAnswer(q, answer) : null, rule);
      return { name, question, answer, rule, expect: { marks } };
    });
    golden("scoring", { version: 1, cases });
  });

  it("parseNumber and normalizeTyped", () => {
    golden("parsing", {
      version: 1,
      parse: PARSE_CASES.map((c) => ({ ...c, expect: parseNumber(c.raw, c.allowScientific) })),
      normalize: NORMALIZE_CASES.map((text) => ({ text, expect: normalizeTyped(text) })),
    });
  });
});
