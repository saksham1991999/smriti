import { describe, expect, it } from "vitest";

import { autoNarrate, cardNarration, petReaction, planLesson, playerRules, readyMediaUrl } from "../src/index.js";
import { config, EXAM_DEPTH, fixtureBundle } from "./fixture.js";

describe("card narration", () => {
  const { bundle, hash } = fixtureBundle("a", "deep_dive");
  const plan = planLesson(bundle, { mode: "little", bundleVersion: hash, examDepth: EXAM_DEPTH, config: config() });

  it("reads the narration ref of a story card, and none from a question", () => {
    const story = plan.cards.find((c) => c.card?.type === "story");
    expect(cardNarration(story)).toMatch(/^audio\./);
    expect(cardNarration(plan.cards.find((c) => c.question))).toBeNull();
    expect(cardNarration(null)).toBeNull();
  });

  it("gives a url only once the audio is ready", () => {
    const ref = cardNarration(plan.cards.find((c) => c.card?.type === "story"))!;
    expect(readyMediaUrl(bundle.media, ref)).toBeNull(); // fixture media is never approved
    expect(readyMediaUrl({ [ref]: { status: "ready", url: "assets/n.m4a" } }, ref)).toBe("assets/n.m4a");
    expect(readyMediaUrl({ [ref]: { status: "ready", url: null } }, ref)).toBeNull();
    expect(readyMediaUrl(bundle.media, null)).toBeNull();
  });

  it("auto-plays only for little learners, never muted or on a card revisited", () => {
    const little = playerRules("little");
    expect(autoNarrate(little, { muted: false, readOnly: false })).toBe(true);
    expect(autoNarrate(little, { muted: true, readOnly: false })).toBe(false);
    expect(autoNarrate(little, { muted: false, readOnly: true })).toBe(false);
    for (const mode of ["deep_dive", "quick_revision", "onboarding", "quick_check", "fix_mistakes"] as const) {
      expect(autoNarrate(playerRules(mode), { muted: false, readOnly: false })).toBe(false);
    }
  });
});

describe("pet reactions", () => {
  it("use under-10 moods only, and never hop with reduced motion", () => {
    const under10 = new Set(["happy", "excited", "curious", "sleepy"]);
    for (const e of ["page_turn", "story_end", "correct", "wrong", "shown", null] as const) {
      for (const rm of [true, false]) {
        const r = petReaction(e, rm);
        expect(under10.has(r.mood)).toBe(true);
        if (rm) expect(r.hop).toBe(false);
      }
    }
    expect(petReaction("page_turn", false)).toEqual({ mood: "excited", hop: true });
    expect(petReaction("wrong", false)).toEqual({ mood: "curious", hop: false });
    expect(petReaction(null, false)).toEqual({ mood: "happy", hop: false });
  });
});
