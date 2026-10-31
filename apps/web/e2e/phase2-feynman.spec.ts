/** G-3 Feynman explain-back (AI-07 teaser, AI-10, AI-11) against the fake API, in EN and HI. */
import { expect, test } from "@playwright/test";
import { expectAccessible } from "./journey";
import { seedStudent, serverEvents, shoot, type Locale } from "./phase2";

const TOPIC = "fx.chapter-a.topic-a";
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

for (const locale of ["en", "hi"] as Locale[]) {
  test(`Feynman: teaser for free, explain, feedback, gaps (${locale})`, async ({ page }) => {
    await seedStudent(page, locale);

    // A free student sees the AI-07 teaser, which goes to the paywall.
    await page.goto(`/tutor/feynman/${TOPIC}`);
    await expect(page.getByTestId("ai-07")).toBeVisible();
    await expectAccessible(page, "AI-07");
    await shoot(page, locale, "AI-07-feynman");

    await seedStudent(page, locale, { pro: true });
    await page.goto(`/tutor/feynman/${TOPIC}`);
    // First time: the demo plays once, with Skip.
    await expect(page.getByTestId("ai-10-demo")).toBeVisible();
    await expectAccessible(page, "AI-10 demo");
    await page.getByRole("button", { name: locale === "hi" ? "छोड़ें" : "Skip" }).click();
    await expect(page.getByTestId("ai-10")).toBeVisible();
    await expect(page.getByTestId("ai-10-submit")).toBeDisabled();
    await expectAccessible(page, "AI-10");
    await shoot(page, locale, "AI-10");

    // Too few words keeps the button off; enough turns it on; Ctrl+Enter submits.
    await page.getByTestId("ai-10-text").fill(words(12));
    await expect(page.getByTestId("ai-10-submit")).toBeDisabled();
    await page.getByTestId("ai-10-text").fill(`${words(40)} wrong`);
    await expect(page.getByTestId("ai-10-submit")).toBeEnabled();
    await page.getByTestId("ai-10-text").press("Control+Enter");

    await expect(page.getByTestId("ai-11")).toBeVisible();
    await expect(page.getByTestId("meter-completeness")).toHaveAttribute("data-band", "getting_there");
    await expect(page.getByTestId("ai-11-wrong")).toBeVisible();
    await expectAccessible(page, "AI-11");
    await shoot(page, locale, "AI-11");

    // A follow-up answer re-scores in place.
    await page.getByTestId("follow-up-0-open").click();
    await page.getByTestId("follow-up-0-input").fill(words(10));
    await page.getByTestId("follow-up-0-send").click();
    await expect(page.getByTestId("ai-11-no-gaps")).toBeVisible();
    await expect(page.getByTestId("meter-completeness")).toHaveAttribute("data-band", "clear");
    await shoot(page, locale, "AI-11-clear");

    // Try again keeps the concept; a second full answer shows the rise since last time.
    await page.getByTestId("ai-11-try-again").click();
    await page.getByTestId("ai-10-text").fill(words(35));
    await page.getByTestId("ai-10-submit").click();
    await expect(page.getByTestId("ai-11-missed")).toBeVisible();
    await page.getByTestId("ai-11-add-gaps").click();
    await expect(page.getByTestId("ai-11-add-gaps")).toBeDisabled();
    await expect.poll(async () => (await serverEvents(page, "deck_card_upserted")).length, { timeout: 20_000 }).toBeGreaterThan(0);
  });
}

test("Feynman: the draft survives a reload and Speak needs the mic", async ({ page, context }) => {
  await seedStudent(page, "en", { pro: true });
  await page.evaluate(() => localStorage.setItem("smriti.feynman.demo_seen", "1"));
  await page.goto(`/tutor/feynman/${TOPIC}`);
  await page.getByTestId("ai-10-text").fill("A draft I am still writing");
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByTestId("ai-10-text")).toHaveValue("A draft I am still writing");

  // Speak with the mic blocked: the AI-12 denied variant offers typing instead.
  await context.clearPermissions();
  await page.getByTestId("mode-speak").click();
  await expect(page.getByTestId("ai-10-speak")).toBeVisible();
  await expectAccessible(page, "AI-10 speak");
  await shoot(page, "en", "AI-10-speak");
});
