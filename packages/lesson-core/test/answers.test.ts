import type { BundleQuestion } from "@smriti/content-schema";
import { describe, expect, it } from "vitest";

import { checkAnswer, findQuestion, normalizeTyped, parseNumber, scoreAnswer, wrongMarks, type AnyQuestion } from "../src/index.js";
import { fixtureBundle } from "./fixture.js";

const pool: Record<string, BundleQuestion> = {
  ...fixtureBundle("a", "practice").bundle.questions,
  ...fixtureBundle("b", "practice").bundle.questions,
  ...fixtureBundle("c", "practice").bundle.questions,
  ...fixtureBundle("d", "practice").bundle.questions,
};
const hiPool = fixtureBundle("d", "practice", "hi").bundle.questions;
const q = (suffix: string, from: Record<string, BundleQuestion> = pool): AnyQuestion => {
  const topic = suffix[0];
  const found = findQuestion(from, `q.fx.chapter-a.topic-${topic}.${suffix.slice(2)}`);
  if (!found) throw new Error(`no question ${suffix}`);
  return found;
};

describe("checkAnswer", () => {
  it("single-answer types", () => {
    for (const [id, key] of [
      ["a.0001", "c"],
      ["c.0001", "a"],
      ["c.0002", "c"],
      ["b.0002", "a"],
    ] as const) {
      expect(checkAnswer(q(id), { kind: "options", optionIds: [key] }).correct).toBe(true);
      const wrong = checkAnswer(q(id), { kind: "options", optionIds: ["z"] });
      expect(wrong).toMatchObject({ correct: false, partial: 0, response: { option_ids: ["z"] } });
    }
  });

  it("multi-select with partial credit only when nothing wrong is picked", () => {
    const multi = q("b.0001");
    expect(checkAnswer(multi, { kind: "options", optionIds: ["d", "a", "c"] })).toMatchObject({ correct: true, partial: 1 });
    expect(checkAnswer(multi, { kind: "options", optionIds: ["a", "c"] }).partial).toBeCloseTo(2 / 3);
    expect(checkAnswer(multi, { kind: "options", optionIds: ["a", "b"] })).toMatchObject({ correct: false, partial: 0 });
  });

  it("numerical answers with tolerance and unit conversion", () => {
    const num = q("a.0002"); // 2.5 m, abs 0.1
    expect(checkAnswer(num, { kind: "number", value: "2.45" }).correct).toBe(true);
    expect(checkAnswer(num, { kind: "number", value: "2.7" }).correct).toBe(false);
    expect(checkAnswer(num, { kind: "number", value: "250", unit: "cm" }).correct).toBe(true);
    expect(checkAnswer(num, { kind: "number", value: "2.5", unit: "s" }).detail).toMatchObject({ reason: "unit" });
    expect(checkAnswer(num, { kind: "number", value: "two" }).detail).toMatchObject({ reason: "unparsable" });

    const child = q("d.0003"); // 1500 g, rel 1%
    expect(checkAnswer(child, { kind: "number", value: "1.5", unit: "kg" }).correct).toBe(true);
    expect(checkAnswer(child, { kind: "number", value: "1.5e3" }).correct).toBe(true);
    expect(checkAnswer(child, { kind: "number", value: "1520" }).correct).toBe(false);
    expect(checkAnswer(child, { kind: "number", value: "1510" }).response).toEqual({ value: 1510, unit: "g" });
  });

  it("integers are exact", () => {
    expect(checkAnswer(q("a.0004"), { kind: "number", value: "7" }).correct).toBe(true);
    expect(checkAnswer(q("a.0004"), { kind: "number", value: "7.0001" }).correct).toBe(false);
    expect(checkAnswer(q("d.0006"), { kind: "number", value: "−3" }).correct).toBe(true);
  });

  it("match pairs, matrix rows and order", () => {
    const pairs = q("d.0007");
    expect(
      checkAnswer(pairs, { kind: "pairs", pairs: [{ left: "q", right: "one" }, { left: "p", right: "two" }] }).correct,
    ).toBe(true);
    expect(checkAnswer(pairs, { kind: "pairs", pairs: [{ left: "p", right: "two" }, { left: "q", right: "two" }] }).partial).toBe(0.5);

    const matrix = q("d.0004");
    const right = { kind: "matrix" as const, rows: [{ row: "p", columns: ["three", "one"] }, { row: "q", columns: ["two"] }] };
    expect(checkAnswer(matrix, right).correct).toBe(true);
    expect(checkAnswer(matrix, { kind: "matrix", rows: [{ row: "p", columns: ["one"] }, { row: "q", columns: ["two"] }] }).partial).toBe(0.5);

    const order = q("b.0003");
    expect(checkAnswer(order, { kind: "order", order: ["s2", "s1", "s4", "s3"] }).correct).toBe(true);
    expect(checkAnswer(order, { kind: "order", order: ["s1", "s2", "s4", "s3"] })).toMatchObject({ correct: false, partial: 0.5 });
  });

  it("fill in the blanks: choices and typed text, which reaches events only as a key", () => {
    const fill = q("d.0005");
    const res = checkAnswer(fill, { kind: "blanks", blanks: [{ blank: "b1", choiceId: "c2" }, { blank: "b2", text: "  FIXTURES. " }] });
    expect(res.correct).toBe(true);
    expect(res.response).toEqual({ blanks: [{ blank: "b1", key: "c2" }, { blank: "b2", key: "fixture-word" }] });
    const wrong = checkAnswer(fill, { kind: "blanks", blanks: [{ blank: "b1", choiceId: "c2" }, { blank: "b2", text: "my secret note" }] });
    expect(wrong).toMatchObject({ correct: false, partial: 0.5 });
    expect(JSON.stringify(wrong.response)).not.toContain("secret");

    const hi = q("d.0005", hiPool);
    expect(checkAnswer(hi, { kind: "blanks", blanks: [{ blank: "b1", choiceId: "c2" }, { blank: "b2", text: "फ़िक्स्चर" }] }).correct).toBe(true);
  });

  it("refuses a paragraph as a whole and mismatched answer kinds", () => {
    expect(checkAnswer(q("d.0001"), { kind: "options", optionIds: ["a"] }).detail.kind).toBe("invalid");
    expect(checkAnswer(q("a.0001"), { kind: "order", order: [] })).toMatchObject({ correct: false, response: null });
  });
});

describe("helpers", () => {
  it("parses numbers students type", () => {
    expect(parseNumber("1,500")).toBe(1500);
    expect(parseNumber("1.5×10^3")).toBe(1500);
    expect(parseNumber(".5")).toBe(0.5);
    expect(parseNumber("1e3", false)).toBeNull();
    expect(parseNumber("")).toBeNull();
  });

  it("normalises typed text", () => {
    expect(normalizeTyped("  Hello   World!! ")).toBe("hello world");
    expect(normalizeTyped("उत्तर।")).toBe("उत्तर");
  });

  it("scores with blueprint marking, including JEE-style partial marks", () => {
    const multi = q("b.0001");
    const rule = { correct: 4, wrong: -2, unattempted: 0, partial: { per_correct_option: 1, requires_no_wrong: true } };
    expect(scoreAnswer(multi, checkAnswer(multi, { kind: "options", optionIds: ["a", "c", "d"] }), rule)).toBe(4);
    expect(scoreAnswer(multi, checkAnswer(multi, { kind: "options", optionIds: ["a", "c"] }), rule)).toBe(2);
    expect(scoreAnswer(multi, checkAnswer(multi, { kind: "options", optionIds: ["a", "b"] }), rule)).toBe(-2);
    expect(scoreAnswer(multi, null, rule)).toBe(0);
    const single = q("a.0001");
    expect(scoreAnswer(single, checkAnswer(single, { kind: "options", optionIds: ["b"] }), { correct: 4, wrong: -1, unattempted: 0 })).toBe(-1);
  });

  it("scores a fraction penalty, and never guesses marks the notice does not state", () => {
    const single = q("a.0001");
    const wrong = checkAnswer(single, { kind: "options", optionIds: ["b"] });
    const right = checkAnswer(single, { kind: "options", optionIds: ["c"] });
    const third = { fraction_of_question_marks: 1 / 3 };
    expect(wrongMarks({ correct: 2, wrong: third, unattempted: 0 })).toBeCloseTo(-2 / 3);
    expect(scoreAnswer(single, wrong, { correct: 2, wrong: third, unattempted: 0 })).toBeCloseTo(-2 / 3);
    // UPSC-style: the penalty is a fraction of marks the notice does not state, so neither can be scored.
    const unstated = { correct: null, wrong: third, unattempted: 0 };
    expect(wrongMarks(unstated)).toBeNull();
    expect(scoreAnswer(single, wrong, unstated)).toBeNull();
    expect(scoreAnswer(single, right, unstated)).toBeNull();
    expect(scoreAnswer(single, null, unstated)).toBe(0);
  });
});
