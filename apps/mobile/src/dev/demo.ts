/**
 * DEV ONLY: demo states for the web preview on the in-app fake API (EXPO_PUBLIC_FAKE_API=1),
 * used for design review screenshots. `?demo=<name>&theme=dark&lang=hi` on the web build seeds
 * the profile through the app's own services and the fake API's test hooks. Never runs against
 * a real API: device.ts calls it only with the fake.
 */
import { deviceLimits } from '../features/parent/limits';
import { parentSession } from '../features/parent/session';
import type { SmritiApp } from '../services/app';
import type { FakeApiServer } from './fake-api/server';

type Demo = (app: SmritiApp, fake: FakeApiServer) => Promise<void>;

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
};

export async function runDemo(app: SmritiApp, fake: FakeApiServer, search: string): Promise<void> {
  const q = new URLSearchParams(search);
  const lang = q.get('lang');
  if (lang === 'hi' || lang === 'en') await app.setLocale(lang);
  const theme = q.get('theme');
  if (theme === 'dark' || theme === 'light') await app.savePrefs({ themePref: theme });
  const name = q.get('demo');
  const demo = name ? demos[name] : undefined;
  if (demo) await demo(app, fake);
}
