import { defaultFlags, type Flags } from '@smriti/config';

import { istDate, weekStartMonday, type Instant, type LocalDate } from '../time';

/**
 * Free-tier limits (PRD §11.1, R16, R25, R35; practice §4.1; learn §6.2). All are flags. Limits
 * are shown up front and never trigger mid-session (X1): sessions are sized to what is left.
 * A `null` limit (owner flag not set) turns that limit off and is reported as `unset`.
 */

export interface Quota {
  unlimited: boolean;
  limit: number | null;
  used: number;
  remaining: number;
  /** True when one more use is allowed. */
  allowed: boolean;
}

function quota(used: number, limit: number | null, isPro: boolean): Quota {
  if (isPro || limit === null) return { unlimited: true, limit, used, remaining: Number.POSITIVE_INFINITY, allowed: true };
  const remaining = Math.max(0, limit - used);
  return { unlimited: false, limit, used, remaining, allowed: remaining > 0 };
}

/**
 * Practice questions: 30 a day for guests and free (R25). Counts at [Check]; drills, weak-spot
 * drills, PYQs from search and chapter tests count. Lesson checks, review cards, the daily
 * challenge, Test out and Find my level never count. Resets at local midnight.
 */
export function practiceQuota(usedToday: number, isPro: boolean, flags: Flags = defaultFlags): Quota {
  return quota(usedToday, flags.get('free.practice_questions_per_day'), isPro);
}

/** A drill or PYQ session started on free is sized to the questions left today (never stops mid-way). */
export function sizePracticeSession(requested: number, q: Quota): number {
  return q.unlimited ? requested : Math.min(requested, q.remaining);
}

export const PRACTICE_COUNTED_CONTEXTS = ['practice', 'drill', 'pyq', 'chapter_test'] as const;

/** Whether an answer in this context uses the practice quota. */
export function countsTowardPracticeQuota(context: string): boolean {
  return (PRACTICE_COUNTED_CONTEXTS as readonly string[]).includes(context);
}

/** Tutor messages: 5 a day for guests and free (R35); Pro has a fair-use cap (owner flag). */
export function tutorQuota(usedToday: number, isPro: boolean, flags: Flags = defaultFlags): Quota {
  return quota(usedToday, isPro ? flags.get('pro.tutor_messages_per_day') : flags.get('free.tutor_messages_per_day'), false);
}

/** Read-aloud of tutor answers: free for everyone within a daily cap (R35). */
export function readAloudQuota(usedToday: number, flags: Flags = defaultFlags): Quota {
  return quota(usedToday, flags.get('free.tutor_read_aloud_per_day'), false);
}

export type LessonAccess = { kind: 'full' } | { kind: 'preview'; cards: number };

export interface DeepDiveInput {
  mode: 'deep_dive' | 'quick_revision' | 'onboarding' | 'quick_check';
  /** 0-based position of the chapter in its subject, in the exam profile's chapter order. */
  chapterIndexInSubject: number;
  chapterId: string;
  /** Today's rotating free chapters (`free.rotating_chapters`, served in the manifest). */
  rotatingFreeChapters: readonly string[];
  isPro: boolean;
}

/**
 * Lessons (learn §6.2, R9, R16): Quick revision is always free; Deep Dive is free for the first
 * 2 chapters of every subject and the rotating "Free today" chapters; other Deep Dives open to a
 * preview of the first `free.deep_dive_preview_cards` (4) cards. "Locked" only ever means Pro.
 */
export function lessonAccess(input: DeepDiveInput, flags: Flags = defaultFlags): LessonAccess {
  if (input.isPro || input.mode !== 'deep_dive') return { kind: 'full' };
  if (input.chapterIndexInSubject < flags.get('free.deep_dive_free_chapters_per_subject')) return { kind: 'full' };
  if (input.rotatingFreeChapters.includes(input.chapterId)) return { kind: 'full' };
  return { kind: 'preview', cards: flags.get('free.deep_dive_preview_cards') };
}

/** The mock week runs Monday 00:00 to Sunday 23:59 IST, like the league rollover (practice §4.1). */
export function mockWeekStart(now: Instant): LocalDate {
  return weekStartMonday(istDate(now));
}

/** Sectional mocks: 1 a week free (R25). A mock counts when its timer starts. */
export function sectionalMockQuota(startedThisWeek: number, isPro: boolean, flags: Flags = defaultFlags): Quota {
  return quota(startedThisWeek, flags.get('free.sectional_mocks_per_week'), isPro);
}

export type MockKind = 'full' | 'sectional' | 'chapter' | 'pyq_paper' | 'live' | 'custom';

export interface MockAccessInput {
  kind: MockKind;
  isPro: boolean;
  /** `content.mocks.is_free` (the sample full mock). */
  isFreeSample: boolean;
  /** For `pyq_paper`: one free paper per exam (`free.pyq_papers_free`). */
  paperId?: string;
  sectionalStartedThisWeek: number;
}

export type MockAccess = { ok: true } | { ok: false; paywallSource: 'mock_lock' | 'pyq_paper' | 'live_mock' | 'custom_mock' };

export function mockAccess(input: MockAccessInput, flags: Flags = defaultFlags): MockAccess {
  if (input.isPro) {
    if (input.kind === 'custom' && !flags.get('pro.custom_mocks')) return { ok: false, paywallSource: 'custom_mock' };
    return { ok: true };
  }
  switch (input.kind) {
    case 'full':
      return input.isFreeSample ? { ok: true } : { ok: false, paywallSource: 'mock_lock' };
    case 'sectional':
    case 'chapter': // timed chapter mocks count as sectional (practice Q15, recommended)
      return sectionalMockQuota(input.sectionalStartedThisWeek, false, flags).allowed ? { ok: true } : { ok: false, paywallSource: 'mock_lock' };
    case 'pyq_paper':
      return input.paperId && flags.get('free.pyq_papers_free').includes(input.paperId) ? { ok: true } : { ok: false, paywallSource: 'pyq_paper' };
    case 'live':
      return { ok: false, paywallSource: 'live_mock' };
    case 'custom':
      return { ok: false, paywallSource: 'custom_mock' };
  }
}

/** Free mock report sections (R25, R43): score, bars, solutions, the top "Fix next" item. */
export function isReportSectionFree(section: string, isPro: boolean, flags: Flags = defaultFlags): boolean {
  return isPro || flags.get('free.mock_report_sections').includes(section);
}

/** Per-day usage counters kept on the device (`profile_snapshot`), reconciled by the server. */
export interface UsageCounters {
  day: LocalDate;
  practiceQuestions: number;
  tutorMessages: number;
  readAloud: number;
}

export function usageFor(counters: UsageCounters | undefined, today: LocalDate): UsageCounters {
  return counters && counters.day === today ? counters : { day: today, practiceQuestions: 0, tutorMessages: 0, readAloud: 0 };
}

export function bumpUsage(counters: UsageCounters | undefined, today: LocalDate, key: keyof Omit<UsageCounters, 'day'>, by = 1): UsageCounters {
  const c = usageFor(counters, today);
  return { ...c, [key]: c[key] + by };
}

/** The server's count wins when higher (two devices); the app never deletes answers given. */
export function reconcileUsage(local: UsageCounters, server: Partial<Omit<UsageCounters, 'day'>> & { day: LocalDate }): UsageCounters {
  if (server.day !== local.day) return local;
  return {
    day: local.day,
    practiceQuestions: Math.max(local.practiceQuestions, server.practiceQuestions ?? 0),
    tutorMessages: Math.max(local.tutorMessages, server.tutorMessages ?? 0),
    readAloud: Math.max(local.readAloud, server.readAloud ?? 0),
  };
}
