import { describe, expect, it } from "vitest";
import { ageBandFrom, nextStep, questionSteps } from "../src/lib/onboarding";
import { localizeQuestion, markingLabel } from "../src/lib/mocks";
import { fromAnswerIn, toAnswerIn } from "../src/lib/practice";

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

describe("mocks on the server", () => {
  it("reads saved answers back into lesson-core answers", () => {
    expect(fromAnswerIn({ kind: "options", option_ids: ["b"] })).toEqual({ kind: "options", optionIds: ["b"] });
    expect(fromAnswerIn({ kind: "pairs", pairs: [{ left: "l1", right: "r2" }] })).toEqual({ kind: "pairs", pairs: [{ left: "l1", right: "r2" }] });
    expect(fromAnswerIn({ kind: "matrix", rows: [{ row: "p", columns: ["q"] }] })).toEqual({ kind: "matrix", rows: [{ row: "p", columns: ["q"] }] });
    expect(fromAnswerIn(null)).toBeNull();
  });

  it("picks one language from the server's {en, hi} question body", () => {
    const body = { id: "q1", type: "mcq_single", stem: { en: "Stem", hi: "प्रश्न" }, options: [{ id: "a", text: { en: "A", hi: "क" } }], ideal_time_s: 60 };
    expect(localizeQuestion(body, "hi")).toMatchObject({ stem: "प्रश्न", options: [{ id: "a", text: "क" }], ideal_time_s: 60 });
    expect(localizeQuestion(body, "en")).toMatchObject({ stem: "Stem" });
  });

  it("shows marks only when the notice states them", () => {
    expect(markingLabel({ correct: 4, wrong: -1, unattempted: 0 })).toEqual({ correct: 4, wrong: -1 });
    expect(markingLabel({ correct: 3, wrong: { fraction_of_question_marks: 0.25 }, unattempted: 0 } as never)).toEqual({ correct: 3, wrong: -0.75 });
    expect(markingLabel({ correct: null, wrong: -1, unattempted: 0 } as never)).toBeNull();
    expect(markingLabel(null)).toBeNull();
  });
});
