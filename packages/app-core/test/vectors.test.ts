/**
 * Golden test vectors shared with the server (`apps/api` roll-ups and FSRS check). Each JSON file
 * holds inputs and the expected outputs of app-core's rules with the default flags. The server's
 * tests load the same files, so both sides agree day for day.
 *
 * Regenerate after an intended rule change: `pnpm --filter @smriti/app-core vectors`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RULES,
  EMPTY_STREAK,
  NEW_PLANT,
  SrsScheduler,
  addDays,
  closeDay,
  closePetDay,
  closePlantDay,
  derivePetState,
  grantMonthlyFreezes,
  newPet,
  type DayInput,
  type PetStats,
  type PlantDayInput,
  type PlantHealth,
  type PlantState,
  type ReviewRating,
  type SrsCardRow,
  type StreakState,
} from '../src';

const DIR = join(__dirname, '..', 'test-vectors');
const UPDATE = process.env['UPDATE_VECTORS'] === '1';

function golden(name: string, data: unknown) {
  const file = join(DIR, `${name}.json`);
  const text = `${JSON.stringify(data, null, 2)}\n`;
  if (UPDATE || !existsSync(file)) {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(file, text);
  }
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(JSON.parse(text));
}

// ── Streak ────────────────────────────────────────────────────────────────────

type StreakStep = Omit<DayInput, 'day'> & { grant?: 'free' | 'pro' };
interface StreakCase {
  name: string;
  start: LocalDateStr;
  initial: StreakState;
  days: StreakStep[];
}
type LocalDateStr = string;

const S = (q: boolean, extra: Partial<StreakStep> = {}): StreakStep => ({ qualified: q, ...extra });
const studied = (n: number) => Array.from({ length: n }, () => S(true));
const missed = (n: number) => Array.from({ length: n }, () => S(false));

const streakCases: StreakCase[] = [
  { name: 'seven study days', start: '2026-10-01', initial: EMPTY_STREAK, days: studied(7) },
  { name: 'missed day breaks the streak', start: '2026-10-01', initial: EMPTY_STREAK, days: [...studied(3), S(false), ...studied(2)] },
  { name: 'freeze covers one missed day', start: '2026-10-01', initial: { ...EMPTY_STREAK, freezesEquipped: 1 }, days: [...studied(3), S(false), ...studied(2)] },
  { name: 'two freezes cover two days, the third breaks', start: '2026-10-01', initial: { ...EMPTY_STREAK, freezesEquipped: 2 }, days: [...studied(2), ...missed(3), S(true)] },
  { name: 'rest day keeps the freeze', start: '2026-10-05', initial: { ...EMPTY_STREAK, freezesEquipped: 1 }, days: [...studied(2), S(false, { restDay: true }), S(true)] },
  { name: 'studying on a rest day counts', start: '2026-10-05', initial: EMPTY_STREAK, days: [S(true), S(true, { restDay: true }), S(true)] },
  { name: 'incident freeze', start: '2026-10-01', initial: EMPTY_STREAK, days: [...studied(2), S(false, { incident: true }), S(true)] },
  { name: 'protected exam day', start: '2026-10-01', initial: EMPTY_STREAK, days: [...studied(2), S(false, { examDay: true }), S(true)] },
  {
    name: 'monthly grant across a month boundary (free)',
    start: '2026-10-29',
    initial: { ...EMPTY_STREAK, lastGrantMonth: '2026-10' },
    days: [S(true), S(true), S(true), S(false, { grant: 'free' }), S(true), S(false), S(true)],
  },
  {
    name: 'pro grant with full slots waits in pending and refills a used slot',
    start: '2026-10-30',
    initial: { ...EMPTY_STREAK, freezesEquipped: 1, lastGrantMonth: '2026-10' },
    days: [S(true), S(true), S(true, { grant: 'pro' }), S(false), S(false), S(false), S(true)],
  },
  { name: 'long break of 45 days', start: '2026-09-01', initial: { ...EMPTY_STREAK, freezesEquipped: 2 }, days: [...studied(10), ...missed(45), S(true)] },
];

function runStreak(c: StreakCase) {
  let s = c.initial;
  const steps = c.days.map((d, i) => {
    const day = addDays(c.start, i);
    if (d.grant) s = grantMonthlyFreezes(s, day, d.grant === 'pro');
    const { grant: _g, ...input } = d;
    const r = closeDay(s, { ...input, day });
    s = r.state;
    return { day, input: { ...input, ...(d.grant ? { grant: d.grant } : {}) }, status: r.outcome.status, freeze_used: r.outcome.freezeUsed, current: s.current, longest: s.longest, freezes_equipped: s.freezesEquipped, freezes_pending: s.pendingFreezes.length };
  });
  return { name: c.name, initial: c.initial, steps, final: s };
}

// ── Plant ─────────────────────────────────────────────────────────────────────

interface PlantCase {
  name: string;
  start: string;
  initial: PlantState;
  days: Omit<PlantDayInput, 'day'>[];
}
const P = (q: boolean, extra: Partial<PlantDayInput> = {}) => ({ qualified: q, ...extra });
const pStudy = (n: number) => Array.from({ length: n }, () => P(true));
const pMiss = (n: number) => Array.from({ length: n }, () => P(false));
const sick = (health: PlantHealth, missedStreak: number): PlantState => ({ ...NEW_PLANT, growthPoints: 12, stage: 'sapling', health, missedStreak });

const plantCases: PlantCase[] = [
  { name: 'seed to sapling', start: '2026-10-01', initial: NEW_PLANT, days: pStudy(8) },
  { name: 'health falls 1/3/7/21 and never dies', start: '2026-10-01', initial: { ...NEW_PLANT, growthPoints: 1, stage: 'sprout' }, days: pMiss(25) },
  { name: 'droopy revives in 1 study day', start: '2026-10-01', initial: sick('droopy', 1), days: [P(true)] },
  { name: 'dry revives in 2 study days in a row', start: '2026-10-01', initial: sick('dry', 3), days: [P(true), P(false), P(true), P(true)] },
  { name: 'wilted revival quest keeps its dots', start: '2026-10-01', initial: sick('wilted', 7), days: [P(true), P(false), P(true), P(true)] },
  { name: 'dormant revives in 5 study days', start: '2026-10-01', initial: sick('dormant', 21), days: [...pStudy(2), P(false), ...pStudy(3)] },
  { name: 'rescue and protected days water without reviving', start: '2026-10-01', initial: sick('droopy', 1), days: [P(false, { rescue: true }), P(false, { protected: true }), P(false), P(true)] },
];

function runPlant(c: PlantCase) {
  let s = c.initial;
  const steps = c.days.map((d, i) => {
    const day = addDays(c.start, i);
    const r = closePlantDay(s, { ...d, day });
    s = r.state;
    return { day, input: d, stage: s.stage, health: s.health, growth_points: s.growthPoints, revival_progress: s.revivalProgress, missed_streak: s.missedStreak, events: r.events };
  });
  return { name: c.name, initial: c.initial, steps, final: s };
}

// ── Pet ───────────────────────────────────────────────────────────────────────

function runPet(name: string, start: string, days: { qualified: boolean; healthDay: boolean }[], initial: PetStats = newPet()) {
  let plant: PlantState = { ...NEW_PLANT, growthPoints: 5, stage: 'sprout' };
  let pet = initial;
  const steps = days.map((d, i) => {
    const day = addDays(start, i);
    plant = closePlantDay(plant, { day, qualified: d.qualified, protected: d.healthDay && !d.qualified }).state;
    pet = closePetDay(pet, { day, qualified: d.qualified, healthDay: d.healthDay, plantHealth: plant.health });
    return { day, input: d, plant_health: plant.health, mood: pet.mood, energy: pet.energy, state: derivePetState(pet), state_under10: derivePetState(pet, { under10: true }) };
  });
  return { name, initial, steps };
}

// ── FSRS ──────────────────────────────────────────────────────────────────────

function runFsrs(name: string, start: string, reviews: { afterDays: number; rating: ReviewRating }[], opts: { requestRetention?: number } = {}) {
  const sched = new SrsScheduler({ enableFuzz: false, ...opts });
  let card: SrsCardRow = sched.newCard('c:vector', start);
  let at = Date.parse(start);
  const steps = reviews.map((r) => {
    at += r.afterDays * 86_400_000;
    const res = sched.schedule(card, r.rating, at);
    card = res.card;
    return {
      reviewed_at: new Date(at).toISOString(),
      rating: r.rating,
      due: card.due_at,
      stability: Number(card.stability.toFixed(6)),
      difficulty: Number(card.difficulty.toFixed(6)),
      state: card.state,
      reps: card.reps,
      lapses: card.lapses,
      scheduled_days: card.scheduled_days,
      learning_steps: card.learning_steps,
      previews: sched.preview(card, at).map((p) => ({ rating: p.rating, due: p.due })),
    };
  });
  return { name, params: { request_retention: opts.requestRetention ?? 0.9, enable_fuzz: false, maximum_interval: 36500, weights: 'ts-fsrs 5.4.2 default' }, start, steps };
}

describe('golden vectors', () => {
  it('streak', () => {
    golden('streak', { version: 1, config: { freeze_slots_max: DEFAULT_RULES.freezeSlotsMax, monthly_freezes: DEFAULT_RULES.monthlyFreezes }, cases: streakCases.map(runStreak) });
  });

  it('plant', () => {
    golden('plant', {
      version: 1,
      config: { stage_days: DEFAULT_RULES.plantStageDays, health_missed_days: DEFAULT_RULES.plantHealthMissedDays, revival_days: DEFAULT_RULES.plantRevivalDays },
      cases: plantCases.map(runPlant),
    });
  });

  it('pet', () => {
    const T = { qualified: true, healthDay: true };
    const M = { qualified: false, healthDay: false };
    const W = { qualified: false, healthDay: true };
    golden('pet', {
      version: 1,
      config: DEFAULT_RULES.pet,
      cases: [
        runPet('steady study', '2026-10-01', [T, T, T, T]),
        runPet('a week away, then back', '2026-10-01', [M, M, M, M, M, M, M, M, T, T, T, T]),
        runPet('watered days do not decay', '2026-10-01', [M, W, W, M, T]),
        runPet('three weeks away', '2026-10-01', Array.from({ length: 22 }, () => M)),
      ],
    });
  });

  it('fsrs', () => {
    golden('fsrs', {
      version: 1,
      cases: [
        runFsrs('all good', '2026-10-01T04:30:00.000Z', [{ afterDays: 0, rating: 3 }, { afterDays: 0.007, rating: 3 }, { afterDays: 2, rating: 3 }, { afterDays: 8, rating: 3 }, { afterDays: 25, rating: 3 }]),
        runFsrs('lapse and relearn', '2026-10-01T04:30:00.000Z', [{ afterDays: 0, rating: 3 }, { afterDays: 0.007, rating: 3 }, { afterDays: 3, rating: 1 }, { afterDays: 0.007, rating: 3 }, { afterDays: 1, rating: 3 }]),
        runFsrs('easy from the start', '2026-10-01T04:30:00.000Z', [{ afterDays: 0, rating: 4 }, { afterDays: 10, rating: 4 }]),
        runFsrs('hard and again on a new card', '2026-10-01T04:30:00.000Z', [{ afterDays: 0, rating: 2 }, { afterDays: 0.004, rating: 1 }, { afterDays: 0.001, rating: 3 }]),
        runFsrs('higher retention (0.95)', '2026-10-01T04:30:00.000Z', [{ afterDays: 0, rating: 3 }, { afterDays: 0.007, rating: 3 }, { afterDays: 2, rating: 3 }], { requestRetention: 0.95 }),
      ],
    });
  });
});
