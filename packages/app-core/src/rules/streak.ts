import { addDays, compareDates, daysBetween, monthEnd, monthKey, weekStartMonday, type LocalDate } from '../time';
import { DEFAULT_RULES, type RulesConfig } from './config';

/**
 * Streak rules (PRD §7, R1, R23, R28, R36, me-money §3.5):
 * - consecutive streak days; a day counts when it has one qualifying activity;
 * - a missed day is protected (no +1, no break) by, in this order: an incident freeze (our outage),
 *   a rest day (planned, wins over a freeze, which is kept), the exam day when protected, or an
 *   equipped freeze (used automatically, up to 2 equipped, and only when there is a streak to
 *   protect: with the streak at 0 a missed day is just missed and the freeze is kept, R52);
 * - studying on a rest day cancels it: the day counts normally;
 * - no paid repair. A broken streak keeps `longest`.
 */

export type DayStatus = 'studied' | 'incident' | 'rest' | 'exam_day' | 'freeze' | 'missed';

export interface PendingFreeze {
  source: 'monthly' | 'pro_monthly' | 'reward';
  /** Lapses after this day (end of the grant month). */
  expiresAfter: LocalDate;
}

export interface StreakState {
  current: number;
  longest: number;
  lastStudiedDay: LocalDate | null;
  /** The roll-up has closed every day up to and including this one. */
  closedThrough: LocalDate | null;
  freezesEquipped: number;
  /** Monthly grants that found both slots full, kept for the next free slot within the month. */
  pendingFreezes: PendingFreeze[];
  /** Last month (`YYYY-MM`) a monthly grant was given. */
  lastGrantMonth: string | null;
}

export const EMPTY_STREAK: StreakState = {
  current: 0,
  longest: 0,
  lastStudiedDay: null,
  closedThrough: null,
  freezesEquipped: 0,
  pendingFreezes: [],
  lastGrantMonth: null,
};

export interface DayInput {
  day: LocalDate;
  qualified: boolean;
  /** The student marked this day as a rest day. */
  restDay?: boolean;
  /** `streak.incident_freeze` was on for this day. */
  incident?: boolean;
  /** The exam date with `streak.exam_day_protected` on (does not use the week's rest day). */
  examDay?: boolean;
}

export interface DayOutcome {
  day: LocalDate;
  status: DayStatus;
  freezeUsed: boolean;
  /** The streak after this day. */
  current: number;
}

/**
 * Status of one day given the freezes equipped before it and the streak going into it. Pure; no
 * inventory change. A freeze is spent only when there is a streak to protect (R52).
 */
export function classifyDay(input: DayInput, freezesEquipped: number, current = 1): DayStatus {
  if (input.qualified) return 'studied';
  if (input.incident) return 'incident';
  if (input.restDay) return 'rest';
  if (input.examDay) return 'exam_day';
  if (freezesEquipped > 0 && current > 0) return 'freeze';
  return 'missed';
}

function dropExpired(pending: readonly PendingFreeze[], day: LocalDate): PendingFreeze[] {
  return pending.filter((p) => compareDates(p.expiresAfter, day) >= 0);
}

function fillSlots(state: StreakState, day: LocalDate, cfg: Pick<RulesConfig, 'freezeSlotsMax'>): StreakState {
  let pending = dropExpired(state.pendingFreezes, day);
  let equipped = state.freezesEquipped;
  while (equipped < cfg.freezeSlotsMax && pending.length > 0) {
    equipped += 1;
    pending = pending.slice(1);
  }
  return { ...state, freezesEquipped: equipped, pendingFreezes: pending };
}

/** Closes one day: the nightly roll-up step (and the sync handler's incremental update). */
export function closeDay(
  state: StreakState,
  input: DayInput,
  cfg: Pick<RulesConfig, 'freezeSlotsMax'> = DEFAULT_RULES,
): { state: StreakState; outcome: DayOutcome } {
  if (state.closedThrough && compareDates(input.day, state.closedThrough) <= 0) {
    throw new RangeError(`Day ${input.day} is already closed (through ${state.closedThrough})`);
  }
  const s = fillSlots(state, input.day, cfg);
  const status = classifyDay(input, s.freezesEquipped, s.current);
  let next: StreakState = { ...s, closedThrough: input.day };
  let freezeUsed = false;
  switch (status) {
    case 'studied': {
      const current = s.current + 1;
      next = { ...next, current, longest: Math.max(s.longest, current), lastStudiedDay: input.day };
      break;
    }
    case 'freeze':
      freezeUsed = true;
      next = fillSlots({ ...next, freezesEquipped: s.freezesEquipped - 1 }, input.day, cfg);
      break;
    case 'missed':
      next = { ...next, current: 0 };
      break;
    default:
      break; // incident, rest, exam_day: the streak pauses
  }
  return { state: next, outcome: { day: input.day, status, freezeUsed, current: next.current } };
}

/**
 * Closes every day after `closedThrough` up to and including `through`. Days without an input are
 * days with no activity (rest days and incidents come from `inputs`).
 */
export function rollStreak(
  state: StreakState,
  inputs: readonly DayInput[],
  through: LocalDate,
  cfg: Pick<RulesConfig, 'freezeSlotsMax'> = DEFAULT_RULES,
): { state: StreakState; outcomes: DayOutcome[] } {
  const byDay = new Map(inputs.map((i) => [i.day, i]));
  const sorted = [...inputs].sort((a, b) => compareDates(a.day, b.day));
  const first = state.closedThrough ? addDays(state.closedThrough, 1) : sorted[0]?.day;
  const outcomes: DayOutcome[] = [];
  if (!first || compareDates(first, through) > 0) return { state, outcomes };
  let s = state;
  for (let d = first; compareDates(d, through) <= 0; d = addDays(d, 1)) {
    const r = closeDay(s, byDay.get(d) ?? { day: d, qualified: false }, cfg);
    s = r.state;
    outcomes.push(r.outcome);
  }
  return { state: s, outcomes };
}

export interface StreakView {
  /** Shown on the streak pill: includes today once today qualifies. */
  current: number;
  longest: number;
  todayQualified: boolean;
  restDayToday: boolean;
  /** There is a streak, today isn't a streak day yet and today isn't protected (rest day, incident). */
  atRisk: boolean;
  /** A freeze will cover today if nothing qualifies (MEM-32 "A streak freeze will cover today."). */
  freezeWillCover: boolean;
  freezesEquipped: number;
  freezesPending: number;
}

/** The live view for `today`, from a state closed through yesterday plus today's activity. */
export function streakView(
  state: StreakState,
  today: LocalDate,
  todayInput: Omit<DayInput, 'day'>,
  cfg: Pick<RulesConfig, 'freezeSlotsMax'> = DEFAULT_RULES,
  /** Inputs for days after `closedThrough` and before today (the app was offline overnight). */
  openDays: readonly DayInput[] = [],
): StreakView {
  const caughtUp =
    state.closedThrough && compareDates(state.closedThrough, addDays(today, -1)) < 0
      ? rollStreak(state, openDays, addDays(today, -1), cfg).state
      : state;
  const s = fillSlots(caughtUp, today, cfg);
  const current = todayInput.qualified ? s.current + 1 : s.current;
  const protectedToday = Boolean(todayInput.restDay || todayInput.incident || todayInput.examDay);
  const freezeWillCover = !todayInput.qualified && !protectedToday && s.freezesEquipped > 0;
  return {
    current,
    longest: Math.max(s.longest, current),
    todayQualified: todayInput.qualified,
    restDayToday: Boolean(todayInput.restDay),
    atRisk: !todayInput.qualified && !protectedToday && s.current > 0,
    freezeWillCover: freezeWillCover && s.current > 0,
    freezesEquipped: s.freezesEquipped,
    freezesPending: s.pendingFreezes.length,
  };
}

/**
 * Recomputes the streak from stored day statuses (`learn.activity_days`: qualified, rest_day,
 * freeze_used, plus incident days). This is what the server's nightly roll-up checks against.
 */
export function streakFromDays(
  days: readonly { day: LocalDate; status: DayStatus }[],
  today: LocalDate,
): { current: number; longest: number } {
  const sorted = [...days].sort((a, b) => compareDates(a.day, b.day));
  const byDay = new Map(sorted.map((d) => [d.day, d.status]));
  let longest = 0;
  let run = 0;
  let prev: LocalDate | null = null;
  for (const d of sorted) {
    if (prev && daysBetween(prev, d.day) > 1) run = 0; // a gap with no row is a missed day
    if (d.status === 'studied') longest = Math.max(longest, ++run);
    else if (d.status === 'missed') run = 0;
    prev = d.day;
  }
  // Current: walk back from today (if studied) or yesterday.
  let current = 0;
  let d = byDay.get(today) === 'studied' ? today : addDays(today, -1);
  for (;;) {
    const st = byDay.get(d);
    if (st === 'studied') current += 1;
    else if (st === undefined || st === 'missed') break;
    d = addDays(d, -1);
  }
  return { current, longest: Math.max(longest, current) };
}

/**
 * The monthly freeze grant on the 1st (free 1, Pro 2: PRD §11.1, R36). Grants fill free slots;
 * the rest wait in `pendingFreezes` until the month ends, then lapse.
 */
export function grantMonthlyFreezes(
  state: StreakState,
  day: LocalDate,
  isPro: boolean,
  cfg: Pick<RulesConfig, 'freezeSlotsMax' | 'monthlyFreezes'> = DEFAULT_RULES,
): StreakState {
  const month = monthKey(day);
  if (state.lastGrantMonth === month) return state;
  const n = isPro ? cfg.monthlyFreezes.pro : cfg.monthlyFreezes.free;
  const grants: PendingFreeze[] = Array.from({ length: n }, () => ({
    source: isPro ? ('pro_monthly' as const) : ('monthly' as const),
    expiresAfter: monthEnd(day),
  }));
  return fillSlots({ ...state, pendingFreezes: [...dropExpired(state.pendingFreezes, day), ...grants], lastGrantMonth: month }, day, cfg);
}

export type FreezeBlockReason = 'slots_full';

/** A freeze bought with gems goes straight into a slot; blocked when both are full (me-money §3.6). */
export function canEquipFreeze(state: StreakState, cfg: Pick<RulesConfig, 'freezeSlotsMax'> = DEFAULT_RULES): { ok: true } | { ok: false; reason: FreezeBlockReason } {
  return state.freezesEquipped < cfg.freezeSlotsMax ? { ok: true } : { ok: false, reason: 'slots_full' };
}

export function equipFreeze(state: StreakState, cfg: Pick<RulesConfig, 'freezeSlotsMax'> = DEFAULT_RULES): StreakState {
  const check = canEquipFreeze(state, cfg);
  if (!check.ok) throw new RangeError('Both freeze slots are full');
  return { ...state, freezesEquipped: state.freezesEquipped + 1 };
}

export type RestDayBlockReason = 'in_past' | 'too_far_ahead' | 'week_used' | 'already_set';

/**
 * Can `day` be marked as a rest day? One per calendar week (Monday–Sunday), from today up to
 * `streak.rest_day_plan_ahead_days` ahead. The protected exam day doesn't use the week's rest day.
 */
export function canSetRestDay(
  day: LocalDate,
  today: LocalDate,
  existingRestDays: readonly LocalDate[],
  cfg: Pick<RulesConfig, 'restDaysPerWeek' | 'restDayPlanAheadDays'> = DEFAULT_RULES,
): { ok: true } | { ok: false; reason: RestDayBlockReason } {
  if (compareDates(day, today) < 0) return { ok: false, reason: 'in_past' };
  if (daysBetween(today, day) > cfg.restDayPlanAheadDays) return { ok: false, reason: 'too_far_ahead' };
  if (existingRestDays.includes(day)) return { ok: false, reason: 'already_set' };
  const week = weekStartMonday(day);
  const inWeek = existingRestDays.filter((d) => weekStartMonday(d) === week).length;
  if (inWeek >= cfg.restDaysPerWeek) return { ok: false, reason: 'week_used' };
  return { ok: true };
}

/** Streak-milestone days crossed by going from `before` to `after` (share cards, gems). */
export function milestonesCrossed(before: number, after: number, milestones: readonly number[]): number[] {
  return milestones.filter((m) => before < m && after >= m);
}
