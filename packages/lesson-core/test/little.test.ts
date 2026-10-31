import type { ActivityBundle } from "@smriti/content-schema";
import { describe, expect, it } from "vitest";

import {
  type Answer,
  initialPlay,
  initialSong,
  initialStory,
  isGentleText,
  type LessonAction,
  LessonSession,
  type LessonState,
  lineAt,
  negativeFeedbackWords,
  nextMove,
  type PlayAction,
  type PlayState,
  planLesson,
  planPlay,
  planSong,
  planStory,
  playerRules,
  reducePlay,
  reduceSong,
  reduceStory,
  roundMoves,
  traceCoverage,
  type SongAction,
  type SongState,
  STORY_AUTO_ADVANCE_MS,
  type StoryAction,
  type StoryState,
} from "../src/index.js";
import { config, EXAM_DEPTH, fixtureBundle, T0, XP } from "./fixture.js";

const A = "fx.chapter-a.topic-a";
const opts = (...ids: string[]): Answer => ({ kind: "options", optionIds: ids });

function session() {
  let now = T0;
  let n = 0;
  const s = new LessonSession({ config: config(), tz: "Asia/Kolkata", clock: () => (now += 1000), newId: () => `id-${++n}` });
  const run = (...actions: LessonAction[]): LessonState => {
    let st = s.state;
    for (const a of actions) st = s.dispatch(a);
    return st;
  };
  return { s, run, types: () => s.emitted.map((e) => e.type) };
}

function littlePlan(mutate?: (b: ReturnType<typeof fixtureBundle>["bundle"]) => void) {
  const { bundle, hash } = fixtureBundle("a", "deep_dive");
  mutate?.(bundle);
  return planLesson(bundle, { mode: "little", bundleVersion: hash, examDepth: EXAM_DEPTH, config: config() });
}

function activityBundle(mode: "story" | "song" | "play", locale = "en"): { bundle: ActivityBundle; hash: string } {
  const { bundle, hash } = fixtureBundle("a", mode, locale);
  return { bundle: bundle as unknown as ActivityBundle, hash };
}

describe("gentle words", () => {
  it("finds the words little learners never hear, in English and Hindi", () => {
    expect(negativeFeedbackWords("Not quite. That is wrong!")).toEqual(["wrong", "not quite"]);
    expect(negativeFeedbackWords("यह गलत है")).toEqual(["गलत"]);
    expect(isGentleText("Let's try again together!")).toBe(true);
    expect(isGentleText("चलो, साथ में फिर से कोशिश करें!")).toBe(true);
    // Whole words only in English: a badge is not "bad".
    expect(isGentleText("You won a badge")).toBe(true);
  });
});

describe("player rules", () => {
  it("are gentle for little learners", () => {
    expect(playerRules("little")).toEqual({
      tone: "gentle",
      hints: true,
      attemptsAllowed: 2,
      combos: false,
      xpChip: false,
      stars: true,
      timers: false,
      confidenceRow: false,
      confidenceStep: false,
      counter: false,
      narrationAutoPlay: true,
      guidedFinish: true,
      fixRow: false,
    });
    expect(playerRules("deep_dive")).toMatchObject({ tone: "standard", combos: true, confidenceStep: true, guidedFinish: false, timers: false });
    expect(playerRules("quick_check")).toMatchObject({ hints: false, attemptsAllowed: 1, combos: false, confidenceStep: false });
  });
});

describe("little learner lesson", () => {
  it("has no combos and plays a Deep Dive bite", () => {
    const plan = littlePlan();
    expect(plan).toMatchObject({ mode: "little", combos: false, hints: true, attemptsAllowed: 2, lessonEvents: true, rapid: false });
    expect(plan.cards.map((c) => c.key)).toEqual(littlePlan().cards.map((c) => c.key));
  });

  it("ends every question on a win and skips the confidence step", () => {
    const { s, run, types } = session();
    run({ type: "start", plan: littlePlan(), resumeIndex: 3 });
    expect(s.emitted[0]!.payload).toMatchObject({ topic_id: A, mode: "deep_dive" });

    const first = run({ type: "submit", answer: opts("b") });
    expect(first).toMatchObject({ phase: "hint", hint: { source: "trap", text: "Fixture trap A1.b" } });
    run({ type: "try_again" });
    const second = run({ type: "submit", answer: opts("d") });
    // The second wrong try shows the answer; the child taps it.
    expect(second).toMatchObject({ phase: "guided", xp: XP.attempt, guided: false });
    expect(second.outcomes[`${A}:dd:04`]).toMatchObject({ correct: false, attempts: 2 });
    const sent = s.emitted.length;

    // Nothing else moves on, and nothing is sent or taken away.
    expect(run({ type: "continue" }).phase).toBe("guided");
    expect(run({ type: "next" }).phase).toBe("guided");
    expect(run({ type: "submit", answer: opts("a") })).toMatchObject({ phase: "guided", xp: XP.attempt });
    const won = run({ type: "submit", answer: opts("c") });
    expect(won).toMatchObject({ phase: "feedback", guided: true, xp: XP.attempt, lastResult: { correct: true } });
    expect(s.emitted.length).toBe(sent);
    // The outcome stays honest: the miss was recorded by answer_submitted.
    expect(won.outcomes[`${A}:dd:04`]).toMatchObject({ correct: false });

    expect(run({ type: "continue" })).toMatchObject({ phase: "card", index: 4, guided: false });
    const done = run({ type: "next" });
    expect(done.phase).toBe("complete");
    expect(done.summary).toMatchObject({ xp: XP.attempt + XP.complete, stars: XP.attempt + XP.complete, comboReached: false });
    expect(types().at(-1)).toBe("lesson_completed");
    expect(s.emitted.at(-1)!.payload).toMatchObject({ mode: "deep_dive", xp: XP.attempt + XP.complete });
  });

  it("guides after I don't know yet too", () => {
    const { run } = session();
    run({ type: "start", plan: littlePlan(), resumeIndex: 3 });
    expect(run({ type: "dont_know" })).toMatchObject({ phase: "guided" });
    expect(run({ type: "dont_know" }).phase).toBe("guided");
    expect(run({ type: "submit", answer: opts("c") })).toMatchObject({ phase: "feedback", guided: true });
  });

  it("swaps a hint with a negative word for the generic nudge", () => {
    const plan = littlePlan((b) => {
      const q = b.questions["q.fx.chapter-a.topic-a.0001"]!;
      if (q.type === "paragraph" || !q.solution?.common_traps) throw new Error("fixture changed");
      q.solution.common_traps = q.solution.common_traps.map((t) => ({ ...t, why: "Oops, that is wrong" }));
    });
    const { run } = session();
    run({ type: "start", plan, resumeIndex: 3 });
    expect(run({ type: "submit", answer: opts("b") }).hint).toEqual({ source: "generic", conceptId: `${A}.sub-1.concept-1` });
  });

  it("leaves the standard player unchanged", () => {
    const { bundle, hash } = fixtureBundle("a", "deep_dive");
    const plan = planLesson(bundle, { mode: "deep_dive", bundleVersion: hash, examDepth: EXAM_DEPTH, config: config() });
    const { run } = session();
    run({ type: "start", plan, resumeIndex: 3 });
    run({ type: "submit", answer: opts("b") }, { type: "try_again" });
    expect(run({ type: "submit", answer: opts("d") }).phase).toBe("explain");
    run({ type: "continue" });
    expect(run({ type: "next" }).phase).toBe("confidence");
  });
});

describe("story", () => {
  const { bundle, hash } = activityBundle("story");
  const plan = planStory(bundle, "sb.fx.chapter-a", { bundleVersion: hash, little: true });
  let now = T0;
  const go = (s: StoryState, ...actions: StoryAction[]) => actions.reduce((st, a) => reduceStory(st, { ...a, now: (now += 1000) }), s);

  it("reads page by page to The end, then Done completes it", () => {
    expect(plan).toMatchObject({ kind: "story", activityId: "sb.fx.chapter-a", topicId: A, narrationDefault: true, locale: "en" });
    expect(typeof plan.title).toBe("string");
    let s = go(initialStory(), { type: "start", plan });
    expect(s).toMatchObject({ phase: "page", page: 0, narration: true });
    expect(go(s, { type: "back" }).page).toBe(0);
    for (let i = 1; i < plan.pages.length; i++) s = go(s, { type: "next" });
    expect(s.page).toBe(plan.pages.length - 1);
    s = go(s, { type: "next" });
    expect(s.phase).toBe("end");
    expect(go(s, { type: "read_again" })).toMatchObject({ phase: "page", page: 0 });
    const done = go(s, { type: "done" });
    expect(done.phase).toBe("complete");
    expect(done.completion).toMatchObject({ kind: "story", activityId: "sb.fx.chapter-a", topicId: A, stars: 1, bundleVersion: hash, locale: "en" });
    expect(done.completion!.msTotal).toBeGreaterThan(0);
  });

  it("turns the page 2 s after narration ends, unless the child touches the screen", () => {
    const s0 = reduceStory(initialStory(), { type: "start", plan, now: T0 });
    const ended = reduceStory(s0, { type: "narration_ended", now: T0 + 5000 });
    expect(ended.autoAdvanceAt).toBe(T0 + 5000 + STORY_AUTO_ADVANCE_MS);
    expect(reduceStory(ended, { type: "tick", now: T0 + 6000 }).page).toBe(0);
    expect(reduceStory(ended, { type: "tick", now: T0 + 7000 }).page).toBe(1);
    const touched = reduceStory(ended, { type: "touch", now: T0 + 5500 });
    expect(reduceStory(touched, { type: "tick", now: T0 + 9000 }).page).toBe(0);
    // With Read to me off, nothing turns by itself.
    const quiet = reduceStory(s0, { type: "narration", on: false, now: T0 + 1 });
    expect(reduceStory(quiet, { type: "narration_ended", now: T0 + 2 }).autoAdvanceAt).toBeNull();
  });
});

describe("song", () => {
  it("carries this locale's version and highlights the line being sung", () => {
    for (const locale of ["en", "hi"]) {
      const { bundle, hash } = activityBundle("song", locale);
      const plan = planSong(bundle, "sg.fx.topic-a", { bundleVersion: hash });
      expect(plan).toMatchObject({ kind: "song", style: "rhyme", audio: `audio.chapter-a.fx-song-${locale}`, timed: true, minutes: 1, locale });
      expect(plan.lines).toHaveLength(4);
    }
    const { bundle, hash } = activityBundle("song");
    const plan = planSong(bundle, "sg.fx.topic-a", { bundleVersion: hash });
    expect(lineAt(plan.lines, 0)).toBe(0);
    expect(lineAt(plan.lines, 1900)).toBeNull();
    expect(lineAt(plan.lines, 2500)).toBe(1);
    expect(lineAt([{ text: "untimed" }], 0)).toBeNull();
    expect(plan.actions.map((a) => a.id)).toEqual(["clap"]);

    let now = T0;
    const go = (s: SongState, ...actions: SongAction[]) => actions.reduce((st, a) => reduceSong(st, { ...a, now: (now += 1000) }), s);
    let s = go(initialSong(), { type: "start", plan });
    expect(s.phase).toBe("ready");
    expect(go(s, { type: "tick", positionMs: 2500 }).line).toBeNull();
    s = go(s, { type: "play" }, { type: "tick", positionMs: 2500 });
    expect(s).toMatchObject({ phase: "playing", line: 1, action: "clap" });
    s = go(s, { type: "pause" }, { type: "tick", positionMs: 4500 });
    expect(s).toMatchObject({ phase: "paused", line: 1 });
    s = go(s, { type: "play" }, { type: "tick", positionMs: 4500 });
    expect(s).toMatchObject({ line: 2, action: null });
    s = go(s, { type: "ended" });
    expect(s.phase).toBe("complete");
    expect(s.completion).toMatchObject({ kind: "song", activityId: "sg.fx.topic-a", stars: 1 });
    // Singing again is welcome; the completion stays the first one.
    const again = go(s, { type: "play" });
    expect(again).toMatchObject({ phase: "playing", positionMs: 0 });
    expect(go(again, { type: "ended" }).completion).toBe(s.completion);
  });
});

describe("play", () => {
  const { bundle, hash } = activityBundle("play");
  const plan = planPlay(bundle, "pl.fx.topic-a", { bundleVersion: hash });
  let now = T0;
  const go = (s: PlayState, ...actions: PlayAction[]) => actions.reduce((st, a) => reducePlay(st, { ...a, now: (now += 1000) }), s);
  const success = "Fixture success line";
  const tryAgain = "Fixture try again line";

  it("bounces a wrong move, then hints, then shows the move, so the round ends on a win", () => {
    expect(plan.rounds.map((r) => r.kind)).toEqual(["tap", "match", "sort", "drag", "trace"]);
    let s = go(initialPlay(), { type: "start", plan });
    expect(s).toMatchObject({ phase: "round", round: 0, guided: false, hint: null });
    s = go(s, { type: "move", move: { type: "tap", item: "tile-2" } });
    expect(s).toMatchObject({ tries: 1, feedback: tryAgain, hint: null, guided: false });
    s = go(s, { type: "move", move: { type: "tap", item: "tile-2" } });
    expect(s).toMatchObject({ tries: 2, hint: "Fixture tap hint", guided: false });
    s = go(s, { type: "move", move: { type: "tap", item: "tile-2" } });
    expect(s).toMatchObject({ tries: 3, guided: true });
    expect(nextMove(s)).toEqual({ type: "tap", item: "tile-1" });
    s = go(s, { type: "move", move: { type: "tap", item: "tile-1" } });
    expect(s).toMatchObject({ phase: "round", done: ["tile-1"], feedback: success });
    // Tapping a picked tile again is ignored, not wrong.
    expect(go(s, { type: "move", move: { type: "tap", item: "tile-1" } })).toBe(s);
    s = go(s, { type: "move", move: { type: "tap", item: "tile-3" } });
    expect(s).toMatchObject({ phase: "cheer", stars: 1, guided: false, hint: null });
    expect(nextMove(s)).toBeNull();
    s = go(s, { type: "next" });
    expect(s).toMatchObject({ phase: "round", round: 1, done: [], tries: 0, feedback: null });
  });

  it("checks match, sort, drag and trace moves and completes with a star per round", () => {
    let s = go(initialPlay(), { type: "start", plan });
    for (const m of roundMoves(plan.rounds[0]!)) s = go(s, { type: "move", move: m });
    s = go(s, { type: "next" });
    // Match: a wrong partner bounces.
    expect(go(s, { type: "move", move: { type: "match", left: "tile-1", right: "tile-4" } }).feedback).toBe(tryAgain);
    for (const m of roundMoves(plan.rounds[1]!)) s = go(s, { type: "move", move: m });
    expect(s.phase).toBe("cheer");
    s = go(s, { type: "next" });
    // Sort: the wrong bucket bounces; without a hint the second wrong move shows the move.
    s = go(s, { type: "move", move: { type: "place", item: "tile-1", target: "bucket-b" } });
    s = go(s, { type: "move", move: { type: "place", item: "tile-2", target: "bucket-a" } });
    expect(s).toMatchObject({ tries: 2, guided: true, hint: null });
    expect(nextMove(s)).toEqual({ type: "place", item: "tile-1", target: "bucket-a" });
    for (const m of roundMoves(plan.rounds[2]!)) s = go(s, { type: "move", move: m });
    s = go(s, { type: "next" });
    // Drag: a distractor on a target bounces.
    expect(go(s, { type: "move", move: { type: "place", item: "tile-3", target: "spot-1" } }).tries).toBe(1);
    for (const m of roundMoves(plan.rounds[3]!)) s = go(s, { type: "move", move: m });
    s = go(s, { type: "next" });
    // Trace: too little coverage bounces; once guided, finishing the trace is enough.
    s = go(s, { type: "move", move: { type: "trace", coverage: 0.3 } }, { type: "move", move: { type: "trace", coverage: 0.3 } });
    expect(s.guided).toBe(true);
    s = go(s, { type: "move", move: { type: "trace", coverage: 0.3 } });
    expect(s).toMatchObject({ phase: "cheer", stars: 5 });
    s = go(s, { type: "next" });
    expect(s.phase).toBe("complete");
    expect(s.completion).toMatchObject({ kind: "play", activityId: "pl.fx.topic-a", topicId: A, stars: 5 });
    expect(go(s, { type: "move", move: { type: "trace", coverage: 1 } })).toBe(s);
  });

  it("refuses an activity whose lines are not gentle", () => {
    const { bundle: b, hash: h } = activityBundle("play");
    const p = b.activities["pl.fx.topic-a"]!;
    if (p.schema !== "play@1") throw new Error("fixture changed");
    p.feedback.try_again = "Wrong! Try harder";
    expect(() => planPlay(b, "pl.fx.topic-a", { bundleVersion: h })).toThrow(/not gentle/);
    expect(() => planSong(b, "pl.fx.topic-a", { bundleVersion: h })).toThrow(/not song@1/);
  });
});

describe("trace coverage", () => {
  // A 10 x 10 mask with one vertical bar of ink in column 4 (a stand-in for a rasterised "l").
  const ink = Array.from({ length: 100 }, (_, i) => (i % 10 === 4 ? 1 : 0));
  const mask = { width: 10, height: 10, ink };

  it("measures the share of the glyph's ink the finger passed over", () => {
    expect(traceCoverage(mask, [[{ x: 0.45, y: 0 }, { x: 0.45, y: 1 }]])).toBe(1);
    expect(traceCoverage(mask, [[{ x: 0.45, y: 0 }, { x: 0.45, y: 0.5 }]])).toBeCloseTo(0.6, 5);
    // A stroke far from the ink covers nothing; one tap covers only what is under the finger.
    expect(traceCoverage(mask, [[{ x: 0.95, y: 0 }, { x: 0.95, y: 1 }]])).toBe(0);
    expect(traceCoverage(mask, [[{ x: 0.45, y: 0.05 }]])).toBeCloseTo(0.1, 5);
    expect(traceCoverage(mask, [])).toBe(0);
    expect(traceCoverage({ width: 2, height: 2, ink: [0, 0, 0, 0] }, [])).toBe(1);
  });
});
