import { describe, expect, it } from 'vitest';

import {
  defaultQuietHours,
  notifyConfigFromFlags,
  planLocalNotifications,
  reminderMinutes,
  streakSaverMinutes,
  widgetEveningHour,
  widgetSnapshot,
  type NotificationPlanInput,
  type NotifyPrefs,
  type WidgetSnapshotInput,
} from '../src';

const TZ = 'Asia/Kolkata';
const NOW = '2026-10-29T06:00:00.000Z'; // Thursday 11:30 IST
const ist = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+05:30`).toISOString();

const adultPrefs: NotifyPrefs = {
  reminderEnabled: true,
  dailyReminderAt: '19:00',
  smartTiming: false,
  streakSaver: true,
  quietStart: '22:00',
  quietEnd: '07:00',
  schoolHours: false,
};

function input(over: Partial<NotificationPlanInput> = {}): NotificationPlanInput {
  const audience = over.audience ?? 'adult';
  return {
    now: NOW,
    timeZone: TZ,
    audience,
    prefs: adultPrefs,
    config: notifyConfigFromFlags(audience),
    todayQualified: false,
    streak: 3,
    lastActivityDay: '2026-10-28',
    dueCards: 12,
    rescueAvailable: true,
    mockRunnerOpen: false,
    ...over,
  };
}

describe('notification config', () => {
  it('reads the per-audience caps and quiet hours from flags', () => {
    expect(notifyConfigFromFlags('adult')).toMatchObject({ planDays: 7, autopauseAfterIgnored: 7, habitCap: 2, totalCap: 4 });
    expect(notifyConfigFromFlags('teen')).toMatchObject({ habitCap: 1, totalCap: 3 });
    expect(notifyConfigFromFlags('child')).toMatchObject({ habitCap: 1, totalCap: 1 });
    expect(defaultQuietHours('child')).toEqual({ start: '20:00', end: '08:00' });
  });

  it('moves a reminder inside quiet hours to their end, and a minor school-hours time to the end of school', () => {
    const cfg = notifyConfigFromFlags('teen');
    expect(reminderMinutes({ ...adultPrefs, dailyReminderAt: '23:15' }, '2026-10-29', 'adult', cfg)).toBe(7 * 60);
    expect(reminderMinutes({ ...adultPrefs, dailyReminderAt: '06:30' }, '2026-10-29', 'adult', cfg)).toBe(7 * 60);
    const teen = { ...adultPrefs, dailyReminderAt: '10:00', schoolHours: true };
    expect(reminderMinutes(teen, '2026-10-29', 'teen', cfg)).toBe(14 * 60); // Thursday
    expect(reminderMinutes(teen, '2026-10-31', 'teen', cfg)).toBe(10 * 60); // Saturday
    expect(reminderMinutes(teen, '2026-10-29', 'adult', cfg)).toBe(10 * 60); // adults: no school hours
    expect(reminderMinutes({ ...adultPrefs, dailyReminderAt: null }, '2026-10-29', 'adult', cfg)).toBeNull();
  });

  it('puts the streak saver an hour before quiet hours, wrapping midnight', () => {
    expect(streakSaverMinutes({ quietStart: '22:00' })).toBe(21 * 60);
    expect(streakSaverMinutes({ quietStart: '00:30' })).toBe(23 * 60 + 30);
  });
});

describe('planLocalNotifications', () => {
  it('adults: today\'s saver, seven reminders, then one pause notice', () => {
    const plan = planLocalNotifications(input());
    expect(plan.items.map((i) => [i.kind, i.localDay])).toEqual([
      ['daily_reminder', '2026-10-29'],
      ['streak_risk', '2026-10-29'],
      ['daily_reminder', '2026-10-30'],
      ['pet_misses_you', '2026-10-31'], // day 3 of the lapse
      ['daily_reminder', '2026-11-01'],
      ['daily_reminder', '2026-11-02'],
      ['daily_reminder', '2026-11-03'],
      ['daily_reminder', '2026-11-04'],
      ['reminders_paused', '2026-11-05'],
    ]);
    const saver = plan.items.find((i) => i.kind === 'streak_risk');
    expect(saver).toMatchObject({ id: 'streak_risk:2026-10-29', fireAt: ist('2026-10-29', '21:00'), deepLink: '/review?set=rescue', class: 'habit' });
    expect(plan.items[0]).toMatchObject({ fireAt: ist('2026-10-29', '19:00'), deepLink: '/review' });
    expect(plan.items.find((i) => i.kind === 'pet_misses_you')?.deepLink).toBe('/pet');
    expect(plan.items.at(-1)?.deepLink).toBe('/home');
    // rotation advances one a day, for round robin
    expect(plan.items[2]!.rotation - plan.items[0]!.rotation).toBe(1);
  });

  it('a qualified today gets no saver and no reminder; the plan starts tomorrow', () => {
    const plan = planLocalNotifications(input({ todayQualified: true, lastActivityDay: '2026-10-29' }));
    expect(plan.items[0]).toMatchObject({ kind: 'daily_reminder', localDay: '2026-10-30' });
    expect(plan.items.filter((i) => i.kind !== 'reminders_paused')).toHaveLength(7);
    expect(plan.items.at(-1)).toMatchObject({ kind: 'reminders_paused', localDay: '2026-11-06' });
    expect(plan.items.some((i) => i.kind === 'streak_risk')).toBe(false);
  });

  it('skips times already past and the saver without a streak', () => {
    const plan = planLocalNotifications(input({ now: ist('2026-10-29', '20:00'), streak: 0 }));
    expect(plan.items[0]?.localDay).toBe('2026-10-30');
    expect(plan.items.some((i) => i.kind === 'streak_risk')).toBe(false);
  });

  it('adults: copy follows the predicted plant health', () => {
    const health = { '2026-10-30': 'droopy', '2026-11-01': 'dry', '2026-11-02': 'wilted' } as const;
    const plan = planLocalNotifications(
      input({ lastActivityDay: null, predictPlantHealth: (d) => health[d as keyof typeof health] ?? 'thriving' }),
    );
    const kinds = Object.fromEntries(plan.items.filter((i) => i.kind !== 'streak_risk').map((i) => [i.localDay, i.kind]));
    expect(kinds['2026-10-30']).toBe('daily_reminder_thirsty');
    expect(kinds['2026-11-01']).toBe('daily_reminder_dry');
    expect(kinds['2026-11-02']).toBe('daily_reminder_dry');
    expect(kinds['2026-10-31']).toBe('daily_reminder');
    expect(plan.items.find((i) => i.kind === 'daily_reminder_thirsty')?.deepLink).toBe('/garden');
  });

  it('minors: the picked time only, plain reminders, no saver, no smart timing', () => {
    for (const audience of ['teen', 'child'] as const) {
      const plan = planLocalNotifications(
        input({
          audience,
          prefs: { ...adultPrefs, smartTiming: true, quietStart: '21:00', quietEnd: '07:00' },
          lastSessionEndedAt: ist('2026-10-28', '17:00'),
          predictPlantHealth: () => 'dry',
        }),
      );
      expect(new Set(plan.items.map((i) => i.kind))).toEqual(new Set(['daily_reminder', 'reminders_paused']));
      expect(plan.items.every((i) => i.fireAt.endsWith('T13:30:00.000Z'))).toBe(true); // 19:00 IST
      expect(plan.notes).toContain('streak_saver_adults_only');
    }
  });

  it('adults with smart timing: about 23.5 h after the last session, never more than 2 h early', () => {
    const smart = { ...adultPrefs, smartTiming: true };
    const early = planLocalNotifications(input({ prefs: smart, lastSessionEndedAt: ist('2026-10-28', '15:00') }));
    expect(early.items[0]?.fireAt).toBe(ist('2026-10-29', '17:00')); // 14:30 clamped to 19:00 − 2 h
    const later = planLocalNotifications(input({ prefs: smart, lastSessionEndedAt: ist('2026-10-28', '18:00') }));
    expect(later.items[0]?.fireAt).toBe(ist('2026-10-29', '17:30'));
    expect(later.items.find((i) => i.localDay === '2026-10-30' && i.kind === 'daily_reminder')?.fireAt).toBe(ist('2026-10-30', '19:00'));
    const quiet = planLocalNotifications(input({ prefs: smart, lastSessionEndedAt: ist('2026-10-28', '23:00') }));
    expect(quiet.items[0]?.fireAt).toBe(ist('2026-10-29', '19:00')); // 22:30 is inside quiet hours
  });

  it('respects the habit cap: a cap of 1 keeps the reminder over the saver', () => {
    const plan = planLocalNotifications(input({ config: { ...notifyConfigFromFlags('adult'), habitCap: 1 } }));
    expect(plan.items.filter((i) => i.localDay === '2026-10-29').map((i) => i.kind)).toEqual(['daily_reminder']);
  });

  it('nothing while a mock runner is open; only the saver when reminders are off', () => {
    expect(planLocalNotifications(input({ mockRunnerOpen: true }))).toEqual({ items: [], notes: ['mock_runner_open'] });
    const off = planLocalNotifications(input({ prefs: { ...adultPrefs, reminderEnabled: false } }));
    expect(off.items.map((i) => i.kind)).toEqual(['streak_risk']);
    expect(off.notes).toEqual(['reminder_off']);
  });

  it('home deep link when nothing is due; saver opens home without a rescue', () => {
    const plan = planLocalNotifications(input({ dueCards: 0, rescueAvailable: false }));
    expect(plan.items[0]?.deepLink).toBe('/home');
    expect(plan.items.find((i) => i.kind === 'streak_risk')?.deepLink).toBe('/home');
  });
});

describe('widgetSnapshot', () => {
  const base: WidgetSnapshotInput = {
    now: NOW,
    timeZone: TZ,
    locale: 'hi',
    themePref: 'system',
    signedIn: true,
    isUnder10: false,
    streak: 12,
    goalProgress: 0.456,
    freezeHeld: true,
    restDayToday: false,
    lastActivityDay: '2026-10-28',
    plant: { species: 'tulsi', skin: null, stage: 'sapling', health: 'dry' },
    pet: { species: 'cat', name: 'Miso', state: 'missing_you', outfit: null },
    healthByMissedDays: { droopy: 1, dry: 3, wilted: 7, dormant: 14 },
    dueCards: 23,
    planItems: [
      { title: 'a', subject_family: 'physics', minutes: 10, deep_link: '/review' },
      { title: 'b', subject_family: 'math', minutes: 5, deep_link: '/learn/x' },
      { title: 'c', subject_family: 'chem', minutes: 5, deep_link: '/learn/y' },
      { title: 'd', subject_family: 'bio', minutes: 5, deep_link: '/learn/z' },
    ],
    exam: { name: 'JEE Main', target_date: '2027-01', date_precision: 'month' },
    quietStart: '22:00',
    quietEnd: '07:00',
    eveningHour: null,
  };

  it('writes the §6.6 fields', () => {
    const s = widgetSnapshot(base);
    expect(s).toMatchObject({
      schema_version: 1,
      written_at: NOW,
      local_day: '2026-10-29',
      tz: TZ,
      streak: 12,
      goal_met_today: false,
      goal_progress: 0.46,
      plant: { stage: 'sapling', health: 'dry' },
      pet: { state: 'missing_you' },
      due_cards: 23,
      evening_hour: 19,
      quiet_end: '07:00',
    });
    expect(s.plan_items.map((i) => i.title)).toEqual(['a', 'b', 'c']);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('under 10: the pet never below sleepy, the plant at most droopy', () => {
    const s = widgetSnapshot({ ...base, isUnder10: true, plant: { ...base.plant, health: 'dormant' } });
    expect(s.pet?.state).toBe('sleepy');
    expect(s.plant.health).toBe('droopy');
    expect(widgetSnapshot({ ...base, isUnder10: true, pet: { ...base.pet!, state: 'happy' } }).pet?.state).toBe('happy');
  });

  it('clamps progress and counts, and handles signed-out and pet-less states', () => {
    const s = widgetSnapshot({ ...base, goalProgress: 1.7, dueCards: -2, streak: 3.9, pet: null, signedIn: false, exam: null });
    expect(s).toMatchObject({ goal_progress: 1, goal_met_today: true, due_cards: 0, streak: 3, pet: null, signed_in: false, exam: null });
    expect(widgetSnapshot({ ...base, goalProgress: Number.NaN }).goal_progress).toBe(0);
  });

  it('evening hour: the flag, or 3 h before quiet hours if earlier', () => {
    expect(widgetEveningHour(null, '22:00')).toBe(19);
    expect(widgetEveningHour(18, '22:00')).toBe(18);
    expect(widgetEveningHour(20, '21:00')).toBe(18);
    expect(widgetEveningHour(null, '01:00')).toBe(22);
  });
});
