import { describe, expect, it } from "vitest";
import { canCheck, createFlowReducer, initialFlow, isNumericCorrect, parseNumeric, type FlowState } from "../src";
import { fixtureLesson } from "./fixture";

const cards = fixtureLesson.cards;
const run = (actions: Parameters<ReturnType<typeof createFlowReducer>>[1][], preview?: number): FlowState => {
  const reduce = createFlowReducer(cards, preview);
  return actions.reduce(reduce, initialFlow(cards));
};

describe("lesson flow", () => {
  it("starts on a reading card and moves on with next", () => {
    const s = run([{ type: "next" }]);
    expect(s.index).toBe(1);
    expect(s.phase).toBe("reading");
    expect(s.seen).toBe(2);
  });

  it("blocks next while a question is unanswered", () => {
    const s = run([{ type: "next" }, { type: "next" }, { type: "next" }]);
    expect(s.index).toBe(2);
    expect(s.phase).toBe("answering");
  });

  it("counts a first-try correct answer", () => {
    const s = run([{ type: "next" }, { type: "next" }, { type: "select", optionId: "b" }, { type: "check" }]);
    expect(s.phase).toBe("correct");
    expect(s.correct).toBe(1);
    expect(s.firstTry).toBe(1);
  });

  it("gives a second attempt with a hint, then reveals and records the miss", () => {
    let s = run([{ type: "next" }, { type: "next" }, { type: "select", optionId: "a" }, { type: "check" }]);
    expect(s.phase).toBe("retry");
    expect(s.attempt).toBe(2);
    const reduce = createFlowReducer(cards);
    s = reduce(reduce(s, { type: "select", optionId: "c" }), { type: "check" });
    expect(s.phase).toBe("revealed");
    expect(s.missed).toEqual(["c3"]);
    expect(s.correct).toBe(0);
  });

  it("right on the second try is correct but not first-try", () => {
    const s = run([{ type: "next" }, { type: "next" }, { type: "select", optionId: "a" }, { type: "check" }, { type: "select", optionId: "b" }, { type: "check" }]);
    expect(s.phase).toBe("correct");
    expect(s.correct).toBe(1);
    expect(s.firstTry).toBe(0);
  });

  it("I don't know yet reveals and counts as a miss", () => {
    const s = run([{ type: "next" }, { type: "next" }, { type: "dont_know" }]);
    expect(s.phase).toBe("revealed");
    expect(s.missed).toEqual(["c3"]);
  });

  it("checks numeric answers with tolerance", () => {
    const card = cards[3];
    if (card?.type !== "numeric") throw new Error("fixture");
    expect(isNumericCorrect(card, "4")).toBe(true);
    expect(isNumericCorrect(card, "4.005")).toBe(true);
    expect(isNumericCorrect(card, "4.1")).toBe(false);
    expect(isNumericCorrect(card, "four")).toBe(false);
    expect(parseNumeric("1,000")).toBe(1000);
    expect(parseNumeric("")).toBeNull();
    const s = run([{ type: "next" }, { type: "next" }, { type: "select", optionId: "b" }, { type: "check" }, { type: "next" }]);
    expect(canCheck(card, s)).toBe(false);
  });

  it("finishes after the last card", () => {
    const s = run([
      { type: "next" },
      { type: "next" },
      { type: "select", optionId: "b" },
      { type: "check" },
      { type: "next" },
      { type: "numeric", value: "4" },
      { type: "check" },
      { type: "next" },
      { type: "next" },
    ]);
    expect(s.phase).toBe("done");
    expect(s.correct).toBe(2);
    expect(s.seen).toBe(5);
  });

  it("stops a preview after the preview cards", () => {
    const s = run([{ type: "next" }, { type: "next" }], 2);
    expect(s.phase).toBe("preview_end");
  });
});
