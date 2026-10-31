import type { TestRig } from './harness';

/** A class 3 child, onboarded through the services, with Phase 2/3 flags from the fake API. */
export async function onboardLittle(r: TestRig, flags: Record<string, unknown> = { 'feature.little_learner': true }) {
  const { app } = r;
  r.fake.flags = flags;
  await app.boot();
  await app.ensureSession();
  await app.loadConfig();
  await app.chooseLocale('en');
  await app.answerGoal(['school'], 3);
  await app.answerLevel('starting');
  await app.nameBuddy('dog', 'Bholu');
  await app.plantSeed();
  await app.setDailyGoal(10, true);
  await app.answerReminder(null);
}

/** A 19-year-old JEE student (an adult: social and voice need no guardian consent). */
export async function onboardAdult(r: TestRig, flags: Record<string, unknown> = {}) {
  const { app } = r;
  r.fake.flags = flags;
  await app.boot();
  await app.ensureSession();
  await app.loadConfig();
  await app.chooseLocale('en');
  await app.answerGoal(['jee-main-2027'], null);
  await app.answerBirthYear(2007);
  await app.answerLevel('starting');
  await app.nameBuddy('cat', 'Miko');
  await app.plantSeed();
  await app.setDailyGoal(10, true);
  await app.answerReminder(null);
}
