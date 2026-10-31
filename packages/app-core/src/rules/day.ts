import type { OutboxRow } from '../storage/types';
import { localDate, type LocalDate } from '../time';
import { DEFAULT_RULES, type RulesConfig } from './config';

/** What happened on one local day (mirrors `learn.activity_days`). */
export interface DayActivity {
  lessonsCompleted: number;
  /** Every `review_rated` of the day, whatever its context (memory-labs §5.1). */
  reviews: number;
  mockSections: number;
  dailyChallenge: boolean;
  /** A finished 2-minute rescue: a plant health day, never a streak day. */
  rescueDone: boolean;
}

export const EMPTY_DAY: DayActivity = { lessonsCompleted: 0, reviews: 0, mockSections: 0, dailyChallenge: false, rescueDone: false };

export type QualifyingReason = 'lesson' | 'reviews' | 'mock_section' | 'daily_challenge';

/**
 * R1 + R23: a streak day has one qualifying activity: one lesson, or 10 reviews, or one mock
 * section, or the daily challenge. Minutes (the daily goal ring) and rescues never qualify.
 */
export function qualifiesDay(a: DayActivity, cfg: Pick<RulesConfig, 'reviewsToQualify'> = DEFAULT_RULES): boolean {
  return qualifyingReason(a, cfg) !== null;
}

export function qualifyingReason(a: DayActivity, cfg: Pick<RulesConfig, 'reviewsToQualify'> = DEFAULT_RULES): QualifyingReason | null {
  if (a.lessonsCompleted >= 1) return 'lesson';
  if (a.mockSections >= 1) return 'mock_section';
  if (a.dailyChallenge) return 'daily_challenge';
  if (a.reviews >= cfg.reviewsToQualify) return 'reviews';
  return null;
}

/** `streakProgress()` for the MEM-03 chip: "{n} more reviews to keep your streak". */
export function streakProgress(
  a: DayActivity,
  cfg: Pick<RulesConfig, 'reviewsToQualify'> = DEFAULT_RULES,
): { qualified: boolean; reviewsToday: number; reviewsLeft: number } {
  const qualified = qualifiesDay(a, cfg);
  return { qualified, reviewsToday: a.reviews, reviewsLeft: qualified ? 0 : Math.max(0, cfg.reviewsToQualify - a.reviews) };
}

/** A plant health day: a streak day or a rescue day (TRD §10, DB_SCHEMA §5.1). */
export function isHealthDay(a: DayActivity, cfg: Pick<RulesConfig, 'reviewsToQualify'> = DEFAULT_RULES): boolean {
  return qualifiesDay(a, cfg) || a.rescueDone;
}

export function mergeDays(a: DayActivity, b: DayActivity): DayActivity {
  return {
    lessonsCompleted: a.lessonsCompleted + b.lessonsCompleted,
    reviews: a.reviews + b.reviews,
    mockSections: a.mockSections + b.mockSections,
    dailyChallenge: a.dailyChallenge || b.dailyChallenge,
    rescueDone: a.rescueDone || b.rescueDone,
  };
}

type EventLike = Pick<OutboxRow, 'type' | 'occurred_at'>;

/**
 * Folds learning events into per-day activity, by the student's local day in `timeZone`
 * (the profile timezone). The daily challenge counts on the local day it was finished.
 */
export function activityByDay(events: readonly EventLike[], timeZone: string): Map<LocalDate, DayActivity> {
  const out = new Map<LocalDate, DayActivity>();
  for (const e of events) {
    const day = localDate(e.occurred_at, timeZone);
    const cur = out.get(day) ?? { ...EMPTY_DAY };
    switch (e.type) {
      case 'lesson_completed':
      case 'activity_completed': // a little learner's story, song or play counts as a lesson (v1.4)
      case 'topic_tested_out': // a passed Test out counts as one lesson (learn Q7, sync v1.6)
        cur.lessonsCompleted += 1;
        break;
      case 'review_rated':
        cur.reviews += 1;
        break;
      case 'mock_section_submitted':
        cur.mockSections += 1;
        break;
      case 'daily_challenge_completed':
        cur.dailyChallenge = true;
        break;
      case 'rescue_completed':
        cur.rescueDone = true;
        break;
      default:
        continue;
    }
    out.set(day, cur);
  }
  return out;
}

/** Today's activity: the last synced counts for today plus unsent local events. */
export function todayActivity(
  synced: DayActivity | undefined,
  unsent: readonly EventLike[],
  today: LocalDate,
  timeZone: string,
): DayActivity {
  const local = activityByDay(unsent, timeZone).get(today) ?? EMPTY_DAY;
  return mergeDays(synced ?? EMPTY_DAY, local);
}
