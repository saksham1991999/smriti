/**
 * The guest-to-Pro journey through the services layer, against the fake API (dev and test only).
 * The UI-level version of the same journey is `journey.ui.test.tsx`.
 */
import { unsyncedSummary } from '@smriti/app-core';

import { firstTopicId, openLesson } from '../src/services/lessons';
import { createTestApp } from './harness';
import { playToEnd } from './play';

const DAY = 86_400_000;

describe('guest to Pro (services)', () => {
  it('onboards a guest, completes lessons, links Google and buys Pro', async () => {
    const { app, fake, clock } = createTestApp({ variant: 'all' });
    await app.boot();
    await app.ensureSession();
    expect(app.store.getState().session.status).toBe('guest');

    // Onboarding (ONB-01 to ONB-12)
    await app.chooseLocale('en');
    await app.answerGoal(['jee-main-2027'], null);
    await app.answerBirthYear(2008);
    await app.answerLevel('starting');
    await app.nameBuddy('cat', 'Miko');
    await app.plantSeed();

    // ONB-13: the first lesson, in onboarding mode, on the seed pack
    const topicId = firstTopicId(app);
    expect(topicId).toBeTruthy();
    const run = openLesson(app, { topicId: topicId!, mode: 'onboarding' })!;
    const end = playToEnd(run);
    expect(end.phase).toBe('complete');
    await run.drain();
    const first = await app.completeLesson(end.summary!, { onboarding: true });
    expect(first.streakUp).toBe(true);
    expect(app.store.getState().streak?.current).toBe(1);
    await app.finishFirstLesson({ topicId: topicId!, xp: end.summary!.xp, accuracy: end.summary!.accuracy, minutes: 1 });
    await app.leaveFirstWin();
    await app.setDailyGoal(10, true);
    await app.answerReminder('19:00');
    expect(app.ui.getState().onboarding.completedAt).not.toBeNull();

    // The server agrees: streak 1, plant sprouted, pet named, XP counted
    await app.syncNow();
    const st = app.store.getState();
    expect(st.streak?.current).toBe(1);
    expect(st.streak?.today_qualified).toBe(true);
    expect(st.plant?.study_days).toBe(1);
    expect(st.pet?.name).toBe('Miko');
    expect(st.wallet?.xp_total).toBe(end.summary!.xp);
    expect(fake.log.some((l) => l.path === '/v1/sync/events' && l.status === 200)).toBe(true);

    // Two more Deep Dive lessons; the third lesson ends with the soft login prompt (R15, AUTH-01)
    let extra = '';
    for (let i = 0; i < 2; i++) {
      clock.advance(DAY / 24);
      const r = openLesson(app, { topicId: topicId!, mode: 'deep_dive', biteId: run.plan.biteId ?? undefined })!;
      const done = playToEnd(r);
      expect(done.phase).toBe('complete');
      await r.drain();
      extra = (await app.completeLesson(done.summary!)).extra;
    }
    expect(extra).toBe('soft_login');
    await app.syncNow();

    // AUTH-04: Google links in place, the guest's progress stays
    const userBefore = app.store.getState().session.userId;
    const linked = await app.continueWithGoogle({ email: 'learner@example.test', name: 'Learner' });
    expect(linked).toEqual({ status: 'linked' });
    expect(app.store.getState().session.status).toBe('signed_in');
    expect(app.store.getState().session.userId).toBe(userBefore);
    expect(app.store.getState().streak?.current).toBe(1);

    // PAY-01 to PAY-09: fake billing, confirmed by server state
    const purchase = await app.purchasePro({ pollMs: 10, confirmTimeoutMs: 5_000 });
    expect(purchase.status).toBe('done');
    expect(app.store.getState().entitlement?.plan).toBe('pro');
    expect(app.isPro()).toBe(true);
    app.stop();
  });

  it('keeps working offline and syncs on reconnect', async () => {
    const { app, network } = createTestApp();
    network.set(false);
    await app.boot();
    await app.chooseLocale('hi');
    await app.answerGoal(['neet-ug-2027'], null);
    await app.nameBuddy('dog', 'Bholu');
    await app.plantSeed();
    const run = openLesson(app, { topicId: firstTopicId(app)!, mode: 'onboarding' })!;
    const end = playToEnd(run);
    await run.drain();
    await app.completeLesson(end.summary!, { onboarding: true });
    expect(app.store.getState().streak?.current).toBe(1);
    expect((await unsyncedSummary(app.deps.stores.storage)).total).toBeGreaterThan(0);

    network.set(true);
    await app.syncNow();
    expect((await unsyncedSummary(app.deps.stores.storage)).total).toBe(0);
    expect(app.store.getState().pet?.name).toBe('Bholu');
    app.stop();
  });
});
