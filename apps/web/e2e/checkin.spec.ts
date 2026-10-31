/**
 * ENT-08 streak check-in on the fake API: a student who last opened the app four days ago (their
 * fake server history moved back with them) gets the check-in once, and not again the same day.
 */
import { expect, test } from "@playwright/test";
import { expectAccessible } from "./journey";
import { seedStudent, shoot, type Locale } from "./phase2";

const FAKE_DB = "smriti.fake-api.v1";
const AWAY_DAYS = 4;

for (const locale of ["en", "hi"] as Locale[]) {
  test(`streak check-in after days away (${locale})`, async ({ page }) => {
    await seedStudent(page, locale);
    await page.evaluate(
      ({ k, away }) => {
        const ms = away * 86_400_000;
        const shift = (iso: string) => new Date(Date.parse(iso) - ms).toISOString();
        const db = JSON.parse(localStorage.getItem(k) ?? "{}");
        // The plant was seeded and one lesson done on the last day this student studied.
        const then = new Date(Date.now() - ms).toISOString();
        for (const u of Object.values(db.users ?? {}) as { events: Record<string, unknown>[] }[]) {
          for (const e of u.events) e.occurred_at = shift(e.occurred_at as string);
          u.events.push(
            { event_id: crypto.randomUUID(), type: "plant_seeded", occurred_at: then, tz: "Asia/Kolkata", payload: {} },
            { event_id: crypto.randomUUID(), type: "lesson_completed", occurred_at: then, tz: "Asia/Kolkata", payload: { topic_id: "fx.chapter-a.topic-a", mode: "deep_dive", cards_seen: 1, correct: 1, total: 1, ms_total: 60_000, xp: 10 } },
          );
        }
        localStorage.setItem(k, JSON.stringify(db));
        const ob = JSON.parse(localStorage.getItem("smriti.onboarding.v1") ?? "{}");
        ob.completedAt = shift(ob.completedAt);
        ob.firstWinAt = shift(ob.firstWinAt);
        localStorage.setItem("smriti.onboarding.v1", JSON.stringify(ob));
        const d = new Date(Date.now() - ms);
        const p = (n: number) => String(n).padStart(2, "0");
        localStorage.setItem("smriti.pref.home.last_open_day", `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
        localStorage.removeItem("smriti.pref.home.checkin_shown_day");
      },
      { k: FAKE_DB, away: AWAY_DAYS },
    );
    await page.goto("/learn");
    const sheet = page.getByTestId("ent-08");
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    await expect(sheet.locator("[data-variant]")).toHaveAttribute("data-variant", /^(comeback|resting)$/);
    await expect(page.getByTestId("checkin-growth")).toBeVisible();
    await expectAccessible(page, "ENT-08");
    await shoot(page, locale, "ENT-08");
    await page.getByTestId("checkin-home").click();
    await expect(sheet).toBeHidden();

    // Once a day: Home again shows no check-in.
    await page.reload();
    await expect(page.getByTestId("home-01")).toBeVisible();
    await page.waitForTimeout(1_000);
    await expect(page.getByTestId("ent-08")).toHaveCount(0);
  });
}
