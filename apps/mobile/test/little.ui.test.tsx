/**
 * Little learner mode (Phase 3) through the real screens on the dev fake API: the three-tab
 * shell (R14), HOME-06's path, the gentle pet, the 2-second "For grown-ups" hold, and SET-13's
 * parent sign-in and PIN.
 */
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';

import { gentleMood } from '../src/features/little/LittleHome';
import { loadLittlePath } from '../src/features/little/path';
import { parentSession } from '../src/features/parent/session';
import { provideAppForTests } from '../src/services/device';
import { onboardLittle } from './features.helpers';
import { createTestApp, type TestRig } from './harness';

jest.setTimeout(60_000);

const appDir = path.join(__dirname, '..', 'app');
let rig: TestRig;

beforeEach(() => {
  rig = createTestApp({ variant: 'all' });
  provideAppForTests(rig.app);
});

afterEach(() => {
  rig.app.stop();
  provideAppForTests(null);
});

test('HOME-06 with three tabs, the path and coming-soon song and play nodes', async () => {
  await onboardLittle(rig);
  await renderRouter(appDir, { initialUrl: '/learn' });
  await screen.findByTestId('HOME-06', {}, { timeout: 10_000 });
  // R14: Learn, Labs, Me.
  const bar = screen.getByTestId('tab-bar');
  expect(bar).toHaveTextContent(/Learn/);
  expect(bar).not.toHaveTextContent(/Practice/);
  expect(screen.getByTestId('little-line')).toHaveTextContent('Ready for an adventure?');

  const model = await loadLittlePath(rig.app, null);
  const kinds = model.nodes.map((n) => n.kind);
  expect(kinds.slice(-2)).toEqual(['song', 'play']);
  // The song node is shown but never opens: the pet says it is coming.
  const songIndex = model.nodes.length - 2;
  await fireEvent.press(await screen.findByTestId(`little-node-${songIndex}`));
  expect(screen.getByTestId('little-line')).toHaveTextContent('Coming soon!');

  // [Play] opens the current lesson in the player.
  await fireEvent.press(screen.getByTestId('little-play'));
  await screen.findByTestId('LES-01', {}, { timeout: 10_000 });
});

test('without the flag a class 3 child keeps HOME-01 and still has no Practice tab', async () => {
  await onboardLittle(rig, {});
  await renderRouter(appDir, { initialUrl: '/learn' });
  await screen.findByTestId('HOME-01', {}, { timeout: 10_000 });
  expect(screen.getByTestId('tab-bar')).not.toHaveTextContent(/Practice/);
});

test('the grown-ups button needs a hold, then SET-13 signs the parent in and sets a PIN', async () => {
  await onboardLittle(rig);
  await renderRouter(appDir, { initialUrl: '/learn' });
  const hold = await screen.findByTestId('grown-ups-hold', {}, { timeout: 10_000 });
  // A tap never opens it.
  await fireEvent.press(hold);
  expect(screen.queryByTestId('SET-13')).toBeNull();
  await fireEvent(hold, 'pressIn');
  rig.clock.advance(2_100);
  await fireEvent(hold, 'longPress');
  await screen.findByTestId('SET-13');
  expect(screen.getByTestId('set13-hand-over')).toHaveTextContent('Please give the phone to a parent.');

  // First time on this device: the parent's own Google sign-in (the dev form locally).
  await fireEvent.press(screen.getByTestId('set13-google'));
  await fireEvent.changeText(screen.getByTestId('set13-dev-email'), 'asha.parent@example.com');
  await fireEvent.changeText(screen.getByTestId('set13-dev-name'), 'Asha Rao');
  await fireEvent.press(screen.getByTestId('set13-dev-submit'));
  await fireEvent.changeText(await screen.findByTestId('set13-pin'), '4826');
  await fireEvent.press(screen.getByTestId('set13-pin-submit'));

  const session = parentSession(rig.app);
  await waitFor(() => expect(session.store.getState()).toMatchObject({ linked: true, pinSet: true, unlocked: true, name: 'Asha' }));
  // The parent's session is separate: the child is still the device user.
  const childId = rig.app.store.getState().session.userId;
  const guardian = [...rig.fake.users.values()].find((u) => u.email === 'asha.parent@example.com');
  expect(guardian?.id).not.toBe(childId);
  expect(rig.app.store.getState().session.isGuest).toBe(true);
});

test('a returning parent sees Continue as and the PIN, which locks after 5 wrong tries', async () => {
  await onboardLittle(rig);
  const session = parentSession(rig.app);
  await session.signIn({ email: 'asha.parent@example.com', name: 'Asha' });
  await session.setPin('4826');
  session.exit();
  await renderRouter(appDir, { initialUrl: '/grown-ups' });
  expect(await screen.findByTestId('set13-continue', {}, { timeout: 10_000 })).toHaveTextContent('Continue as Asha');
  await fireEvent.press(screen.getByTestId('set13-use-pin'));
  for (let i = 0; i < 4; i++) {
    await fireEvent.changeText(screen.getByTestId('set13-pin'), '1111');
    await fireEvent.press(screen.getByTestId('set13-pin-submit'));
    await screen.findByText("That PIN didn't match.");
  }
  await fireEvent.changeText(screen.getByTestId('set13-pin'), '1111');
  await fireEvent.press(screen.getByTestId('set13-pin-submit'));
  await screen.findByText(/Too many tries/);
  // Even the right PIN waits out the lock.
  await fireEvent.changeText(screen.getByTestId('set13-pin'), '4826');
  await fireEvent.press(screen.getByTestId('set13-pin-submit'));
  await screen.findByText(/Too many tries/);
  expect(session.store.getState().unlocked).toBe(false);
});

test('gentle mood: a tired pet shows sleepy for a little learner, as it is for others', () => {
  expect(gentleMood('tired', true)).toBe('sleepy');
  expect(gentleMood('missing_you', true)).toBe('sleepy');
  expect(gentleMood('content', true)).toBe('happy');
  expect(gentleMood('tired', false)).toBe('sleepy');
});
