import { defaultFlags, type Flags } from '@smriti/config';

import type { PlantHealth } from '../rules/plant';
import { addDays, daysBetween, inWindow, localDate, parseHhmm, toIso, toMs, weekday, zonedInstant, type Instant, type LocalDate } from '../time';

/**
 * The local notification planner (me-money §6.1–6.4, TRD §12). On every app open and after every
 * sync the app rebuilds the next `notify.plan_days` of local sends from this plan and replaces
 * whatever was scheduled before (ids are stable, so a platform can diff instead).
 *
 * - One daily reminder a day at the chosen time. A time inside quiet hours moves to the end of
 *   quiet hours (SET-04); minors with school hours on move a weekday time inside them to the end.
 * - Adults only: smart timing for the first day after the last session (about
 *   `notify.smart.offset_hours` after it, never more than 2 h before the chosen time), reminder
 *   copy from the plant health predicted for that day (`_thirsty`, `_dry`), `pet_misses_you` on
 *   day 3 of a lapse, and today's streak saver at least 1 h before quiet hours start.
 * - After the `notify.autopause_after_ignored`-th reminder, one `reminders_paused` notice at the
 *   next reminder slot, then nothing. The planner runs on an open, which resets the count.
 * - Nothing while a mock runner is open (R24): the plan is empty and the app re-plans on close.
 * - Minors (R34): the reminder at the picked time only, plain templates.
 */

/** `adult` (18+), `teen` (13–17), `child` (under 13, little learners included); flags use these keys. */
export type NotifyAudience = 'adult' | 'teen' | 'child';

export type LocalNotificationKind =
  | 'daily_reminder'
  | 'daily_reminder_thirsty'
  | 'daily_reminder_dry'
  | 'pet_misses_you'
  | 'streak_risk'
  | 'reminders_paused';

/** The device copy of `notify.prefs` the planner needs (DB_SCHEMA §10). Times are local `HH:MM`. */
export interface NotifyPrefs {
  reminderEnabled: boolean;
  dailyReminderAt: string | null;
  smartTiming: boolean;
  streakSaver: boolean;
  quietStart: string;
  quietEnd: string;
  schoolHours: boolean;
}

export interface NotifyConfig {
  planDays: number;
  autopauseAfterIgnored: number;
  smartOffsetHours: number;
  /** Habit sends a day for this audience (`notify.cap.habit`). */
  habitCap: number;
  /** Total a day for this audience (`notify.cap.total`); local sends count against it. */
  totalCap: number;
  schoolHours: { start: string; end: string };
}

export function notifyConfigFromFlags(audience: NotifyAudience, flags: Flags = defaultFlags): NotifyConfig {
  return {
    planDays: flags.get('notify.plan_days'),
    autopauseAfterIgnored: flags.get('notify.autopause_after_ignored'),
    smartOffsetHours: flags.get('notify.smart.offset_hours'),
    habitCap: flags.get('notify.cap.habit')[audience],
    totalCap: flags.get('notify.cap.total')[audience],
    schoolHours: flags.get('notify.school_hours'),
  };
}

/** Age-band defaults for quiet hours (`notify.quiet_hours`), used before `notify.prefs` has synced. */
export function defaultQuietHours(audience: NotifyAudience, flags: Flags = defaultFlags): { start: string; end: string } {
  return flags.get('notify.quiet_hours')[audience];
}

export interface NotificationPlanInput {
  now: Instant;
  timeZone: string;
  audience: NotifyAudience;
  prefs: NotifyPrefs;
  config: NotifyConfig;
  /** Today is already a streak day (R1, R23). */
  todayQualified: boolean;
  /** Current streak length (the saver needs at least 1). */
  streak: number;
  /** The last local day with study, if any (the lapse count for `pet_misses_you`). */
  lastActivityDay: LocalDate | null;
  /** Adults only: when the last session ended (smart timing). */
  lastSessionEndedAt?: Instant | null;
  /** Adults only: the plant health predicted for a day if the student doesn't study before it. */
  predictPlantHealth?: (day: LocalDate) => PlantHealth;
  dueCards: number;
  /** A card is due or near due, so the saver can open the 2-minute rescue. */
  rescueAvailable: boolean;
  /** A mock runner is open (R24). */
  mockRunnerOpen: boolean;
}

export interface PlannedNotification {
  /** Stable: `<kind>:<local day>`. */
  id: string;
  kind: LocalNotificationKind;
  /** The `template_id` family for copy and the `notification_opened` event. */
  templateId: LocalNotificationKind;
  /** Round-robin slot for the template pool (minors: plain round robin; adults may re-rank). */
  rotation: number;
  localDay: LocalDate;
  fireAt: string;
  /** App path, prefixed with the variant's link domain by the platform. */
  deepLink: string;
  class: 'habit';
}

export interface NotificationPlan {
  items: PlannedNotification[];
  /** Why nothing (or less than usual) was planned; for debugging, never sent anywhere. */
  notes: string[];
}

const HOUR = 60;

function isAdult(a: NotifyAudience) {
  return a === 'adult';
}

/** The daily reminder's local time (minutes) on a given day, before smart timing. */
export function reminderMinutes(prefs: NotifyPrefs, day: LocalDate, audience: NotifyAudience, config: Pick<NotifyConfig, 'schoolHours'>): number | null {
  if (!prefs.dailyReminderAt) return null;
  let m = parseHhmm(prefs.dailyReminderAt);
  const qs = parseHhmm(prefs.quietStart);
  const qe = parseHhmm(prefs.quietEnd);
  if (inWindow(m, qs, qe)) m = qe; // "This is inside your quiet hours, so we'll remind you at {quiet_end}"
  const wd = weekday(day);
  if (!isAdult(audience) && prefs.schoolHours && wd >= 1 && wd <= 5) {
    const ss = parseHhmm(config.schoolHours.start);
    const se = parseHhmm(config.schoolHours.end);
    if (inWindow(m, ss, se)) m = se;
  }
  return m;
}

/** The streak saver's local time: 1 hour before quiet hours start. */
export function streakSaverMinutes(prefs: Pick<NotifyPrefs, 'quietStart'>): number {
  return (parseHhmm(prefs.quietStart) - HOUR + 24 * HOUR) % (24 * HOUR);
}

function reminderKind(input: NotificationPlanInput, day: LocalDate): LocalNotificationKind {
  if (!isAdult(input.audience)) return 'daily_reminder';
  const lapseDay = input.lastActivityDay ? daysBetween(input.lastActivityDay, day) : 0;
  if (lapseDay === 3) return 'pet_misses_you';
  const health = input.predictPlantHealth?.(day) ?? 'thriving';
  if (health === 'droopy') return 'daily_reminder_thirsty';
  if (health !== 'thriving') return 'daily_reminder_dry';
  return 'daily_reminder';
}

function deepLinkFor(kind: LocalNotificationKind, input: NotificationPlanInput): string {
  switch (kind) {
    case 'daily_reminder':
      return input.dueCards > 0 ? '/review' : '/home';
    case 'daily_reminder_thirsty':
    case 'daily_reminder_dry':
      return '/garden';
    case 'pet_misses_you':
      return '/pet';
    case 'streak_risk':
      return input.rescueAvailable ? '/review?set=rescue' : '/home';
    case 'reminders_paused':
      return '/home';
  }
}

export function planLocalNotifications(input: NotificationPlanInput): NotificationPlan {
  const notes: string[] = [];
  if (input.mockRunnerOpen) return { items: [], notes: ['mock_runner_open'] };
  const nowMs = toMs(input.now);
  const today = localDate(input.now, input.timeZone);
  const { prefs, config } = input;
  const items: PlannedNotification[] = [];
  const perDay = new Map<LocalDate, number>();
  const room = (day: LocalDate) => (perDay.get(day) ?? 0) < Math.min(config.habitCap, config.totalCap);
  const push = (kind: LocalNotificationKind, day: LocalDate, minutes: number) => {
    const at = zonedInstant(day, minutes, input.timeZone);
    if (at <= nowMs || !room(day)) return false;
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
    items.push({
      id: `${kind}:${day}`,
      kind,
      templateId: kind,
      rotation: daysBetween('1970-01-01', day),
      localDay: day,
      fireAt: toIso(at),
      deepLink: deepLinkFor(kind, input),
      class: 'habit',
    });
    return true;
  };

  const planSaver = () => {
    // Today's streak saver (adults with it on, today not yet a streak day). Planned after the
    // reminders, so a tight cap keeps the reminder.
    if (isAdult(input.audience) && prefs.streakSaver && !input.todayQualified && input.streak >= 1) {
      push('streak_risk', today, streakSaverMinutes(prefs));
    } else if (!isAdult(input.audience) && prefs.streakSaver) {
      notes.push('streak_saver_adults_only');
    }
  };

  if (!prefs.reminderEnabled || !prefs.dailyReminderAt) {
    notes.push('reminder_off');
    planSaver();
    return { items: sortItems(items), notes };
  }

  const smartDay = input.lastSessionEndedAt ? addDays(localDate(input.lastSessionEndedAt, input.timeZone), 1) : null;
  const minutesFor = (day: LocalDate): number | null => {
    const minutes = reminderMinutes(prefs, day, input.audience, config);
    if (minutes === null || !isAdult(input.audience) || !prefs.smartTiming || !input.lastSessionEndedAt || day !== smartDay) return minutes;
    const target = toMs(input.lastSessionEndedAt) + config.smartOffsetHours * 3_600_000;
    if (localDate(target, input.timeZone) !== day) return minutes;
    const smart = Math.max(Math.round((target - zonedInstant(day, 0, input.timeZone)) / 60_000), minutes - 2 * HOUR);
    return inWindow(smart, parseHhmm(prefs.quietStart), parseHhmm(prefs.quietEnd)) ? minutes : smart;
  };

  // "The next 7 days": today (when still open) plus `planDays` more.
  let reminders = 0;
  let lastReminderDay: LocalDate | null = null;
  const lastDay = addDays(today, config.planDays);
  for (let day = today; daysBetween(day, lastDay) >= 0 && reminders < config.autopauseAfterIgnored; day = addDays(day, 1)) {
    if (day === today && input.todayQualified) continue; // nothing to remind about today
    const minutes = minutesFor(day);
    if (minutes === null) break;
    if (push(reminderKind(input, day), day, minutes)) {
      reminders += 1;
      lastReminderDay = day;
    }
  }
  // After the last reminder that would be ignored, one kind stop at the next slot (R34, A41).
  if (reminders >= config.autopauseAfterIgnored && lastReminderDay) {
    const day = addDays(lastReminderDay, 1);
    const minutes = minutesFor(day);
    if (minutes !== null) push('reminders_paused', day, minutes);
  }
  planSaver();
  return { items: sortItems(items), notes };
}

function sortItems(items: PlannedNotification[]): PlannedNotification[] {
  return items.sort((a, b) => (a.fireAt < b.fireAt ? -1 : a.fireAt > b.fireAt ? 1 : 0));
}
