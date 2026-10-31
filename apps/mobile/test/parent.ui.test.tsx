/**
 * Parent mode on the child's phone (Phase 3, me-money §4.7) through the real screens on the dev
 * fake API: SET-14 dashboard, SET-15 weekly report, SET-16 limits, the device-side limit opening
 * SET-19, and a time request asked by the child and decided by the parent.
 */
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';

import { deviceLimits } from '../src/features/parent/limits';
import { decideTimeRequest } from '../src/features/parent/services';
import { parentSession } from '../src/features/parent/session';
import { provideAppForTests } from '../src/services/device';
import { createTestApp, type TestRig } from './harness';
import { onboardLittle } from './features.helpers';

jest.setTimeout(60_000);

const appDir = path.join(__dirname, '..', 'app');
let rig: TestRig;

/** A little learner with 12 minutes of lessons today and a parent signed in on the same phone. */
async function setUp(r: TestRig) {
  await onboardLittle(r);
  const { app } = r;
  await app.record('lesson_completed', { topic_id: 'fx.chapter-a.topic-a', mode: 'deep_dive', cards_seen: 8, correct: 4, total: 5, ms_total: 12 * 60_000, xp: 20 });
  await app.syncNow();
  const session = parentSession(app);
  expect(await session.signIn({ email: 'asha.parent@example.com', name: 'Asha' })).toBe('ok');
  const guardian = [...r.fake.users.values()].find((u) => u.email === 'asha.parent@example.com')!;
  r.fake.features.parent.link(guardian.id, app.store.getState().session.userId!, 'Meera');
  return { session };
}

beforeEach(() => {
  rig = createTestApp({ variant: 'all' });
  provideAppForTests(rig.app);
});

afterEach(() => {
  rig.app.stop();
  provideAppForTests(null);
});

test('parent screens need the gate', async () => {
  await onboardLittle(rig);
  await renderRouter(appDir, { initialUrl: '/parent' });
  await screen.findByTestId('SET-13', {}, { timeout: 10_000 });
});

test('SET-14 shows the child from the guardian API, SET-15 the week, SET-16 saves a limit', async () => {
  await setUp(rig);
  await renderRouter(appDir, { initialUrl: '/parent' });
  await screen.findByTestId('SET-14', {}, { timeout: 10_000 });
  expect(await screen.findByText('Meera')).toBeTruthy();
  expect(screen.getByTestId('set14-week-minutes')).toHaveTextContent(/12 min this week/);
  // The guardian calls carried the parent's token, not the child's.
  expect(rig.fake.log.some((l) => l.path === '/v1/guardian/dashboard' && l.status === 200)).toBe(true);

  await fireEvent.press(screen.getByTestId('set14-report'));
  await screen.findByTestId('SET-15');
  expect(await screen.findByTestId('set15-minutes')).toHaveTextContent(/^12/);
  expect(screen.getByText(/Chats, notes and anything Meera types stay private/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('back'));

  await fireEvent.press(await screen.findByTestId('set14-limits'));
  await screen.findByTestId('SET-16');
  await fireEvent.press(await screen.findByText('15 minutes'));
  await fireEvent.press(screen.getByTestId('set16-save'));
  expect(await screen.findByTestId('set16-saved')).toHaveTextContent(/It applies on this phone now/);
  const childId = rig.app.store.getState().session.userId!;
  expect(rig.fake.features.parent.controls.get(childId)?.daily_limit_min).toBe(15);
  // The child's phone picked the limit up at once.
  expect(deviceLimits(rig.app).timeLimits()).toEqual({ dailyMinutes: 15, allowedHours: null });
});

test('the limit opens SET-19; the child asks for 15 more and the parent allows it', async () => {
  const { session } = await setUp(rig);
  const childId = rig.app.store.getState().session.userId!;
  rig.fake.features.parent.setControls(childId, { daily_limit_min: 15 });
  session.exit();
  const limits = deviceLimits(rig.app);
  await limits.refresh();
  await limits.addMinutes(4); // 12 synced + 4 on the device: past 15
  await renderRouter(appDir, { initialUrl: '/learn' });
  await screen.findByTestId('SET-19', {}, { timeout: 10_000 });
  expect(screen.getByTestId('set19-title')).toHaveTextContent('Bholu is sleepy');
  expect(screen.getByTestId('set19-body')).toHaveTextContent(/That's today's study time/);

  await fireEvent.press(screen.getByTestId('set19-ask'));
  expect(await screen.findByTestId('set19-status')).toHaveTextContent(/Asked\. A grown-up will see it/);
  const req = rig.fake.features.parent.requests[0]!;
  expect(req).toMatchObject({ status: 'pending', minutes: 15 });

  // The parent sees it under Needs you and allows it.
  await decideTimeRequest(rig.app, req.id, true);
  await waitFor(() => expect(limits.state(false)).toEqual({ kind: 'ok', minutesLeft: 14 }));
});
