/**
 * The web golden path against the fake API, in English and in Hindi:
 * guest → onboarding → first lesson → streak day 1 → a second lesson (LES-08) → soft sign-in
 * prompt → link Google (dev auth) → paywall → FakeBilling checkout → Pro.
 * axe runs on every main screen on the way (zero serious or critical issues).
 */
import { expect, test } from "@playwright/test";
import { devGoogle, drill, expectAccessible, finishFirstWin, onboard, playLesson, type Locale } from "./journey";

for (const locale of ["en", "hi"] as Locale[]) {
  test(`guest to Pro (${locale})`, async ({ page }) => {
    const email = `e2e-${locale}-${Date.now()}@example.test`;

    await onboard(page, locale, { petName: locale === "hi" ? "मिट्टी" : "Mitti" });
    await expect(page).toHaveURL(/\/onboarding\/first-lesson/);
    await playLesson(page, /\/onboarding\/first-win/);
    await finishFirstWin(page);
    await expectAccessible(page, "HOME-01");
    await expect(page.getByTestId("home-streak")).toBeVisible();

    // A second lesson from Home's main action ends on LES-08 with the streak row.
    await page.getByTestId("hero").getByRole("button").first().click();
    await playLesson(page, /\/lesson-complete/);
    await expect(page.getByTestId("les-08")).toBeVisible();
    await expect(page.getByTestId("stat-xp")).toBeVisible();
    await expectAccessible(page, "LES-08");
    if (await page.getByTestId("auth-01").isVisible()) await page.getByTestId("auth-later").click();
    await page.getByTestId("les-08-close").click();
    await expect(page.getByTestId("home-01")).toBeVisible();

    // A drill on the device (the fake API has no practice routes, so answers go through the outbox).
    await drill(page);

    // Soft prompt (AUTH-01) from Home's "save your plant" link, then link Google.
    await page.goto("/learn");
    await page.getByTestId("save-plant-link").click();
    await expect(page.getByTestId("auth-01")).toBeVisible();
    await expectAccessible(page, "AUTH-01");
    await devGoogle(page, email, "E2E Student");
    await expect(page.getByTestId("auth-01")).toBeHidden();
    await expect(page.getByTestId("save-plant-link")).toHaveCount(0);

    // Me shows the account; the Pro card opens the paywall.
    await page.goto("/me");
    await expect(page.getByTestId("me-01")).toBeVisible();
    await expect(page.getByTestId("me-guest-card")).toHaveCount(0);
    await expectAccessible(page, "ME-01");
    await page.getByTestId("me-pro-card").click();
    await expect(page.getByTestId("pay-01")).toBeVisible();
    await expect(page.getByTestId("trial-timeline")).toBeVisible();
    await expectAccessible(page, "PAY-01");
    await page.getByTestId("pay-cta").click();

    // PAY-06 → FakeBilling approve → PAY-08 → PAY-09.
    await expect(page.getByTestId("pay-06")).toBeVisible();
    await expectAccessible(page, "PAY-06");
    await page.getByTestId("pay-06-cta").click();
    await page.getByTestId("fake-pay-approve").click();
    await expect(page.getByTestId("pro-on")).toBeVisible();
    await expectAccessible(page, "PAY-09");
    await page.getByTestId("pay-09-continue").click();

    await page.goto("/me/plan");
    await expect(page.getByTestId("pay-12-cancel")).toBeVisible();
  });
}
