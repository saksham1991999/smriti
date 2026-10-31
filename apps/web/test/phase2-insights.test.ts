import { describe, expect, it } from "vitest";
import { bars, clockLabel, fadingRows, headline, playable, sessionTopics, sleepState, stillNeeded, targetsFrom } from "../src/screens/phase2/insights/logic";

const targets = { sure: 0.9, fifty: 0.5, guess: 0.25 };

describe("calibration (MEM-25)", () => {
  it("turns the server's levels into bars with whole percents and the target mark", () => {
    const b = bars(
      [
        { confidence: "sure", answers: 40, correct: 31, accuracy: 0.775 },
        { confidence: "fifty", answers: 20, correct: 11, accuracy: 0.55 },
        { confidence: "guess", answers: 0, correct: 0, accuracy: null },
      ],
      targets,
    );
    expect(b.map((x) => [x.level, x.pct, x.target, x.below])).toEqual([
      ["sure", 78, 90, true],
      ["fifty", 55, 50, false],
      ["guess", null, 25, false],
    ]);
  });

  it("counts sure-but-wrong and lucky guesses from the levels", () => {
    const b = bars(
      [
        { confidence: "sure", answers: 10, correct: 7, accuracy: 0.7 },
        { confidence: "guess", answers: 8, correct: 3, accuracy: 0.375 },
      ],
      targets,
    );
    expect(headline(b)).toEqual({ sureWrong: 3, lucky: 3 });
  });

  it("says how many more tagged answers are needed", () => {
    expect(stillNeeded({ needed: 30, tagged: 12 })).toBe(18);
    expect(stillNeeded({ needed: 30, tagged: 40 })).toBe(0);
    expect(stillNeeded({ needed: null, tagged: 3 })).toBeNull();
  });

  it("falls back to the doc targets for a bad flag", () => {
    expect(targetsFrom({ sure: 0.8, fifty: 2, guess: "x" })).toEqual({ sure: 0.8, fifty: 0.5, guess: 0.25 });
    expect(targetsFrom(null)).toEqual(targets);
  });
});

describe("fading and sleep review", () => {
  it("joins weak areas to topic names and keeps unknown topics", () => {
    const rows = fadingRows({ horizon_days: 3, target_retention: 0.9, topics: [{ topic_id: "a", cards: 4, min_retrievability: 0.914 }, { topic_id: "zz", cards: 1, min_retrievability: 0.9 }] }, (id) => (id === "a" ? { name: "Topic A", subject: "Physics" } : null));
    expect(rows).toEqual([
      { topicId: "a", name: "Topic A", subject: "Physics", cards: 4, recallPct: 91 },
      { topicId: "zz", name: null, subject: null, cards: 1, recallPct: 90 },
    ]);
  });

  it("maps the sleep review answer to a state", () => {
    expect(sleepState({ eligible: true, bedtime: "22:30", cards: [{ card_ref: "c:1", difficulty: 5, due_at: "" }] })).toEqual({ kind: "ready", cards: 1, at: "22:30" });
    expect(sleepState({ eligible: false, reason: "pro_required" })).toEqual({ kind: "reason", reason: "pro_required" });
    expect(sleepState({ eligible: false, reason: "threshold_unset" })).toEqual({ kind: "reason", reason: "not_confident" });
    expect(sleepState({ eligible: true, cards: [] })).toEqual({ kind: "reason", reason: "unavailable" });
    expect(sleepState(undefined)).toEqual({ kind: "reason", reason: "unavailable" });
  });

  it("formats the bedtime on the reader's clock", () => {
    expect(clockLabel("22:30", "en")).toMatch(/10:30\s?pm/i);
    expect(clockLabel("oops", "en")).toBe("oops");
  });
});

describe("mixed drill", () => {
  const qs = [
    { question_id: "q1", topic_id: "a" },
    { question_id: "q2", topic_id: "b" },
    { question_id: "q3", topic_id: "a" },
    { question_id: "q4", topic_id: "c" },
  ];
  it("loads each topic once, in first-seen order", () => {
    expect(sessionTopics(qs)).toEqual(["a", "b", "c"]);
  });
  it("keeps the server's order and skips questions no bundle holds", () => {
    const have: Record<string, string[]> = { a: ["q1", "q3"], b: ["q2"] };
    expect(playable(qs, (t, id) => (have[t]?.includes(id) ? id.toUpperCase() : undefined)).map((x) => x.q)).toEqual(["Q1", "Q2", "Q3"]);
  });
});
