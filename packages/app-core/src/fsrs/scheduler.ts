import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type FSRS, type Grade } from 'ts-fsrs';

import type { FsrsStatePayload, ReviewRating } from '../sync/types';
import type { SrsCardRow } from '../storage/types';
import { toIso, toMs, type Instant } from '../time';

/**
 * FSRS on the device (TRD §3.2), over `ts-fsrs` pinned at 5.4.2. The server runs the same
 * parameters and its schedule wins on conflict. Ratings are Again / Hard / Good / Easy = 1–4 (R18).
 */

export const RATING_LABELS = ['again', 'hard', 'good', 'easy'] as const;
export type RatingLabel = (typeof RATING_LABELS)[number];

export const ratingFromLabel = (label: RatingLabel): ReviewRating => (RATING_LABELS.indexOf(label) + 1) as ReviewRating;

export interface SchedulerOptions {
  /** Desired retention (`memory.retention_presets`, standard 0.9). */
  requestRetention?: number;
  maximumIntervalDays?: number;
  /** Per-user optimised weights (`learn.fsrs_params.weights`); defaults to ts-fsrs's. */
  weights?: readonly number[];
  /** Interval fuzz (on in the app; off in test vectors so the server can match exactly). */
  enableFuzz?: boolean;
}

export interface ScheduleResult {
  card: SrsCardRow;
  /** What `review_rated.fsrs_state` carries. */
  fsrsState: FsrsStatePayload;
  /** Days between this review and the next due date. */
  intervalDays: number;
  log: { rating: ReviewRating; stateBefore: 0 | 1 | 2 | 3; elapsedDays: number; scheduledDays: number; reviewedAt: string };
}

export interface IntervalPreview {
  rating: ReviewRating;
  label: RatingLabel;
  due: string;
  /** Milliseconds from now to `due`. */
  intervalMs: number;
  /** For the button caption ("10 min", "3 d", "2 mo"); the UI localises the unit. */
  display: { value: number; unit: 'min' | 'h' | 'd' | 'mo' | 'y' };
}

export class SrsScheduler {
  readonly engine: FSRS;
  constructor(readonly options: SchedulerOptions = {}) {
    this.engine = fsrs(
      generatorParameters({
        request_retention: options.requestRetention ?? 0.9,
        maximum_interval: options.maximumIntervalDays ?? 36500,
        enable_fuzz: options.enableFuzz ?? true,
        ...(options.weights ? { w: [...options.weights] } : {}),
      }),
    );
  }

  /** A new card row (state New, due now). */
  newCard(cardRef: string, now: Instant, extra: Partial<SrsCardRow> = {}): SrsCardRow {
    const c = createEmptyCard(new Date(toMs(now)));
    return { ...fromFsrsCard(cardRef, c, toIso(now), null), ...extra };
  }

  schedule(row: SrsCardRow, rating: ReviewRating, now: Instant): ScheduleResult {
    const at = new Date(toMs(now));
    const { card, log } = this.engine.next(toFsrsCard(row), at, rating as Grade);
    const next = fromFsrsCard(row.card_ref, card, at.toISOString(), row);
    return {
      card: next,
      fsrsState: toFsrsStatePayload(next),
      intervalDays: (card.due.getTime() - at.getTime()) / 86_400_000,
      log: {
        rating,
        stateBefore: row.state,
        elapsedDays: log.elapsed_days,
        scheduledDays: log.scheduled_days,
        reviewedAt: at.toISOString(),
      },
    };
  }

  /** Intervals for all four buttons, computed before the back is shown (memory-labs §5.1). */
  preview(row: SrsCardRow, now: Instant): IntervalPreview[] {
    const at = new Date(toMs(now));
    const log = this.engine.repeat(toFsrsCard(row), at);
    return ([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as Grade[]).map((g) => {
      const due = log[g].card.due;
      const intervalMs = due.getTime() - at.getTime();
      return {
        rating: g as unknown as ReviewRating,
        label: RATING_LABELS[g - 1] ?? 'good',
        due: due.toISOString(),
        intervalMs,
        display: displayInterval(intervalMs),
      };
    });
  }

  /** Probability of recall now (0–1). New cards have no memory yet: 0. */
  retrievability(row: SrsCardRow, now: Instant): number {
    if (row.state === 0) return 0;
    return this.engine.get_retrievability(toFsrsCard(row), new Date(toMs(now)), false);
  }

  /** Reset a card to relearning-from-scratch (after "Relearn with Quick Revision", memory-labs §5.2). */
  forget(row: SrsCardRow, now: Instant): SrsCardRow {
    const at = new Date(toMs(now));
    const { card } = this.engine.forget(toFsrsCard(row), at, false);
    return fromFsrsCard(row.card_ref, card, at.toISOString(), row);
  }
}

export function toFsrsCard(row: SrsCardRow): Card {
  const card: Card = {
    due: new Date(row.due_at),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
  };
  if (row.last_review_at) card.last_review = new Date(row.last_review_at);
  return card;
}

function fromFsrsCard(cardRef: string, c: Card, nowIso: string, prev: SrsCardRow | null): SrsCardRow {
  return {
    card_ref: cardRef,
    deck_id: prev?.deck_id ?? null,
    state: c.state as 0 | 1 | 2 | 3,
    due_at: c.due.toISOString(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    last_review_at: c.last_review ? c.last_review.toISOString() : null,
    suspended: prev?.suspended ?? false,
    flags: prev?.flags ?? 0,
    buried_until: prev?.buried_until ?? null,
    updated_at: nowIso,
    topic_id: prev?.topic_id ?? null,
    concept_ids: prev?.concept_ids ?? [],
    sibling_key: prev?.sibling_key ?? null,
    introduced_on: prev?.introduced_on ?? null,
  };
}

export function toFsrsStatePayload(row: SrsCardRow): FsrsStatePayload {
  return {
    due: row.due_at,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
  };
}

/** Rounds an interval to the unit a rating button shows. */
export function displayInterval(ms: number): IntervalPreview['display'] {
  const min = ms / 60_000;
  if (min < 60) return { value: Math.max(1, Math.round(min)), unit: 'min' };
  const h = min / 60;
  if (h < 24) return { value: Math.round(h), unit: 'h' };
  const d = h / 24;
  if (d < 30) return { value: Math.round(d), unit: 'd' };
  if (d < 365) return { value: Math.round(d / 30), unit: 'mo' };
  return { value: Math.round((d / 365) * 10) / 10, unit: 'y' };
}

/** `c:<card_id>`, `u:<uuid>` / `d:<uuid>` (own cards; the docs use both prefixes), `q:<question_id>`. */
export function parseCardRef(ref: string): { kind: 'content' | 'user' | 'question'; id: string } | null {
  const m = /^([cudq]):(.+)$/.exec(ref);
  if (!m || !m[2]) return null;
  const kind = m[1] === 'c' ? 'content' : m[1] === 'q' ? 'question' : 'user';
  return { kind, id: m[2] };
}

export const LEECH_SEEN_FLAG = 1;

/** A leech at `memory.leech_lapses` lapses, and again at every further multiple of half of it. */
export function isLeechMoment(lapses: number, leechLapses: number): boolean {
  if (lapses < leechLapses) return false;
  if (lapses === leechLapses) return true;
  const step = Math.max(1, Math.floor(leechLapses / 2));
  return (lapses - leechLapses) % step === 0;
}
