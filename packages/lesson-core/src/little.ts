/**
 * Little learner activities (class 1–5; PRD §6 "Story, song and play", learn §5.6, HOME-06,
 * LRN-11). Three pure reducers, one per activity bundle mode, in the style of the lesson machine:
 * every action carries the time and hosts render from `phase`.
 *
 * Rules shared by all three (playerRules("little")):
 * - No timers, no score, no fail state, no XP combos. Nothing is ever taken away.
 * - Feedback is gentle (NEGATIVE_FEEDBACK_WORDS never appear in what lesson-core hands the host).
 * - Always end on a win: a play round finishes only when the child makes the right move. A wrong
 *   move bounces back with the try_again line, the second shows the round's hint, and after that
 *   `guided` is set and `nextMove` names the move for the host to show (the hand points, the
 *   item glows), so the child still does it.
 *
 * Completing an activity returns an `ActivityCompletion` for the host. It is not a sync event:
 * docs/contracts/sync.md (v1.3) has no event or lesson mode for stories, songs or play yet.
 */
import type { ActivityBundle, ActivityKind, BundlePlay, BundlePlayRound, BundleSong, BundleStorybook, LyricLine } from "@smriti/content-schema";
import { negativeFeedbackWords } from "@smriti/content-schema";

export type { ActivityKind };

/** What finishing an activity gives the host: the path node is done, the stars to add. */
export interface ActivityCompletion {
  kind: ActivityKind;
  activityId: string;
  topicId: string;
  concepts: string[];
  bundleVersion: string;
  locale: string;
  stars: number;
  msTotal: number;
  completedAt: number;
}

/** True when a line has none of the words little learners never hear. */
export function isGentleText(text: string): boolean {
  return negativeFeedbackWords(text).length === 0;
}

interface ActivityPlanBase {
  activityId: string;
  topicId: string;
  bundleVersion: string;
  locale: string;
  title: string;
  concepts: string[];
  minutes: number | null;
}

function activity<S extends string>(bundle: ActivityBundle, id: string, schema: S) {
  const a = bundle.activities[id];
  if (!a) throw new Error(`bundle ${bundle.id} has no activity ${id}`);
  if (a.schema !== schema) throw new Error(`${id} is ${a.schema}, not ${schema}`);
  return a;
}

/** The activity ids in a bundle, in bundle order (sorted by id at publish). */
export function activityIds(bundle: ActivityBundle): string[] {
  return Object.keys(bundle.activities);
}

const base = (bundle: ActivityBundle, a: { id: string; title: string; concepts: string[] }, bundleVersion: string, minutes: number | null) => ({
  activityId: a.id,
  topicId: bundle.topic.id,
  bundleVersion,
  locale: bundle.locale,
  title: a.title,
  concepts: a.concepts,
  minutes,
});

function completion(plan: ActivityPlanBase, kind: ActivityKind, stars: number, startedAt: number | null, now: number): ActivityCompletion {
  return {
    kind,
    activityId: plan.activityId,
    topicId: plan.topicId,
    concepts: plan.concepts,
    bundleVersion: plan.bundleVersion,
    locale: plan.locale,
    stars,
    msTotal: now - (startedAt ?? now),
    completedAt: now,
  };
}

// ---------------------------------------------------------------------------------------------
// Story (LRN-11)

export interface StoryPlan extends ActivityPlanBase {
  kind: "story";
  pages: BundleStorybook["pages"];
  /** "Read to me" starts on for little learners (LRN-11 little learner state). */
  narrationDefault: boolean;
}

/** Wait after a page's narration ends before turning the page (LRN-11: 2 s without a touch). */
export const STORY_AUTO_ADVANCE_MS = 2000;

export function planStory(bundle: ActivityBundle, id: string, opts: { bundleVersion: string; little: boolean }): StoryPlan {
  const a = activity(bundle, id, "storybook@1") as BundleStorybook;
  return { ...base(bundle, a, opts.bundleVersion, null), kind: "story", pages: a.pages, narrationDefault: opts.little };
}

export interface StoryState {
  plan: StoryPlan | null;
  /** "page" while reading; "end" is "The end!" with [Read again] and [Done]. */
  phase: "loading" | "page" | "end" | "complete" | "exited";
  page: number;
  /** Narration is on and a page with narration plays it. */
  narration: boolean;
  /** When the page turns by itself (narration on, audio ended, no touch since). */
  autoAdvanceAt: number | null;
  startedAt: number | null;
  completion: ActivityCompletion | null;
}

export type StoryAction =
  | { type: "start"; plan: StoryPlan }
  | { type: "next" }
  | { type: "back" }
  | { type: "narration"; on: boolean }
  | { type: "narration_ended" }
  | { type: "touch" }
  | { type: "tick" }
  | { type: "read_again" }
  | { type: "done" }
  | { type: "exit" };

export function initialStory(): StoryState {
  return { plan: null, phase: "loading", page: 0, narration: false, autoAdvanceAt: null, startedAt: null, completion: null };
}

function turn(s: StoryState): StoryState {
  const last = s.plan!.pages.length - 1;
  if (s.page >= last) return { ...s, phase: "end", autoAdvanceAt: null };
  return { ...s, page: s.page + 1, autoAdvanceAt: null };
}

export function reduceStory(s: StoryState, action: StoryAction & { now: number }): StoryState {
  const { now } = action;
  if (s.phase === "complete" || s.phase === "exited") return s;
  if (action.type === "start") {
    return { ...initialStory(), plan: action.plan, phase: "page", narration: action.plan.narrationDefault, startedAt: now };
  }
  if (!s.plan) return s;
  switch (action.type) {
    case "next":
      return s.phase === "page" ? turn(s) : s;
    case "back":
      if (s.phase === "end") return { ...s, phase: "page", autoAdvanceAt: null };
      return s.phase === "page" && s.page > 0 ? { ...s, page: s.page - 1, autoAdvanceAt: null } : s;
    case "narration":
      return { ...s, narration: action.on, autoAdvanceAt: null };
    case "narration_ended":
      return s.phase === "page" && s.narration ? { ...s, autoAdvanceAt: now + STORY_AUTO_ADVANCE_MS } : s;
    case "touch":
      return { ...s, autoAdvanceAt: null };
    case "tick":
      return s.phase === "page" && s.autoAdvanceAt !== null && now >= s.autoAdvanceAt ? turn(s) : s;
    case "read_again":
      return s.phase === "end" ? { ...s, phase: "page", page: 0, autoAdvanceAt: null } : s;
    case "done":
      // A finished storybook counts as a lesson (learn §6.2): one star, like a finished node.
      return s.phase === "end" ? { ...s, phase: "complete", completion: completion(s.plan, "story", 1, s.startedAt, now) } : s;
    case "exit":
      return { ...s, phase: "exited", autoAdvanceAt: null };
  }
}

// ---------------------------------------------------------------------------------------------
// Song

export interface SongPlan extends ActivityPlanBase {
  kind: "song";
  style: BundleSong["style"];
  cover: string | null;
  audio: string;
  lines: LyricLine[];
  /** Every line has start_ms and end_ms, so the host can highlight the line being sung. */
  timed: boolean;
  actions: NonNullable<BundleSong["actions"]>;
}

export function planSong(bundle: ActivityBundle, id: string, opts: { bundleVersion: string }): SongPlan {
  const a = activity(bundle, id, "song@1") as BundleSong;
  const lines = a.version.lines;
  return {
    ...base(bundle, a, opts.bundleVersion, a.minutes ?? null),
    kind: "song",
    style: a.style,
    cover: a.cover ?? null,
    audio: a.version.audio,
    lines,
    timed: lines.every((l) => l.start_ms !== undefined && l.end_ms !== undefined),
    actions: a.actions ?? [],
  };
}

/** The line being sung at `ms`, or null between lines and for untimed songs. */
export function lineAt(lines: readonly LyricLine[], ms: number): number | null {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.start_ms === undefined || l.end_ms === undefined) return null;
    if (ms >= l.start_ms && ms < l.end_ms) return i;
  }
  return null;
}

export interface SongState {
  plan: SongPlan | null;
  phase: "loading" | "ready" | "playing" | "paused" | "complete" | "exited";
  positionMs: number;
  line: number | null;
  /** The action to do now (clap, jump), from the current line. */
  action: string | null;
  startedAt: number | null;
  completion: ActivityCompletion | null;
}

export type SongAction =
  | { type: "start"; plan: SongPlan }
  | { type: "play" }
  | { type: "pause" }
  | { type: "tick"; positionMs: number }
  | { type: "ended" }
  | { type: "exit" };

export function initialSong(): SongState {
  return { plan: null, phase: "loading", positionMs: 0, line: null, action: null, startedAt: null, completion: null };
}

function at(s: SongState, positionMs: number): SongState {
  const line = lineAt(s.plan!.lines, positionMs);
  return { ...s, positionMs, line, action: line === null ? null : (s.plan!.lines[line]!.action ?? null) };
}

export function reduceSong(s: SongState, action: SongAction & { now: number }): SongState {
  const { now } = action;
  if (s.phase === "exited") return s;
  if (action.type === "start") return { ...initialSong(), plan: action.plan, phase: "ready", startedAt: now };
  if (!s.plan) return s;
  switch (action.type) {
    case "play":
      // Singing again after the end is welcome; the completion stays.
      return s.phase === "complete" ? { ...at(s, 0), phase: "playing" } : s.phase === "playing" ? s : { ...s, phase: "playing" };
    case "pause":
      return s.phase === "playing" ? { ...s, phase: "paused" } : s;
    case "tick":
      return s.phase === "playing" ? at(s, Math.max(0, action.positionMs)) : s;
    case "ended": {
      if (s.phase !== "playing") return s;
      const done = { ...s, phase: "complete" as const, line: null, action: null };
      return s.completion ? done : { ...done, completion: completion(s.plan, "song", 1, s.startedAt, now) };
    }
    case "exit":
      return { ...s, phase: "exited" };
  }
}

// ---------------------------------------------------------------------------------------------
// Play

export interface PlayPlan extends ActivityPlanBase {
  kind: "play";
  cover: string | null;
  feedback: BundlePlay["feedback"];
  rounds: BundlePlayRound[];
}

export function planPlay(bundle: ActivityBundle, id: string, opts: { bundleVersion: string }): PlayPlan {
  const a = activity(bundle, id, "play@1") as BundlePlay;
  // The content check refuses negative words; this keeps a bad bundle from reaching a child.
  for (const line of [a.feedback.success, a.feedback.try_again]) {
    if (!isGentleText(line)) throw new Error(`${id} feedback is not gentle: ${line}`);
  }
  return { ...base(bundle, a, opts.bundleVersion, a.minutes), kind: "play", cover: a.cover ?? null, feedback: a.feedback, rounds: a.rounds };
}

export type PlayMove =
  | { type: "tap"; item: string }
  | { type: "match"; left: string; right: string }
  /** Sort: `target` is a bucket id. Drag: `target` is a target id. */
  | { type: "place"; item: string; target: string }
  /** Trace: the share of the glyph the finger covered, 0–1, measured by the host. */
  | { type: "trace"; coverage: number };

export interface PlayState {
  plan: PlayPlan | null;
  /** "round" while playing; "cheer" after a finished round (the pet celebrates); then the next. */
  phase: "loading" | "round" | "cheer" | "complete" | "exited";
  round: number;
  /** Right moves made in this round: tapped items, matched left ids, placed items, or "trace". */
  done: string[];
  /** Wrong moves in this round. Never shown as a count. */
  tries: number;
  /** The line for the last move: the success line, the try_again line, or null. */
  feedback: string | null;
  /** The round's hint is showing (after the second wrong move). */
  hint: string | null;
  /** The player shows the next move (after the hint, or the second wrong move without one). */
  guided: boolean;
  stars: number;
  startedAt: number | null;
  completion: ActivityCompletion | null;
}

export type PlayAction = { type: "start"; plan: PlayPlan } | { type: "move"; move: PlayMove } | { type: "next" } | { type: "exit" };

export function initialPlay(): PlayState {
  return { plan: null, phase: "loading", round: 0, done: [], tries: 0, feedback: null, hint: null, guided: false, stars: 0, startedAt: null, completion: null };
}

/** The right moves a round needs, in order. */
export function roundMoves(round: BundlePlayRound): PlayMove[] {
  switch (round.kind) {
    case "tap":
      return round.answer.map((item) => ({ type: "tap", item }));
    case "match":
      return round.pairs.map((p) => ({ type: "match", left: p.left.id, right: p.right.id }));
    case "sort":
      return round.items.map((i) => ({ type: "place", item: i.id, target: i.bucket }));
    case "drag":
      return round.targets.map((t) => ({ type: "place", item: t.accepts, target: t.id }));
    case "trace":
      return [{ type: "trace", coverage: round.min_coverage }];
  }
}

const moveKey = (m: PlayMove): string => (m.type === "tap" ? m.item : m.type === "match" ? m.left : m.type === "place" ? m.item : "trace");

/** The next right move, for the host to show while `guided` (or any time a grown-up asks). */
export function nextMove(s: PlayState): PlayMove | null {
  const round = s.plan?.rounds[s.round];
  if (!round || s.phase !== "round") return null;
  return roundMoves(round).find((m) => !s.done.includes(moveKey(m))) ?? null;
}

/** Is this move one the round still needs? Trace needs enough coverage (any coverage once guided). */
function isRight(round: BundlePlayRound, move: PlayMove, guided: boolean, done: readonly string[]): boolean {
  const key = moveKey(move);
  if (done.includes(key)) return false;
  switch (round.kind) {
    case "tap":
      return move.type === "tap" && round.answer.includes(move.item);
    case "match":
      return move.type === "match" && round.pairs.some((p) => p.left.id === move.left && p.right.id === move.right);
    case "sort":
      return move.type === "place" && round.items.some((i) => i.id === move.item && i.bucket === move.target);
    case "drag":
      return move.type === "place" && round.targets.some((t) => t.id === move.target && t.accepts === move.item);
    case "trace":
      // Once guided, the child traces along the animated guide: finishing the trace is the win.
      return move.type === "trace" && move.coverage >= (guided ? 0 : round.min_coverage) && move.coverage > 0;
  }
}

/** A move that names something already done (a picked tile tapped again) is ignored, not wrong. */
function isRepeat(move: PlayMove, done: readonly string[]): boolean {
  return move.type !== "trace" && done.includes(moveKey(move));
}

function startRound(s: PlayState, index: number): PlayState {
  return { ...s, phase: "round", round: index, done: [], tries: 0, feedback: null, hint: null, guided: false };
}

export function reducePlay(s: PlayState, action: PlayAction & { now: number }): PlayState {
  const { now } = action;
  if (s.phase === "complete" || s.phase === "exited") return s;
  if (action.type === "start") {
    if (action.plan.rounds.length === 0) throw new Error("a play activity needs at least one round");
    return startRound({ ...initialPlay(), plan: action.plan, startedAt: now }, 0);
  }
  if (!s.plan) return s;
  const plan = s.plan;
  switch (action.type) {
    case "move": {
      if (s.phase !== "round") return s;
      const round = plan.rounds[s.round]!;
      const move = action.move;
      if (isRepeat(move, s.done)) return s;
      if (isRight(round, move, s.guided, s.done)) {
        const done = [...s.done, moveKey(move)];
        const finished = roundMoves(round).every((m) => done.includes(moveKey(m)));
        if (!finished) return { ...s, done, feedback: plan.feedback.success };
        // The round is won: one star, and the pet cheers.
        return { ...s, done, phase: "cheer", feedback: plan.feedback.success, hint: null, guided: false, stars: s.stars + 1 };
      }
      const tries = s.tries + 1;
      const roundHint = round.hint && isGentleText(round.hint) ? round.hint : null;
      // 1st wrong: try again. 2nd: the hint (if the round has one). After that: show the move.
      const hint = tries >= 2 && roundHint ? roundHint : s.hint;
      const guided = s.guided || (roundHint ? tries >= 3 : tries >= 2);
      return { ...s, tries, feedback: plan.feedback.try_again, hint, guided };
    }
    case "next": {
      if (s.phase !== "cheer") return s;
      if (s.round + 1 < plan.rounds.length) return startRound(s, s.round + 1);
      return { ...s, phase: "complete", feedback: null, completion: completion(plan, "play", s.stars, s.startedAt, now) };
    }
    case "exit":
      return { ...s, phase: "exited" };
  }
}
