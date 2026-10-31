/**
 * G-2 voice tutor (AI-07, AI-12 to AI-15) against the fake API, whose fake provider mints a fake
 * token: the live screen plays labelled fixture captions, no audio leaves the browser. Chromium's
 * fake mic stands in for a real one.
 */
import { expect, test } from "@playwright/test";
import { expectAccessible } from "./journey";
import { seedStudent, shoot, type Locale } from "./phase2";

test.use({ permissions: ["microphone"], launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

for (const locale of ["en", "hi"] as Locale[]) {
  test(`voice: teaser, connect, live captions, reconnect, end, transcript (${locale})`, async ({ page }) => {
    await seedStudent(page, locale);
    await page.goto("/tutor/voice");
    await expect(page.getByTestId("ai-07")).toBeVisible();
    await expectAccessible(page, "AI-07 voice");
    await shoot(page, locale, "AI-07-voice");

    await seedStudent(page, locale, { pro: true });
    await page.goto("/tutor/voice?from=/learn");
    await expect(page.getByTestId("ai-14")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("ai-14-fake")).toBeVisible();
    await expect(page.getByTestId("ai-14-captions-panel")).toContainText("Fixture tutor greeting", { timeout: 10_000 });
    await expect(page.getByTestId("ai-14-captions-panel")).toContainText("Fixture student question", { timeout: 10_000 });
    await expectAccessible(page, "AI-14");
    await shoot(page, locale, "AI-14");

    // Mute shows the muted hint; captions off collapses the panel to a chip.
    await page.getByTestId("ai-14-mute-wide").click();
    await expect(page.getByTestId("ai-14-state")).toHaveText(locale === "hi" ? "आपका माइक म्यूट है" : "You're muted");
    await page.getByTestId("ai-14-captions").click();
    await shoot(page, locale, "AI-14-muted");
    await page.getByTestId("ai-14-captions").click();
    await page.getByTestId("ai-14-mute-wide").click();

    // A dropped socket shows the weak-connection banner and reconnects with a fresh token.
    await page.evaluate(() => document.dispatchEvent(new Event("smriti:voice-drop")));
    await expect(page.getByTestId("ai-14-reconnecting")).toBeVisible();
    await shoot(page, locale, "AI-14-reconnecting");
    await expect(page.getByTestId("ai-14-reconnecting")).toBeHidden({ timeout: 15_000 });

    // Esc asks before ending.
    await page.waitForTimeout(3500);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ai-14-confirm")).toBeVisible();
    await expectAccessible(page, "AI-14 end confirm");
    await page.getByTestId("ai-14-confirm").getByRole("button", { name: locale === "hi" ? "खत्म करें" : "End" }).click();

    await expect(page.getByTestId("ai-15-normal")).toBeVisible();
    await expectAccessible(page, "AI-15");
    await shoot(page, locale, "AI-15");
    await page.getByTestId("ai-15-transcript").click();
    await expect(page.getByTestId("ai-15-transcript-view")).toContainText("Fixture tutor greeting");
    await expectAccessible(page, "AI-15 transcript");
    await shoot(page, locale, "AI-15-transcript");
  });
}

test("voice: unavailable and no time left are calm, with Switch to text", async ({ page }) => {
  await seedStudent(page, "en", { pro: true });
  await page.evaluate(() => localStorage.setItem("smriti.fake-api.voice", "unavailable"));
  await page.goto("/tutor/voice");
  await expect(page.getByTestId("ai-13-unavailable")).toBeVisible();
  await expect(page.getByTestId("ai-13-text")).toBeVisible();
  await expectAccessible(page, "AI-13 unavailable");
  await shoot(page, "en", "AI-13-unavailable");

  await page.evaluate(() => localStorage.setItem("smriti.fake-api.voice", "no_time"));
  await page.reload();
  await expect(page.getByTestId("ai-13-no-time")).toBeVisible();
  await expectAccessible(page, "AI-13 no time");
  await shoot(page, "en", "AI-13-no-time");
  await page.evaluate(() => localStorage.removeItem("smriti.fake-api.voice"));
});

test("voice: offline shows the connect error with Voice needs internet", async ({ page }) => {
  await seedStudent(page, "hi", { pro: true });
  // The browser says it is offline (the fake API runs in the page, so it would still answer).
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "onLine", { get: () => false }));
  await page.goto("/tutor/voice");
  await expect(page.getByTestId("ai-13-offline")).toBeVisible();
  await expectAccessible(page, "AI-13 offline");
  await shoot(page, "hi", "AI-13-offline");
});
