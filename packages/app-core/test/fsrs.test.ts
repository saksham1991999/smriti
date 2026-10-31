import { describe, expect, it } from 'vitest';

import {
  SrsScheduler,
  addDays,
  backlogThreshold,
  buildComebackPlan,
  buildDailyQueue,
  buildRescueSet,
  canonicalCardRef,
  cardsQueuedSource,
  comebackChunkFor,
  comebackStartedPayload,
  displayInterval,
  interleaveTopics,
  isLeechMoment,
  median,
  parseCardRef,
  queueCardsForConcepts,
  quickReviewSet,
  ratingFromLabel,
  rescueCompletedPayload,
  rescueOutcome,
  secondsPerCard,
  sessionSlice,
  shouldOfferComeback,
  shouldOfferRescue,
  type ComebackConfig,
  type SrsCardRow,
} from '../src';

const NOW = '2026-10-29T06:00:00.000Z'; // 11:30 IST
const TZ = 'Asia/Kolkata';
const sched = new SrsScheduler({ enableFuzz: false });

/** A review card last seen `daysAgo` days ago with stability `s`, due `dueInDays` from now. */
function reviewCard(ref: string, opts: { s?: number; daysAgo?: number; dueInDays?: number; topic?: string; sibling?: string; state?: 0 | 1 | 2 | 3 } = {}): SrsCardRow {
  const now = Date.parse(NOW);
  return {
    card_ref: ref,
    deck_id: null,
    state: opts.state ?? 2,
    due_at: new Date(now + (opts.dueInDays ?? 0) * 86_400_000).toISOString(),
    stability: opts.s ?? 5,
    difficulty: 5,
    elapsed_days: 0,
    scheduled_days: 5,
    learning_steps: 0,
    reps: 3,
    lapses: 0,
    last_review_at: new Date(now - (opts.daysAgo ?? 5) * 86_400_000).toISOString(),
    suspended: false,
    flags: 0,
    buried_until: null,
    updated_at: NOW,
    topic_id: opts.topic ?? 't1',
    concept_ids: [`k-${opts.topic ?? 't1'}`],
    sibling_key: opts.sibling ?? null,
    introduced_on: null,
  };
}

describe('SrsScheduler', () => {
  it('a new card graduates with Good and lapses with Again', () => {
    let card = sched.newCard('c:a', NOW, { topic_id: 'phy.kin' });
    expect(card).toMatchObject({ state: 0, reps: 0, topic_id: 'phy.kin' });
    const first = sched.schedule(card, 3, NOW);
    expect(first.card.state).toBe(1); // learning step
    expect(first.card.topic_id).toBe('phy.kin'); // local fields kept
    expect(first.fsrsState).toMatchObject({ reps: 1, state: 1 });
    card = first.card;
    const second = sched.schedule(card, 3, first.card.due_at);
    expect(second.card.state).toBe(2);
    expect(second.intervalDays).toBeGreaterThanOrEqual(1);
    const lapse = sched.schedule(second.card, 1, second.card.due_at);
    expect(lapse.card).toMatchObject({ state: 3, lapses: 1 });
    expect(lapse.log.stateBefore).toBe(2);
  });

  it('previews four increasing intervals before the back is shown', () => {
    const card = reviewCard('c:x', { s: 10, daysAgo: 10 });
    const p = sched.preview(card, NOW);
    expect(p.map((x) => x.label)).toEqual(['again', 'hard', 'good', 'easy']);
    expect(p.map((x) => x.rating)).toEqual([1, 2, 3, 4]);
    for (let i = 1; i < 4; i++) expect(p[i]!.intervalMs).toBeGreaterThan(p[i - 1]!.intervalMs);
    // The preview equals what scheduling would do.
    expect(sched.schedule(card, 3, NOW).card.due_at).toBe(p[2]?.due);
  });

  it('is deterministic with fuzz off', () => {
    const a = new SrsScheduler({ enableFuzz: false }).schedule(reviewCard('c:x', { s: 30, daysAgo: 30 }), 3, NOW);
    const b = new SrsScheduler({ enableFuzz: false }).schedule(reviewCard('c:x', { s: 30, daysAgo: 30 }), 3, NOW);
    expect(a.card).toEqual(b.card);
  });

  it('higher target retention means shorter intervals; maximum interval caps', () => {
    const card = reviewCard('c:x', { s: 20, daysAgo: 20 });
    const std = sched.schedule(card, 3, NOW).intervalDays;
    const strict = new SrsScheduler({ enableFuzz: false, requestRetention: 0.95 }).schedule(card, 3, NOW).intervalDays;
    expect(strict).toBeLessThan(std);
    // ts-fsrs clamps to the maximum, then keeps Hard < Good < Easy one day apart.
    const capped = new SrsScheduler({ enableFuzz: false, maximumIntervalDays: 3 }).preview(card, NOW).map((p) => p.intervalMs / 86_400_000);
    expect(capped.slice(1)).toEqual([3, 4, 5]);
  });

  it('retrievability: 0 for new, falls with time', () => {
    expect(sched.retrievability(sched.newCard('c:n', NOW), NOW)).toBe(0);
    const fresh = sched.retrievability(reviewCard('c:a', { s: 5, daysAgo: 1 }), NOW);
    const stale = sched.retrievability(reviewCard('c:a', { s: 5, daysAgo: 30 }), NOW);
    expect(fresh).toBeGreaterThan(stale);
    expect(fresh).toBeLessThanOrEqual(1);
  });

  it('forget resets the schedule to new and keeps the review history counts', () => {
    expect(sched.forget(reviewCard('c:a'), NOW)).toMatchObject({ state: 0, stability: 0, reps: 3, due_at: NOW, card_ref: 'c:a', topic_id: 't1' });
  });

  it('helpers', () => {
    expect(ratingFromLabel('again')).toBe(1);
    expect(ratingFromLabel('easy')).toBe(4);
    expect(displayInterval(10 * 60_000)).toEqual({ value: 10, unit: 'min' });
    expect(displayInterval(5 * 3_600_000)).toEqual({ value: 5, unit: 'h' });
    expect(displayInterval(3 * 86_400_000)).toEqual({ value: 3, unit: 'd' });
    expect(displayInterval(60 * 86_400_000)).toEqual({ value: 2, unit: 'mo' });
    expect(displayInterval(500 * 86_400_000)).toEqual({ value: 1.4, unit: 'y' });
    expect(parseCardRef('c:phy.kin.001')).toEqual({ kind: 'content', id: 'phy.kin.001' });
    expect(parseCardRef('u:abc')).toEqual({ kind: 'user', id: 'abc' });
    expect(parseCardRef('d:abc')).toEqual({ kind: 'user', id: 'abc' });
    expect(parseCardRef('q:1')).toEqual({ kind: 'question', id: '1' });
    expect(parseCardRef('x:1')).toBeNull();
    expect([7, 8, 9, 10, 11, 12].map((l) => isLeechMoment(l, 8))).toEqual([false, true, false, false, false, true]);
  });
});

describe('daily queue', () => {
  const config = { newCardsPerDay: 2, dailyReviewCap: 5 };

  it('due by local end of day, learning first, then lowest recall, then new; capped with rollover', () => {
    const cards = [
      reviewCard('c:strong', { s: 50, daysAgo: 5, dueInDays: 0 }),
      reviewCard('c:weak', { s: 2, daysAgo: 10, dueInDays: -1, topic: 't2' }),
      reviewCard('c:learn', { state: 1, dueInDays: 0, topic: 't3' }),
      reviewCard('c:tonight', { s: 5, dueInDays: 0.5 }), // 23:30 IST: still today
      reviewCard('c:tomorrow', { s: 5, dueInDays: 0.8 }), // after IST midnight
      reviewCard('c:susp', { dueInDays: -1 }),
      { ...sched.newCard('c:new1', NOW), topic_id: 't4' },
      { ...sched.newCard('c:new2', NOW), topic_id: 't5' },
      { ...sched.newCard('c:new3', NOW), topic_id: 't6' },
    ];
    cards[5] = { ...cards[5]!, suspended: true };
    const q = buildDailyQueue({ cards, now: NOW, timeZone: TZ, scheduler: sched, reviewedToday: 0, newIntroducedToday: 1, config });
    expect(q.dueTotal).toBe(4);
    // Priority order is learn, weak, tonight, strong, new1; interleaving splits the two t1 cards.
    expect(q.cards.map((c) => c.card_ref)).toEqual(['c:learn', 'c:weak', 'c:tonight', 'c:new1', 'c:strong']);
    expect(q.newCards).toBe(1);
    expect(q.rolledOver).toBe(0);
    expect(q.tomorrow).toBe('2026-10-30');
    const capped = buildDailyQueue({ cards, now: NOW, timeZone: TZ, scheduler: sched, reviewedToday: 3, newIntroducedToday: 0, config });
    expect(capped.cards).toHaveLength(2);
    expect(capped.rolledOver).toBe(4);
  });

  it('a comeback plan stops new cards; unavailable bundles count as needs internet', () => {
    const cards = [reviewCard('c:a', { dueInDays: -1 }), reviewCard('c:b', { dueInDays: -1 }), sched.newCard('c:n', NOW)];
    const q = buildDailyQueue({
      cards, now: NOW, timeZone: TZ, scheduler: sched, reviewedToday: 0, newIntroducedToday: 0, comebackActive: true,
      isAvailable: (c) => c.card_ref !== 'c:b', config,
    });
    expect(q.cards.map((c) => c.card_ref)).toEqual(['c:a']);
    expect(q.needsInternet).toBe(1);
  });

  it('siblings never on the same day; buried cards wait', () => {
    const cards = [
      reviewCard('c:fwd', { sibling: 's1', dueInDays: -1, s: 1, daysAgo: 9 }),
      reviewCard('c:rev', { sibling: 's1', dueInDays: -1 }),
      { ...reviewCard('c:buried', { dueInDays: -1 }), buried_until: '2026-10-30' },
      { ...reviewCard('c:unburied', { dueInDays: -1 }), buried_until: '2026-10-29' },
    ];
    const q = buildDailyQueue({ cards, now: NOW, timeZone: TZ, scheduler: sched, reviewedToday: 0, newIntroducedToday: 0, config });
    expect(q.cards.map((c) => c.card_ref).sort()).toEqual(['c:fwd', 'c:unburied']);
    expect(q.buryUntilTomorrow).toEqual(['c:rev']);
  });

  it('interleaves topics when the mix allows', () => {
    const order = interleaveTopics([{ topic_id: 'a', n: 1 }, { topic_id: 'a', n: 2 }, { topic_id: 'b', n: 3 }, { topic_id: 'b', n: 4 }]);
    expect(order.map((c) => c.topic_id)).toEqual(['a', 'b', 'a', 'b']);
    expect(sessionSlice([1, 2, 3], 2)).toEqual([1, 2]);
    expect(sessionSlice([1, 2, 3], 'all')).toEqual([1, 2, 3]);
  });

  it('quick review picks the 5 weakest', () => {
    const cards = Array.from({ length: 8 }, (_, i) => reviewCard(`c:${i}`, { s: i + 1, daysAgo: 10 }));
    expect(quickReviewSet(cards, sched, NOW).map((c) => c.card_ref)).toEqual(['c:0', 'c:1', 'c:2', 'c:3', 'c:4']);
  });

  it('queueCardsForConcepts starts unstarted cards and pulls weak ones forward within the cap', () => {
    const cards = [reviewCard('c:weak', { s: 1, daysAgo: 6, dueInDays: 5, topic: 'm' }), reviewCard('c:fine', { s: 100, daysAgo: 1, dueInDays: 50, topic: 'm' })];
    const index = [
      { card_id: 'n1', bundle_id: 'b', topic_id: 'm', concept_ids: ['k-m'] },
      { card_id: 'n2', bundle_id: 'b', topic_id: 'm', concept_ids: ['k-m'] },
      { card_id: 'other', bundle_id: 'b', topic_id: 'x', concept_ids: ['k-x'] },
      { card_id: 'weak', bundle_id: 'b', topic_id: 'm', concept_ids: ['k-m'] },
    ];
    const r = queueCardsForConcepts({ conceptIds: ['k-m'], source: 'mock_report', cards, index, now: NOW, timeZone: TZ, scheduler: sched, targetRetention: 0.9, maxNew: 5, todayQueued: 98, dailyReviewCap: 100 });
    expect(r.started.map((c) => c.card_ref)).toEqual(['c:n1', 'c:n2']);
    expect(r.started.map((c) => c.due_at)).toEqual([NOW, NOW]);
    expect(r.pulledForward.map((c) => c.card_ref)).toEqual(['c:weak']);
    expect(r.pulledForward[0]?.due_at).toBe('2026-10-29T18:30:00.000Z'); // today full → tomorrow 00:00 IST
    expect(r.event).toEqual({ concept_ids: ['k-m'], source: 'practice' });
  });

  it('maps queue origins to the wire cards_queued.source (contract v1.1)', () => {
    expect(['mock_report', 'practice_summary', 'solution', 'lesson', 'comeback'].map((s) => cardsQueuedSource(s as never))).toEqual([
      'practice', 'practice', 'practice', 'lesson', 'comeback',
    ]);
  });

  it('builds the contract v1.1 payloads for rescue and comeback, and canonical card refs', () => {
    expect(rescueCompletedPayload(6.7, 118_400.4)).toEqual({ cards: 6, ms_total: 118_400 });
    expect(rescueCompletedPayload(-1, -5)).toEqual({ cards: 0, ms_total: 0 });
    expect(comebackStartedPayload({ total: 240 }, 12.9)).toEqual({ days_away: 12, cards: 240 });
    expect(canonicalCardRef('u:abc')).toBe('d:abc');
    expect(canonicalCardRef('d:abc')).toBe('d:abc');
    expect(canonicalCardRef('c:u:x')).toBe('c:u:x');
  });
});

describe('comeback plan (R22)', () => {
  const cfg: ComebackConfig = { minDue: 60, relearnBelow: 0.3, firstSession: 10, planLengths: [3, 5, 7], sessionSize: 20, defaultSecondsPerCard: 10 };

  it('backlog rule: max(60, 3 × median of the last 14 active days)', () => {
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(backlogThreshold([], cfg)).toBe(60);
    expect(backlogThreshold(Array(14).fill(30), cfg)).toBe(90);
    expect(shouldOfferComeback(89, Array(14).fill(30), cfg)).toBe(false);
    expect(shouldOfferComeback(90, Array(14).fill(30), cfg)).toBe(true);
    expect(secondsPerCard(Array(49).fill(4000), cfg)).toBe(10);
    expect(secondsPerCard(Array(50).fill(4000), cfg)).toBe(4);
  });

  it('spreads the backlog over the shortest plan that fits the daily goal, core first', () => {
    // 300 due cards, last seen 3 days ago with stability 20 (high recall), half core.
    const backlog = Array.from({ length: 300 }, (_, i) => reviewCard(`c:${String(i).padStart(3, '0')}`, { s: 20, daysAgo: 3, dueInDays: -1, topic: i % 2 ? 'core' : 'side' }));
    const plan = buildComebackPlan({
      backlog, now: NOW, today: '2026-10-29', scheduler: sched, goalMinutes: 10, secondsPerCard: 10,
      isCore: (c) => c.topic_id === 'core', config: cfg,
    });
    expect(plan.dailyChunk).toBe(60);
    expect(plan.planDays).toBe(5);
    expect(plan.chunks).toHaveLength(5);
    expect(plan.chunks[0]?.cardRefs).toHaveLength(60);
    expect(plan.chunks[4]?.day).toBe('2026-11-02');
    expect(plan.chunks[0]?.cardRefs.every((r) => Number(r.slice(2)) % 2 === 1)).toBe(true);
    expect(plan.firstSession).toBeNull();
    expect(comebackChunkFor(plan, '2026-10-30')?.dayIndex).toBe(2);
    expect(comebackChunkFor(plan, '2026-11-03')).toBeNull();
  });

  it('very low recall cards go to relearn topics; a long break starts with a short session', () => {
    const backlog = [
      ...Array.from({ length: 20 }, (_, i) => reviewCard(`c:lost${i}`, { s: 0.01, daysAgo: 365, topic: 'optics' })),
      ...Array.from({ length: 40 }, (_, i) => reviewCard(`c:ok${i}`, { s: 60, daysAgo: 5, topic: 'kin' })),
    ];
    const plan = buildComebackPlan({ backlog, now: NOW, today: '2026-10-29', scheduler: sched, goalMinutes: 5, secondsPerCard: 10, isCore: () => false, longBreak: true, config: cfg });
    expect(plan.relearnTopics).toEqual([{ topicId: 'optics', cardRefs: backlog.slice(0, 20).map((c) => c.card_ref) }]);
    expect(plan.planDays).toBe(3);
    expect(plan.firstSession).toHaveLength(10);
    expect(plan.total).toBe(60);
  });

  it('a backlog too big for 7 days still uses 7 days, and the student can choose', () => {
    const backlog = Array.from({ length: 1000 }, (_, i) => reviewCard(`c:${i}`, { s: 20, daysAgo: 3 }));
    const base = { backlog, now: NOW, today: '2026-10-29', scheduler: sched, goalMinutes: 5, secondsPerCard: 10, isCore: () => false, config: cfg };
    expect(buildComebackPlan(base).planDays).toBe(7);
    expect(buildComebackPlan({ ...base, chosenDays: 3 }).chunks[0]?.cardRefs).toHaveLength(334);
  });
});

describe('2-minute rescue', () => {
  const base = { todayQualified: false, plantThirsty: true, plantHealth: 'thriving' as const, comebackActive: false, littleLearner: false, hasCards: true };

  it('offer rules', () => {
    expect(shouldOfferRescue(base)).toBe(true);
    expect(shouldOfferRescue({ ...base, todayQualified: true })).toBe(false);
    expect(shouldOfferRescue({ ...base, plantThirsty: false })).toBe(false);
    expect(shouldOfferRescue({ ...base, plantThirsty: false, plantHealth: 'dry' })).toBe(true);
    expect(shouldOfferRescue({ ...base, plantHealth: 'dormant' })).toBe(false);
    expect(shouldOfferRescue({ ...base, littleLearner: true })).toBe(false);
    expect(shouldOfferRescue({ ...base, comebackActive: true })).toBe(false);
  });

  it('due cards by lowest recall, topped up with the soonest due', () => {
    const cards = [
      reviewCard('c:due-strong', { s: 50, daysAgo: 2, dueInDays: -0.1 }),
      reviewCard('c:due-weak', { s: 1, daysAgo: 9, dueInDays: -1 }),
      reviewCard('c:soon', { dueInDays: 1 }),
      reviewCard('c:later', { dueInDays: 9 }),
      reviewCard('c:later2', { dueInDays: 10 }),
      reviewCard('c:latest', { dueInDays: 11 }),
      sched.newCard('c:new', NOW),
    ];
    expect(buildRescueSet(cards, NOW, sched).map((c) => c.card_ref)).toEqual(['c:due-weak', 'c:due-strong', 'c:soon', 'c:later', 'c:later2']);
    expect(rescueOutcome(5, 10, true)).toEqual({ streakKept: false, reviewsLeft: 5, freezeWillCover: true });
    expect(rescueOutcome(10, 10, true)).toEqual({ streakKept: true, reviewsLeft: 0, freezeWillCover: false });
  });
});

it('addDays sanity for plan chunks', () => {
  expect(addDays('2026-10-29', 4)).toBe('2026-11-02');
});
