import { webcrypto } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ALL_TABS,
  LITTLE_LEARNER_TABS,
  NEW_PLANT,
  ageOn,
  bandForAge,
  bandForClass,
  buildLittlePlan,
  canAskForMoreTime,
  currentNodeIndex,
  derivePetState,
  gentlePetState,
  gentleReaction,
  grantMoreTime,
  hashParentPin,
  holdOpensGate,
  isLittleLearnerClass,
  learnerExperience,
  needsParentGate,
  parentGateSteps,
  pathWindow,
  petRiveInputs,
  plantDisplay,
  playNode,
  registerKey,
  resolveAgeBand,
  timeLimitState,
  timeUseFor,
  verifyParentPin,
  widgetSnapshot,
  type CryptoLike,
  type LittlePathNode,
  type PetState,
  type PlantState,
  type WidgetSnapshotInput,
} from '../src';

const crypto = webcrypto as unknown as CryptoLike;

describe('age bands', () => {
  it('maps classes as onboarding §6.2 does (errs young)', () => {
    expect([1, 5, 6, 7, 8, 12].map(bandForClass)).toEqual(['u10', 'u10', '10_12', '10_12', '13_17', '13_17']);
    expect(() => bandForClass(0)).toThrow(RangeError);
    expect(() => bandForClass(13)).toThrow(RangeError);
    expect(isLittleLearnerClass(5)).toBe(true);
    expect(isLittleLearnerClass(6)).toBe(false);
    expect(isLittleLearnerClass(null)).toBe(false);
  });

  it('treats an unknown birth month as the younger option', () => {
    expect(ageOn({ year: 2008 }, '2026-10-30')).toBe(17);
    expect(ageOn({ year: 2008 }, '2026-12-31')).toBe(18);
    expect(ageOn({ year: 2008, month: 10 }, '2026-10-30')).toBe(17);
    expect(ageOn({ year: 2008, month: 10 }, '2026-10-31')).toBe(18);
    expect(ageOn({ year: 2008, month: 9 }, '2026-10-01')).toBe(18);
    expect([9, 10, 12, 13, 17, 18].map(bandForAge)).toEqual(['u10', '10_12', '10_12', '13_17', '13_17', '18p']);
  });

  it('resolves a known age, then class, then the stored band, then "Prefer not to say" (R56)', () => {
    const today = '2026-10-30';
    expect(resolveAgeBand({ schoolClass: 4, birth: { year: 2000 } }, today)).toBe('18p');
    expect(resolveAgeBand({ storedBand: '18p', storedSource: 'self_declared', schoolClass: 12, birth: null }, today)).toBe('18p');
    expect(resolveAgeBand({ storedBand: '18p', storedSource: 'class', schoolClass: 3, birth: null }, today)).toBe('u10');
    expect(resolveAgeBand({ storedBand: '13_17', schoolClass: null, birth: 'declined' }, today)).toBe('13_17');
    expect(resolveAgeBand({ schoolClass: 5, birth: null }, today)).toBe('u10');
    expect(resolveAgeBand({ schoolClass: null, birth: { year: 2018 } }, today)).toBe('u10');
    expect(resolveAgeBand({ schoolClass: null, birth: 'declined' }, today)).toBe('13_17');
    expect(resolveAgeBand({ schoolClass: null, birth: null }, today)).toBeNull();
  });
});

describe('learnerExperience', () => {
  const little = learnerExperience({ ageBand: 'u10', schoolClass: 3, managedChild: true }, { littleLearnerEnabled: true });

  it('gives a class 1–5 child the little learner experience in Phase 3', () => {
    expect(little).toMatchObject({
      littleLearner: true,
      gentle: true,
      register: 'tum',
      home: 'HOME-06',
      tabs: LITTLE_LEARNER_TABS,
      showPrices: false,
      paywall: 'ask_grown_up',
      tutorButton: false,
      tutorVariant: 'chips_only',
      search: false,
      gems: false,
      leagues: false,
      examSwitcher: false,
      topicModeChoice: false,
      socialDeepLinks: false,
      signIn: 'parent',
      analytics: 'learning_only',
      readAloud: true,
      mnemonicForge: false,
      timeLimits: true,
      defaultTheme: 'light',
    });
  });

  it('lets the parent turn on the tutor button and Picture rhymes', () => {
    const on = learnerExperience(
      { ageBand: 'u10', schoolClass: 2 },
      { littleLearnerEnabled: true, parent: { tutorButton: true, pictureRhymes: true } },
    );
    expect(on.tutorButton).toBe(true);
    expect(on.mnemonicForge).toBe(true);
  });

  it('keeps u10 defaults without the little learner Home before Phase 3', () => {
    const phase1 = learnerExperience({ ageBand: 'u10', schoolClass: null }, { littleLearnerEnabled: false });
    expect(phase1).toMatchObject({ littleLearner: false, gentle: true, register: 'aap', home: 'HOME-01', showPrices: false, analytics: 'learning_only' });
    const classPhase1 = learnerExperience({ ageBand: 'u10', schoolClass: 4 }, { littleLearnerEnabled: false });
    expect(classPhase1.littleLearner).toBe(false);
    expect(classPhase1.tabs).toEqual(['learn', 'labs', 'practice', 'me']);
  });

  it('gives classes 6–8 the standard app with child protections', () => {
    const c7 = learnerExperience({ ageBand: '10_12', schoolClass: 7 }, { littleLearnerEnabled: true });
    expect(c7).toMatchObject({ littleLearner: false, gentle: false, showPrices: true, paywall: 'ask_grown_up', signIn: 'parent', analytics: 'reduced' });
    const c8 = learnerExperience({ ageBand: '13_17', schoolClass: 8 }, { littleLearnerEnabled: true, friendsEnabled: true });
    expect(c8).toMatchObject({ paywall: 'standard', signIn: 'self', tabs: ALL_TABS });
    const adult = learnerExperience({ ageBand: '18p', schoolClass: null }, { littleLearnerEnabled: true });
    expect(adult.analytics).toBe('full');
    expect(adult.tabs).not.toContain('friends');
  });
});

describe('registerKey (R3)', () => {
  const keys = new Set(['learn:HOME-06.little_learner_play', 'learn:LES-08.title_little_learner']);
  const exists = (k: string) => keys.has(k);
  it('prefers the _little_learner variants in the तुम register only', () => {
    expect(registerKey('learn:LES-08.title', 'tum', exists)).toBe('learn:LES-08.title_little_learner');
    expect(registerKey('learn:HOME-06.play', 'tum', exists)).toBe('learn:HOME-06.little_learner_play');
    expect(registerKey('learn:HOME-06.play', 'aap', exists)).toBe('learn:HOME-06.play');
    expect(registerKey('learn:LES-01.title', 'tum', exists)).toBe('learn:LES-01.title');
    expect(registerKey('learn:HOME-06.little_learner_play', 'tum', exists)).toBe('learn:HOME-06.little_learner_play');
  });
});

describe('gentle pet and plant', () => {
  it('never shows a gentle pet below sleepy', () => {
    const all: PetState[] = ['happy', 'content', 'sleepy', 'tired', 'missing_you', 'resting'];
    expect(all.map((s) => gentlePetState(s, true))).toEqual(['happy', 'content', 'sleepy', 'sleepy', 'sleepy', 'sleepy']);
    expect(all.map((s) => gentlePetState(s, false))).toEqual(all);
    expect(gentlePetState(derivePetState({ mood: 0, energy: 0 }), true)).toBe('sleepy');
    expect(petRiveInputs('resting', true)).toEqual({ state: 'sleepy', under10: true });
  });

  it('maps reactions to the allowed two', () => {
    expect(gentleReaction('proud', true)).toBe('excited');
    expect(gentleReaction('thinking', true)).toBe('curious');
    expect(gentleReaction('curious', true)).toBe('curious');
    expect(gentleReaction('proud', false)).toBe('proud');
  });

  it('stops the plant at droopy and hides the revival quest', () => {
    const wilted: PlantState = { ...NEW_PLANT, health: 'wilted', revivalProgress: 1, growthPoints: 12, stage: 'sapling' };
    expect(plantDisplay(wilted, true)).toEqual({ stage: 'sapling', health: 'droopy', revivalQuest: null, growthPoints: 12 });
    expect(plantDisplay(wilted, false).health).toBe('wilted');
    expect(plantDisplay(wilted, false).revivalQuest).toEqual({ kind: 'wilted', days: 3, done: 1 });
  });

  it('keeps a resting pet off an under-10 widget', () => {
    const input: WidgetSnapshotInput = {
      now: '2026-10-30T10:00:00Z',
      timeZone: 'Asia/Kolkata',
      locale: 'hi',
      themePref: 'system',
      signedIn: false,
      isUnder10: true,
      streak: 0,
      goalProgress: 0,
      freezeHeld: false,
      restDayToday: false,
      lastActivityDay: null,
      plant: { species: 'tulsi', skin: null, stage: 'sprout', health: 'dormant' },
      pet: { species: 'cat', name: null, state: 'resting', outfit: null },
      healthByMissedDays: { droopy: 1, dry: 3, wilted: 7, dormant: 21 },
      dueCards: 0,
      planItems: [],
      exam: null,
      quietStart: '20:00',
      quietEnd: '08:00',
      eveningHour: null,
    };
    const snap = widgetSnapshot(input);
    expect(snap.pet?.state).toBe('sleepy');
    expect(snap.plant.health).toBe('droopy');
  });
});

describe('little learner path and plan', () => {
  const node = (id: string, kind: LittlePathNode['kind'], extra: Partial<LittlePathNode> = {}): LittlePathNode => ({
    id,
    kind,
    ref: kind === 'story' ? `sb.${id}` : `t.${id}`,
    minutes: 3,
    done: false,
    locked: false,
    available: true,
    ...extra,
  });
  const nodes = [
    node('a', 'story', { done: true }),
    node('b', 'song'),
    node('c', 'lesson'),
    node('d', 'story', { locked: true }),
    node('e', 'story', { available: false }),
    node('f', 'lesson'),
    node('g', 'lesson'),
    node('h', 'lesson'),
    node('i', 'lesson'),
  ];

  it('puts the pet on the first playable node and keeps it in a 7-node window', () => {
    expect(currentNodeIndex(nodes)).toBe(2);
    const w = pathWindow(nodes, 7);
    expect(w.nodes).toHaveLength(7);
    expect(w.start).toBe(1);
    expect(w.nodes.map((n) => n.id)).toContain('c');
  });

  it('plays, asks a grown-up, or says it needs internet', () => {
    expect(playNode(nodes[2]!, true)).toEqual({ kind: 'open', route: 'LES-01', ref: 't.c' });
    expect(playNode(nodes[0]!, true)).toEqual({ kind: 'open', route: 'LRN-11', ref: 'sb.a' });
    expect(playNode(nodes[1]!, true)).toEqual({ kind: 'not_ready' });
    expect(playNode(nodes[3]!, true)).toEqual({ kind: 'ask_grown_up' });
    expect(playNode(nodes[4]!, false)).toEqual({ kind: 'needs_internet' });
    expect(playNode(nodes[4]!, true).kind).toBe('open');
  });

  it('plans picture-card reviews, then playable unlocked nodes up to the goal', () => {
    const plan = buildLittlePlan({ day: '2026-10-30', goalMinutes: 5, nodes, reviewsDue: 4, secondsPerCard: 15 });
    expect(plan.items.map((i) => i.id)).toEqual(['review', 'lesson:c', 'story:e']);
    expect(plan.totalMinutes).toBe(7);
    const none = buildLittlePlan({ day: '2026-10-30', goalMinutes: 5, nodes: [], reviewsDue: 0, secondsPerCard: 15 });
    expect(none.items).toEqual([]);
  });
});

describe('parent mode', () => {
  const little = learnerExperience({ ageBand: 'u10', schoolClass: 3 }, { littleLearnerEnabled: true });
  const teen = learnerExperience({ ageBand: '13_17', schoolClass: 9 }, { littleLearnerEnabled: true });
  const tween = learnerExperience({ ageBand: '10_12', schoolClass: 6 }, { littleLearnerEnabled: true });

  it('gates a little learner’s account, money and settings actions', () => {
    for (const a of ['buy', 'sign_in', 'change_settings', 'time_limits', 'delete_account', 'export_data'] as const) {
      expect(needsParentGate(a, little, { askBeforeSwitching: false })).toBe(true);
      expect(needsParentGate(a, teen, { askBeforeSwitching: false })).toBe(false);
    }
    expect(needsParentGate('buy', tween, { askBeforeSwitching: false })).toBe(true);
    expect(needsParentGate('switch_profile', teen, { askBeforeSwitching: true })).toBe(true);
    expect(needsParentGate('open_parent_mode', teen, { askBeforeSwitching: false })).toBe(true);
  });

  it('offers sign-in first, then the PIN or the account picker', () => {
    expect(parentGateSteps({ parentLinked: false, pinSet: true })).toEqual(['parent_sign_in']);
    expect(parentGateSteps({ parentLinked: true, pinSet: true })).toEqual(['pin', 'account_picker']);
    expect(parentGateSteps({ parentLinked: true, pinSet: false })).toEqual(['account_picker']);
    expect(holdOpensGate(1999, 2000)).toBe(false);
    expect(holdOpensGate(2000, 2000)).toBe(true);
  });

  it('checks the PIN and locks after repeated failures', async () => {
    await expect(hashParentPin(crypto, '12a4')).rejects.toThrow(RangeError);
    const stored = await hashParentPin(crypto, '4821');
    expect(stored.hash).not.toContain('4821');
    let attempts = { failures: 0, lockedUntilMs: null as number | null };
    const ok = await verifyParentPin(crypto, stored, '4821', attempts, 0);
    expect(ok.ok).toBe(true);
    for (let i = 0; i < 5; i++) {
      const r = await verifyParentPin(crypto, stored, '0000', attempts, 1000, { maxFailures: 5, lockMs: 60_000 });
      attempts = r.attempts;
    }
    expect(attempts.lockedUntilMs).toBe(61_000);
    expect((await verifyParentPin(crypto, stored, '4821', attempts, 2000)).locked).toBe(true);
    expect((await verifyParentPin(crypto, stored, '4821', attempts, 61_000)).ok).toBe(true);
  });

  it('enforces daily limits and allowed hours, letting the current card finish', () => {
    const tz = 'Asia/Kolkata';
    const limits = { dailyMinutes: 30, allowedHours: { start: '16:00', end: '20:00' } };
    const use = timeUseFor(null, '2026-10-30');
    const at = (hhmm: string) => `2026-10-30T${hhmm}:00+05:30`;
    expect(timeLimitState(limits, { ...use, usedMinutes: 10 }, { now: at('17:00'), timeZone: tz, inActivity: false })).toEqual({ kind: 'ok', minutesLeft: 20 });
    expect(timeLimitState(limits, { ...use, usedMinutes: 30 }, { now: at('17:00'), timeZone: tz, inActivity: true })).toEqual({ kind: 'finish_current', reason: 'daily_limit' });
    expect(timeLimitState(limits, { ...use, usedMinutes: 30 }, { now: at('17:00'), timeZone: tz, inActivity: false })).toEqual({ kind: 'times_up', reason: 'daily_limit' });
    expect(timeLimitState(limits, use, { now: at('21:00'), timeZone: tz, inActivity: false })).toEqual({ kind: 'times_up', reason: 'outside_hours' });
    const more = grantMoreTime({ ...use, usedMinutes: 30 }, 15);
    expect(timeLimitState(limits, more, { now: at('17:00'), timeZone: tz, inActivity: false })).toEqual({ kind: 'ok', minutesLeft: 15 });
    expect(timeLimitState({ dailyMinutes: 0, allowedHours: null }, { ...use, usedMinutes: 500 }, { now: at('23:00'), timeZone: tz, inActivity: false })).toEqual({ kind: 'ok', minutesLeft: null });
    // A new day resets the counters.
    expect(timeLimitState(limits, { ...use, usedMinutes: 30 }, { now: '2026-10-31T17:00:00+05:30', timeZone: tz, inActivity: false })).toEqual({ kind: 'ok', minutesLeft: 30 });
  });

  it('asks for more time online, up to the daily cap', () => {
    const use = timeUseFor(null, '2026-10-30');
    expect(canAskForMoreTime(use, true, 3)).toEqual({ kind: 'can_ask' });
    expect(canAskForMoreTime(use, false, 3)).toEqual({ kind: 'needs_internet' });
    expect(canAskForMoreTime({ ...use, requestsToday: 3 }, true, 3)).toEqual({ kind: 'limit_reached' });
  });
});
