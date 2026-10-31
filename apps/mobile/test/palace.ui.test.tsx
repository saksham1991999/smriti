/**
 * Memory palaces (MEM-12 to MEM-18) and insights (MEM-25 calibration, fading topics, sleep
 * review) through the real screens on the dev fake API. Palace items come from a learned
 * topic's list mnemonic in the fixture bundles (test data).
 */
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';

import { listPalaces } from '../src/features/palace/palaces';
import { provideAppForTests } from '../src/services/device';
import { onboardAdult } from './features.helpers';
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

const me = () => [...rig.fake.users.values()].find((u) => u.id === rig.app.store.getState().session.userId)!;

async function makePro() {
  me().entitlement = { plan: 'pro', pro_until: null, status: 'active' };
  await rig.app.syncNow();
  expect(rig.app.isPro()).toBe(true);
}

/** The fixture topic whose deep dive has a three-item list mnemonic. */
async function learnListTopic(): Promise<string> {
  const topics = rig.app.deps.content.topics('en', rig.app.examProfileId());
  const t = topics.find((x) => Object.values(rig.app.deps.content.load('en', x.id, 'deep_dive', rig.app.examProfileId())?.bundle.mnemonics ?? {}).some((m) => m.decodes_to.length >= 2));
  if (!t) throw new Error('no list mnemonic in the fixtures');
  await rig.app.deps.stores.storage.topic_status.put({ topic_id: t.id, status: 'learned', learned_via: 'lesson', percent: 100, updated_at: new Date(rig.app.deps.clock()).toISOString() });
  return t.id;
}

test('a free student sees the Pro line, and [Build a palace] opens the paywall', async () => {
  await onboardAdult(rig);
  await renderRouter(appDir, { initialUrl: '/palace' });
  await screen.findByTestId('MEM-12', {}, { timeout: 10_000 });
  expect(screen.getByTestId('mem12-pro-line')).toHaveTextContent('Build your own palaces with Pro.');
  expect(await screen.findByTestId('mem12-empty')).toHaveTextContent(/No palaces yet/);
  await fireEvent.press(screen.getByTestId('mem12-build'));
  await screen.findByTestId('PAY-01', {}, { timeout: 10_000 });
});

test('build a palace from a learned list, place items, walk it and quiz it', async () => {
  await onboardAdult(rig);
  await makePro();
  await learnListTopic();
  await renderRouter(appDir, { initialUrl: '/palace/new' });
  await screen.findByTestId('MEM-13', {}, { timeout: 10_000 });
  expect(screen.getByTestId('mem13-next')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('mem13-home'));
  expect(screen.getByTestId('mem13-name').props.value).toBe('Home');
  await fireEvent.changeText(screen.getByTestId('mem13-name'), 'My home');
  await fireEvent.press(screen.getByTestId('mem13-next'));

  await screen.findByTestId('MEM-15');
  const source = await screen.findByText(/3 items in order/);
  expect(source).toBeTruthy();
  await fireEvent.press(screen.getByRole('checkbox'));
  expect(screen.getByTestId('mem15-use')).toHaveTextContent('Use these 3 items');
  await fireEvent.press(screen.getByTestId('mem15-use'));

  // MEM-14: one room of four spots, three items in the tray. Tap an item, then a spot.
  await screen.findByTestId('MEM-14', {}, { timeout: 10_000 });
  expect(await screen.findByText('To place (3)', {}, { timeout: 10_000 })).toBeTruthy();
  expect(screen.getByTestId('mem14-walk')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('mem14-item-2'));
  await fireEvent.press(screen.getByTestId('mem14-spot-4'));
  await waitFor(() => expect(screen.getByTestId('mem14-spot-4')).toHaveAccessibleName('Spot 4, Fixture item 3'));
  await fireEvent.press(screen.getByTestId('mem14-auto'));
  await waitFor(() => expect(screen.getByTestId('mem14-spot-1')).toHaveAccessibleName('Spot 1, Fixture item 1'));
  expect(screen.getByTestId('mem14-spot-2')).toHaveAccessibleName('Spot 2, Fixture item 2');
  expect(screen.queryByText(/To place/)).toBeNull();
  // A filled spot swaps: lift item 1 and drop it on spot 4.
  await fireEvent.press(screen.getByTestId('mem14-spot-1'));
  await fireEvent.press(screen.getByTestId('mem14-spot-4'));
  await waitFor(() => expect(screen.getByTestId('mem14-spot-1')).toHaveAccessibleName('Spot 1, Fixture item 3'));
  expect(screen.getByTestId('mem14-spot-4')).toHaveAccessibleName('Spot 4, Fixture item 1');

  // MEM-17: three filled spots in walk order.
  await fireEvent.press(screen.getByTestId('mem14-walk'));
  await screen.findByTestId('mem17-counter', {}, { timeout: 10_000 });
  expect(screen.getByTestId('mem17-counter')).toHaveTextContent('Spot 1 of 3');
  expect(screen.getByTestId('mem17-item')).toHaveTextContent('Fixture item 3');
  await fireEvent.press(screen.getByTestId('mem17-next'));
  await fireEvent.press(screen.getByTestId('mem17-next'));
  expect(screen.getByTestId('mem17-item')).toHaveTextContent('Fixture item 1');
  await fireEvent.press(screen.getByTestId('mem17-quiz'));

  // MEM-18: remember two of three.
  await screen.findByTestId('mem18-show', {}, { timeout: 10_000 });
  expect(screen.queryByTestId('mem18-item')).toBeNull();
  for (const got of [true, false, true]) {
    await fireEvent.press(screen.getByTestId('mem18-show'));
    await fireEvent.press(screen.getByTestId(got ? 'mem18-got' : 'mem18-missed'));
  }
  await screen.findByTestId('MEM-18-result');
  expect(screen.getByTestId('mem18-remembered')).toHaveTextContent(/2 \/ 3/);
  expect(screen.getByText('A few got lost. One more walk will help.')).toBeTruthy();

  const list = await listPalaces(rig.app);
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ rooms: 1, items: 3 });
  expect(list[0]!.palace.name).toBe('My home');
  // The palace syncs as one document, and each rating scheduled the item's `p:` review card.
  const palaceCards = async () => (await rig.app.deps.stores.storage.srs_cards.all()).filter((c) => c.card_ref.startsWith('p:'));
  for (let n = 0; n < 50 && (await palaceCards()).length < 3; n++) await new Promise((r) => setTimeout(r, 20));
  expect(await palaceCards()).toHaveLength(3);
  await rig.app.syncNow();
  const sent = me().events.filter((e) => e.type === 'palace_saved');
  expect(sent.length).toBeGreaterThan(0);
  expect((sent[sent.length - 1]!.payload as { name: string }).name).toBe('My home');
});

test('MEM-25 says how many answers are still needed, then shows calibration, fading topics and sleep review', async () => {
  await onboardAdult(rig, { 'analytics.min_tagged_answers': 4 });
  await makePro();
  const ins = rig.fake.features.insights;
  ins.tag(me().id, 'sure', true);
  await renderRouter(appDir, { initialUrl: '/insights' });
  expect(await screen.findByTestId('mem25-empty', {}, { timeout: 10_000 })).toHaveTextContent(/Your map appears after 3 answers\.$/);
  screen.unmount();

  ins.tag(me().id, 'sure', false);
  ins.tag(me().id, 'guess', true);
  ins.tag(me().id, 'fifty', false);
  const topic = rig.app.deps.content.topics('en', rig.app.examProfileId())[0]!;
  ins.weak.set(me().id, [{ topic_id: topic.id, cards: 4, min_retrievability: 0.82 }]);
  ins.sleep.set(me().id, { eligible: true, bedtime: '22:30:00', source: 'estimate', confidence: 0.8, cards: [] });
  await renderRouter(appDir, { initialUrl: '/insights' });
  expect(await screen.findByTestId('mem25-sure-wrong', {}, { timeout: 10_000 })).toHaveTextContent(/1/);
  expect(screen.getByTestId('mem25-lucky')).toHaveTextContent(/1/);
  expect(screen.getByTestId('mem25-bar-sure')).toHaveAccessibilityValue({ text: '50% right · 2 answers' });
  expect(await screen.findByTestId(`fading-${topic.id}`)).toHaveAccessibleName(`${topic.name} is fading · 4 cards`);
  expect(await screen.findByTestId('sleep-bedtime')).toHaveTextContent(/Estimated bedtime: 10:30\s?pm/i);
});
