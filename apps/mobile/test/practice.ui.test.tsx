/**
 * Practice, mocks, the tutor and device registration through the real screens on the dev fake
 * API, plus the pure helpers behind them (SSE parsing, answer shapes, deep links).
 */
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';

import { provideAppForTests } from '../src/services/device';
import { routeForLink } from '../src/services/links';
import { parseTutorStream, toServerAnswer, tutorAnswerText } from '../src/services/practice';
import { createTestApp, type TestRig } from './harness';

jest.setTimeout(60_000);

const appDir = path.join(__dirname, '..', 'app');
let rig: TestRig;

/** Onboards a guest through the services so the tabs open. */
async function onboard(r: TestRig) {
  const { app } = r;
  await app.boot();
  await app.ensureSession();
  await app.chooseLocale('en');
  await app.answerGoal(['jee-main-2027'], null);
  await app.answerBirthYear(2008);
  await app.answerLevel('starting');
  await app.nameBuddy('cat', 'Miko');
  await app.plantSeed();
  await app.setDailyGoal(10, true);
  r.notifier.token = 'ExponentPushToken[fake-test-token]';
  await app.answerReminder('19:00');
}

beforeEach(() => {
  rig = createTestApp({ variant: 'jee' });
  provideAppForTests(rig.app);
});

afterEach(() => {
  rig.app.stop();
  provideAppForTests(null);
});

test('registers the push token with /v1/devices after the reminder answer', async () => {
  await onboard(rig);
  await waitFor(() => expect(rig.fake.devices.size).toBe(1));
  const [device] = [...rig.fake.devices.values()];
  expect(device).toEqual({ pushToken: 'ExponentPushToken[fake-test-token]', permission: 'granted' });
});

test('a tapped push reports /v1/notifications/opened with its outbox id', async () => {
  await onboard(rig);
  await renderRouter(appDir, { initialUrl: '/learn' });
  await screen.findByTestId('HOME-01', {}, { timeout: 10_000 });
  await act(() => rig.notifier.tap({ url: '/pro', id: 'outbox-1' }));
  await waitFor(() => expect(rig.fake.opened).toContain('outbox-1'));
  await screen.findByTestId('PAY-01', {}, { timeout: 10_000 });
});

test('practice hub, mocks and a tutor answer through the screens', async () => {
  await onboard(rig);
  await renderRouter(appDir, { initialUrl: '/practice' });
  await screen.findByTestId('PRC-01', {}, { timeout: 10_000 });
  // The hub came from /v1/practice/hub: no challenge published, so no Play button.
  await screen.findByTestId('prc-challenge-unavailable', {}, { timeout: 10_000 });
  expect(rig.fake.log.some((l) => l.path === '/v1/practice/hub' && l.status === 200)).toBe(true);

  await fireEvent.press(screen.getByTestId('prc-tile-mocks'));
  await screen.findByTestId('MOCK-01');
  await screen.findByTestId('mock-empty', {}, { timeout: 10_000 });
  await fireEvent.press(screen.getByTestId('back'));

  await fireEvent.press(await screen.findByTestId('prc-tile-tutor'));
  await screen.findByTestId('AI-02');
  await fireEvent.press(await screen.findByTestId('tutor-chip-0', {}, { timeout: 10_000 }));
  const answer = await screen.findByTestId('tutor-msg-ai', {}, { timeout: 10_000 });
  expect(answer).toHaveTextContent(/\[fake\] Explain a topic/);
});

describe('helpers', () => {
  test('parses the tutor SSE stream as the API writes it', () => {
    const body =
      'event: delta\ndata: {"text": "Hel"}\n\n' +
      'event: delta\ndata: {"text": "lo"}\n\n' +
      'event: citations\ndata: {"items": []}\n\n' +
      'event: quota\ndata: {"used": 1, "limit": 5, "remaining": 4, "unlimited": false}\n\n' +
      'event: done\ndata: {}\n\n';
    const events = parseTutorStream(body);
    expect(tutorAnswerText(events)).toBe('Hello');
    expect(events.find((e) => e.type === 'quota')).toEqual({ type: 'quota', quota: { used: 1, limit: 5, remaining: 4, unlimited: false } });
    expect(tutorAnswerText(parseTutorStream('event: delta\ndata: {"text":"x"}\n\nevent: replace\ndata: {"text":""}\n\n'))).toBe('');
  });

  test('a crisis event carries the helplines the server sent, and nothing else', () => {
    const body =
      'event: safety\ndata: {"kind": "crisis", "helplines": [{"name": "Test line", "number": "000-TEST", "description": "fixture"}, {"name": 5}]}\n\n' +
      'event: done\ndata: {"message_id": "m1"}\n\n';
    const events = parseTutorStream(body);
    expect(events[0]).toEqual({ type: 'safety', kind: 'crisis', helplines: [{ name: 'Test line', number: '000-TEST', description: 'fixture' }], chips: [] });
    expect(events[1]).toEqual({ type: 'done', messageId: 'm1' });
  });

  test("maps lesson-core answers to the API's shapes", () => {
    expect(toServerAnswer({ kind: 'options', optionIds: ['b'] })).toEqual({ kind: 'options', option_ids: ['b'] });
    expect(toServerAnswer({ kind: 'blanks', blanks: [{ blank: 'b1', text: '4' }] })).toEqual({ kind: 'blanks', blanks: [{ blank: 'b1', choice_id: null, text: '4' }] });
  });

  test('routes server deep links to screens the app has', () => {
    expect(routeForLink('/pro/fix')).toBe('/paywall');
    expect(routeForLink('/garden')).toBe('/me');
    expect(routeForLink('smriti-jee://practice')).toBe('/learn');
    expect(routeForLink('smriti-jee:///practice')).toBe('/practice');
    expect(routeForLink('/books/abc')).toBe('/learn');
  });
});
