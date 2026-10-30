/**
 * Screenshot matrix for design review (not part of `pnpm e2e`; it runs only when SHOTS_DIR is set):
 * every built P0 screen at 390 and 1280 px, light and Night Colour, in English and Hindi.
 *
 *   SHOTS_DIR=/abs/out pnpm exec playwright test e2e/screens.spec.ts --project=fake
 *
 * Writes <SHOTS_DIR>/<locale>/<SCREEN>-<width>-<light|dark>.png.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { devGoogle, drill, finishFirstWin, onboard, playLesson, type Locale } from "./journey";

const OUT = process.env.SHOTS_DIR;
const SIZES = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
];
const THEMES = ["light", "dark"] as const;

async function shoot(page: Page, locale: Locale, screen: string) {
  if (!OUT) return;
  const dir = join(OUT, locale);
  mkdirSync(dir, { recursive: true });
  for (const size of SIZES) {
    await page.setViewportSize(size);
    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.waitForTimeout(250);
      // Grow the window to the page's height so fixed bars sit at the bottom, as on a phone scroll.
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewportSize({ width: size.width, height: Math.max(size.height, Math.min(height, 4000)) });
      await page.waitForTimeout(100);
      await page.screenshot({ path: join(dir, `${screen}-${size.width}-${theme}.png`) });
      await page.setViewportSize(size);
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
}

for (const locale of ["en", "hi"] as Locale[]) {
  test(`screens (${locale})`, async ({ page }) => {
    test.skip(!OUT, "set SHOTS_DIR to take the screenshot matrix");
    test.setTimeout(600_000);
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto("/");
    await expect(page).toHaveURL(/\/welcome/);
    await page.evaluate((l) => localStorage.setItem("smriti.pref.locale", l), locale);
    await page.reload();
    await shoot(page, locale, "ONB-01");

    await onboard(page, locale, { petName: locale === "hi" ? "मिट्टी" : "Mitti" });
    await expect(page.getByTestId("lesson-player")).toBeVisible();
    await shoot(page, locale, "LES-01");
    await playLesson(page, /\/onboarding\/first-win/);
    await expect(page.getByTestId("onb-14")).toBeVisible();
    await shoot(page, locale, "ONB-14");
    await finishFirstWin(page);
    await shoot(page, locale, "HOME-01");

    // Learn: subject (LRN-01) -> chapter (LRN-02) -> topic (LRN-03), by the first card of each.
    await page.locator("[data-testid^=subject-]").first().click();
    await expect(page.getByTestId("lrn-01")).toBeVisible();
    await shoot(page, locale, "LRN-01");
    await page.locator("[data-testid^=chapter-]").first().click();
    await expect(page.getByTestId("lrn-02")).toBeVisible();
    await shoot(page, locale, "LRN-02");
    await page.locator("[data-testid^=topic-]").first().click();
    await expect(page.getByTestId("lrn-03")).toBeVisible();
    await shoot(page, locale, "LRN-03");

    await page.goto("/learn");
    await page.getByTestId("hero").getByRole("button").first().click();
    await playLesson(page, /\/lesson-complete/);
    await expect(page.getByTestId("les-08")).toBeVisible();
    await shoot(page, locale, "LES-08");
    if (await page.getByTestId("auth-01").isVisible()) await page.getByTestId("auth-later").click();
    await page.getByTestId("les-08-close").click();

    await page.goto("/practice");
    await expect(page.getByTestId("prc-01")).toBeVisible();
    await shoot(page, locale, "PRC-01");
    await page.locator("[data-testid^=drill-]").first().click();
    await expect(page.getByTestId("prc-03")).toBeVisible();
    await shoot(page, locale, "PRC-03");
    await page.getByTestId("drill-start").click();
    await expect(page.getByTestId("prc-04")).toBeVisible();
    await shoot(page, locale, "PRC-04");
    await page.getByTestId("drill-close").click();
    await drill(page);

    await page.goto("/practice/mock");
    await expect(page.locator("[data-testid=mock-06],[data-testid=mock-empty]")).toBeVisible();
    if (await page.getByTestId("mock-06").isVisible()) {
      await shoot(page, locale, "MOCK-06");
      await page.getByTestId("mock-declaration").click();
      await page.getByTestId("mock-begin").click();
      await expect(page.getByTestId("mock-07")).toBeVisible();
      await shoot(page, locale, "MOCK-07");
    }

    await page.goto("/labs");
    await expect(page.getByTestId("lab-01")).toBeVisible();
    await shoot(page, locale, "LAB-01");

    await page.goto("/review");
    await page.waitForTimeout(500);
    await shoot(page, locale, "MEM-03");

    await page.goto("/login?reason=restore");
    await expect(page.getByTestId("auth-02")).toBeVisible();
    await shoot(page, locale, "AUTH-02");

    await page.goto("/learn");
    await page.getByTestId("save-plant-link").click();
    await expect(page.getByTestId("auth-01")).toBeVisible();
    await shoot(page, locale, "AUTH-01");
    await devGoogle(page, `shots-${locale}-${Date.now()}@example.test`, "Asha Verma");
    await expect(page.getByTestId("auth-01")).toBeHidden();

    await page.goto("/me");
    await expect(page.getByTestId("me-01")).toBeVisible();
    await shoot(page, locale, "ME-01");
    await page.goto("/me/settings");
    await expect(page.getByTestId("set-01")).toBeVisible();
    await shoot(page, locale, "SET-01");
    await page.goto("/me/notifications");
    await expect(page.getByTestId("set-03")).toBeVisible();
    await shoot(page, locale, "SET-03");

    await page.goto("/pro");
    await expect(page.getByTestId("pay-01")).toBeVisible();
    await expect(page.getByTestId("trial-timeline")).toBeVisible();
    await shoot(page, locale, "PAY-01");
    await page.getByTestId("pay-cta").click();
    await expect(page.getByTestId("pay-06")).toBeVisible();
    await shoot(page, locale, "PAY-06");
    await page.getByTestId("pay-06-cta").click();
    await page.getByTestId("fake-pay-approve").click();
    await expect(page.getByTestId("pro-on")).toBeVisible();
    await shoot(page, locale, "PAY-09");
    await page.getByTestId("pay-09-continue").click();
    await page.goto("/me/plan");
    await expect(page.getByTestId("pay-12")).toBeVisible();
    await shoot(page, locale, "PAY-12");
  });
}
