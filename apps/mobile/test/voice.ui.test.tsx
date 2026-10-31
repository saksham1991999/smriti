/**
 * Feynman explain-back (AI-10, AI-11), the voice tutor (AI-13 to AI-15) and read-aloud and
 * dictation (`/v1/speech/*`) through the real screens on the dev fake API. Locally the API has
 * no AI keys: grading, voice and speech say they're unavailable, and the screens say so too.
 */
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';

import { readAloud, provideSpeech, transcribe } from '../src/features/speech/speech';
import { conceptFor } from '../src/features/feynman/services';
import { provideVoiceTransport, type VoiceEvents } from '../src/features/voice/session';
import { provideAppForTests } from '../src/services/device';
import { createTestApp, type TestRig } from './harness';
import { onboardAdult } from './features.helpers';

jest.setTimeout(60_000);

const appDir = path.join(__dirname, '..', 'app');
const FLAGS = { 'feature.feynman': true, 'feature.voice_tutor': true };
let rig: TestRig;

beforeEach(() => {
  rig = createTestApp({ variant: 'all' });
  provideAppForTests(rig.app);
});

afterEach(() => {
  rig.app.stop();
  provideAppForTests(null);
});

function topicWithConcept(): string {
  const topics = rig.app.deps.content.topics('en', rig.app.examProfileId());
  const found = topics.find((t) => t.hasDeepDive && conceptFor(rig.app, t.id));
  if (!found) throw new Error('no topic with a concept in the fixture bundles');
  return found.id;
}

test('AI-10 keeps the explanation when grading is unavailable, then AI-11 shows the grade', async () => {
  await onboardAdult(rig, FLAGS);
  const topicId = topicWithConcept();
  await renderRouter(appDir, { initialUrl: `/teach/${topicId}` });
  await screen.findByTestId('AI-10', {}, { timeout: 10_000 });
  expect(screen.getByTestId('ai10-submit')).toBeDisabled();
  const words = Array.from({ length: 32 }, (_, i) => `w${i}`).join(' ');
  await fireEvent.changeText(screen.getByTestId('ai10-text'), words);
  expect(screen.getByTestId('ai10-count')).toHaveTextContent('32 words · at least 30');
  await fireEvent.press(screen.getByTestId('ai10-submit'));
  expect(await screen.findByTestId('ai10-error')).toHaveTextContent(/Your explanation is kept/);
  expect(screen.getByTestId('ai10-text').props.value).toBe(words);

  // With a grader (the API with its AI keys): one key point covered, one missed.
  rig.fake.features.ai.grader = () => ({
    clarity: 72,
    completeness: 50,
    accuracy: 100,
    key_points: [
      { index: 0, text: { en: 'Fixture key point one', hi: 'Fixture key point one' }, status: 'covered', note: null },
      { index: 1, text: { en: 'Fixture key point two', hi: 'Fixture key point two' }, status: 'missing', note: null },
    ],
    follow_ups: ['Fixture follow-up?'],
  });
  await fireEvent.press(screen.getByTestId('ai10-submit'));
  await screen.findByTestId('AI-11');
  expect(screen.getByTestId('ai11-meter-0')).toHaveAccessibleName('Clarity, Clear, 72 out of 100');
  expect(screen.getByTestId('ai11-meter-1')).toHaveAccessibleName('Completeness, Getting there, 50 out of 100');
  expect(screen.getByTestId('ai11-gap-1')).toHaveTextContent(/Fixture key point two/);
  // The explanation went to the grader, never to analytics.
  expect(rig.fake.features.ai.attempts[0]!.explanation).toBe(words);
  await fireEvent.press(screen.getByTestId('ai11-add-gaps'));
  expect(await screen.findByText('Added 1 card to your review.')).toBeTruthy();
});

test('AI-13 says why voice is off and offers text', async () => {
  await onboardAdult(rig, FLAGS);
  await renderRouter(appDir, { initialUrl: '/voice' });
  // A free student: voice is a Pro feature.
  expect(await screen.findByTestId('ai13-body', {}, { timeout: 10_000 })).toHaveTextContent(/comes with Pro/);
  expect(screen.getByTestId('ai13-pro')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('ai13-text'));
  await screen.findByTestId('AI-02', {}, { timeout: 10_000 });
});

test('a Pro student with no daily voice allowance set sees "not ready"', async () => {
  await onboardAdult(rig, FLAGS);
  const user = [...rig.fake.users.values()].find((u) => u.id === rig.app.store.getState().session.userId)!;
  user.entitlement = { plan: 'pro', pro_until: null, status: 'active' };
  await renderRouter(appDir, { initialUrl: '/voice' });
  expect(await screen.findByTestId('ai13-title', {}, { timeout: 10_000 })).toHaveTextContent("Voice isn't ready yet");
  expect(screen.getByTestId('ai13-body')).toHaveTextContent(/ask Miko anything in text/);
});

test('with an allowance and a transport, a session the API cannot mint still ends on the not-ready panel', async () => {
  await onboardAdult(rig, FLAGS);
  const user = [...rig.fake.users.values()].find((u) => u.id === rig.app.store.getState().session.userId)!;
  user.entitlement = { plan: 'pro', pro_until: null, status: 'active' };
  rig.fake.features.ai.voiceDailySeconds = 900;
  let events: VoiceEvents | null = null;
  provideVoiceTransport(rig.app, { available: true, connect: async (_s, e) => void (events = e), setMuted: () => undefined, close: () => undefined });
  // The fake API, like the local one, has no voice provider: the session can't be minted.
  await renderRouter(appDir, { initialUrl: '/voice' });
  expect(await screen.findByTestId('ai13-body', {}, { timeout: 10_000 })).toHaveTextContent(/ask Miko anything in text/);
  expect(events).toBeNull();
});

test('read-aloud and dictation report unavailable locally; dictation text comes back when the API hears it', async () => {
  await onboardAdult(rig, FLAGS);
  const played: string[] = [];
  provideSpeech(rig.app, { out: { available: true, play: async (u) => void played.push(u), stop: () => undefined }, in: { available: false, start: async () => null } });
  expect(await readAloud(rig.app, 'Hello')).toBe('unavailable');
  expect(played).toEqual([]);
  expect(await transcribe(rig.app, { data: new Blob(['x']), mime: 'audio/webm' })).toEqual({ kind: 'failed' });
  rig.fake.features.ai.dictationText = 'what I said';
  expect(await transcribe(rig.app, { data: new Blob(['x']), mime: 'audio/webm' })).toEqual({ kind: 'text', text: 'what I said' });
  await act(async () => undefined);
  await waitFor(() => expect(rig.fake.log.some((l) => l.path === '/v1/speech/dictation' && l.status === 200)).toBe(true));
});
