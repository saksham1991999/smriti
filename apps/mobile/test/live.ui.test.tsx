/**
 * Live mocks (MOCK-03 room, registration, countdown; MOCK-24 leaderboard) through the real
 * screens on the dev fake API, with the API's rules: Pro to register, the status on the
 * server's clock, ranks frozen after results with the owner-set minimum.
 */
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';

import { provideAppForTests } from '../src/services/device';
import { onboardAdult } from './features.helpers';
import { createTestApp, type TestRig } from './harness';

jest.setTimeout(60_000);

const appDir = path.join(__dirname, '..', 'app');
const FLAGS = { 'feature.live_mocks': true, 'live.enabled': true, 'live.room_lead_min': 30 };
let rig: TestRig;

beforeEach(() => {
  rig = createTestApp({ variant: 'all' });
  provideAppForTests(rig.app);
});

afterEach(() => {
  rig.app.stop();
  provideAppForTests(null);
});

const me = () => [...rig.fake.users.values()].find((u) => u.id === rig.app.store.getState().session.userId)!;

function schedule(startInMin: number) {
  const now = rig.clock.now;
  return rig.fake.features.live.schedule({
    id: 'live.fx.2026-11',
    title: { en: 'Fixture live mock', hi: 'Fixture live mock' },
    windowStart: now + startInMin * 60_000,
    windowEnd: now + (startInMin + 240) * 60_000,
    resultsAt: now + (startInMin + 300) * 60_000,
    durationS: 180 * 60,
  });
}

test('a free student sees Unlock with Pro; it opens the paywall', async () => {
  await onboardAdult(rig, FLAGS);
  schedule(10);
  await renderRouter(appDir, { initialUrl: '/live/live.fx.2026-11' });
  expect(await screen.findByTestId('mock03-register', {}, { timeout: 10_000 })).toHaveTextContent('Unlock with Pro');
  expect(screen.getByTestId('mock03-countdown')).toHaveTextContent('Starts in 00:10:00');
  await fireEvent.press(screen.getByTestId('mock03-register'));
  await screen.findByTestId('PAY-01', {}, { timeout: 10_000 });
});

test('Pro: register, count down, and Start now when the window opens', async () => {
  await onboardAdult(rig, FLAGS);
  me().entitlement = { plan: 'pro', pro_until: null, status: 'active' };
  await rig.app.syncNow();
  const mock = schedule(10);
  await renderRouter(appDir, { initialUrl: '/live/live.fx.2026-11' });
  await fireEvent.press(await screen.findByTestId('mock03-register', {}, { timeout: 10_000 }));
  expect(await screen.findByTestId('mock03-registered')).toHaveTextContent('Registered');
  expect(mock.registrations.has(me().id)).toBe(true);
  expect(screen.getByText(/^Start by .+ to get the full 180 minutes\.$/)).toBeTruthy();

  // The window opens on the server's clock: the room flips to Start now.
  rig.clock.advance(10 * 60_000);
  await waitFor(() => expect(screen.getByTestId('mock03-start')).toBeEnabled(), { timeout: 5_000 });
  expect(screen.getByTestId('mock03-countdown')).toHaveTextContent(/^Window closes in 0[34]:/);
});

test('MOCK-24 waits for results, then shows ranks with your row pinned', async () => {
  await onboardAdult(rig, { ...FLAGS, 'mock.min_attempts_for_percentile': 2 });
  await rig.app.continueWithGoogle({ email: 'meera@example.com', name: 'Meera Iyer' });
  const mock = schedule(-300);
  const ravi = rig.fake.addLearner({ name: 'Ravi Kumar', email: 'ravi@example.com', birthYear: 2005 });
  mock.scores.set(ravi.id, 212);
  mock.scores.set(me().id, 180);
  await renderRouter(appDir, { initialUrl: '/live/live.fx.2026-11/leaderboard' });
  expect(await screen.findByTestId('mock24-pending', {}, { timeout: 10_000 })).toHaveTextContent(/^Ranks come out at/);
  screen.unmount();

  rig.fake.features.live.publish(mock.id);
  await renderRouter(appDir, { initialUrl: '/live/live.fx.2026-11/leaderboard' });
  expect(await screen.findByTestId('mock24-meta', {}, { timeout: 10_000 })).toHaveTextContent(/^2 ranked/);
  expect(screen.getByTestId('mock24-row-1')).toHaveTextContent(/Ravi Kumar/);
  expect(screen.getByTestId('mock24-you')).toHaveTextContent(/180/);
});
