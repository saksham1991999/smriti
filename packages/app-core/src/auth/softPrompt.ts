import { defaultFlags, type Flags } from '@smriti/config';

import type { KeyValueStore } from '../storage/types';
import { toIso, toMs, type Instant } from '../time';

/**
 * The soft-login budget (auth flow §4, R29). Per profile, in MMKV / localStorage: `last_shown_at`
 * per soft reason, `later_count` and `paused_until`. No content, no user text.
 *
 * - Pop-up triggers (`lesson_3`, `streak_day_2`, `web_storage_risk`) use the budget: shown only if
 *   that reason wasn't shown in the last 7 days and the pause has passed.
 * - Tap triggers (`save_progress`, `leaderboard`) open because the student asked: they ignore the
 *   cooldown and the pause, but their "Later" still counts.
 * - Two "Later"s pause pop-up soft walls for 14 days and reset the count.
 * - Never mid-lesson, review, mock, onboarding, paywall or tutor chat; never for managed learners
 *   (they get "Ask a grown-up") and never for signed-in users. A skipped trigger isn't queued.
 */

export const POPUP_REASONS = ['lesson_3', 'streak_day_2', 'web_storage_risk'] as const;
export const TAP_REASONS = ['save_progress', 'leaderboard'] as const;
export type PopupReason = (typeof POPUP_REASONS)[number];
export type TapReason = (typeof TAP_REASONS)[number];
export type SoftReason = PopupReason | TapReason;

export interface SoftPromptRecord {
  lastShownAt: Partial<Record<SoftReason, string>>;
  laterCount: number;
  pausedUntil: string | null;
}

export const EMPTY_SOFT_RECORD: SoftPromptRecord = { lastShownAt: {}, laterCount: 0, pausedUntil: null };

export type SkipCause = 'cooldown' | 'paused' | 'mid_activity' | 'managed' | 'signed_in';

export interface SoftPromptContext {
  now: Instant;
  signedIn: boolean;
  managed: boolean;
  /** A lesson card, review, mock or section, onboarding, paywall or tutor chat is on screen. */
  midActivity: boolean;
}

export interface SoftPromptConfig {
  cooldownDays: number;
  laterLimit: number;
  pauseDays: number;
}

export function softPromptConfig(flags: Flags = defaultFlags): SoftPromptConfig {
  return {
    cooldownDays: flags.get('auth.soft_prompt_cooldown_days'),
    laterLimit: flags.get('auth.soft_prompt_later_limit'),
    pauseDays: flags.get('auth.soft_prompt_pause_days'),
  };
}

const DAY = 86_400_000;
const isPopup = (r: SoftReason): r is PopupReason => (POPUP_REASONS as readonly string[]).includes(r);

export function decideSoftPrompt(
  record: SoftPromptRecord,
  reason: SoftReason,
  ctx: SoftPromptContext,
  cfg: SoftPromptConfig = softPromptConfig(),
): { show: true } | { show: false; cause: SkipCause } {
  if (ctx.signedIn) return { show: false, cause: 'signed_in' };
  if (ctx.managed) return { show: false, cause: 'managed' };
  if (ctx.midActivity) return { show: false, cause: 'mid_activity' };
  if (!isPopup(reason)) return { show: true };
  const now = toMs(ctx.now);
  if (record.pausedUntil && now < toMs(record.pausedUntil)) return { show: false, cause: 'paused' };
  const last = record.lastShownAt[reason];
  if (last && now - toMs(last) < cfg.cooldownDays * DAY) return { show: false, cause: 'cooldown' };
  return { show: true };
}

export function recordShown(record: SoftPromptRecord, reason: SoftReason, now: Instant): SoftPromptRecord {
  return { ...record, lastShownAt: { ...record.lastShownAt, [reason]: toIso(now) } };
}

/** [Later], swipe down, back gesture, or a closed One Tap prompt: one "Later" each. */
export function recordLater(record: SoftPromptRecord, now: Instant, cfg: SoftPromptConfig = softPromptConfig()): SoftPromptRecord {
  const laterCount = record.laterCount + 1;
  if (laterCount >= cfg.laterLimit) {
    return { ...record, laterCount: 0, pausedUntil: toIso(toMs(now) + cfg.pauseDays * DAY) };
  }
  return { ...record, laterCount };
}

const STORE_KEY = 'auth.soft_prompt.v1';

/** Persists the record in the profile's key-value store. Signing in clears it. */
export class SoftPromptBudget {
  constructor(
    private readonly store: KeyValueStore,
    private readonly cfg: SoftPromptConfig = softPromptConfig(),
  ) {}

  async read(): Promise<SoftPromptRecord> {
    const raw = await this.store.get(STORE_KEY);
    if (!raw) return { ...EMPTY_SOFT_RECORD };
    try {
      const parsed = JSON.parse(raw) as Partial<SoftPromptRecord>;
      return { lastShownAt: parsed.lastShownAt ?? {}, laterCount: parsed.laterCount ?? 0, pausedUntil: parsed.pausedUntil ?? null };
    } catch {
      return { ...EMPTY_SOFT_RECORD };
    }
  }

  /** Decides, and when it shows, records the showing. */
  async tryShow(reason: SoftReason, ctx: SoftPromptContext) {
    const rec = await this.read();
    const d = decideSoftPrompt(rec, reason, ctx, this.cfg);
    if (d.show) await this.write(recordShown(rec, reason, ctx.now));
    return d;
  }

  async later(now: Instant) {
    const next = recordLater(await this.read(), now, this.cfg);
    await this.write(next);
    return next;
  }

  async clear() {
    await this.store.delete(STORE_KEY);
  }

  private write(rec: SoftPromptRecord) {
    return this.store.set(STORE_KEY, JSON.stringify(rec));
  }
}

/**
 * The one extra on LES-08 (learn flow §7.5, R15), in this order: the deferred daily-goal and
 * reminder steps, the soft login at the 3rd lesson (it beats the Pro card), the little-learner
 * "Ask a grown-up" row, then PAY-19 every 5th lesson for free students aged 13+ (not in the first
 * 3 days after install, at most 2 a day; if the 5th coincides with another prompt it waits for the 10th).
 */
export type LessonEndExtra = 'reminder' | 'soft_login' | 'grown_up' | 'upsell' | 'none';

export interface LessonEndInput {
  lessonsCompleted: number;
  deferredOnboardingPending: boolean;
  isGuest: boolean;
  littleLearner: boolean;
  ageBand: 'u10' | '10_12' | '13_17' | '18p' | null;
  isPro: boolean;
  /** Result of `decideSoftPrompt` for `lesson_3` (or `web_storage_risk` on Safari). */
  softPromptAllowed: boolean;
  daysSinceInstall: number;
  upsellsShownToday: number;
  /** Lesson count that triggers the soft login (3, or 1 for `web_storage_risk`). */
  softLoginAtLesson?: number;
}

export function lessonEndExtra(i: LessonEndInput): LessonEndExtra {
  if (i.deferredOnboardingPending) return 'reminder';
  const loginAt = i.softLoginAtLesson ?? 3;
  if (i.littleLearner && i.lessonsCompleted === 3) return 'grown_up';
  if (i.isGuest && !i.littleLearner && i.lessonsCompleted === loginAt && i.softPromptAllowed) return 'soft_login';
  const teenOrAdult = i.ageBand === '13_17' || i.ageBand === '18p';
  const fifth = i.lessonsCompleted > 0 && i.lessonsCompleted % 5 === 0;
  if (!i.isPro && teenOrAdult && fifth && i.daysSinceInstall >= 3 && i.upsellsShownToday < 2) return 'upsell';
  return 'none';
}
