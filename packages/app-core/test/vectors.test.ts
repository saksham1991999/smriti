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
  DEFAULT_LITTLE_ACTIVITY_STAR_XP,
  DEFAULT_RULES,
  EMPTY_STREAK,
  activityByDay,
  activityCompletedPayload,
  activityCompletedXp,
  activityDedupeKey,
  NEW_PLANT,
  SrsScheduler,
  addDays,
  closeDay,
  closePetDay,
  closePlantDay,
  derivePetState,
  grantMonthlyFreezes,
  learnerExperience,
  newPet,
  plantDisplay,
  gentlePetState,
  resolveAgeBand,
  timeLimitState,
  PET_STATES,
  PLANT_HEALTH,
  type ActivityCompletionLike,
  type AgeBandInput,
  type DayInput,
  type PetStats,
  type PlantDayInput,
  type PlantHealth,
  type PlantState,
  type ReviewRating,
  type SrsCardRow,
  type StreakState,
  type TopicMarkContext,
  type TopicMarkEvent,
  type TopicMarkRow,
  applyTopicMark,
  chapterResetPayload,
  placementCheckedPayload,
  qualifiesDay,
  topicTestOutUndonePayload,
  topicTestedOutPayload,
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
  // R52: with the streak at 0 there is nothing to protect, so a missed day keeps the freeze.
  { name: 'no freeze is spent when the streak is 0', start: '2026-10-01', initial: { ...EMPTY_STREAK, freezesEquipped: 1 }, days: [S(false), S(false), S(true), S(false), S(true)] },
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
  it('age_band', () => {
    // R56: a known age first, then class (class 5 is u10), then the stored band. The server's
    // profile_rules.resolve_age_band runs these same cases (apps/api/tests/test_vectors.py).
    const today = '2026-10-30';
    const cases: { name: string; input: AgeBandInput }[] = [
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((c) => ({ name: `class ${c} only`, input: { schoolClass: c, birth: null } })),
      { name: 'born 2017, month unknown: 8', input: { schoolClass: null, birth: { year: 2017 } } },
      { name: 'born 2016, month unknown: 9', input: { schoolClass: null, birth: { year: 2016 } } },
      { name: 'born 2016-10: birthday month not over, 9', input: { schoolClass: null, birth: { year: 2016, month: 10 } } },
      { name: 'born 2016-09: 10', input: { schoolClass: null, birth: { year: 2016, month: 9 } } },
      { name: 'born 2014, month unknown: 11', input: { schoolClass: null, birth: { year: 2014 } } },
      { name: 'born 2013, month unknown: 12', input: { schoolClass: null, birth: { year: 2013 } } },
      { name: 'born 2008, month unknown: 17', input: { schoolClass: null, birth: { year: 2008 } } },
      { name: 'born 2008-10: still 17', input: { schoolClass: null, birth: { year: 2008, month: 10 } } },
      { name: 'born 2008-09: 18', input: { schoolClass: null, birth: { year: 2008, month: 9 } } },
      { name: 'birth year beats class', input: { schoolClass: 4, birth: { year: 2008, month: 1 } } },
      { name: 'birth year beats a declared stored band', input: { schoolClass: null, birth: { year: 2017 }, storedBand: '18p', storedSource: 'self_declared' } },
      { name: 'self-declared adult in class 12', input: { schoolClass: 12, birth: null, storedBand: '18p', storedSource: 'self_declared' } },
      { name: 'guardian-set band beats class', input: { schoolClass: 6, birth: null, storedBand: 'u10', storedSource: 'guardian' } },
      { name: 'stored birth-year band beats class', input: { schoolClass: 2, birth: null, storedBand: '13_17', storedSource: 'birth_year' } },
      { name: 'class beats a class-derived stored band', input: { schoolClass: 5, birth: null, storedBand: '10_12', storedSource: 'class' } },
      { name: 'class beats a stored band of unknown source', input: { schoolClass: 9, birth: null, storedBand: '18p' } },
      { name: 'stored band when nothing else is known', input: { schoolClass: null, birth: null, storedBand: '10_12', storedSource: 'class' } },
      { name: 'stored band beats "Prefer not to say"', input: { schoolClass: null, birth: 'declined', storedBand: '10_12', storedSource: 'class' } },
      { name: 'class beats "Prefer not to say"', input: { schoolClass: 3, birth: 'declined' } },
      { name: '"Prefer not to say" alone', input: { schoolClass: null, birth: 'declined' } },
      { name: 'nothing known', input: { schoolClass: null, birth: null } },
    ];
    golden('age_band', { version: 1, today, cases: cases.map((c) => ({ ...c, expected: resolveAgeBand(c.input, today) })) });
  });

  it('little_learner', () => {
    const today = '2026-10-30';
    const facts = [
      { ageBand: 'u10', schoolClass: 3, managedChild: true },
      { ageBand: 'u10', schoolClass: null },
      { ageBand: '10_12', schoolClass: 5 },
      { ageBand: '10_12', schoolClass: 7 },
      { ageBand: '13_17', schoolClass: 8 },
      { ageBand: '18p', schoolClass: null },
      { ageBand: null, schoolClass: null },
    ] as const;
    const experiences = facts.flatMap((f) =>
      [true, false].map((enabled) => ({ facts: f, littleLearnerEnabled: enabled, expected: learnerExperience(f, { littleLearnerEnabled: enabled }) })),
    );
    const plant = (health: (typeof PLANT_HEALTH)[number]) => ({ ...NEW_PLANT, health });
    golden('little_learner', {
      version: 1,
      today,
      experiences,
      gentle_pet: PET_STATES.map((s) => ({ state: s, shown: gentlePetState(s, true) })),
      gentle_plant: PLANT_HEALTH.map((h) => ({ health: h, shown: plantDisplay(plant(h), true).health })),
      time_limits: [
        { limits: { dailyMinutes: 30, allowedHours: { start: '16:00', end: '20:00' } }, used: 10, extra: 0, at: '2026-10-30T17:00:00+05:30', inActivity: false },
        { limits: { dailyMinutes: 30, allowedHours: { start: '16:00', end: '20:00' } }, used: 30, extra: 0, at: '2026-10-30T17:00:00+05:30', inActivity: true },
        { limits: { dailyMinutes: 30, allowedHours: { start: '16:00', end: '20:00' } }, used: 30, extra: 15, at: '2026-10-30T17:00:00+05:30', inActivity: false },
        { limits: { dailyMinutes: 30, allowedHours: { start: '16:00', end: '20:00' } }, used: 0, extra: 0, at: '2026-10-30T20:00:00+05:30', inActivity: false },
        { limits: { dailyMinutes: 0, allowedHours: null }, used: 300, extra: 0, at: '2026-10-30T23:00:00+05:30', inActivity: false },
      ].map((c) => ({
        ...c,
        timeZone: 'Asia/Kolkata',
        expected: timeLimitState(c.limits, { day: today, usedMinutes: c.used, extraMinutes: c.extra, requestsToday: 0 }, { now: c.at, timeZone: 'Asia/Kolkata', inActivity: c.inActivity }),
      })),
    });
  });

  it('activity_completed', () => {
    // One little learner's completions in order (sync contract v1.4). The server must accept,
    // reject and credit them exactly so, and count each accepted one as a lesson on its day.
    const timeZone = 'Asia/Kolkata';
    const base = { topicId: 'fx.chapter-a.topic-a', concepts: ['fx.chapter-a.topic-a.sub-1.concept-1'], locale: 'en', msTotal: 180_000 };
    const steps: { name: string; completion: ActivityCompletionLike }[] = [
      { name: 'a story: one star', completion: { ...base, kind: 'story', activityId: 'sb.fx.topic-a', bundleVersion: 'v1', stars: 1, completedAt: '2026-10-30T04:30:00.000Z' } },
      { name: 'play: a star per round', completion: { ...base, kind: 'play', activityId: 'play.fx.topic-a', bundleVersion: 'v1', stars: 3, completedAt: '2026-10-30T05:00:00.000Z' } },
      { name: 'the same story again that day', completion: { ...base, kind: 'story', activityId: 'sb.fx.topic-a', bundleVersion: 'v1', stars: 1, completedAt: '2026-10-30T12:30:00.000Z' } },
      { name: 'the same story in a new bundle', completion: { ...base, kind: 'story', activityId: 'sb.fx.topic-a', bundleVersion: 'v2', stars: 1, completedAt: '2026-10-30T13:00:00.000Z' } },
      { name: 'a song in Hindi', completion: { ...base, kind: 'song', activityId: 'song.fx.topic-a', bundleVersion: 'v1', stars: 1, locale: 'hi', completedAt: '2026-10-30T13:30:00.000Z' } },
      { name: 'the first story the next local day (still the 30th in UTC)', completion: { ...base, kind: 'story', activityId: 'sb.fx.topic-a', bundleVersion: 'v1', stars: 1, completedAt: '2026-10-30T19:00:00.000Z' } },
    ];
    const seen = new Set<string>();
    const cases = steps.map((step) => {
      const payload = activityCompletedPayload(step.completion);
      const key = activityDedupeKey(payload, timeZone);
      const accepted = !seen.has(key);
      seen.add(key);
      return { name: step.name, completion: step.completion, payload, expected: { accepted, code: accepted ? null : 'already_recorded', xp: accepted ? activityCompletedXp(payload.stars) : 0, dedupe_key: key } };
    });
    const acceptedEvents = cases.filter((c) => c.expected.accepted).map((c) => ({ type: 'activity_completed' as const, occurred_at: c.payload.completed_at }));
    const days = [...activityByDay(acceptedEvents, timeZone)].map(([day, a]) => ({ day, lessons_completed: a.lessonsCompleted }));
    golden('activity_completed', { version: 1, config: { xp_little_activity_star: DEFAULT_LITTLE_ACTIVITY_STAR_XP }, time_zone: timeZone, cases, days });
  });

  it('topic_marks', () => {
    // Test out marks, their undo and a chapter reset (sync contract v1.6), in order, for one
    // student. The server applies the same events to learn.topic_status and must end each step
    // with these rows and codes.
    const chapter = 'fx.chapter-a';
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((x) => `${chapter}.topic-${x}`) as [string, string, string, string];
    const check1 = '0193a000-0000-7000-8000-000000000001';
    const check2 = '0193a000-0000-7000-8000-000000000002';
    const check3 = '0193a000-0000-7000-8000-000000000003';
    const initial: Record<string, TopicMarkRow> = {
      [a]: { status: 'in_progress', learned_via: null },
      [b]: { status: 'learned', learned_via: 'lesson' },
    };
    const ctx: TopicMarkContext = { chapterTopics: { [chapter]: [a, b, c, d] }, checks: {} };
    const steps: { name: string; event: TopicMarkEvent }[] = [
      { name: 'a Test out passes a, b and c (b was already learned)', event: { type: 'topic_tested_out', payload: topicTestedOutPayload(check1, chapter, [a, b, c]) } },
      { name: 'the same check again', event: { type: 'topic_tested_out', payload: topicTestedOutPayload(check1, chapter, [c]) } },
      { name: 'a topic from another chapter', event: { type: 'topic_tested_out', payload: topicTestedOutPayload(check2, chapter, ['fx.chapter-z.topic-a']) } },
      { name: 'Undo this: only the marks the check made', event: { type: 'topic_test_out_undone', payload: topicTestOutUndonePayload(check1, [{ topicId: a, previous: { status: 'in_progress' } }, { topicId: c, previous: null }]) } },
      { name: 'undo of a check that never happened', event: { type: 'topic_test_out_undone', payload: topicTestOutUndonePayload(check2, [{ topicId: a, previous: null }]) } },
      { name: 'a second Test out passes c and d', event: { type: 'topic_tested_out', payload: topicTestedOutPayload(check3, chapter, [c, d]) } },
      { name: 'Reset chapter progress', event: { type: 'chapter_reset', payload: chapterResetPayload(chapter) } },
      { name: 'reset of an unknown chapter', event: { type: 'chapter_reset', payload: chapterResetPayload('fx.chapter-z') } },
    ];
    const rows: Record<string, TopicMarkRow> = structuredClone(initial);
    const cases = steps.map((step) => {
      const code = applyTopicMark(rows, step.event, ctx);
      const sorted = Object.fromEntries(Object.entries(rows).sort(([x], [y]) => x.localeCompare(y)));
      return { name: step.name, type: step.event.type, payload: step.event.payload, expected: { accepted: code === null, code, rows: structuredClone(sorted) } };
    });
    golden('topic_marks', { version: 1, chapter_topics: ctx.chapterTopics, initial, cases });
  });

  it('placement_marks', () => {
    // Find my level (sync contract v1.7, learn §6.5), in order, for one student: pre-marks, a
    // redo that replaces unconfirmed marks, a lesson that confirms one, and the checks around
    // Test out and chapter reset. The server must end each step with these rows and codes. The
    // second chapter (fx.chapter-p) is added by the server test for this vector.
    const subject = 'fx';
    const ch1 = 'fx.chapter-a';
    const ch2 = 'fx.chapter-p';
    const [a, b, c] = ['a', 'b', 'c'].map((x) => `${ch1}.topic-${x}`) as [string, string, string];
    const p1 = `${ch2}.topic-a`;
    const p2 = `${ch2}.topic-b`;
    const id = (n: number) => `0193a000-0000-7000-8000-0000000000${20 + n}`;
    const initial: Record<string, TopicMarkRow> = { [c]: { status: 'in_progress', learned_via: null } };
    const ctx: TopicMarkContext = {
      chapterTopics: { [ch1]: [a, b, c, `${ch1}.topic-d`], [ch2]: [p1, p2] },
      subjectTopics: { [subject]: [a, b, c, `${ch1}.topic-d`, p1, p2] },
      checks: {},
      placements: {},
    };
    const lesson = (topic: string, mode: 'deep_dive' | 'quick_check' = 'deep_dive') => ({ topic_id: topic, mode, cards_seen: 6, correct: 4, total: 4, ms_total: 300000 });
    const steps: { name: string; event: TopicMarkEvent; payload?: Record<string, unknown> }[] = [
      { name: 'Find my level pre-marks two chapters (and an in-progress topic stays)', event: { type: 'placement_checked', payload: placementCheckedPayload(id(1), subject, [a, p1, c]) } },
      { name: 'the same check again', event: { type: 'placement_checked', payload: placementCheckedPayload(id(1), subject, [a]) } },
      { name: 'a topic from another subject', event: { type: 'placement_checked', payload: placementCheckedPayload(id(2), subject, ['zz.chapter-x.topic-a']) } },
      { name: 'an unknown subject', event: { type: 'placement_checked', payload: placementCheckedPayload(id(3), 'zz', []) } },
      { name: 'a quick check does not confirm a mark', event: { type: 'lesson_completed', payload: lesson(p1, 'quick_check') }, payload: lesson(p1, 'quick_check') },
      { name: 'a lesson confirms the first chapter\'s mark', event: { type: 'lesson_completed', payload: lesson(a) }, payload: lesson(a) },
      { name: 'a Test out leaves a placement mark alone', event: { type: 'topic_tested_out', payload: topicTestedOutPayload(id(4), ch2, [p1, p2]) } },
      { name: 'a redo with nothing right takes back only unconfirmed marks', event: { type: 'placement_checked', payload: placementCheckedPayload(id(5), subject, []) } },
      { name: 'a redo pre-marks again', event: { type: 'placement_checked', payload: placementCheckedPayload(id(6), subject, [b, p1]) } },
      { name: 'Reset chapter progress clears placement marks too', event: { type: 'chapter_reset', payload: chapterResetPayload(ch1) } },
    ];
    const rows: Record<string, TopicMarkRow> = structuredClone(initial);
    const cases = steps.map((step) => {
      const code = applyTopicMark(rows, step.event, ctx);
      const sorted = Object.fromEntries(Object.entries(rows).sort(([x], [y]) => x.localeCompare(y)));
      return { name: step.name, type: step.event.type, payload: step.payload ?? step.event.payload, expected: { accepted: code === null, code, rows: structuredClone(sorted) } };
    });
    golden('placement_marks', { version: 1, subject_topics: ctx.subjectTopics, chapter_topics: ctx.chapterTopics, initial, cases });
  });

  it('test_out_streak', () => {
    // Learn flow Q7: a passed Test out counts toward the streak as one lesson, on the local day it
    // was sent, once per check. A repeated check, an undo and a chapter reset count nothing, and
    // an undo never takes the day back.
    const timeZone = 'Asia/Kolkata';
    const chapter = 'fx.chapter-a';
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((x) => `${chapter}.topic-${x}`) as [string, string, string, string];
    const ids = ['0193a000-0000-7000-8000-000000000011', '0193a000-0000-7000-8000-000000000012', '0193a000-0000-7000-8000-000000000013'] as const;
    const steps: { name: string; at: string; event: TopicMarkEvent }[] = [
      { name: 'only a Test out that day', at: '2026-10-28T05:00:00.000Z', event: { type: 'topic_tested_out', payload: topicTestedOutPayload(ids[0], chapter, [a, b]) } },
      { name: 'the same check again', at: '2026-10-28T06:00:00.000Z', event: { type: 'topic_tested_out', payload: topicTestedOutPayload(ids[0], chapter, [a, b]) } },
      { name: 'Undo this the next day', at: '2026-10-29T05:00:00.000Z', event: { type: 'topic_test_out_undone', payload: topicTestOutUndonePayload(ids[0], [{ topicId: a, previous: null }, { topicId: b, previous: null }]) } },
      { name: 'and a chapter reset', at: '2026-10-29T05:30:00.000Z', event: { type: 'chapter_reset', payload: chapterResetPayload(chapter) } },
      { name: 'two Test outs on one day', at: '2026-10-30T04:00:00.000Z', event: { type: 'topic_tested_out', payload: topicTestedOutPayload(ids[1], chapter, [c]) } },
      { name: 'the second one', at: '2026-10-30T04:30:00.000Z', event: { type: 'topic_tested_out', payload: topicTestedOutPayload(ids[2], chapter, [d]) } },
    ];
    const rows: Record<string, TopicMarkRow> = {};
    const ctx: TopicMarkContext = { chapterTopics: { [chapter]: [a, b, c, d] }, checks: {} };
    const cases = steps.map((step) => {
      const code = applyTopicMark(rows, step.event, ctx);
      return { name: step.name, at: step.at, type: step.event.type, payload: step.event.payload, expected: { accepted: code === null, code } };
    });
    const accepted = cases.filter((x) => x.expected.accepted).map((x) => ({ type: x.type, occurred_at: x.at }));
    const byDay = activityByDay(accepted, timeZone);
    const days = ['2026-10-28', '2026-10-29', '2026-10-30'].map((day) => {
      const activity = byDay.get(day as never) ?? { lessonsCompleted: 0, reviews: 0, mockSections: 0, dailyChallenge: false, rescueDone: false };
      return { day, lessons_completed: activity.lessonsCompleted, qualified: qualifiesDay(activity) };
    });
    golden('test_out_streak', { version: 1, time_zone: timeZone, cases, days });
  });
});
