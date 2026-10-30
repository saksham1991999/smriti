import { createFlags } from '@smriti/config';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RULES,
  EMPTY_DAY,
  EMPTY_STREAK,
  GEM_SOURCES,
  NEW_PLANT,
  activityByDay,
  addDays,
  applyCare,
  applyGemDelta,
  canClaim,
  canEquipFreeze,
  canPlantNewSeed,
  canSetRestDay,
  careActionToWire,
  checkPurchase,
  claimQuest,
  closeDay,
  closePetDay,
  closePlantDay,
  derivePetState,
  displayHealth,
  equipFreeze,
  eventIncrement,
  gemsForStreakMilestone,
  grantMonthlyFreezes,
  healthForMissedDays,
  isHealthDay,
  milestonesCrossed,
  moodBand,
  newPet,
  nextStageAt,
  predictHealth,
  predictQuest,
  qualifiesDay,
  qualifyingReason,
  revivalDaysLeft,
  revivalQuest,
  rollPlant,
  rollStreak,
  rolloverQuests,
  rulesConfigFromFlags,
  stageForPoints,
  streakFromDays,
  streakProgress,
  streakView,
  todayActivity,
  type DayInput,
  type PetStats,
  type PlantDayInput,
  type PlantState,
  type Quest,
  type ShopItem,
  type StreakState,
} from '../src';

const D0 = '2026-10-01'; // a Thursday

const studyDays = (from: string, n: number): DayInput[] => Array.from({ length: n }, (_, i) => ({ day: addDays(from, i), qualified: true }));

describe('qualifiesDay (R1, R23)', () => {
  it('one lesson, ten reviews, one mock section or the daily challenge', () => {
    expect(qualifiesDay(EMPTY_DAY)).toBe(false);
    expect(qualifyingReason({ ...EMPTY_DAY, lessonsCompleted: 1 })).toBe('lesson');
    expect(qualifiesDay({ ...EMPTY_DAY, reviews: 9 })).toBe(false);
    expect(qualifyingReason({ ...EMPTY_DAY, reviews: 10 })).toBe('reviews');
    expect(qualifyingReason({ ...EMPTY_DAY, mockSections: 1 })).toBe('mock_section');
    expect(qualifyingReason({ ...EMPTY_DAY, dailyChallenge: true })).toBe('daily_challenge');
  });

  it('a rescue is a plant health day but never a streak day', () => {
    const rescue = { ...EMPTY_DAY, rescueDone: true, reviews: 5 };
    expect(qualifiesDay(rescue)).toBe(false);
    expect(isHealthDay(rescue)).toBe(true);
  });

  it('the review threshold is a flag', () => {
    const cfg = rulesConfigFromFlags(createFlags({ 'streak.reviews_to_qualify': 5 }));
    expect(qualifiesDay({ ...EMPTY_DAY, reviews: 5 }, cfg)).toBe(true);
    expect(streakProgress({ ...EMPTY_DAY, reviews: 3 })).toEqual({ qualified: false, reviewsToday: 3, reviewsLeft: 7 });
  });

  it('buckets events by the local day: 23:59 and 00:01 IST are different days', () => {
    const ev = (iso: string, type: 'review_rated' | 'lesson_completed' = 'review_rated') => ({ type, occurred_at: iso });
    const events = [
      ...Array.from({ length: 10 }, () => ev('2026-10-01T18:29:00Z')), // 23:59 IST on the 1st
      ev('2026-10-01T18:31:00Z', 'lesson_completed'), // 00:01 IST on the 2nd
    ];
    const ist = activityByDay(events, 'Asia/Kolkata');
    expect(ist.get('2026-10-01')?.reviews).toBe(10);
    expect(ist.get('2026-10-02')?.lessonsCompleted).toBe(1);
    // The same instants are one day in London.
    const uk = activityByDay(events, 'Europe/London');
    expect(uk.get('2026-10-01')).toMatchObject({ reviews: 10, lessonsCompleted: 1 });
  });

  it("today's activity merges synced counts with unsent events", () => {
    const a = todayActivity({ ...EMPTY_DAY, reviews: 6 }, Array.from({ length: 4 }, () => ({ type: 'review_rated' as const, occurred_at: '2026-10-02T04:00:00Z' })), '2026-10-02', 'Asia/Kolkata');
    expect(qualifiesDay(a)).toBe(true);
  });
});

describe('streak', () => {
  it('counts consecutive study days and keeps longest after a break', () => {
    let s = rollStreak(EMPTY_STREAK, studyDays(D0, 5), addDays(D0, 4)).state;
    expect(s).toMatchObject({ current: 5, longest: 5, lastStudiedDay: addDays(D0, 4) });
    s = closeDay(s, { day: addDays(D0, 5), qualified: false }).state;
    expect(s).toMatchObject({ current: 0, longest: 5 });
  });

  it('a missed day with a freeze equipped uses it and keeps the streak', () => {
    const start: StreakState = { ...EMPTY_STREAK, freezesEquipped: 1 };
    const { state, outcomes } = rollStreak(start, [...studyDays(D0, 3), ...studyDays(addDays(D0, 4), 2)], addDays(D0, 5));
    expect(outcomes.map((o) => o.status)).toEqual(['studied', 'studied', 'studied', 'freeze', 'studied', 'studied']);
    expect(outcomes[3]).toMatchObject({ freezeUsed: true, current: 3 });
    expect(state).toMatchObject({ current: 5, freezesEquipped: 0 });
  });

  it('two missed days with one freeze: the second day breaks the streak', () => {
    const { outcomes, state } = rollStreak({ ...EMPTY_STREAK, freezesEquipped: 1 }, studyDays(D0, 3), addDays(D0, 4));
    expect(outcomes.slice(3).map((o) => o.status)).toEqual(['freeze', 'missed']);
    expect(state.current).toBe(0);
  });

  it('a rest day pauses the streak and keeps the freeze; studying on it counts normally', () => {
    const inputs: DayInput[] = [...studyDays(D0, 2), { day: addDays(D0, 2), qualified: false, restDay: true }, { day: addDays(D0, 3), qualified: true }];
    const { outcomes, state } = rollStreak({ ...EMPTY_STREAK, freezesEquipped: 2 }, inputs, addDays(D0, 3));
    expect(outcomes.map((o) => o.status)).toEqual(['studied', 'studied', 'rest', 'studied']);
    expect(state).toMatchObject({ current: 3, freezesEquipped: 2 });
    const studied = closeDay(EMPTY_STREAK, { day: D0, qualified: true, restDay: true });
    expect(studied.outcome.status).toBe('studied');
  });

  it('an incident freeze beats everything and uses nothing', () => {
    const r = closeDay({ ...EMPTY_STREAK, current: 4, freezesEquipped: 1, closedThrough: addDays(D0, -1) }, { day: D0, qualified: false, incident: true, restDay: true });
    expect(r.outcome.status).toBe('incident');
    expect(r.state).toMatchObject({ current: 4, freezesEquipped: 1 });
  });

  it('the protected exam day pauses the streak', () => {
    expect(closeDay({ ...EMPTY_STREAK, current: 9 }, { day: D0, qualified: false, examDay: true }).state.current).toBe(9);
  });

  it('a long break (40 days) ends at 0 and uses at most the equipped freezes', () => {
    const { state, outcomes } = rollStreak({ ...EMPTY_STREAK, freezesEquipped: 2 }, studyDays(D0, 10), addDays(D0, 49));
    expect(outcomes.filter((o) => o.freezeUsed)).toHaveLength(2);
    expect(state).toMatchObject({ current: 0, longest: 10, freezesEquipped: 0 });
  });

  it('keeps the freeze on a missed day when the streak is 0 (R52)', () => {
    const r = closeDay({ ...EMPTY_STREAK, freezesEquipped: 1 }, { day: D0, qualified: false });
    expect(r.outcome).toMatchObject({ status: 'missed', freezeUsed: false, current: 0 });
    expect(r.state.freezesEquipped).toBe(1);
  });

  it('refuses to close a day twice', () => {
    const s = closeDay(EMPTY_STREAK, { day: D0, qualified: true }).state;
    expect(() => closeDay(s, { day: D0, qualified: true })).toThrow(RangeError);
  });

  it('monthly grants: free 1, Pro 2; extras wait for a slot and lapse at month end', () => {
    let s = grantMonthlyFreezes(EMPTY_STREAK, '2026-10-01', false);
    expect(s).toMatchObject({ freezesEquipped: 1, lastGrantMonth: '2026-10' });
    expect(grantMonthlyFreezes(s, '2026-10-15', false)).toBe(s); // once a month
    s = grantMonthlyFreezes({ ...EMPTY_STREAK, freezesEquipped: 2 }, '2026-10-01', true);
    expect(s).toMatchObject({ freezesEquipped: 2, pendingFreezes: [{ source: 'pro_monthly', expiresAfter: '2026-10-31' }, { source: 'pro_monthly', expiresAfter: '2026-10-31' }] });
    // A freeze used on the 10th refills from pending.
    s = closeDay({ ...s, current: 3, closedThrough: '2026-10-09' }, { day: '2026-10-10', qualified: false }).state;
    expect(s).toMatchObject({ freezesEquipped: 2 });
    expect(s.pendingFreezes).toHaveLength(1);
    // In November, the October grant has lapsed.
    s = closeDay({ ...s, freezesEquipped: 0, closedThrough: '2026-10-31' }, { day: '2026-11-01', qualified: false }).state;
    expect(s).toMatchObject({ freezesEquipped: 0, pendingFreezes: [] });
  });

  it('equipping a bought freeze is capped at 2 slots', () => {
    expect(canEquipFreeze({ ...EMPTY_STREAK, freezesEquipped: 1 })).toEqual({ ok: true });
    const full = equipFreeze({ ...EMPTY_STREAK, freezesEquipped: 1 });
    expect(canEquipFreeze(full)).toEqual({ ok: false, reason: 'slots_full' });
    expect(() => equipFreeze(full)).toThrow();
  });

  it('rest days: one per Monday–Sunday week, not in the past, up to 30 days ahead', () => {
    const today = '2026-10-29'; // Thursday
    expect(canSetRestDay('2026-10-28', today, [])).toEqual({ ok: false, reason: 'in_past' });
    expect(canSetRestDay('2026-10-31', today, [])).toEqual({ ok: true });
    expect(canSetRestDay('2026-11-01', today, ['2026-10-31'])).toEqual({ ok: false, reason: 'week_used' }); // Sunday, same week
    expect(canSetRestDay('2026-11-02', today, ['2026-10-31'])).toEqual({ ok: true }); // next Monday
    expect(canSetRestDay('2026-10-31', today, ['2026-10-31'])).toEqual({ ok: false, reason: 'already_set' });
    expect(canSetRestDay('2026-11-29', today, [])).toEqual({ ok: false, reason: 'too_far_ahead' });
  });

  it('streakView: at risk, freeze cover and rest day', () => {
    const s: StreakState = { ...EMPTY_STREAK, current: 6, longest: 6, closedThrough: '2026-10-28', freezesEquipped: 1 };
    expect(streakView(s, '2026-10-29', { qualified: false })).toMatchObject({ current: 6, atRisk: true, freezeWillCover: true });
    expect(streakView(s, '2026-10-29', { qualified: true })).toMatchObject({ current: 7, longest: 7, atRisk: false });
    expect(streakView(s, '2026-10-29', { qualified: false, restDay: true })).toMatchObject({ atRisk: false, restDayToday: true, freezeWillCover: false });
    expect(streakView(EMPTY_STREAK, '2026-10-29', { qualified: false }).atRisk).toBe(false);
  });

  it('streakView catches up days the app missed while offline', () => {
    const s: StreakState = { ...EMPTY_STREAK, current: 6, longest: 6, closedThrough: '2026-10-25' };
    const v = streakView(s, '2026-10-29', { qualified: false }, DEFAULT_RULES, studyDays('2026-10-26', 3));
    expect(v.current).toBe(9);
    expect(streakView(s, '2026-10-29', { qualified: false }).current).toBe(0);
  });

  it('streakFromDays matches the roll-up', () => {
    const days = [
      { day: '2026-10-20', status: 'studied' as const },
      { day: '2026-10-21', status: 'studied' as const },
      { day: '2026-10-22', status: 'freeze' as const },
      { day: '2026-10-23', status: 'studied' as const },
      { day: '2026-10-24', status: 'rest' as const },
      { day: '2026-10-25', status: 'studied' as const },
    ];
    expect(streakFromDays(days, '2026-10-26')).toEqual({ current: 4, longest: 4 });
    expect(streakFromDays(days, '2026-10-27')).toEqual({ current: 0, longest: 4 });
    expect(streakFromDays([...days, { day: '2026-10-26', status: 'studied' }], '2026-10-26')).toEqual({ current: 5, longest: 5 });
  });

  it('milestones crossed', () => {
    expect(milestonesCrossed(6, 7, [7, 30, 100])).toEqual([7]);
    expect(milestonesCrossed(7, 8, [7, 30, 100])).toEqual([]);
    expect(milestonesCrossed(0, 100, [7, 30, 100])).toEqual([7, 30, 100]);
  });
});

describe('plant (R2, R12, R37)', () => {
  const roll = (state: PlantState, inputs: PlantDayInput[], through: string) => rollPlant(state, inputs, through);

  it('grows through the stages at 1, 7, 30 and 100 study days', () => {
    expect([0, 1, 6, 7, 29, 30, 99, 100].map((p) => stageForPoints(p))).toEqual(['seed', 'sprout', 'sprout', 'sapling', 'sapling', 'flowering', 'flowering', 'tree']);
    expect(nextStageAt(0)).toBe(1);
    expect(nextStageAt(8)).toBe(30);
    expect(nextStageAt(100)).toBeNull();
    const { state, events } = roll(NEW_PLANT, studyDays(D0, 7), addDays(D0, 6));
    expect(state).toMatchObject({ growthPoints: 7, stage: 'sapling' });
    expect(events.filter((e) => e.kind === 'stage_up')).toEqual([{ kind: 'stage_up', stage: 'sprout' }, { kind: 'stage_up', stage: 'sapling' }]);
    expect(canPlantNewSeed(state)).toBe(false);
  });

  it('health from missed days: 1 droopy, 3 dry, 7 wilted, 21 dormant; never dead', () => {
    expect([0, 1, 2, 3, 6, 7, 20, 21, 400].map((m) => healthForMissedDays(m))).toEqual(['thriving', 'droopy', 'droopy', 'dry', 'dry', 'wilted', 'wilted', 'dormant', 'dormant']);
    const seeded = roll(NEW_PLANT, studyDays(D0, 1), D0).state;
    const { state } = roll(seeded, [], addDays(D0, 60));
    expect(state).toMatchObject({ health: 'dormant', growthPoints: 1, stage: 'sprout' }); // growth never lost
  });

  it('freezes, rest days and rescues water the plant but are not revival days', () => {
    const s = roll(NEW_PLANT, studyDays(D0, 2), addDays(D0, 1)).state;
    const r = roll(s, [{ day: addDays(D0, 2), qualified: false, rescue: true }, { day: addDays(D0, 3), qualified: false, protected: true }], addDays(D0, 3));
    expect(r.state).toMatchObject({ health: 'thriving', missedStreak: 0, growthPoints: 2 });
    const droopy = closePlantDay({ ...s, health: 'droopy', missedStreak: 1, closedThrough: addDays(D0, 1) }, { day: addDays(D0, 2), qualified: false, rescue: true }).state;
    expect(droopy).toMatchObject({ health: 'droopy', revivalProgress: 0 });
  });

  it('revival: droopy 1 study day, dry 2 in a row, wilted 3, dormant 5', () => {
    const base = (health: PlantState['health']): PlantState => ({ ...NEW_PLANT, growthPoints: 10, stage: 'sapling', health, closedThrough: addDays(D0, -1) });
    for (const [health, days] of [['droopy', 1], ['dry', 2], ['wilted', 3], ['dormant', 5]] as const) {
      const before = roll(base(health), studyDays(D0, days - 1), addDays(D0, days - 2));
      if (days > 1) expect(before.state.health).toBe(health);
      expect(revivalDaysLeft(before.state)).toBe(1);
      const after = closePlantDay(before.state, { day: addDays(D0, days - 1), qualified: true });
      expect(after.state.health).toBe('thriving');
      expect(after.events).toContainEqual({ kind: 'revived', from: health });
    }
  });

  it('dry needs 2 days in a row: a miss in between resets the count', () => {
    let s: PlantState = { ...NEW_PLANT, growthPoints: 5, stage: 'sprout', health: 'dry', missedStreak: 3, closedThrough: addDays(D0, -1) };
    s = closePlantDay(s, { day: D0, qualified: true }).state;
    expect(s.revivalProgress).toBe(1);
    s = closePlantDay(s, { day: addDays(D0, 1), qualified: false }).state;
    expect(s).toMatchObject({ health: 'dry', revivalProgress: 0 });
  });

  it('wilted and dormant keep their revival dots through a missed day', () => {
    let s: PlantState = { ...NEW_PLANT, growthPoints: 40, stage: 'flowering', health: 'dormant', missedStreak: 21, closedThrough: addDays(D0, -1) };
    s = roll(s, studyDays(D0, 3), addDays(D0, 2)).state;
    expect(revivalQuest(s)).toEqual({ kind: 'dormant', days: 5, done: 3 });
    s = closePlantDay(s, { day: addDays(D0, 3), qualified: false }).state;
    expect(s).toMatchObject({ health: 'dormant', revivalProgress: 3 });
    s = roll(s, studyDays(addDays(D0, 4), 2), addDays(D0, 5)).state;
    expect(s.health).toBe('thriving');
    expect(revivalQuest(s)).toBeNull();
  });

  it('a revival quest that slips past the next threshold restarts at the worse health', () => {
    let s: PlantState = { ...NEW_PLANT, growthPoints: 9, stage: 'sapling', health: 'wilted', missedStreak: 7, revivalProgress: 0, closedThrough: addDays(D0, -1) };
    s = closePlantDay(s, { day: D0, qualified: true }).state; // 1 of 3
    s = roll(s, [], addDays(D0, 21)).state; // 21 missed days → dormant
    expect(s).toMatchObject({ health: 'dormant', revivalProgress: 0 });
  });

  it('predictHealth for a stale snapshot, and the under-10 display clamp', () => {
    const s: PlantState = { ...NEW_PLANT, health: 'thriving', missedStreak: 0, lastHealthDay: '2026-10-20', closedThrough: '2026-10-20' };
    expect(predictHealth(s, '2026-10-21')).toBe('thriving'); // today is still open
    expect(predictHealth(s, '2026-10-22')).toBe('droopy');
    expect(predictHealth(s, '2026-10-28')).toBe('wilted');
    expect(displayHealth('dormant', { under10: true })).toBe('droopy');
    expect(displayHealth('dry', { under10: false })).toBe('dry');
  });

  it('reaches Tree at 100 days and offers a new seed', () => {
    const { state } = roll(NEW_PLANT, studyDays(D0, 100), addDays(D0, 99));
    expect(state.stage).toBe('tree');
    expect(canPlantNewSeed(state)).toBe(true);
  });
});

describe('pet', () => {
  it('state follows the mood band of plant health', () => {
    expect(moodBand('thriving')).toEqual([70, 100]);
    expect(moodBand('dormant')).toEqual([0, 14]);
    expect(derivePetState({ mood: 80, energy: 80 })).toBe('happy');
    expect(derivePetState({ mood: 55, energy: 80 })).toBe('content');
    expect(derivePetState({ mood: 35, energy: 80 })).toBe('sleepy');
    expect(derivePetState({ mood: 20, energy: 50 })).toBe('tired');
    expect(derivePetState({ mood: 20, energy: 20 })).toBe('missing_you');
    expect(derivePetState({ mood: 5, energy: 0 })).toBe('resting');
    expect(derivePetState({ mood: 5, energy: 0 }, { under10: true })).toBe('sleepy');
  });

  it('decays on missed days, not on watered days, and recovers by studying', () => {
    let p: PetStats = newPet();
    p = closePetDay(p, { day: D0, qualified: false, healthDay: false, plantHealth: 'droopy' });
    expect(p).toMatchObject({ mood: 69, energy: 70 }); // clamped to the droopy band ceiling
    p = closePetDay(p, { day: addDays(D0, 1), qualified: false, healthDay: true, plantHealth: 'droopy' });
    expect(p).toMatchObject({ mood: 69, energy: 70 });
    p = closePetDay(p, { day: addDays(D0, 2), qualified: true, healthDay: true, plantHealth: 'thriving' });
    expect(p).toMatchObject({ mood: 89, energy: 85 });
    expect(() => closePetDay(p, { day: addDays(D0, 2), qualified: true, healthDay: true, plantHealth: 'thriving' })).toThrow();
  });

  it('care: petting is capped at +5 mood a day, play 3 a day, one treat a day', () => {
    const pet: PetStats = { mood: 72, energy: 50, lastDecayDay: null };
    let c = { day: D0, careMood: 0, plays: 0, treats: 0 };
    let p = pet;
    for (let i = 0; i < 3; i++) {
      const r = applyCare(p, 'pet', c, { day: D0, plantHealth: 'thriving', treatsHeld: 0 });
      if (!r.ok) throw new Error('blocked');
      p = r.pet;
      c = r.counters;
    }
    expect(p.mood).toBe(77);
    expect(applyCare(p, 'pet', c, { day: D0, plantHealth: 'thriving', treatsHeld: 0 })).toEqual({ ok: false, reason: 'cap' });
    // A new day resets the counters.
    expect(applyCare(p, 'pet', c, { day: addDays(D0, 1), plantHealth: 'thriving', treatsHeld: 0 }).ok).toBe(true);
    expect(applyCare(p, 'treat', c, { day: D0, plantHealth: 'thriving', treatsHeld: 0 })).toEqual({ ok: false, reason: 'no_treat' });
    const t = applyCare(p, 'treat', c, { day: D0, plantHealth: 'thriving', treatsHeld: 2 });
    expect(t).toMatchObject({ ok: true, usedTreat: true, pet: { energy: 58 } });
    if (t.ok) expect(applyCare(t.pet, 'treat', t.counters, { day: D0, plantHealth: 'thriving', treatsHeld: 1 })).toEqual({ ok: false, reason: 'cap' });
  });

  it('care cannot lift a resting pet out of its band: only studying does', () => {
    const r = applyCare({ mood: 14, energy: 10, lastDecayDay: null }, 'pet', { day: D0, careMood: 0, plays: 0, treats: 0 }, { day: D0, plantHealth: 'dormant', treatsHeld: 0 });
    expect(r).toMatchObject({ ok: true, pet: { mood: 14 } });
    expect(careActionToWire('treat')).toBe('feed');
    expect(careActionToWire('play')).toBe('play');
  });
});

describe('gems and shop (R36)', () => {
  const item = (over: Partial<ShopItem> = {}): ShopItem => ({ id: 'i1', kind: 'pet_outfit', price_gems: 100, pro_only: false, active: true, ...over });
  const ctx = { gems: 150, isPro: false, online: true, freezesEquipped: 0, treatsHeld: 0, owned: 0 };

  it('there is no way to earn gems from money', () => {
    expect(GEM_SOURCES.some((s) => /purchase|pay|iap|money|buy/.test(s))).toBe(false);
  });

  it('balance never goes below zero', () => {
    expect(applyGemDelta(10, { delta: 5, reason: 'daily_quest' })).toEqual({ balance: 15, adjustment: null });
    expect(applyGemDelta(10, { delta: -15, reason: 'purchase:x', ref: 'p1' })).toEqual({ balance: 0, adjustment: { delta: 5, reason: 'adjustment', ref: 'p1' } });
  });

  it('milestone gems come from config', () => {
    expect(gemsForStreakMilestone(7)).toBe(25);
    expect(gemsForStreakMilestone(8)).toBe(0);
  });

  it('purchase checks in order', () => {
    expect(checkPurchase(item(), ctx)).toEqual({ ok: true });
    expect(checkPurchase(item({ active: false }), ctx)).toEqual({ ok: false, reason: 'inactive' });
    expect(checkPurchase(item(), { ...ctx, online: false })).toEqual({ ok: false, reason: 'offline' });
    expect(checkPurchase(item({ pro_only: true }), ctx)).toEqual({ ok: false, reason: 'pro_only' });
    expect(checkPurchase(item({ kind: 'freeze', price_gems: 50 }), { ...ctx, freezesEquipped: 2 })).toEqual({ ok: false, reason: 'cap' });
    expect(checkPurchase(item({ kind: 'treat', price_gems: 5 }), { ...ctx, treatsHeld: 10 })).toEqual({ ok: false, reason: 'cap' });
    expect(checkPurchase(item(), { ...ctx, owned: 1 })).toEqual({ ok: false, reason: 'owned' });
    expect(checkPurchase(item({ kind: 'treat', price_gems: 5 }), { ...ctx, owned: 3, treatsHeld: 3 })).toEqual({ ok: true });
    expect(checkPurchase(item({ price_gems: 200 }), ctx)).toEqual({ ok: false, reason: 'balance' });
  });
});

describe('quests', () => {
  const daily: Quest = { id: 'd1', period: 'daily', spec: { counter: 'reviews', target: 20 }, reward: { gems: 10 }, active_from: '2026-01-01', active_to: null };
  const weekly: Quest = { id: 'w1', period: 'weekly', spec: { counter: 'lessons_completed', target: 5, filters: { mode: 'deep_dive' } }, reward: { gems: 50 }, active_from: '2026-01-01', active_to: null };
  const review = (iso: string) => ({ type: 'review_rated' as const, occurred_at: iso, payload: {} as never });
  const lesson = (iso: string, mode: string, ms = 0) => ({ type: 'lesson_completed' as const, occurred_at: iso, payload: { mode, ms_total: ms, xp: 10 } as never });

  it('predicts progress from unsent events in the current local period, capped at the target', () => {
    const today = '2026-10-29';
    const events = [review('2026-10-28T18:29:00Z'), ...Array.from({ length: 25 }, () => review('2026-10-29T05:00:00Z'))];
    const uq = predictQuest(daily, undefined, events, today, 'Asia/Kolkata', 'now');
    expect(uq).toMatchObject({ period_start: today, progress: 20, completed_at: 'now' });
    expect(canClaim(uq)).toEqual({ ok: true });
    const claimed = claimQuest(uq, 'later');
    expect(canClaim(claimed)).toEqual({ ok: false, reason: 'already_claimed' });
  });

  it('weekly quests start on Monday and respect filters', () => {
    const events = [lesson('2026-10-26T05:00:00Z', 'deep_dive'), lesson('2026-10-27T05:00:00Z', 'quick_revision'), lesson('2026-10-25T05:00:00Z', 'deep_dive')];
    const uq = predictQuest(weekly, undefined, events, '2026-10-29', 'Asia/Kolkata', 'now');
    expect(uq).toMatchObject({ period_start: '2026-10-26', progress: 1, completed_at: null });
    expect(canClaim(uq)).toEqual({ ok: false, reason: 'not_complete' });
  });

  it('minutes count finished sessions', () => {
    const q: Quest = { ...daily, spec: { counter: 'minutes', target: 10 } };
    expect(eventIncrement(q, lesson('2026-10-29T05:00:00Z', 'deep_dive', 7 * 60_000 + 59_000))).toBe(7);
    expect(eventIncrement(q, review('2026-10-29T05:00:00Z'))).toBe(0);
  });

  it('rollover auto-claims finished rewards and opens fresh rows', () => {
    const prev = { quest_id: 'd1', period_start: '2026-10-28', progress: 20, target: 20, completed_at: 'x', claimed_at: null };
    const { current, autoClaimed } = rolloverQuests([daily, weekly], [prev], '2026-10-29', 'now');
    expect(autoClaimed).toHaveLength(1);
    expect(autoClaimed[0]?.userQuest.claimed_at).toBe('now');
    expect(current.map((c) => `${c.quest_id}@${c.period_start}:${c.progress}`)).toEqual(['d1@2026-10-29:0', 'w1@2026-10-26:0']);
  });
});
