/**
 * The guest -> onboarding -> lesson -> streak -> link -> Pro (RevenueCat webhook) journey, then
 * /v1/devices, the practice hub, mocks and a tutor answer, against a real local apps/api.
 * Skipped unless SMRITI_LIVE_API is set, for example:
 *
 *   SMRITI_LIVE_API=http://127.0.0.1:8000 pnpm --filter @smriti/mobile test:live
 *
 * Start the API first (apps/api/README.md): scripts/dev/db.sh reset, then
 * `APP_ENV=local AI_PROVIDER=fake uv run uvicorn smriti_api.main:app --port 8000`.
 */
import { unsyncedSummary, type Fetch } from '@smriti/app-core';
import http from 'node:http';

import { firstTopicId, openLesson } from '../../src/services/lessons';
import { fetchMocks, fetchPracticeHub, openTutorSession, sendTutorMessage, tutorAnswerText } from '../../src/services/practice';
import { createTestApp } from '../harness';
import { playToEnd } from '../play';

const BASE = process.env.SMRITI_LIVE_API;
const live = BASE ? describe : describe.skip;

// jest-expo replaces the global fetch with a mock, so live runs use node:http directly.
const nodeFetch: Fetch = (url, init) =>
  new Promise((resolve, reject) => {
    const req = http.request(url, { method: init?.method ?? 'GET', headers: init?.headers ?? {} }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const status = res.statusCode ?? 0;
        resolve({
          status,
          ok: status >= 200 && status < 300,
          json: async () => JSON.parse(text) as unknown,
          text: async () => text,
          headers: { get: (n: string) => (res.headers[n.toLowerCase()] as string | undefined) ?? null },
        });
      });
    });
    req.on('error', reject);
    if (init?.body) req.write(init.body);
    req.end();
  });

/** Events the real server refused, by type and code: the fake should refuse the same ones. */
const refused: string[] = [];
const watchedFetch: Fetch = async (url, init) => {
  const res = await nodeFetch(url, init);
  if (url.endsWith('/v1/sync/events') && init?.body && res.ok) {
    const sent = (JSON.parse(init.body) as { events: { event_id: string; type: string }[] }).events;
    const body = (await res.json()) as { rejected: { event_id: string; code: string }[] };
    for (const r of body.rejected) {
      const e = sent.find((x) => x.event_id === r.event_id) as { type: string; payload?: unknown } | undefined;
      refused.push(`${e?.type}:${r.code} ${JSON.stringify(e?.payload).slice(0, 120)}`);
    }
    const text = JSON.stringify(body);
    return { ...res, json: async () => JSON.parse(text) as unknown, text: async () => text };
  }
  return res;
};

live('guest to streak against the real API', () => {
  afterAll(() => {
    // Printed for the report; refusals of client-only analytics-like events are expected to be listed.
    console.log('server refused', refused);
  });

  it('syncs a guest lesson, shows streak 1 from the server and links Google in place', async () => {
    const { app } = createTestApp({ variant: 'all', now: Date.now(), live: { baseUrl: BASE!, fetch: watchedFetch } });
    await app.boot();
    await app.ensureSession();
    expect(app.store.getState().session.status).toBe('guest');
    const guestId = app.store.getState().session.userId;

    // /v1/config and /v1/catalog/exams through @smriti/api-client
    await app.loadConfig();
    expect(app.ui.getState().config.exams.some((e) => e.exam_profile_id === 'jee-main-2027')).toBe(true);

    await app.chooseLocale('en');
    await app.answerGoal(['jee-main-2027'], null);
    await app.answerBirthYear(2007);
    await app.answerLevel('starting');
    await app.nameBuddy('cat', 'Miko');
    await app.plantSeed();

    const topicId = firstTopicId(app)!;
    const run = openLesson(app, { topicId, mode: 'onboarding' })!;
    const end = playToEnd(run);
    expect(end.phase).toBe('complete');
    await run.drain();
    await app.completeLesson(end.summary!, { onboarding: true });
    await app.setDailyGoal(10, true);
    await app.answerReminder(null);

    await app.syncNow();
    expect((await unsyncedSummary(app.deps.stores.storage)).total).toBe(0);
    const st = app.store.getState();
    expect(st.streak?.current).toBe(1);
    expect(st.streak?.today_qualified).toBe(true);
    expect(st.plant?.study_days).toBe(1);
    expect(st.pet?.name).toBe('Miko');

    // Two more lessons: the third ends with the soft login prompt
    let extra = '';
    for (let i = 0; i < 2; i++) {
      const r = openLesson(app, { topicId, mode: 'deep_dive', biteId: run.plan.biteId ?? undefined })!;
      const done = playToEnd(r);
      await r.drain();
      extra = (await app.completeLesson(done.summary!)).extra;
    }
    expect(extra).toBe('soft_login');
    await app.syncNow();
    expect(app.store.getState().streak?.current).toBe(1);

    // Dev Google links the same user (no data moves)
    const email = `mobile-live-${Date.now()}@example.test`;
    expect(await app.continueWithGoogle({ email, name: 'Live Learner' })).toEqual({ status: 'linked' });
    expect(app.store.getState().session.userId).toBe(guestId);
    expect(app.store.getState().session.status).toBe('signed_in');
    expect(app.store.getState().streak?.current).toBe(1);
    // Every event the app sent was accepted by the real server.
    expect(refused).toEqual([]);

    // R38: the ₹1 month only when /v1/billing/intro-eligibility says so; the price from config.
    const eligibility = await app.introEligibility();
    console.log('intro eligibility', eligibility);
    expect(eligibility.pricePaise).toBe(app.ui.getState().config.pricing.monthly_paise);
    const [offer] = await app.billing.offers();
    expect(offer?.introEligible).toBe(eligibility.eligible === true && eligibility.introPricePaise !== null);

    // PAY: FakeBilling plays RevenueCat through /v1/webhooks/revenuecat; Pro arrives via sync.
    const purchase = await app.purchasePro({ pollMs: 200, confirmTimeoutMs: 15_000 });
    expect(purchase.status).toBe('done');
    expect(app.store.getState().entitlement?.plan).toBe('pro');

    // /v1/devices (no push token on a test device, permission as answered)
    expect(await app.registerDevice()).toBe(true);
    await app.notificationOpened(null);

    // Practice hub, mocks and the tutor through @smriti/api-client
    const hub = await fetchPracticeHub(app);
    expect(hub.exam).toBe('jee-main-2027');
    expect(hub.limits.is_pro).toBe(true);
    console.log('hub', JSON.stringify({ challenge: hub.daily_challenge, weak: hub.weak_spots.length, limits: hub.limits.practice_questions }));
    const mocks = await fetchMocks(app);
    expect(Array.isArray(mocks)).toBe(true);
    console.log('mocks', mocks.length);
    const tutor = await openTutorSession(app, null);
    const events = await sendTutorMessage(app, tutor.id, 'What is a vector?');
    console.log('tutor events', events.map((e) => e.type).join(','), JSON.stringify(tutorAnswerText(events).slice(0, 80)));
    expect(events.some((e) => e.type === 'done' || e.type === 'quota')).toBe(true);
    app.stop();
  });
});
