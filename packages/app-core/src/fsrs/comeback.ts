import type { SrsCardRow } from '../storage/types';
import { addDays, type Instant, type LocalDate } from '../time';
import type { SrsScheduler } from './scheduler';

/**
 * The comeback plan (R22, memory-labs §5.2): a plan, never a wall. The backlog is spread over
 * 3, 5 or 7 days; Home shows only today's capped chunk.
 */

export interface ComebackConfig {
  /** `memory.comeback.min_due` (60). */
  minDue: number;
  /** `memory.comeback.relearn_below` (0.3 retrievability). */
  relearnBelow: number;
  /** `memory.comeback.first_session` (10). */
  firstSession: number;
  /** `memory.comeback.plan_lengths` ([3, 5, 7]). */
  planLengths: readonly number[];
  /** `memory.session_size` (20): a chunk is never smaller. */
  sessionSize: number;
  /** `memory.default_seconds_per_card` (10), until 50 timed reviews exist. */
  defaultSecondsPerCard: number;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/**
 * The backlog rule: today's due count is at least max(min_due, 3 × the median daily reviews over
 * the last 14 active days). With no history, only `min_due` applies.
 */
export function backlogThreshold(dailyReviewsLast14ActiveDays: readonly number[], cfg: Pick<ComebackConfig, 'minDue'>): number {
  const last14 = dailyReviewsLast14ActiveDays.slice(-14);
  return Math.max(cfg.minDue, Math.ceil(3 * median(last14)));
}

export function shouldOfferComeback(dueToday: number, dailyReviewsLast14ActiveDays: readonly number[], cfg: Pick<ComebackConfig, 'minDue'>): boolean {
  return dueToday >= backlogThreshold(dailyReviewsLast14ActiveDays, cfg);
}

/** Median seconds per card from timed reviews; the default until there are 50. */
export function secondsPerCard(durationsMs: readonly number[], cfg: Pick<ComebackConfig, 'defaultSecondsPerCard'>): number {
  if (durationsMs.length < 50) return cfg.defaultSecondsPerCard;
  return Math.max(1, Math.round(median(durationsMs) / 1000));
}

export interface ComebackInput {
  backlog: readonly SrsCardRow[];
  now: Instant;
  today: LocalDate;
  scheduler: SrsScheduler;
  /** Profile daily goal (minutes). */
  goalMinutes: number;
  secondsPerCard: number;
  /** Concepts marked `priority: core` in the exam map come first. */
  isCore: (card: SrsCardRow) => boolean;
  /** The student picked another length on MEM-02. */
  chosenDays?: number;
  /** 30 or more days away: the first session is short (A44). */
  longBreak?: boolean;
  config: ComebackConfig;
}

export interface ComebackPlan {
  startDay: LocalDate;
  planDays: number;
  /** The goal-sized daily chunk (cards). */
  dailyChunk: number;
  /** Card refs per day, day 1 first. */
  chunks: { day: LocalDate; cardRefs: string[] }[];
  /** Very-low-recall cards grouped by topic, offered as "Relearn with Quick Revision" (always free). */
  relearnTopics: { topicId: string; cardRefs: string[] }[];
  /** The short first session after 30+ days away, from core concepts with the best recall. */
  firstSession: string[] | null;
  total: number;
}

export function buildComebackPlan(input: ComebackInput): ComebackPlan {
  const cfg = input.config;
  const scored = input.backlog.map((c) => ({ c, r: input.scheduler.retrievability(c, input.now), core: input.isCore(c) }));

  const relearn = new Map<string, string[]>();
  const keep: typeof scored = [];
  for (const s of scored) {
    if (s.c.state !== 0 && s.r < cfg.relearnBelow) {
      const topic = s.c.topic_id ?? 'unknown';
      relearn.set(topic, [...(relearn.get(topic) ?? []), s.c.card_ref]);
    } else {
      keep.push(s);
    }
  }
  // Core first, then the ones still nearly remembered (highest retrievability first).
  keep.sort((a, b) => Number(b.core) - Number(a.core) || b.r - a.r || a.c.card_ref.localeCompare(b.c.card_ref));

  const dailyChunk = Math.max(cfg.sessionSize, Math.floor((input.goalMinutes * 60) / Math.max(1, input.secondsPerCard)));
  const lengths = [...cfg.planLengths].sort((a, b) => a - b);
  const fitting = lengths.find((l) => Math.ceil(keep.length / l) <= dailyChunk);
  const planDays = input.chosenDays ?? fitting ?? lengths[lengths.length - 1] ?? 7;
  const perDay = Math.max(1, Math.ceil(keep.length / planDays));

  const chunks: ComebackPlan['chunks'] = [];
  for (let i = 0; i < planDays; i++) {
    chunks.push({ day: addDays(input.today, i), cardRefs: keep.slice(i * perDay, (i + 1) * perDay).map((s) => s.c.card_ref) });
  }

  const firstSession = input.longBreak
    ? keep
        .filter((s) => s.core)
        .concat(keep.filter((s) => !s.core))
        .slice(0, cfg.firstSession)
        .map((s) => s.c.card_ref)
    : null;

  return {
    startDay: input.today,
    planDays,
    dailyChunk,
    chunks,
    relearnTopics: [...relearn].map(([topicId, cardRefs]) => ({ topicId, cardRefs })),
    firstSession,
    total: input.backlog.length,
  };
}

/** Today's chunk of an active plan (Home shows only this count). */
export function comebackChunkFor(plan: ComebackPlan, today: LocalDate): { dayIndex: number; cardRefs: string[] } | null {
  const i = plan.chunks.findIndex((c) => c.day === today);
  if (i < 0) return null;
  return { dayIndex: i + 1, cardRefs: plan.chunks[i]?.cardRefs ?? [] };
}
