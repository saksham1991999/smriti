import { describe, expect, it } from "vitest";
import type { AnyQuestion } from "@smriti/lesson-core";
import { ageBandFrom, nextStep, questionSteps } from "../src/lib/onboarding";
import { toAnswerIn } from "../src/lib/practice";
import { mockMarksFor, mockPaletteState } from "../src/screens/practice/Mock";

describe("onboarding steps", () => {
  it("asks the class only for School and the exam date only for competitive exams", () => {
    expect(questionSteps({ goals: ["cbse-10-2027"], classNo: 10, school: true })).toContain("class");
    expect(questionSteps({ goals: ["jee-main-2027"], classNo: null, school: false })).toEqual(expect.arrayContaining(["goal", "birth-year", "exam-date", "level", "buddy"]));
    expect(questionSteps({ goals: ["curious"], classNo: null, school: false })).not.toContain("level");
  });

  it("ends at the plant step", () => {
    expect(nextStep({ goals: ["curious"], classNo: null, school: false }, "buddy")).toBe("plant");
  });

  it("derives the age band from the class or the birth year", () => {
    expect(ageBandFrom({ classNo: 4, birthYear: null })).toBe("u10");
    expect(ageBandFrom({ classNo: 9, birthYear: null })).toBe("13_17");
    expect(ageBandFrom({ classNo: null, birthYear: 1990 }, new Date("2026-10-30"))).toBe("18p");
    expect(ageBandFrom({ classNo: null, birthYear: "prefer_not" })).toBe("13_17");
  });
});

describe("practice answers on the wire", () => {
  it("maps lesson-core answers to the API's AnswerIn", () => {
    expect(toAnswerIn({ kind: "options", optionIds: ["a"] })).toEqual({ kind: "options", option_ids: ["a"] });
    expect(toAnswerIn({ kind: "number", value: "9.8", unit: "m/s^2" })).toEqual({ kind: "number", value: "9.8", unit: "m/s^2" });
    expect(toAnswerIn({ kind: "blanks", blanks: [{ blank: "b1", choiceId: "c2" }] })).toEqual({ kind: "blanks", blanks: [{ blank: "b1", choice_id: "c2", text: null }] });
    expect(toAnswerIn({ kind: "order", order: ["x", "y"] })).toEqual({ kind: "order", order: ["x", "y"] });
  });
});

describe("mock runner shell", () => {
  it("uses the exam palette states, answered and marked first", () => {
    const visited = new Set([0, 1, 2]);
    const saved = new Map([[0, { kind: "options" as const, optionIds: ["a"] }], [2, { kind: "options" as const, optionIds: ["b"] }]]);
    const marked = new Set([1, 2]);
    expect(mockPaletteState(0, visited, saved, marked)).toBe("answered");
    expect(mockPaletteState(1, visited, saved, marked)).toBe("marked");
    expect(mockPaletteState(2, visited, saved, marked)).toBe("answeredMarked");
    expect(mockPaletteState(3, visited, saved, marked)).toBe("notVisited");
    expect(mockPaletteState(1, visited, saved, new Set())).toBe("notAnswered");
  });

  it("scores with the blueprint's marking rule", () => {
    const q = { id: "q1", type: "mcq_single", options: [{ id: "a" }, { id: "b" }], answer: { option_ids: ["a"] }, concepts: [] } as unknown as AnyQuestion;
    const rule = { correct: 4, wrong: -1, unattempted: 0 };
    expect(mockMarksFor(q, { kind: "options", optionIds: ["a"] }, rule)).toEqual({ marks: 4, correct: true, attempted: true });
    expect(mockMarksFor(q, { kind: "options", optionIds: ["b"] }, rule)).toEqual({ marks: -1, correct: false, attempted: true });
    expect(mockMarksFor(q, undefined, rule)).toEqual({ marks: 0, correct: false, attempted: false });
  });
});
