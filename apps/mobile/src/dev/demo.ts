/**
 * DEV ONLY: demo states for the web preview on the in-app fake API (EXPO_PUBLIC_FAKE_API=1),
 * used for design review screenshots. `?demo=<name>&theme=dark&lang=hi` on the web build seeds
 * the profile through the app's own services and the fake API's test hooks. Never runs against
 * a real API: device.ts calls it only with the fake.
 */
import { router, type Href } from 'expo-router';

import { conceptFor } from '../features/feynman/services';
import { autoPlace, createPalace, loadPalace, palaceSources } from '../features/palace/palaces';
import { startDuel } from '../features/social/services';
import { deviceLimits } from '../features/parent/limits';
import { parentSession } from '../features/parent/session';
import type { SmritiApp } from '../services/app';
import { duelQuestionsFrom } from './duelQuestions';
import type { FakeApiServer } from './fake-api/server';

/** A demo may name the screen to open once it has seeded the state (e.g. a duel's own URL). */
type Demo = (app: SmritiApp, fake: FakeApiServer) => Promise<void | string>;

async function onboard(app: SmritiApp, kind: 'little' | 'adult') {
  await app.ensureSession();
  await app.loadConfig();
  await app.chooseLocale(app.ui.getState().locale);
  if (kind === 'little') {
    await app.answerGoal(['school'], 3);
  } else {
    await app.answerGoal(['jee-main-2027'], null);
    await app.answerBirthYear(2007);
  }
  await app.answerLevel('starting');
  await app.nameBuddy(kind === 'little' ? 'dog' : 'cat', kind === 'little' ? 'Bholu' : 'Miko');
  await app.plantSeed();
  await app.setDailyGoal(10, true);
  await app.answerReminder(null);
}

async function lesson(app: SmritiApp, minutes: number) {
  const topic = app.deps.content.topics(app.ui.getState().locale, app.examProfileId())[0];
  if (!topic) return;
  await app.record('lesson_completed', { topic_id: topic.id, mode: 'deep_dive', cards_seen: 6, correct: 4, total: 5, ms_total: minutes * 60_000, xp: 20 });
  await app.syncNow();
}

async function parentLinked(app: SmritiApp, fake: FakeApiServer) {
  const session = parentSession(app);
  await session.signIn({ email: 'parent@example.com', name: 'Asha' });
  const guardian = [...fake.users.values()].find((u) => u.email === 'parent@example.com');
  const child = app.store.getState().session.userId;
  if (guardian && child) fake.features.parent.link(guardian.id, child, 'Meera');
  return { session, guardian, child };
}

const LITTLE = { 'feature.little_learner': true };
export const PHASE2 = { 'feature.friends': true, 'feature.feynman': true, 'feature.voice_tutor': true, 'feature.live_mocks': true, 'live.enabled': true };

const demos: Record<string, Demo> = {
  little: async (app, fake) => {
    fake.flags = LITTLE;
    await onboard(app, 'little');
    await lesson(app, 6);
  },
  parent: async (app, fake) => {
    fake.flags = LITTLE;
    await onboard(app, 'little');
    await lesson(app, 12);
    const { child } = await parentLinked(app, fake);
    if (child) {
      fake.features.parent.setControls(child, { daily_limit_min: 30 });
      await deviceLimits(app).refresh();
      await deviceLimits(app).ask();
    }
  },
  timesup: async (app, fake) => {
    fake.flags = LITTLE;
    await onboard(app, 'little');
    await lesson(app, 16);
    const { session, child } = await parentLinked(app, fake);
    session.exit();
    if (child) fake.features.parent.setControls(child, { daily_limit_min: 15 });
  },
  adult: async (app, fake) => {
    fake.flags = PHASE2;
    await onboard(app, 'adult');
    await lesson(app, 8);
  },
  social: async (app, fake) => {
    await socialWorld(app, fake);
  },
  // AI-10 and AI-11 with a stand-in grader (the local API has none). The key points are
  // labelled placeholders, not study content: the real ones come from the concept's rubric.
  teach: async (app, fake) => {
    fake.flags = PHASE2;
    await onboard(app, 'adult');
    fake.features.ai.grader = () => ({
      clarity: 72,
      completeness: 50,
      accuracy: 90,
      key_points: [
        { index: 0, text: { en: 'Key point 1 (demo placeholder)', hi: 'मुख्य बिंदु 1 (डेमो)' }, status: 'covered', note: null },
        { index: 1, text: { en: 'Key point 2 (demo placeholder)', hi: 'मुख्य बिंदु 2 (डेमो)' }, status: 'missing', note: null },
      ],
      follow_ups: [],
    });
    const topics = app.deps.content.topics(app.ui.getState().locale, app.examProfileId());
    const topic = topics.find((t) => conceptFor(app, t.id));
    return topic ? `/teach/${topic.id}` : undefined;
  },
  // AI-13 for a free student (voice is a Pro feature) and for Pro with no allowance set.
  voice: async (app, fake) => {
    fake.flags = PHASE2;
    await onboard(app, 'adult');
    return '/voice';
  },
  // MEM-12 with one palace built from a learned topic's list mnemonic (fixture content).
  palace: async (app, fake) => {
    await proAdult(app, fake);
    await learnListTopic(app);
    const [source] = await palaceSources(app);
    if (source) {
      const id = await createPalace(app, { name: 'Home', template: 'home', items: source.items.map((i) => i.ref) });
      const model = await loadPalace(app, id);
      if (model) await autoPlace(app, model);
    }
    return '/palace';
  },
  palacenew: async (app, fake) => {
    await proAdult(app, fake);
    await learnListTopic(app);
    return '/palace/new';
  },
  // MEM-25 from tagged answers, a fading topic and tonight's sleep review (the API's shapes).
  insights: async (app, fake) => {
    await proAdult(app, fake, { 'analytics.min_tagged_answers': 6 });
    const me = app.store.getState().session.userId!;
    const ins = fake.features.insights;
    for (const [c, ok] of [['sure', true], ['sure', true], ['sure', false], ['fifty', true], ['fifty', false], ['guess', true], ['guess', false]] as const) ins.tag(me, c, ok);
    const topic = app.deps.content.topics(app.ui.getState().locale, app.examProfileId())[1];
    if (topic) ins.weak.set(me, [{ topic_id: topic.id, cards: 4, min_retrievability: 0.82 }]);
    ins.sleep.set(me, { eligible: true, bedtime: '22:30:00', source: 'estimate', confidence: 0.8, cards: [] });
    return '/insights';
  },
  insightsempty: async (app, fake) => {
    await proAdult(app, fake, { 'analytics.min_tagged_answers': 20 });
    return '/insights';
  },
  // MOCK-03 before the window, during it, and MOCK-24 after results (scores are demo data).
  live: async (app, fake) => {
    await proAdult(app, fake, { 'live.room_lead_min': 30 });
    liveMock(app, fake, 10);
    return '/live/live.demo';
  },
  livenow: async (app, fake) => {
    await proAdult(app, fake, { 'live.room_lead_min': 30 });
    liveMock(app, fake, -100);
    return '/live/live.demo';
  },
  liveboard: async (app, fake) => {
    await proAdult(app, fake, { 'mock.min_attempts_for_percentile': 3 });
    await app.continueWithGoogle({ email: 'meera@example.com', name: 'Meera Iyer' });
    const m = liveMock(app, fake, -400);
    const me = app.store.getState().session.userId!;
    for (const [name, score] of [['Ravi Kumar', 212], ['Asha Rao', 196], ['Kiran Das', 150]] as const) {
      const u = fake.addLearner({ name, email: `${name.split(' ')[0]!.toLowerCase()}@example.com`, birthYear: 2004 });
      m.scores.set(u.id, score);
    }
    m.scores.set(me, 180);
    fake.features.live.publish(m.id);
    return '/live/live.demo/leaderboard';
  },
  voicepro: async (app, fake) => {
    fake.flags = PHASE2;
    await onboard(app, 'adult');
    const me = [...fake.users.values()].find((u) => u.id === app.store.getState().session.userId);
    if (me) me.entitlement = { plan: 'pro', pro_until: null, status: 'active' };
    return '/voice';
  },
  duel: async (app, fake) => {
    const { ravi } = await socialWorld(app, fake);
    const d = await startDuel(app, { opponentId: ravi });
    fake.features.social.acceptDuelAs(ravi, d.id);
    const key = fake.features.social.currentKey(d.id);
    if (key) fake.features.social.answerAs(app.store.getState().session.userId!, d.id, key, 4000);
    fake.features.social.answerAs(ravi, d.id, ['x'], 6000);
    return `/social/duel/${d.id}`;
  },
};

async function proAdult(app: SmritiApp, fake: FakeApiServer, flags: Record<string, unknown> = {}) {
  fake.flags = { ...PHASE2, ...flags };
  await onboard(app, 'adult');
  const me = [...fake.users.values()].find((u) => u.id === app.store.getState().session.userId);
  if (me) me.entitlement = { plan: 'pro', pro_until: null, status: 'active' };
  await app.syncNow();
}

function liveMock(app: SmritiApp, fake: FakeApiServer, startInMin: number) {
  const now = app.deps.clock();
  return fake.features.live.schedule({
    id: 'live.demo',
    title: { en: 'Fixture live mock', hi: 'फ़िक्स्चर लाइव मॉक' },
    windowStart: now + startInMin * 60_000,
    windowEnd: now + (startInMin + 240) * 60_000,
    resultsAt: now + (startInMin + 300) * 60_000,
    durationS: 180 * 60,
  });
}

/** Marks the first topic whose lesson has a list mnemonic as learned (fixture content). */
async function learnListTopic(app: SmritiApp) {
  const exam = app.examProfileId();
  const locale = app.ui.getState().locale;
  const t = app.deps.content.topics(locale, exam).find((x) => Object.values(app.deps.content.load(locale, x.id, 'deep_dive', exam)?.bundle.mnemonics ?? {}).some((m) => m.decodes_to.length >= 2));
  if (t) await app.deps.stores.storage.topic_status.put({ topic_id: t.id, status: 'learned', learned_via: 'lesson', percent: 100, updated_at: new Date(app.deps.clock()).toISOString() });
}

/**
 * A signed-in adult with three friends: Ravi (an adult, more XP this week), Asha (an adult who
 * hasn't studied today) and a 15-year-old who appears by a nickname (R31). Ravi shares a Duo and
 * Asha sent a preset cheer. Every XP figure comes from these people's own lesson events.
 */
async function socialWorld(app: SmritiApp, fake: FakeApiServer) {
  fake.flags = PHASE2;
  await onboard(app, 'adult');
  await app.continueWithGoogle({ email: 'meera@example.com', name: 'Meera Iyer' });
  await lesson(app, 8);
  const me = app.store.getState().session.userId!;
  const s = fake.features.social;
  const ravi = fake.addLearner({ name: 'Ravi Kumar', email: 'ravi@example.com', birthYear: 2005, species: 'dog', petName: 'Sheru', lessonsXp: [30, 15] });
  const asha = fake.addLearner({ name: 'Asha Rao', email: 'asha@example.com', birthYear: 2006, species: 'cat', petName: 'Mitthu' });
  const teen = fake.addLearner({ name: 'Kabir', email: 'kabir@example.com', birthYear: 2011, species: 'dog', petName: 'Moti', lessonsXp: [10] });
  s.consent.add(teen.id);
  for (const f of [ravi, asha, teen]) s.befriend(me, f.id);
  s.duos.push({ id: 'duo-demo', a: me, b: ravi.id, status: 'active', at: app.deps.clock() });
  s.cheer(asha.id, me, 'cheer', 'message_2');
  s.questions = duelQuestionsFrom(app, 10);
  return { me, ravi: ravi.id };
}

export async function runDemo(app: SmritiApp, fake: FakeApiServer, search: string): Promise<void> {
  const q = new URLSearchParams(search);
  const lang = q.get('lang');
  if (lang === 'hi' || lang === 'en') await app.setLocale(lang);
  const theme = q.get('theme');
  if (theme === 'dark' || theme === 'light') await app.savePrefs({ themePref: theme });
  const name = q.get('demo');
  const demo = name ? demos[name] : undefined;
  const open = demo ? await demo(app, fake) : undefined;
  if (open) setTimeout(() => router.replace(open as Href), 300);
}
