import { sha256Hex, toHex, type CryptoLike } from '../crypto';
import { inWindow, localDate, localMinutes, parseHhmm, type Instant, type LocalDate } from '../time';
import type { LearnerExperience } from './experience';

/**
 * Parent mode (me-money §4.7, SET-13 to SET-19; learn §5.6; auth §6.11).
 *
 * The gate is a Google sign-in the first time on a device (AUTH-24), then the Google account
 * picker or an optional 4-digit PIN. No maths-question gates. On HOME-06 the "For grown-ups"
 * button opens only on a hold (`parent.gate_hold_ms`, 2 s), never a single tap.
 */

export type ParentAction =
  | 'open_parent_mode'
  | 'change_settings'
  | 'buy'
  | 'sign_in'
  | 'sign_out'
  | 'delete_account'
  | 'export_data'
  | 'switch_profile'
  | 'consents'
  | 'add_child'
  | 'time_limits'
  | 'toggle_tutor'
  | 'toggle_picture_rhymes';

/**
 * Whether an action needs the parent gate first. For a little learner or a managed child every
 * action that changes the account, money, consent or limits does (me-money §3.1 "Parent mode is
 * the only way to change most settings", §6.4: a child's buy goes "Ask a grown-up → SET-13").
 * Switching profiles needs it for anyone when `parent.ask_before_switching` is on (AUTH-25).
 */
export function needsParentGate(
  action: ParentAction,
  who: Pick<LearnerExperience, 'littleLearner' | 'timeLimits' | 'paywall'>,
  opts: { askBeforeSwitching: boolean },
): boolean {
  if (action === 'open_parent_mode') return true;
  if (action === 'switch_profile') return opts.askBeforeSwitching || who.littleLearner;
  const child = who.littleLearner || who.timeLimits;
  if (child) return true;
  // Under-13s who are not managed still reach checkout only through a grown-up (R15).
  return action === 'buy' && who.paywall === 'ask_grown_up';
}

export type ParentGateStep = 'parent_sign_in' | 'pin' | 'account_picker';

/** The ways in, in the order offered (SET-13). */
export function parentGateSteps(device: { parentLinked: boolean; pinSet: boolean }): ParentGateStep[] {
  if (!device.parentLinked) return ['parent_sign_in'];
  return device.pinSet ? ['pin', 'account_picker'] : ['account_picker'];
}

export function holdOpensGate(heldMs: number, holdMs: number): boolean {
  return heldMs >= holdMs;
}

export const PARENT_PIN_RE = /^\d{4}$/;

export interface StoredParentPin {
  salt: string;
  hash: string;
}

/** Hashes a 4-digit PIN with a per-device salt (kept in secure storage, never synced). */
export async function hashParentPin(crypto: CryptoLike, pin: string, salt?: string): Promise<StoredParentPin> {
  if (!PARENT_PIN_RE.test(pin)) throw new RangeError('A parent PIN is 4 digits');
  const s = salt ?? toHex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt: s, hash: await sha256Hex(crypto, `${s}:${pin}`) };
}

export interface PinAttempts {
  failures: number;
  lockedUntilMs: number | null;
}

/**
 * Checks a PIN. After `maxFailures` wrong tries the PIN is locked for `lockMs` and the parent uses
 * the account picker (proposed: 5 tries, 5 minutes; the docs give no numbers).
 */
export async function verifyParentPin(
  crypto: CryptoLike,
  stored: StoredParentPin,
  pin: string,
  attempts: PinAttempts,
  nowMs: number,
  limits: { maxFailures: number; lockMs: number } = { maxFailures: 5, lockMs: 5 * 60_000 },
): Promise<{ ok: boolean; locked: boolean; attempts: PinAttempts }> {
  if (attempts.lockedUntilMs !== null && nowMs < attempts.lockedUntilMs) return { ok: false, locked: true, attempts };
  const clean = attempts.lockedUntilMs !== null ? { failures: 0, lockedUntilMs: null } : attempts;
  const ok = PARENT_PIN_RE.test(pin) && (await hashParentPin(crypto, pin, stored.salt)).hash === stored.hash;
  if (ok) return { ok: true, locked: false, attempts: { failures: 0, lockedUntilMs: null } };
  const failures = clean.failures + 1;
  const locked = failures >= limits.maxFailures;
  return { ok: false, locked, attempts: { failures: locked ? 0 : failures, lockedUntilMs: locked ? nowMs + limits.lockMs : null } };
}

// ── Time limits (SET-16, SET-19) ───────────────────────────────────────────────

export interface TimeLimits {
  /** Minutes a day; 0 is Off (`parent.time_limit_options`). */
  dailyMinutes: number;
  /** Allowed hours, e.g. 16:00–20:00, or null for any time. */
  allowedHours: { start: string; end: string } | null;
}

export const NO_TIME_LIMITS: TimeLimits = { dailyMinutes: 0, allowedHours: null };

export interface TimeUse {
  day: LocalDate;
  /** Active minutes today, counted on the device. */
  usedMinutes: number;
  /** Extra minutes the parent approved today (SET-19 "Ask for 15 more minutes"). */
  extraMinutes: number;
  /** Requests sent today (`parent.time_requests_per_day`). */
  requestsToday: number;
}

export type TimeLimitState =
  | { kind: 'ok'; minutesLeft: number | null }
  /** The limit is reached during a card or a mock section: it finishes first (me-money §4.7). */
  | { kind: 'finish_current'; reason: 'daily_limit' | 'outside_hours' }
  | { kind: 'times_up'; reason: 'daily_limit' | 'outside_hours' };

/** Resets the counters on a new local day. */
export function timeUseFor(use: TimeUse | null, day: LocalDate): TimeUse {
  return use && use.day === day ? use : { day, usedMinutes: 0, extraMinutes: 0, requestsToday: 0 };
}

/** Enforced on the device with a local clock, so it works offline. */
export function timeLimitState(
  limits: TimeLimits,
  use: TimeUse,
  ctx: { now: Instant; timeZone: string; inActivity: boolean },
): TimeLimitState {
  const today = localDate(ctx.now, ctx.timeZone);
  const u = timeUseFor(use, today);
  let reason: 'daily_limit' | 'outside_hours' | null = null;
  if (limits.allowedHours) {
    const m = localMinutes(ctx.now, ctx.timeZone);
    if (!inWindow(m, parseHhmm(limits.allowedHours.start), parseHhmm(limits.allowedHours.end))) reason = 'outside_hours';
  }
  const budget = limits.dailyMinutes > 0 ? limits.dailyMinutes + u.extraMinutes : null;
  if (!reason && budget !== null && u.usedMinutes >= budget) reason = 'daily_limit';
  if (reason) return ctx.inActivity ? { kind: 'finish_current', reason } : { kind: 'times_up', reason };
  return { kind: 'ok', minutesLeft: budget === null ? null : Math.max(0, budget - u.usedMinutes) };
}

export type MoreTimeAnswer = { kind: 'can_ask' } | { kind: 'needs_internet' } | { kind: 'limit_reached' };

/** SET-19 [Ask for 15 more minutes]: online only, at most `parent.time_requests_per_day`. */
export function canAskForMoreTime(use: TimeUse, online: boolean, requestsPerDay: number): MoreTimeAnswer {
  if (use.requestsToday >= requestsPerDay) return { kind: 'limit_reached' };
  if (!online) return { kind: 'needs_internet' };
  return { kind: 'can_ask' };
}

/** The parent approved: extend today's budget. */
export function grantMoreTime(use: TimeUse, minutes: number): TimeUse {
  return { ...use, extraMinutes: use.extraMinutes + Math.max(0, minutes) };
}
