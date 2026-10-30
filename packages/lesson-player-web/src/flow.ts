/**
 * The lesson flow as a pure reducer (learn flow §7): card by card, questions get two attempts
 * (a hint after the first miss, the explanation after the second), "I don't know yet" reveals the
 * idea and counts as a miss, and a preview stops after `previewCards`.
 */
import type { LessonCard, NumericCard, PlayerConfidence, QuestionCard } from "./types";

export type Phase = "reading" | "answering" | "correct" | "retry" | "revealed" | "done" | "preview_end";

export interface FlowState {
  index: number;
  phase: Phase;
  /** 1 before the first check, 2 after a miss. */
  attempt: 1 | 2;
  selected: string | null;
  numeric: string;
  confidence: PlayerConfidence | null;
  correct: number;
  firstTry: number;
  answered: number;
  missed: string[];
  seen: number;
}

export type FlowAction =
  | { type: "select"; optionId: string }
  | { type: "numeric"; value: string }
  | { type: "confidence"; value: PlayerConfidence | null }
  | { type: "check" }
  | { type: "dont_know" }
  | { type: "retry" }
  | { type: "next" };

export const isQuestion = (c: LessonCard | undefined): c is QuestionCard => c?.type === "mcq" || c?.type === "numeric";

export function initialFlow(cards: readonly LessonCard[]): FlowState {
  return {
    index: 0,
    phase: isQuestion(cards[0]) ? "answering" : "reading",
    attempt: 1,
    selected: null,
    numeric: "",
    confidence: null,
    correct: 0,
    firstTry: 0,
    answered: 0,
    missed: [],
    seen: cards.length > 0 ? 1 : 0,
  };
}

/** Parses a typed number ("3.5", "-2", "1e3") or returns null. */
export function parseNumeric(value: string): number | null {
  const v = value.trim().replace(/,/g, "");
  if (v === "" || !/^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function isNumericCorrect(card: NumericCard, value: string): boolean {
  const n = parseNumeric(value);
  return n !== null && Math.abs(n - card.answer) <= card.tolerance + 1e-12;
}

export function isAnswerCorrect(card: QuestionCard, s: Pick<FlowState, "selected" | "numeric">): boolean {
  return card.type === "mcq" ? s.selected === card.correctId : isNumericCorrect(card, s.numeric);
}

export function canCheck(card: LessonCard | undefined, s: FlowState): boolean {
  if (!isQuestion(card) || (s.phase !== "answering" && s.phase !== "retry")) return false;
  return card.type === "mcq" ? s.selected !== null : parseNumeric(s.numeric) !== null;
}

export function createFlowReducer(cards: readonly LessonCard[], previewCards?: number) {
  const limit = previewCards !== undefined ? Math.min(previewCards, cards.length) : cards.length;
  return function reduce(s: FlowState, a: FlowAction): FlowState {
    const card = cards[s.index];
    switch (a.type) {
      case "select":
        return s.phase === "answering" || s.phase === "retry" ? { ...s, selected: a.optionId } : s;
      case "numeric":
        return s.phase === "answering" || s.phase === "retry" ? { ...s, numeric: a.value } : s;
      case "confidence":
        return { ...s, confidence: a.value };
      case "check": {
        if (!isQuestion(card) || !canCheck(card, s)) return s;
        if (isAnswerCorrect(card, s)) {
          return {
            ...s,
            phase: "correct",
            correct: s.correct + 1,
            firstTry: s.attempt === 1 ? s.firstTry + 1 : s.firstTry,
            answered: s.answered + 1,
          };
        }
        if (s.attempt === 1) return { ...s, phase: "retry", attempt: 2 };
        return { ...s, phase: "revealed", answered: s.answered + 1, missed: [...s.missed, card.id] };
      }
      case "dont_know":
        if (!isQuestion(card) || (s.phase !== "answering" && s.phase !== "retry")) return s;
        return { ...s, phase: "revealed", answered: s.answered + 1, missed: [...s.missed, card.id] };
      case "retry":
        return s.phase === "retry" ? { ...s, selected: null, numeric: "" } : s;
      case "next": {
        if (s.phase === "answering" || s.phase === "retry") return s;
        const next = s.index + 1;
        if (next >= limit) return { ...s, phase: limit < cards.length ? "preview_end" : "done" };
        return {
          ...s,
          index: next,
          phase: isQuestion(cards[next]) ? "answering" : "reading",
          attempt: 1,
          selected: null,
          numeric: "",
          confidence: null,
          seen: s.seen + 1,
        };
      }
    }
  };
}

export function totalQuestions(cards: readonly LessonCard[]): number {
  return cards.filter(isQuestion).length;
}
