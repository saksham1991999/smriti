/**
 * Social on mobile (Phase 2, tutor-social SOC-01 to SOC-22) through the real screens on the dev
 * fake API: the Friends tab behind `feature.friends` and the server's gate, adding a friend by
 * invite code, the league, a preset cheer, a squad, a solo round after a random match times out,
 * and a live friend duel with the friend's answers played by the fake.
 */
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';

import { duelQuestionsFrom } from '../src/dev/duelQuestions';
import { provideAppForTests } from '../src/services/device';
import { createTestApp, type TestRig } from './harness';
import { onboardAdult, onboardLittle } from './features.helpers';

jest.setTimeout(90_000);

const appDir = path.join(__dirname, '..', 'app');
const FRIENDS = { 'feature.friends': true };
let rig: TestRig;

/** A signed-in adult (social needs an account, R46) with a lesson this week, and Ravi, who has two. */
async function setUp(r: TestRig) {
  await onboardAdult(r, FRIENDS);
  const { app, fake } = r;
  expect((await app.continueWithGoogle({ email: 'meera@example.com', name: 'Meera Iyer' })).status).toBe('linked');
  await app.record('lesson_completed', { topic_id: 'fx.chapter-a.topic-a', mode: 'deep_dive', cards_seen: 6, correct: 4, total: 5, ms_total: 6 * 60_000, xp: 20 });
  await app.syncNow();
  const ravi = fake.addLearner({ name: 'Ravi Kumar', email: 'ravi@example.com', birthYear: 2005, species: 'dog', petName: 'Sheru', lessonsXp: [30, 15] });
  fake.features.social.questions = duelQuestionsFrom(app, 3);
  return { me: app.store.getState().session.userId!, ravi };
}

beforeEach(() => {
  rig = createTestApp({ variant: 'all' });
  provideAppForTests(rig.app);
});

afterEach(() => {
  rig.app.stop();
  provideAppForTests(null);
});

test('the Friends tab is hidden unless feature.friends is on, and a guest sees SOC-02', async () => {
  await onboardAdult(rig, {});
  await renderRouter(appDir, { initialUrl: '/learn' });
  await screen.findByTestId('tab-bar', {}, { timeout: 10_000 });
  expect(screen.queryByText('Friends')).toBeNull();
  rig.app.stop();

  rig = createTestApp({ variant: 'all' });
  provideAppForTests(rig.app);
  await onboardAdult(rig, FRIENDS);
  await renderRouter(appDir, { initialUrl: '/friends' });
  await screen.findByTestId('SOC-02', {}, { timeout: 10_000 });
  expect(screen.getByText('Study with friends')).toBeTruthy();
  expect(screen.getByTestId('tab-bar')).toHaveTextContent(/Friends/);
});

test('a little learner has no Friends tab even with the flag on', async () => {
  await onboardLittle(rig, { 'feature.little_learner': true, ...FRIENDS });
  await renderRouter(appDir, { initialUrl: '/learn' });
  await screen.findByTestId('HOME-06', {}, { timeout: 10_000 });
  expect(screen.getByTestId('tab-bar')).not.toHaveTextContent(/Friends/);
});

test('add a friend by code, see them on SOC-01 and in the league, and send a preset cheer', async () => {
  const { me, ravi } = await setUp(rig);
  const code = rig.fake.features.social.inviteCodeFor(ravi.id);
  await renderRouter(appDir, { initialUrl: '/friends' });
  await screen.findByTestId('soc01-empty', {}, { timeout: 10_000 });

  await fireEvent.press(screen.getByTestId('soc01-add'));
  await screen.findByTestId('SOC-04');
  expect(await screen.findByTestId('soc04-my-code')).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId('soc04-code'), code);
  await fireEvent.press(screen.getByTestId('soc04-code-add'));
  expect(await screen.findByText('Ravi Kumar is your friend now')).toBeTruthy();
  expect(rig.fake.features.social.friends.get(me)?.has(ravi.id)).toBe(true);
  // My own code is refused.
  await fireEvent.changeText(screen.getByTestId('soc04-code'), rig.fake.features.social.inviteCodeFor(me));
  await fireEvent.press(screen.getByTestId('soc04-code-add'));
  expect(await screen.findByText('This is your own invite link.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('back'));

  // SOC-01: Ravi studied today; the league card has my rank from real XP (Ravi 45, me 20).
  expect(await screen.findByTestId(`soc01-friend-${ravi.id}`, {}, { timeout: 10_000 })).toHaveTextContent(/Ravi Kumar/);
  expect(screen.getByTestId(`soc01-friend-${ravi.id}`)).toHaveTextContent(/Studied/);
  expect(await screen.findByTestId('soc01-rank')).toHaveTextContent('#2 · 20 XP');

  await fireEvent.press(screen.getByTestId('soc01-league'));
  await screen.findByTestId('SOC-08');
  expect(await screen.findByTestId('soc08-row-1')).toHaveTextContent(/Ravi Kumar/);
  expect(screen.getByTestId('soc08-row-2')).toHaveTextContent(/You/);
  await fireEvent.press(screen.getByTestId('back'));

  await fireEvent.press(await screen.findByTestId(`soc01-friend-${ravi.id}`));
  await fireEvent.press(await screen.findByTestId('soc07-cheer'));
  await fireEvent.press(await screen.findByTestId('soc22-message_3'));
  expect(await screen.findByTestId('soc22-sent')).toHaveTextContent('Sent!');
  // A preset id, never free text.
  expect(rig.fake.features.social.inbox.find((i) => i.to === ravi.id)).toMatchObject({ kind: 'cheer', preset: 'message_3' });
});

test('create a squad and see it on SOC-14', async () => {
  await setUp(rig);
  await renderRouter(appDir, { initialUrl: '/social/squads?tab=create' });
  await screen.findByTestId('SOC-13', {}, { timeout: 10_000 });
  await fireEvent.press(screen.getByTestId('soc13-create'));
  await screen.findByTestId('SOC-14');
  expect(await screen.findByTestId('soc14-created')).toHaveTextContent(/Squad 1 is ready/);
  expect(screen.getByTestId('soc14-code')).toHaveTextContent(/^SQ/);
});

test('a random match with no one free times out; Practise solo plays the round', async () => {
  await setUp(rig);
  await renderRouter(appDir, { initialUrl: '/social/duel' });
  await screen.findByTestId('SOC-15', {}, { timeout: 10_000 });
  expect(screen.getByTestId('soc15-rules')).toHaveTextContent('10 questions · 20 s each');
  await fireEvent.press(await screen.findByText('Random opponent'));
  await fireEvent.press(screen.getByTestId('soc15-start'));
  await screen.findByTestId('soc16-finding');
  rig.clock.advance(11_000);
  await screen.findByTestId('soc16-timeout', {}, { timeout: 5_000 });
  await fireEvent.press(screen.getByTestId('soc16-solo'));
  await screen.findByTestId('SOC-18');

  const duel = [...rig.fake.features.social.duels.values()][0]!;
  expect(duel.relation).toBe('solo');
  for (let i = 0; i < 3; i++) {
    expect(await screen.findByTestId('soc18-count')).toHaveTextContent(`Question ${i + 1} of 3`);
    const key = rig.fake.features.social.currentKey(duel.id)![0]!;
    await fireEvent.press(screen.getByTestId(`option-${i === 1 ? wrong(duel.id, key) : key}`));
    await fireEvent.press(screen.getByTestId('soc18-submit'));
    if (i < 2) await waitFor(() => expect(screen.getByTestId('soc18-count')).toHaveTextContent(`Question ${i + 2} of 3`));
  }
  expect(await screen.findByTestId('soc19-title')).toHaveTextContent('Practice done: 2 of 3');
});

test('a friend duel: Ravi accepts and answers on his phone, and I win', async () => {
  const { ravi } = await setUp(rig);
  const social = rig.fake.features.social;
  social.befriend(rig.app.store.getState().session.userId!, ravi.id);
  await renderRouter(appDir, { initialUrl: '/social/duel' });
  await screen.findByTestId('SOC-15', {}, { timeout: 10_000 });
  await fireEvent.press(await screen.findByTestId(`soc15-friend-${ravi.id}`));
  await fireEvent.press(screen.getByTestId('soc15-start'));
  expect(await screen.findByTestId('soc16-waiting')).toHaveTextContent('Waiting for Ravi Kumar…');

  const duel = [...social.duels.values()][0]!;
  social.acceptDuelAs(ravi.id, duel.id);
  await screen.findByTestId('SOC-18', {}, { timeout: 5_000 });
  for (let i = 0; i < 3; i++) {
    // The app polls the duel every second, so Ravi's answer moves it on.
    await waitFor(() => expect(screen.getByTestId('soc18-count')).toHaveTextContent(`Question ${i + 1} of 3`), { timeout: 4_000 });
    const key = social.currentKey(duel.id)![0]!;
    await fireEvent.press(screen.getByTestId(`option-${key}`));
    await fireEvent.press(screen.getByTestId('soc18-submit'));
    if (i === 0) expect(await screen.findByTestId('soc18-waiting')).toHaveTextContent('Waiting for Ravi Kumar…');
    social.answerAs(ravi.id, duel.id, [wrong(duel.id, key)]);
  }
  expect(await screen.findByTestId('soc19-title', {}, { timeout: 5_000 })).toHaveTextContent('You won!');
  expect(screen.getByTestId('soc19-xp')).toHaveTextContent('+25 XP');
});

/** Any option id other than the key, from the question's public body. */
function wrong(duelId: string, key: string): string {
  const d = rig.fake.features.social.duels.get(duelId)!;
  const q = d.questions[d.index]!;
  const options = (q.body.options as { id: string }[]).map((o) => o.id);
  return options.find((o) => o !== key)!;
}
