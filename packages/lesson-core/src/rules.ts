/**
 * What the player shows and allows, by mode. The machine already enforces hints, attempts,
 * combos, the guided finish and the confidence step; hosts read the rest (chips, rows, copy tone)
 * from here so web and native agree.
 *
 * Little learner rules (class 1–5) come from LES-01 and LES-02 "little learner", LES-08 "little
 * learner variant", HOME-06 and learn §5.6: narration auto-plays, no confidence row, no counter
 * (dots instead), no XP chip (stars instead, "XP shown as stars"), wrong answers never say "Not
 * quite", the second wrong try shows the answer with the pet, no Fix row. The guided finish (the
 * child taps the shown answer, so every question ends on a win) is how lesson-core applies "shows
 * the answer with the pet"; the docs do not say whether the child taps it.
 */
import type { PlayerMode } from "./plan.js";

export interface PlayerRules {
  /** "gentle": the LES-02 little learner copy, no negative feedback words anywhere. */
  tone: "standard" | "gentle";
  hints: boolean;
  attemptsAllowed: 1 | 2;
  /** The combo celebration and its XP. */
  combos: boolean;
  /** The "+n XP" chip on feedback. */
  xpChip: boolean;
  /** XP is shown as stars (HOME-06 star counter, LES-08 "You got {n} stars!"). */
  stars: boolean;
  /** No lesson has a countdown; listed so hosts never add one. */
  timers: false;
  /** LES-01 confidence row on questions. */
  confidenceRow: boolean;
  /** LES-07 "How sure does … feel?" at the end. */
  confidenceStep: boolean;
  /** "{n} of {total}" in the top bar (little learners get dots). */
  counter: boolean;
  narrationAutoPlay: boolean;
  /** After the second wrong try or "I don't know yet", the answer is shown and the child taps it. */
  guidedFinish: boolean;
  /** The LES-08 Fix mistakes row may show (A22: only after misses). Never for little learners. */
  fixRow: boolean;
  /** LES-01 little learner: the pet avatar stays at the top-right of every card and reacts. */
  cornerPet: boolean;
}

export function playerRules(mode: PlayerMode): PlayerRules {
  if (mode === "little") {
    return {
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
      cornerPet: true,
    };
  }
  const check = mode === "quick_check";
  return {
    tone: "standard",
    hints: !check,
    attemptsAllowed: check ? 1 : 2,
    combos: mode === "deep_dive" || mode === "quick_revision" || mode === "onboarding",
    xpChip: true,
    stars: false,
    timers: false,
    confidenceRow: true,
    confidenceStep: mode === "deep_dive" || mode === "quick_revision",
    counter: true,
    narrationAutoPlay: false,
    guidedFinish: false,
    fixRow: mode !== "fix_mistakes",
    cornerPet: false,
  };
}
