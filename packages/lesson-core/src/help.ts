/** The help ladder (learn §2.7, §7.3): hints, strike-outs, the worked solution and the sim link. */
import type { TypedBundle } from "@smriti/content-schema";

import type { AnyQuestion, CheckResult } from "./answers.js";
import { isSingleAnswer } from "./answers.js";
import type { PlanCard } from "./plan.js";

export type Hint =
  /** The `common_traps[].why` of the option the student picked. */
  | { source: "trap"; text: string }
  /** The question's own `hints[]`. */
  | { source: "hint"; text: string }
  /** No authored hint: the renderer shows a generic nudge naming the concept (an i18n string). */
  | { source: "generic"; conceptId: string | null };

/** Hint for a wrong try: the picked option's trap, else the question's hints, else generic. */
export function hintFor(q: AnyQuestion, result: CheckResult, attempt: number): Hint {
  const solution = q.solution;
  if (result.detail.kind === "options" && solution?.common_traps) {
    for (const id of result.detail.chosenWrong) {
      const trap = solution.common_traps.find((t) => t.option_id === id);
      if (trap) return { source: "trap", text: trap.why };
    }
  }
  const hints = q.hints ?? [];
  const hint = hints[Math.min(attempt - 1, hints.length - 1)];
  if (hint) return { source: "hint", text: hint };
  return { source: "generic", conceptId: q.concepts[0]?.id ?? null };
}

/** Options to strike out after a wrong try: the chosen wrong ones, for single-answer types only. */
export function struckOptions(q: AnyQuestion, result: CheckResult): string[] {
  if (!isSingleAnswer(q) || result.detail.kind !== "options") return [];
  return result.detail.chosenWrong;
}

/** The worked solution in teaching order: Feynman first, then steps, shortcut and common trap. */
export function workedSolution(q: AnyQuestion): {
  feynman: string | null;
  steps: string[];
  shortcut: string | null;
  shortcutFailsWhen: string | null;
  traps: { optionId: string | null; why: string }[];
} {
  const s = q.solution;
  return {
    feynman: s?.feynman ?? null,
    steps: s?.steps ?? [],
    shortcut: s?.shortcut ?? null,
    shortcutFailsWhen: s?.shortcut_fails_when ?? null,
    traps: (s?.common_traps ?? []).map((t) => ({ optionId: t.option_id ?? null, why: t.why })),
  };
}

/** A sim card in the same bite that shares a concept with the question ("Try it in the sim"). */
export function simCardFor(cards: PlanCard[], current: PlanCard): PlanCard | null {
  return (
    cards.find(
      (c) => c.card?.type === "sim" && c.biteId === current.biteId && c.concepts.some((k) => current.concepts.includes(k)),
    ) ?? null
  );
}

/** "Tough one" chip (A20): hard questions, or PYQs with a real paper behind them. */
export function toughOne(q: AnyQuestion, bundle?: Pick<TypedBundle, "pyq_papers">): { kind: "hard" } | { kind: "pyq"; examName: string; year: number; paper: string } | null {
  if (q.pyq) {
    const paper = bundle?.pyq_papers?.[q.pyq.paper];
    if (paper) return { kind: "pyq", examName: paper.exam_name, year: paper.year, paper: q.pyq.paper };
  }
  return q.difficulty_estimate === "hard" ? { kind: "hard" } : null;
}
