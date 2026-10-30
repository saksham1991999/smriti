/**
 * Random walks over every fixture plan: whatever a host sends, the reducer never throws, never
 * leaves the plan, never loses XP, and never puts typed text into an event.
 */
import { afterAll, describe, expect, it } from "vitest";

import {
  type Answer,
  initialState,
  type LessonAction,
  type LessonPlan,
  type LessonState,
  planCheck,
  planLesson,
  reduce,
  selectTestOut,
  visibleBites,
} from "../src/index.js";
import { config, EXAM_DEPTH, fixtureBundle, T0 } from "./fixture.js";

/** A small deterministic generator (mulberry32), so failures replay. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SECRET = "typed-by-the-student";
const ANSWERS: Answer[] = [
  { kind: "options", optionIds: ["a"] },
  { kind: "options", optionIds: ["b", "c"] },
  { kind: "number", value: "7" },
  { kind: "number", value: SECRET },
  { kind: "order", order: ["s1", "s2"] },
  { kind: "pairs", pairs: [{ left: "p", right: "two" }] },
  { kind: "matrix", rows: [{ row: "p", columns: ["one"] }] },
  { kind: "blanks", blanks: [{ blank: "b1", choiceId: "c2" }, { blank: "b2", text: SECRET }] },
];

function randomAction(r: () => number): LessonAction {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const kind = pick([
    "next", "next", "next", "back", "forward", "submit", "submit", "dont_know", "try_again", "continue", "continue",
    "widget", "sim_task", "skip_task", "skip_online", "open_overlay", "close_overlay", "rate", "confidence", "offline",
  ] as const);
  switch (kind) {
    case "submit":
      return { type: "submit", answer: pick(ANSWERS), confidence: pick(["sure", "fifty_fifty", "guess", null] as const) };
    case "widget":
      return { type: "widget", response: pick([{ widget: "slider", value: 4 }, { widget: "tap_reveal", revealed: ["t1", "t2"] }, { widget: "order_steps", order: ["s1"] }] as const) };
    case "sim_task":
      return { type: "sim_task", taskId: "task-1", correct: r() < 0.5 };
    case "open_overlay":
      return { type: "open_overlay", overlay: pick(["tutor", "make_it_stick"] as const) };
    case "rate":
      return { type: "rate", rating: pick([1, 2, 3, 4] as const) };
    case "confidence":
      return { type: "confidence", value: pick(["sure", "guess", null] as const) };
    default:
      return { type: kind };
  }
}

function allPlans(): LessonPlan[] {
  const plans: LessonPlan[] = [];
  for (const t of ["a", "b", "c", "d"] as const) {
    const dd = fixtureBundle(t, "deep_dive");
    for (const bite of visibleBites(dd.bundle, EXAM_DEPTH)) {
      for (const previewLimited of [false, true]) {
        plans.push(planLesson(dd.bundle, { mode: "deep_dive", bundleVersion: dd.hash, examDepth: EXAM_DEPTH, biteId: bite.id, previewLimited, config: config() }));
      }
    }
    const qr = fixtureBundle(t, "quick_revision");
    plans.push(planLesson(qr.bundle, { mode: "quick_revision", bundleVersion: qr.hash, examDepth: EXAM_DEPTH, config: config() }));
  }
  const practice = (["a", "b", "c", "d"] as const).map((t) => fixtureBundle(t, "practice").bundle);
  plans.push(planCheck(selectTestOut(practice, 2), { scopeId: "fx.chapter-a", bundleVersion: "v", locale: "en" }));
  return plans;
}

describe("reducer invariants", () => {
  const plans = allPlans();
  const reached = new Set<string>();
  // The walks must actually reach the interesting phases, or they prove little.
  afterAll(() => {
    expect([...reached].sort()).toEqual(
      ["card", "complete", "confidence", "explain", "feedback", "hint", "make_it_stick", "preview_end", "question", "tutor"].sort(),
    );
  });

  it.each(plans.map((p, i) => [`${p.mode} ${p.topicId} ${p.biteId ?? ""} ${p.previewLimit ?? ""} #${i}`, p] as const))("%s", (_name, plan) => {
    for (let seed = 1; seed <= 25; seed++) {
      const r = rng(seed * 7919 + plan.cards.length);
      let now = T0;
      let s: LessonState = reduce(initialState(config()), { type: "start", plan, now });
      let xp = s.xp;
      for (let step = 0; step < 120; step++) {
        const action = randomAction(r);
        const next = reduce(s, { ...action, now: (now += 700) });
        expect(next.index).toBeGreaterThanOrEqual(0);
        expect(next.index).toBeLessThan(plan.cards.length);
        expect(next.viewIndex).toBeLessThanOrEqual(next.index);
        expect(next.viewIndex).toBeGreaterThanOrEqual(0);
        expect(next.xp).toBeGreaterThanOrEqual(xp);
        if (plan.previewLimit !== null && plan.previewLimit > 0) expect(next.index).toBeLessThan(plan.previewLimit);
        for (const e of next.events) {
          expect(JSON.stringify(e)).not.toContain(SECRET);
          expect(e.at).toBe(now);
        }
        if (s.phase === "complete" || s.phase === "exited" || s.phase === "preview_end") {
          expect(next.events).toEqual([]);
          if (s.phase !== "preview_end") expect(next.phase).toBe(s.phase);
        }
        reached.add(next.phase);
        xp = next.xp;
        s = next;
      }
    }
  });
});
