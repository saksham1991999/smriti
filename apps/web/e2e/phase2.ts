/**
 * Shared steps for the Phase 2 and 3 specs (fake API). A student who finished onboarding is
 * seeded straight into localStorage, so each spec starts on its own screen; Pro is switched on in
 * the fake server's database. Screenshots are taken only when SHOTS_DIR is set:
 * <SHOTS_DIR>/<locale>/<SCREEN>-<width>-<light|dark>.png at 390 and 1280 px.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

export type Locale = "en" | "hi";
export const PET = { en: "Mitti", hi: "मिट्टी" } as const;

const FAKE_DB = "smriti.fake-api.v1";

/** A signed-in-as-guest student on the fixture exam, onboarding done, in `locale`. */
export async function seedStudent(page: Page, locale: Locale, opts: { pro?: boolean; birthYear?: number } = {}) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/welcome");
  await page.evaluate(
    ({ locale, pet, birthYear }) => {
      const now = new Date().toISOString();
      localStorage.setItem("smriti.pref.locale", locale);
      localStorage.setItem(
        "smriti.onboarding.v1",
        JSON.stringify({ goals: ["fx-exam-2027"], school: false, classNo: null, birthYear, examMonth: null, level: "starting", petSpecies: "cat", petName: pet, seeded: true, firstLessonTopic: null, firstWinAt: now, dailyGoal: 10, reminder: false, completedAt: now, lessonsCompleted: 1, installedAt: now, upsellsShown: { day: "", count: 0 } }),
      );
    },
    { locale, pet: PET[locale], birthYear: opts.birthYear ?? 1998 },
  );
  await page.goto("/learn");
  await expect(page.getByTestId("lrn-01").or(page.getByTestId("home"))).toBeVisible({ timeout: 20_000 }).catch(() => undefined);
  // Wait until the fake server has a user for this browser (the guest session).
  await expect.poll(async () => page.evaluate((k) => Object.keys(JSON.parse(localStorage.getItem(k) ?? "{}").users ?? {}).length, FAKE_DB), { timeout: 20_000 }).toBeGreaterThan(0);
  if (opts.pro) await makePro(page);
}

/** Pro for every fake user (as if a checkout had completed), then a reload to pull the state. */
export async function makePro(page: Page) {
  await page.evaluate((k) => {
    const db = JSON.parse(localStorage.getItem(k) ?? "{}");
    for (const u of Object.values(db.users ?? {}) as { entitlement: unknown }[]) u.entitlement = { plan: "pro", pro_until: new Date(Date.now() + 30 * 864e5).toISOString() };
    localStorage.setItem(k, JSON.stringify(db));
  }, FAKE_DB);
  await page.reload();
}

/** The outbox events the fake server received from this browser, by type. */
export async function serverEvents(page: Page, type: string): Promise<{ payload: Record<string, unknown> }[]> {
  return page.evaluate(
    ({ k, type }) => {
      const db = JSON.parse(localStorage.getItem(k) ?? "{}");
      return (Object.values(db.users ?? {}) as { events: { type: string; payload: Record<string, unknown> }[] }[]).flatMap((u) => u.events.filter((e) => e.type === type));
    },
    { k: FAKE_DB, type },
  );
}

const OUT = process.env.SHOTS_DIR;
const SIZES = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
];

/** Light and Night Colour at 390 and 1280 (only with SHOTS_DIR). */
export async function shoot(page: Page, locale: Locale, screen: string) {
  if (!OUT) return;
  const dir = join(OUT, locale);
  mkdirSync(dir, { recursive: true });
  const original = page.viewportSize() ?? { width: 1280, height: 800 };
  for (const size of SIZES) {
    await page.setViewportSize(size);
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.waitForTimeout(250);
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewportSize({ width: size.width, height: Math.max(size.height, Math.min(height, 4000)) });
      await page.waitForTimeout(100);
      await page.screenshot({ path: join(dir, `${screen}-${size.width}-${theme}.png`) });
      await page.setViewportSize(size);
    }
  }
  await page.setViewportSize(original);
  await page.emulateMedia({ colorScheme: "light" });
}
