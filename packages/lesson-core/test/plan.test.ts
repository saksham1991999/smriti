import { describe, expect, it } from "vitest";

import { cardVisible, nextBite, planCheck, planFix, planLesson, selectPlacement, selectTestOut, visibleBites } from "../src/index.js";
import { config, EXAM_DEPTH, fixtureBundle } from "./fixture.js";

const A = "fx.chapter-a.topic-a";
const D = "fx.chapter-a.topic-d";
const short = (key: string) => key.split(":").slice(-1)[0];

describe("depth filtering", () => {
  it("hides cards deeper than the exam needs, and cards on concepts the exam does not map", () => {
    expect(cardVisible({ depth: 3, concepts: [`${A}.sub-1.concept-1`] }, EXAM_DEPTH)).toBe(true);
    expect(cardVisible({ depth: 4, concepts: [`${A}.sub-1.concept-1`] }, EXAM_DEPTH)).toBe(false);
    expect(cardVisible({ depth: 4, concepts: [`${D}.sub-1.concept-2`] }, EXAM_DEPTH)).toBe(true);
    expect(cardVisible({ depth: 1, concepts: ["fx.unmapped"] }, EXAM_DEPTH)).toBe(false);
    expect(cardVisible({ depth: 9, concepts: [] }, null)).toBe(true);
  });

  it("drops hidden cards from bites", () => {
    const { bundle } = fixtureBundle("a", "deep_dive");
    const bites = visibleBites(bundle, EXAM_DEPTH);
    expect(bites.map((b) => [b.id, b.cardIds.length])).toEqual([
      ["bite-1", 5],
      ["bite-2", 5],
    ]);
    expect(bites[1]!.cardIds).not.toContain(`${A}:dd:10`);
    expect(visibleBites(bundle, null)[1]!.cardIds).toContain(`${A}:dd:10`);
  });
});

describe("planLesson", () => {
  it("plays one Deep Dive bite at a time, in order", () => {
    const { bundle, hash } = fixtureBundle("a", "deep_dive");
    const p = planLesson(bundle, { mode: "deep_dive", bundleVersion: hash, examDepth: EXAM_DEPTH, config: config() });
    expect(p).toMatchObject({ biteId: "bite-1", biteIndex: 0, biteCount: 2, previewLimit: null, hints: true, attemptsAllowed: 2, combos: true, rapid: false });
    expect(p.cards.map((c) => short(c.key))).toEqual(["01", "02", "03", "04", "05"]);
    expect(p.cards[3]!.question?.id).toBe("q.fx.chapter-a.topic-a.0001");

    const second = planLesson(bundle, { mode: "deep_dive", bundleVersion: hash, examDepth: EXAM_DEPTH, biteId: "bite-2", config: config() });
    expect(second.cards.map((c) => short(c.key))).toEqual(["06", "07", "08", "09", "11"]);
    expect(nextBite(bundle, EXAM_DEPTH, ["bite-1"])?.id).toBe("bite-2");
    expect(nextBite(bundle, EXAM_DEPTH, ["bite-1", "bite-2"])).toBeNull();
    expect(() => planLesson(bundle, { mode: "deep_dive", bundleVersion: hash, examDepth: EXAM_DEPTH, biteId: "nope", config: config() })).toThrow();
  });

  it("uses the publisher's derived bites when the lesson has none", () => {
    const { bundle, hash } = fixtureBundle("b", "deep_dive");
    const p = planLesson(bundle, { mode: "deep_dive", bundleVersion: hash, examDepth: EXAM_DEPTH, config: config() });
    expect(p.biteCount).toBe(2);
    expect(p.cards.at(-1)!.card?.type).toBe("summary");
  });

  it("expands a paragraph question into one card per child, sharing the passage", () => {
    const { bundle, hash } = fixtureBundle("d", "deep_dive");
    const p = planLesson(bundle, { mode: "deep_dive", bundleVersion: hash, examDepth: EXAM_DEPTH, config: config() });
    const children = p.cards.filter((c) => c.passage);
    expect(children.map((c) => c.key)).toEqual([`${D}:dd:03#q.fx.chapter-a.topic-d.0002`, `${D}:dd:03#q.fx.chapter-a.topic-d.0003`]);
    expect(children.every((c) => c.cardId === `${D}:dd:03`)).toBe(true);
    // dd:09 is depth 5 and hidden; the depth-4 cards on concept 2 stay.
    expect(p.cards.map((c) => short(c.key.split("#")[0]!))).toEqual(["01", "02", "03", "03", "04", "05", "06", "07", "08", "10"]);
  });

  it("cuts a Pro-locked Deep Dive after the preview cards, counted across bites", () => {
    const { bundle, hash } = fixtureBundle("a", "deep_dive");
    const base = { mode: "deep_dive" as const, bundleVersion: hash, examDepth: EXAM_DEPTH, previewLimited: true, config: config() };
    expect(planLesson(bundle, base).previewLimit).toBe(4);
    expect(planLesson(bundle, { ...base, biteId: "bite-2" }).previewLimit).toBe(0);
    expect(planLesson(bundle, { ...base, config: config({ previewCards: 7 }), biteId: "bite-2" }).previewLimit).toBe(2);
  });

  it("starts onboarding at the first bite beyond L1 for students who know the basics", () => {
    const { bundle, hash } = fixtureBundle("a", "deep_dive");
    const base = { mode: "onboarding" as const, bundleVersion: hash, examDepth: EXAM_DEPTH, config: config() };
    expect(planLesson(bundle, { ...base, level: "new" }).biteId).toBe("bite-1");
    // Bite 1 already has an L2 card (the drag-sort), so it is still the first bite past L1.
    expect(planLesson(bundle, { ...base, level: "revising" }).biteId).toBe("bite-1");
  });

  it("plays Quick Revision as one rapid run over every visible card", () => {
    const { bundle, hash } = fixtureBundle("a", "quick_revision");
    const p = planLesson(bundle, { mode: "quick_revision", bundleVersion: hash, examDepth: EXAM_DEPTH, config: config() });
    expect(p).toMatchObject({ rapid: true, biteId: null, previewLimit: null });
    expect(p.cards.map((c) => c.card?.type)).toEqual(["cheat_sheet_ref", "question", "summary", "common_traps"]);
  });
});

describe("checks and Fix mistakes", () => {
  const practice = (["a", "b", "c", "d"] as const).map((t) => fixtureBundle(t, "practice").bundle);

  it("Test out takes lesson and practice questions per topic", () => {
    const qs = selectTestOut(practice, 3);
    expect(qs.filter((q) => q.topicId === A).map((q) => q.question.id)).toEqual([
      "q.fx.chapter-a.topic-a.0001",
      "q.fx.chapter-a.topic-a.0002",
      "q.fx.chapter-a.topic-a.0003",
    ]);
    expect(qs).toHaveLength(12);
  });

  it("a check plan is one try, no hints, no combos, and expands paragraphs", () => {
    const qs = selectTestOut([fixtureBundle("d", "practice").bundle], 1);
    const p = planCheck(qs, { scopeId: "fx.chapter-a", bundleVersion: "v", locale: "en" });
    expect(p).toMatchObject({ mode: "quick_check", attemptsAllowed: 1, hints: false, combos: false, lessonEvents: true });
    expect(p.cards.map((c) => c.key)).toEqual(["q:q.fx.chapter-a.topic-d.0002", "q:q.fx.chapter-a.topic-d.0003"]);
    expect(p.cards.every((c) => c.cardId === null)).toBe(true);
  });

  it("Find my level takes one placement question per chapter", () => {
    const qs = selectPlacement(practice, 5);
    expect(qs.map((q) => q.question.id)).toEqual(["q.fx.chapter-a.topic-a.0004"]);
    expect(selectPlacement(practice, 0)).toEqual([]);
  });

  it("Fix mistakes swaps a missed question for an unseen sibling on the same concept", () => {
    const pool = fixtureBundle("a", "practice").bundle.questions;
    const missed = [{ questionId: "q.fx.chapter-a.topic-a.0001", concepts: [`${A}.sub-1.concept-1`], topicId: A, chapterId: "fx.chapter-a" }];
    const p = planFix(missed, pool, [], { topicId: A, bundleVersion: "v", locale: "en", config: config() });
    expect(p.cards.map((c) => c.question?.id)).toEqual(["q.fx.chapter-a.topic-a.0003"]);
    expect(p).toMatchObject({ mode: "fix_mistakes", lessonEvents: false, combos: false });

    // With the sibling already seen, the missed question itself comes back.
    const again = planFix(missed, pool, ["q.fx.chapter-a.topic-a.0003"], { topicId: A, bundleVersion: "v", locale: "en", config: config() });
    expect(again.cards.map((c) => c.question?.id)).toEqual(["q.fx.chapter-a.topic-a.0001"]);

    const capped = planFix([...missed, { ...missed[0]!, questionId: "q.fx.chapter-a.topic-a.0002", concepts: [`${A}.sub-1.concept-2`] }], pool, [], {
      topicId: A,
      bundleVersion: "v",
      locale: "en",
      config: config({ fixMistakesMax: 1 }),
    });
    expect(capped.cards).toHaveLength(1);
  });
});
