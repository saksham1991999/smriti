/**
 * The whole guest journey through the real screens (expo-router + RNTL), on the dev fake API:
 * welcome → goal → age → level → buddy → seed → first lesson (lesson-player-native on
 * lesson-core) → first win (streak 1) → daily goal → reminder → Home → two more lessons → the soft
 * login sheet (AUTH-01) → dev Google link → paywall → fake store → Pro (from /v1/sync/state).
 */
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';

import { provideAppForTests } from '../src/services/device';
import { createTestApp, type TestRig } from './harness';

jest.setTimeout(120_000);

let rig: TestRig;

beforeEach(() => {
  rig = createTestApp();
  provideAppForTests(rig.app);
});

afterEach(() => {
  rig.app.stop();
  provideAppForTests(null);
});

const appDir = path.join(__dirname, '..', 'app');

async function press(testID: string, timeout = 10_000) {
  const el = await screen.findByTestId(testID, {}, { timeout });
  await fireEvent.press(el);
}

function enabled(id: string) {
  const el = screen.queryByTestId(id);
  if (!el) return null;
  const disabled = el.props.accessibilityState?.disabled ?? el.props['aria-disabled'];
  return disabled ? null : el;
}

/** Plays the lesson on screen: skips tasks, says "I don't know yet" to questions, continues. */
async function playLesson(endID: string) {
  for (let i = 0; i < 120; i++) {
    if (screen.queryByTestId(endID)) return;
    let acted = false;
    for (const id of ['skip-task', 'lesson-got-it', 'confidence-4', 'lesson-dont-know', 'lesson-continue']) {
      const el = enabled(id);
      if (el) {
        await fireEvent.press(el);
        acted = true;
        break;
      }
    }
    if (!acted) await new Promise((r) => setTimeout(r, 25));
  }
  await screen.findByTestId(endID, {}, { timeout: 10_000 });
}

test('guest to Pro through the screens', async () => {
  await rig.app.boot();
  await renderRouter(appDir, { initialUrl: '/' });

  // ONB-01 to ONB-10
  await press('start-en', 20_000);
  await press('goal-jee-main-2027');
  await press('goal-continue');
  await press('birth-decline');
  await press('level-starting');
  await press('level-continue');
  await press('buddy-continue');

  // ONB-12, ONB-13 (the first lesson), ONB-14
  await press('seed-pot');
  await press('seed-start');
  await screen.findByTestId('ONB-13');
  await playLesson('ONB-14');
  expect(screen.getByTestId('first-win-day')).toBeTruthy();
  expect(rig.app.store.getState().streak?.current).toBe(1);
  await press('first-win-continue');
  await press('goal-set');
  await press('reminder-not-now');

  // HOME-01 shows streak 1; the server agrees after a sync
  await screen.findByTestId('HOME-01');
  await act(() => rig.app.syncNow());
  expect(rig.app.store.getState().streak?.current).toBe(1);
  expect(rig.app.store.getState().plant?.study_days).toBe(1);

  // Two more lessons from the Home hero; the third ends with the soft login prompt (R15)
  for (let n = 0; n < 2; n++) {
    rig.clock.advance(60 * 60 * 1000);
    await press('hero');
    await screen.findByTestId('LES-01');
    await playLesson('LES-08');
    await press('lesson-end-continue');
    if (n === 0) await screen.findByTestId('HOME-01');
  }
  await screen.findByTestId('AUTH-01');

  // AUTH-04 (dev Google): links the guest in place, same user id
  const guestId = rig.app.store.getState().session.userId;
  await press('google-button');
  fireEvent.changeText(await screen.findByTestId('dev-email'), 'learner@example.test');
  fireEvent.changeText(screen.getByTestId('dev-name'), 'Learner');
  await press('dev-submit');
  await screen.findByTestId('AUTH-06', {}, { timeout: 15_000 });
  expect(rig.app.store.getState().session).toMatchObject({ status: 'signed_in', userId: guestId });
  await press('auth-done');

  // ME-01 → PAY-01 → fake store → PAY-08 → PAY-09
  await screen.findByTestId('HOME-01');
  await fireEvent.press(screen.getByRole('tab', { name: rig.app.t('me_money:ME-01.title') }));
  await press('pro-card');
  await press('pay-cta');
  await fireEvent.press(await screen.findByText(rig.app.tPending('learn:WEB-01.fake_pay_approve')));
  await screen.findByTestId('PAY-09', {}, { timeout: 20_000 });
  await waitFor(() => expect(rig.app.store.getState().entitlement?.plan).toBe('pro'));
  expect(rig.app.isPro()).toBe(true);
  expect(rig.fake.rejections).toEqual([]);
});
