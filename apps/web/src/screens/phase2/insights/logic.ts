/**
 * G-8 insight rules, free of React: the MEM-25 calibration bars from `GET /v1/insights/calibration`,
 * the "fading soon" rows from `/v1/insights/weak-areas`, the sleep review state from
 * `/v1/insights/sleep-review`, and the mixed drill's deal (practice §5.3). Every number shown comes
 * from the server's answer; nothing here estimates or rounds beyond whole percents.
 */
import type { Schemas } from "@smriti/api-client";

export type Level = "sure" | "fifty" | "guess";
export const LEVELS: readonly Level[] = ["sure", "fifty", "guess"];
export type Targets = Record<Level, number>;

export interface Bar {
  level: Level;
  /** Whole percent right, or null with no answers at this level. */
  pct: number | null;
  answers: number;
  correct: number;
  target: number;
  /** Right less often than the target at "Sure" (MEM-25 chart note). */
  below: boolean;
}

export const pct = (fraction: number) => Math.round(fraction * 100);

export function bars(levels: readonly Schemas["CalibrationLevel"][] | undefined, targets: Targets): Bar[] {
  return LEVELS.map((level) => {
    const row = levels?.find((l) => l.confidence === level || (level === "fifty" && l.confidence === "fifty_fifty"));
    const answers = row?.answers ?? 0;
    const correct = row?.correct ?? 0;
    const acc = row?.accuracy ?? (answers ? correct / answers : null);
    const target = pct(targets[level]);
    const p = acc === null ? null : pct(acc);
    return { level, pct: p, answers, correct, target, below: level === "sure" && p !== null && p < target };
  });
}

/** "Sure but wrong" and "Lucky guesses": counts straight from the levels. */
export function headline(b: readonly Bar[]): { sureWrong: number; lucky: number } {
  const sure = b.find((x) => x.level === "sure");
  const guess = b.find((x) => x.level === "guess");
  return { sureWrong: sure ? sure.answers - sure.correct : 0, lucky: guess?.correct ?? 0 };
}

/** How many more tagged answers before the map shows (the empty state's `{k}`). */
export function stillNeeded(c: Pick<Schemas["CalibrationOut"], "needed" | "tagged">): number | null {
  return c.needed === null ? null : Math.max(0, c.needed - c.tagged);
}

/** The owner's targets flag, or the doc defaults when a value is missing or out of range. */
export function targetsFrom(v: unknown): Targets {
  const d: Targets = { sure: 0.9, fifty: 0.5, guess: 0.25 };
  if (!v || typeof v !== "object") return d;
  const o = v as Record<string, unknown>;
  const ok = (x: unknown, f: number) => (typeof x === "number" && x >= 0 && x <= 1 ? x : f);
  return { sure: ok(o.sure, d.sure), fifty: ok(o.fifty, d.fifty), guess: ok(o.guess, d.guess) };
}

export interface FadingRow {
  topicId: string;
  name: string | null;
  subject: string | null;
  cards: number;
  recallPct: number;
}

/** Weak areas joined to the catalogue for names; most cards first, as the server ranks them. */
export function fadingRows(w: Schemas["WeakAreasOut"] | undefined, name: (topicId: string) => { name: string; subject: string } | null): FadingRow[] {
  return (w?.topics ?? []).map((t) => {
    const n = name(t.topic_id);
    return { topicId: t.topic_id, name: n?.name ?? null, subject: n?.subject ?? null, cards: t.cards, recallPct: pct(t.min_retrievability) };
  });
}

export type SleepState = { kind: "ready"; cards: number; at: string | null } | { kind: "reason"; reason: SleepReason };
export type SleepReason = "pro_required" | "off" | "pick_a_time" | "not_confident" | "no_due_cards" | "unavailable";

export function sleepState(s: Schemas["SleepReviewOut"] | undefined): SleepState {
  if (!s) return { kind: "reason", reason: "unavailable" };
  if (s.eligible && (s.cards?.length ?? 0) > 0) return { kind: "ready", cards: s.cards?.length ?? 0, at: s.bedtime ?? null };
  const r = s.reason;
  const known: SleepReason[] = ["pro_required", "off", "pick_a_time", "not_confident", "no_due_cards"];
  return { kind: "reason", reason: known.includes(r as SleepReason) ? (r as SleepReason) : r === "threshold_unset" ? "not_confident" : "unavailable" };
}

/** "22:30" in the reader's clock, from the server's local time string. */
export function clockLabel(hhmm: string, locale: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  const d = new Date(2000, 0, 1, Number(m[1]), Number(m[2]));
  return new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", { hour: "numeric", minute: "2-digit" }).format(d);
}

export type GroupBy = "subject" | "chapter" | "topic";
export const COUNTS = [5, 10, 20] as const;

/** The mixed drill's topics, in first-seen order, so their practice bundles load once each. */
export function sessionTopics(questions: readonly { topic_id: string }[]): string[] {
  return [...new Set(questions.map((q) => q.topic_id))];
}

/** Server questions that the loaded bundles hold, in the server's order (others are skipped). */
export function playable<Q>(questions: readonly { question_id: string; topic_id: string }[], find: (topicId: string, id: string) => Q | undefined): { id: string; topicId: string; q: Q }[] {
  return questions.flatMap((s) => {
    const q = find(s.topic_id, s.question_id);
    return q ? [{ id: s.question_id, topicId: s.topic_id, q }] : [];
  });
}
