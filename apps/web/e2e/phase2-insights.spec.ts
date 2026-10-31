/**
 * G-8 insights (MEM-25 with fading soon and sleep review) and the mixed drill, against the fake
 * API. The fake derives insights from the device's events (a new student: not enough data yet);
 * `smriti.fake-api.insights = demo` switches it to made-up numbers over the fixture topics.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./journey";
import { makePro, seedStudent, shoot, type Locale } from "./phase2";

async function demo(page: Page, on: boolean) {
  await page.evaluate((v) => (v ? localStorage.setItem("smriti.fake-api.insights", "demo") : localStorage.removeItem("smriti.fake-api.insights")), on);
}

for (const locale of ["en", "hi"] as Locale[]) {
  test(`insights: empty, calibration, fading, sleep review, mixed drill (${locale})`, async ({ page }) => {
    await seedStudent(page, locale);
    await demo(page, false);
    await page.goto("/memory/insights");
    await expect(page.getByTestId("mem-25-empty")).toBeVisible();
    await expect(page.getByTestId("mem-25-empty")).toContainText("30");
    await expect(page.getByTestId("mem-25-sleep-pro_required")).toBeVisible();
    await expect(page.getByTestId("mem-25-fading")).toBeVisible();
    await expectAccessible(page, "MEM-25 empty");
    await shoot(page, locale, "MEM-25-empty");

    await demo(page, true);
    await makePro(page);
    await page.goto("/memory/insights");
    await expect(page.getByTestId("mem-25-data")).toBeVisible();
    await expect(page.getByTestId("mem-25-sure-wrong")).toContainText("9");
    await expect(page.getByTestId("mem-25-lucky")).toContainText("4");
    await expect(page.getByTestId("mem-25-bars").getByRole("listitem")).toHaveCount(3);
    await expect(page.getByTestId("mem-25-fading").getByRole("listitem")).toHaveCount(2);
    await expect(page.getByTestId("mem-25-sleep-review")).toBeVisible();
    await expectAccessible(page, "MEM-25");
    await shoot(page, locale, "MEM-25");
    await page.getByTestId("mem-25-table-toggle").click();
    await expect(page.getByTestId("mem-25-table")).toBeVisible();
    await expectAccessible(page, "MEM-25 table");

    // Mixed drill: the fixture has one chapter, so mixing chapters isn't possible; topics are.
    await page.getByTestId("mem-25-mixed-start").click();
    await expect(page.getByTestId("mixed-setup")).toBeVisible();
    await page.getByTestId("mixed-start").click();
    await expect(page.getByTestId("mixed-error")).toBeVisible();
    await expectAccessible(page, "Mixed setup");
    await shoot(page, locale, "PRC-03-mixed");
    await page.getByTestId("mixed-by-topic").click();
    await page.getByTestId("mixed-count-5").click();
    await page.getByTestId("mixed-start").click();
    await expect(page.getByTestId("mixed-run")).toBeVisible();
    await expect(page.getByTestId("mixed-counter")).toContainText("5");
    const first = await page.getByTestId("mixed-question").getAttribute("data-topic");
    await page.getByTestId("mixed-question").locator("[data-testid^=option-]").first().click();
    await page.getByTestId("mixed-confidence").getByRole("radio").first().click();
    await expectAccessible(page, "Mixed runner");
    await shoot(page, locale, "PRC-04-mixed");
    await page.getByTestId("mixed-check").click();
    await expect(page.getByTestId("mixed-feedback")).toBeVisible();
    await page.getByTestId("mixed-next").click();
    // Neighbours come from different topics.
    await expect(page.getByTestId("mixed-question")).not.toHaveAttribute("data-topic", first ?? "");
    await page.getByTestId("mixed-close").click();
    await expect(page.getByTestId("mixed-done")).toBeVisible();
    await expectAccessible(page, "Mixed summary");
    await shoot(page, locale, "PRC-06-mixed");
    await demo(page, false);
  });
}
