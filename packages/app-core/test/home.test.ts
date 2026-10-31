import { createFlags } from '@smriti/config';
import { describe, expect, it } from 'vitest';

import {
  EMPTY_SOFT_RECORD,
  MemoryKeyValueStore,
  SoftPromptBudget,
  billingBanner,
  buildLocalPlan,
  bumpUsage,
  countsTowardPracticeQuota,
  decideSoftPrompt,
  firstOpenItem,
  goalProgress,
  isManagedByParent,
  isReportSectionFree,
  lessonAccess,
  lessonEndExtra,
  memoryConfigFromFlags,
  mockAccess,
  mockWeekStart,
  planDone,
  planManagedIn,
  practiceQuota,
  proAccess,
  readAloudQuota,
  reconcileUsage,
  recordLater,
  recordShown,
  sectionalMockQuota,
  selectHero,
  selectSecondary,
  sizePracticeSession,
  softPromptConfig,
  streakRiskHour,
  tutorQuota,
  usageFor,
  type HeroInput,
  type LessonEndInput,
} from '../src';

const base: HeroInput = {
  today: '2026-10-29',
  hour: 10,
  lessonsBeyondOnboarding: 4,
  todayQualified: false,
  restDayToday: false,
  streakRiskHour: null,
  quietHoursStartHour: 22,
  reviewsDueToday: 0,
  reviewHeroMinCards: null,
  reviewsToQualify: 10,
  todayReviewDone: false,
  comebackChunkWaiting: false,
  dailyChallengeOpen: true,
  dailyChallengeDone: false,
  biteInProgress: null,
  continueMaxAgeDays: null,
  goalRingFull: false,
  planDone: false,
  planTopic: { topicId: 'phy.kin.2', mode: 'deep_dive', minutes: 6 },
  nextTopicInChapter: null,
  learnedTopicForRevision: { topicId: 'phy.kin.1', mode: 'quick_revision', minutes: 3 },
  shortestFreeBite: { topicId: 'chem.mole.1', mode: 'deep_dive', minutes: 4 },
  plantResting: false,
};

describe('selectHero', () => {
  it('start here before the first real lesson', () => {
    expect(selectHero({ ...base, lessonsBeyondOnboarding: 0 })).toEqual({ kind: 'start_here', action: { type: 'lesson', topic: base.planTopic } });
  });

  it('a resting plant points at the shortest bite (revival)', () => {
    expect(selectHero({ ...base, plantResting: true, reviewsDueToday: 50 })).toMatchObject({ kind: 'next_topic', reason: 'revival', action: { topic: base.shortestFreeBite } });
  });

  it('streak saver after the risk hour, fastest qualifier first', () => {
    expect(streakRiskHour(base)).toBe(21);
    expect(streakRiskHour({ streakRiskHour: null, quietHoursStartHour: 0 })).toBe(23);
    const late = { ...base, hour: 21 };
    expect(selectHero({ ...late, reviewsDueToday: 12 })).toMatchObject({ kind: 'streak_saver', saver: 'reviews', action: { type: 'review', count: 10, route: 'MEM-03' } });
    expect(selectHero({ ...late, reviewsDueToday: 4 })).toMatchObject({ saver: 'daily_challenge' });
    const bite = { topicId: 't', mode: 'deep_dive' as const, openedOn: '2026-10-20', minutesLeft: 2 };
    expect(selectHero({ ...late, dailyChallengeOpen: false, biteInProgress: bite })).toMatchObject({ saver: 'finish_bite' });
    expect(selectHero({ ...late, dailyChallengeOpen: false })).toMatchObject({ saver: 'quick_revision' });
    expect(selectHero({ ...late, dailyChallengeOpen: false, learnedTopicForRevision: null })).toMatchObject({ saver: 'shortest_bite' });
    // Not when today already counts, on a rest day, or during an incident.
    expect(selectHero({ ...late, todayQualified: true }).kind).toBe('next_topic');
    expect(selectHero({ ...late, restDayToday: true }).kind).toBe('next_topic');
    expect(selectHero({ ...late, incidentActive: true }).kind).toBe('next_topic');
    expect(selectHero({ ...base, hour: 20 }).kind).toBe('next_topic');
  });

  it('reviews, then continue, then goal met, then next topic', () => {
    expect(selectHero({ ...base, reviewsDueToday: 3 })).toMatchObject({ kind: 'review', action: { count: 3 } });
    expect(selectHero({ ...base, reviewsDueToday: 3, reviewHeroMinCards: 5 }).kind).toBe('next_topic');
    expect(selectHero({ ...base, comebackChunkWaiting: true })).toMatchObject({ kind: 'review', action: { route: 'MEM-02' } });
    const bite = { topicId: 't', mode: 'deep_dive' as const, openedOn: '2026-10-25', minutesLeft: 2 };
    expect(selectHero({ ...base, biteInProgress: bite }).kind).toBe('continue');
    expect(selectHero({ ...base, biteInProgress: bite, continueMaxAgeDays: 3 }).kind).toBe('next_topic');
    expect(selectHero({ ...base, goalRingFull: true, planDone: true }).kind).toBe('goal_met');
    expect(selectHero({ ...base, planTopic: null, nextTopicInChapter: null })).toEqual({ kind: 'next_topic', action: { type: 'none' } });
  });

  it('one quiet secondary row', () => {
    const bite = { topicId: 't', mode: 'deep_dive' as const, openedOn: '2026-10-28', minutesLeft: 2 };
    const withReviews = { ...base, reviewsDueToday: 5, biteInProgress: bite };
    expect(selectSecondary(withReviews, selectHero(withReviews))).toEqual({ kind: 'continue', bite });
    const nextTopic = { ...base, reviewsDueToday: 2, reviewHeroMinCards: 5 };
    expect(selectSecondary(nextTopic, selectHero(nextTopic))).toMatchObject({ kind: 'reviews', count: 2 });
    expect(selectSecondary(base, selectHero(base))).toBeNull();
    expect(selectSecondary({ ...base, fadingTopic: { topicId: 'x', cards: 4 } }, selectHero(base))).toEqual({ kind: 'fading', topicId: 'x', cards: 4 });
  });
});

describe('local plan', () => {
  it('reviews, new topic, drill and mock within the goal; the challenge rides along', () => {
    const plan = buildLocalPlan({
      day: '2026-10-29', goalMinutes: 15, reviewsDue: 30, comebackActive: false, secondsPerCard: 10,
      newTopic: { topicId: 'phy.kin.2', minutes: 6, mode: 'deep_dive' }, drill: { conceptIds: ['k'], minutes: 4 },
      mock: { mockId: 'm1', minutes: 30 }, dailyChallengeOpen: true,
    });
    expect(plan.items.map((i) => i.kind)).toEqual(['review', 'learn', 'drill', 'daily_challenge']);
    expect(plan.items[0]).toMatchObject({ minutes: 5, route: 'MEM-03' });
    expect(plan.totalMinutes).toBe(16);
    const done = new Set(['review']);
    expect(firstOpenItem(plan, done)?.kind).toBe('learn');
    expect(planDone(plan, new Set(plan.items.map((i) => i.id)))).toBe(true);
    expect(goalProgress(5, 10)).toEqual({ fraction: 0.5, met: false });
    expect(goalProgress(12, 10)).toEqual({ fraction: 1, met: true });
  });
});

describe('entitlement', () => {
  const ctx = { now: '2026-10-29T00:00:00Z', online: true, offlineGraceDays: 3 };
  it('pro until the end date; grace keeps Pro; on hold locks it', () => {
    expect(proAccess(null, ctx)).toBe('free');
    expect(proAccess({ plan: 'pro', pro_until: '2026-11-01T00:00:00Z', status: 'active' }, ctx)).toBe('pro');
    expect(proAccess({ plan: 'pro', pro_until: '2026-10-28T00:00:00Z', status: 'active' }, ctx)).toBe('free');
    expect(proAccess({ plan: 'pro', pro_until: '2026-10-28T00:00:00Z', status: 'grace', grace_until: '2026-11-05T00:00:00Z' }, ctx)).toBe('pro');
    expect(proAccess({ plan: 'pro', pro_until: '2026-11-01T00:00:00Z', status: 'on_hold' }, ctx)).toBe('free');
    expect(proAccess({ plan: 'pro', pro_until: null }, ctx)).toBe('pro');
  });
  it('offline: trusted for 3 days past the end, then "connect to check"', () => {
    const ent = { plan: 'pro' as const, pro_until: '2026-10-27T00:00:00Z', status: 'active' as const };
    expect(proAccess(ent, { ...ctx, online: false })).toBe('pro');
    expect(proAccess(ent, { ...ctx, online: false, now: '2026-10-31T00:00:00Z' })).toBe('needs_check');
    expect(billingBanner({ plan: 'pro', pro_until: null, status: 'grace' })).toBe('billing_issue');
    expect(billingBanner({ plan: 'free', pro_until: null })).toBeNull();
  });
  it('managed_in from the server (sync v1.4), else inferred for older servers', () => {
    const pro = { plan: 'pro' as const, pro_until: '2026-11-30T00:00:00Z', status: 'active' as const };
    expect(planManagedIn({ ...pro, source: 'razorpay', managed_in: 'parent' })).toBe('parent');
    expect(isManagedByParent({ ...pro, source: 'razorpay', managed_in: 'parent' })).toBe(true);
    // The server's answer wins over a stale hint.
    expect(planManagedIn({ ...pro, source: 'razorpay', managed_in: 'web' }, { payer: 'guardian' })).toBe('web');
    // Older server: no managed_in, so payer = guardian means Parent mode manages it.
    expect(planManagedIn({ ...pro, source: 'razorpay' }, { payer: 'guardian' })).toBe('parent');
    expect(planManagedIn({ ...pro, source: 'razorpay' }, { payer: 'self' })).toBe('web');
    expect(planManagedIn({ ...pro, source: 'play' })).toBe('play');
    expect(planManagedIn({ ...pro, source: 'family' })).toBe('family');
    expect(planManagedIn({ ...pro, source: 'promo' })).toBe('none');
    expect(planManagedIn({ plan: 'free', pro_until: null }, { payer: 'guardian' })).toBe('none');
    expect(planManagedIn(null)).toBe('none');
    expect(isManagedByParent({ ...pro, source: 'razorpay' })).toBe(false);
  });
});

describe('free limits (R16, R25, R35)', () => {
  it('practice: 30 a day; sessions are sized to what is left', () => {
    const q = practiceQuota(25, false);
    expect(q).toMatchObject({ limit: 30, remaining: 5, allowed: true });
    expect(sizePracticeSession(10, q)).toBe(5);
    expect(practiceQuota(30, false).allowed).toBe(false);
    expect(practiceQuota(300, true)).toMatchObject({ unlimited: true, allowed: true });
    expect(countsTowardPracticeQuota('drill')).toBe(true);
    expect(countsTowardPracticeQuota('review')).toBe(false);
    expect(countsTowardPracticeQuota('lesson')).toBe(false);
  });

  it('tutor: 5 a day free; Pro fair-use cap is an owner flag (unset = no cap)', () => {
    expect(tutorQuota(5, false)).toMatchObject({ allowed: false, remaining: 0 });
    expect(tutorQuota(500, true)).toMatchObject({ unlimited: true });
    expect(tutorQuota(50, true, createFlags({ 'pro.tutor_messages_per_day': 50 }))).toMatchObject({ allowed: false });
    expect(readAloudQuota(99)).toMatchObject({ unlimited: true });
  });

  it('deep dive preview: first 2 chapters and rotating chapters are free, else 4 cards', () => {
    const input = { mode: 'deep_dive' as const, chapterIndexInSubject: 2, chapterId: 'ch3', rotatingFreeChapters: [], isPro: false };
    expect(lessonAccess(input)).toEqual({ kind: 'preview', cards: 4 });
    expect(lessonAccess({ ...input, chapterIndexInSubject: 1 })).toEqual({ kind: 'full' });
    expect(lessonAccess({ ...input, rotatingFreeChapters: ['ch3'] })).toEqual({ kind: 'full' });
    expect(lessonAccess({ ...input, mode: 'quick_revision' })).toEqual({ kind: 'full' });
    expect(lessonAccess({ ...input, isPro: true })).toEqual({ kind: 'full' });
  });

  it('one sectional mock a week, the week rolling at Monday 00:00 IST', () => {
    expect(mockWeekStart('2026-11-01T18:29:00Z')).toBe('2026-10-26'); // Sunday 23:59 IST
    expect(mockWeekStart('2026-11-01T18:30:00Z')).toBe('2026-11-02'); // Monday 00:00 IST
    expect(sectionalMockQuota(1, false).allowed).toBe(false);
    const m = { isPro: false, isFreeSample: false, sectionalStartedThisWeek: 0 };
    expect(mockAccess({ ...m, kind: 'sectional' })).toEqual({ ok: true });
    expect(mockAccess({ ...m, kind: 'sectional', sectionalStartedThisWeek: 1 })).toEqual({ ok: false, paywallSource: 'mock_lock' });
    expect(mockAccess({ ...m, kind: 'full' })).toEqual({ ok: false, paywallSource: 'mock_lock' });
    expect(mockAccess({ ...m, kind: 'full', isFreeSample: true })).toEqual({ ok: true });
    expect(mockAccess({ ...m, kind: 'live' })).toEqual({ ok: false, paywallSource: 'live_mock' });
    expect(mockAccess({ ...m, kind: 'pyq_paper', paperId: 'p1' }, createFlags({ 'free.pyq_papers_free': ['p1'] }))).toEqual({ ok: true });
    expect(mockAccess({ ...m, kind: 'custom', isPro: true })).toEqual({ ok: true });
    expect(isReportSectionFree('fix_next_top', false)).toBe(true);
    expect(isReportSectionFree('percentile', false)).toBe(false);
  });

  it('usage counters reset at local midnight and reconcile with the server', () => {
    let c = bumpUsage(undefined, '2026-10-29', 'practiceQuestions', 3);
    c = bumpUsage(c, '2026-10-29', 'tutorMessages');
    expect(c).toEqual({ day: '2026-10-29', practiceQuestions: 3, tutorMessages: 1, readAloud: 0 });
    expect(usageFor(c, '2026-10-30').practiceQuestions).toBe(0);
    expect(reconcileUsage(c, { day: '2026-10-29', practiceQuestions: 7 })).toMatchObject({ practiceQuestions: 7, tutorMessages: 1 });
    expect(reconcileUsage(c, { day: '2026-10-28', practiceQuestions: 7 })).toBe(c);
  });
});

describe('soft-login budget (R29)', () => {
  const ctx = { now: '2026-10-29T10:00:00Z', signedIn: false, managed: false, midActivity: false };
  const cfg = softPromptConfig();

  it('defaults: 7-day cooldown, 2 Laters, 14-day pause', () => {
    expect(cfg).toEqual({ cooldownDays: 7, laterLimit: 2, pauseDays: 14 });
  });

  it('pop-ups respect the cooldown per reason and the pause; taps ignore both', () => {
    let r = recordShown(EMPTY_SOFT_RECORD, 'lesson_3', ctx.now);
    expect(decideSoftPrompt(r, 'lesson_3', { ...ctx, now: '2026-11-04T10:00:00Z' })).toEqual({ show: false, cause: 'cooldown' });
    expect(decideSoftPrompt(r, 'lesson_3', { ...ctx, now: '2026-11-05T10:00:00Z' })).toEqual({ show: true });
    expect(decideSoftPrompt(r, 'streak_day_2', ctx)).toEqual({ show: true });
    r = recordLater(recordLater(r, ctx.now), ctx.now);
    expect(r).toMatchObject({ laterCount: 0, pausedUntil: '2026-11-12T10:00:00.000Z' });
    expect(decideSoftPrompt(r, 'streak_day_2', ctx)).toEqual({ show: false, cause: 'paused' });
    expect(decideSoftPrompt(r, 'save_progress', ctx)).toEqual({ show: true });
    expect(decideSoftPrompt(r, 'streak_day_2', { ...ctx, now: '2026-11-12T10:00:01Z' })).toEqual({ show: true });
  });

  it('never mid-activity, for managed learners or when signed in', () => {
    expect(decideSoftPrompt(EMPTY_SOFT_RECORD, 'save_progress', { ...ctx, midActivity: true })).toEqual({ show: false, cause: 'mid_activity' });
    expect(decideSoftPrompt(EMPTY_SOFT_RECORD, 'lesson_3', { ...ctx, managed: true })).toEqual({ show: false, cause: 'managed' });
    expect(decideSoftPrompt(EMPTY_SOFT_RECORD, 'lesson_3', { ...ctx, signedIn: true })).toEqual({ show: false, cause: 'signed_in' });
  });

  it('persists in the key-value store', async () => {
    const store = new MemoryKeyValueStore();
    const budget = new SoftPromptBudget(store);
    expect(await budget.tryShow('lesson_3', ctx)).toEqual({ show: true });
    expect(await budget.tryShow('lesson_3', ctx)).toEqual({ show: false, cause: 'cooldown' });
    await budget.later(ctx.now);
    expect((await new SoftPromptBudget(store).read()).laterCount).toBe(1);
    await store.set('auth.soft_prompt.v1', '{broken');
    expect(await budget.read()).toEqual(EMPTY_SOFT_RECORD);
    await budget.clear();
    expect(await store.get('auth.soft_prompt.v1')).toBeNull();
  });

  it('lesson-end extra order (R15)', () => {
    const i: LessonEndInput = { lessonsCompleted: 3, deferredOnboardingPending: false, isGuest: true, littleLearner: false, ageBand: '13_17', isPro: false, softPromptAllowed: true, daysSinceInstall: 5, upsellsShownToday: 0 };
    expect(lessonEndExtra({ ...i, deferredOnboardingPending: true })).toBe('reminder');
    expect(lessonEndExtra(i)).toBe('soft_login');
    expect(lessonEndExtra({ ...i, softPromptAllowed: false })).toBe('none');
    expect(lessonEndExtra({ ...i, littleLearner: true, ageBand: 'u10' })).toBe('grown_up');
    expect(lessonEndExtra({ ...i, lessonsCompleted: 5 })).toBe('upsell');
    expect(lessonEndExtra({ ...i, lessonsCompleted: 5, daysSinceInstall: 2 })).toBe('none');
    expect(lessonEndExtra({ ...i, lessonsCompleted: 5, ageBand: '10_12' })).toBe('none');
    expect(lessonEndExtra({ ...i, lessonsCompleted: 10, upsellsShownToday: 2 })).toBe('none');
  });
});

describe('memory config', () => {
  it('reads the memory flags', () => {
    const m = memoryConfigFromFlags();
    expect(m.queue).toEqual({ newCardsPerDay: 15, dailyReviewCap: 200 });
    expect(m.comeback).toMatchObject({ minDue: 60, relearnBelow: 0.5, planLengths: [3, 5, 7], sessionSize: 20 });
    expect(m.rescueCards).toBe(5);
  });
});
