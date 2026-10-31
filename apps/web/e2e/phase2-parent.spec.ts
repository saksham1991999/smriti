/**
 * Phase 3 parent mode (SET-13 to SET-17) against the fake API. A guest meets the gate and signs
 * in with the dev Google form; `smriti.fake-api.parent = demo` then links two fixture children
 * (A: class 1 to 5, managed, a pending time request; B: a teen with friends and a mock).
 */
import { expect, test, type Page } from "@playwright/test";
import { devGoogle, expectAccessible } from "./journey";
import { seedStudent, shoot, type Locale } from "./phase2";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";

async function demo(page: Page, on: boolean) {
  await page.evaluate((v) => (v ? localStorage.setItem("smriti.fake-api.parent", "demo") : localStorage.removeItem("smriti.fake-api.parent")), on);
}

for (const locale of ["en", "hi"] as Locale[]) {
  test(`parent mode: gate, dashboard, report, limits, consents (${locale})`, async ({ page }) => {
    await seedStudent(page, locale);
    await demo(page, false);

    // SET-13: a guest can't open parent mode.
    await page.goto("/parent");
    await expect(page.getByTestId("set-13")).toBeVisible();
    await expectAccessible(page, "SET-13");
    await shoot(page, locale, "SET-13");
    await page.getByTestId("set-13-google").click();
    await devGoogle(page, `parent-${locale}-${Date.now()}@example.test`, "E2E Parent");
    await expect(page).toHaveURL(/\/parent$/);

    // SET-14 with no children yet.
    await expect(page.getByTestId("set-14-empty")).toBeVisible();
    await expectAccessible(page, "SET-14 empty");

    // Two linked children and a time request.
    await demo(page, true);
    await page.reload();
    await expect(page.getByTestId("set-14-children").locator(":scope > li")).toHaveCount(2);
    await expect(page.getByTestId("set-14-needs")).toBeVisible();
    await expectAccessible(page, "SET-14");
    await shoot(page, locale, "SET-14");
    await page.getByTestId(`set-14-allow-${A}`).click();
    await expect(page.getByTestId("set-14-needs")).toHaveCount(0);

    // SET-15: this week, the table, and a quiet earlier week.
    await page.getByTestId(`set-14-report-${B}`).click();
    await expect(page.getByTestId("set-15")).toBeVisible();
    await expect(page.getByTestId("set-15-tiles")).toContainText("210");
    await expect(page.getByTestId("set-15-summary")).toContainText("50");
    await expect(page.getByTestId("set-15-mocks")).toBeVisible();
    await expect(page.getByTestId("set-15-next")).toBeDisabled();
    await expectAccessible(page, "SET-15");
    await shoot(page, locale, "SET-15");
    await page.getByTestId("set-15-table-toggle").click();
    await expect(page.getByTestId("set-15-table").locator("tbody tr")).toHaveCount(7);
    await page.getByTestId("set-15-prev").click();
    await expect(page.getByTestId("set-15-tiles")).toContainText("0");
    await expect(page.getByTestId("set-15-pet")).toBeVisible();
    await expectAccessible(page, "SET-15 quiet");

    // SET-16 for the little learner: limit, hours (checked), switches, save, and it sticks.
    await page.goto(`/parent/${A}/limits`);
    await expect(page.getByTestId("set-16")).toBeVisible();
    await expect(page.getByTestId("set-16-rhymes")).toBeVisible();
    await page.getByTestId("set-16-limit").getByRole("radio").nth(2).click();
    await page.getByTestId("set-16-hours").click();
    await page.getByTestId("set-16-from").fill("21:00");
    await page.getByTestId("set-16-to").fill("07:00");
    await expect(page.getByTestId("set-16-invalid")).toBeVisible();
    await expect(page.getByTestId("set-16-save")).toBeDisabled();
    await page.getByTestId("set-16-from").fill("07:00");
    await page.getByTestId("set-16-to").fill("20:00");
    await page.getByTestId("set-16-rhymes").getByRole("switch").click();
    await expectAccessible(page, "SET-16");
    await shoot(page, locale, "SET-16");
    await page.getByTestId("set-16-save").click();
    await expect(page.getByText(/Saved\.|सेव हो गया/).first()).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("set-16-limit").getByRole("radio").nth(2)).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("set-16-from")).toHaveValue("07:00");
    await expect(page.getByTestId("set-16-rhymes").getByRole("switch")).toHaveAttribute("aria-checked", "true");

    // SET-17 for the teen: friends, remove one, turn off sharing.
    await page.goto(`/parent/${B}/consents`);
    await expect(page.getByTestId("set-17-rows").locator(":scope > li")).toHaveCount(5);
    await expect(page.getByTestId("set-17-friends").getByRole("listitem")).toHaveCount(2);
    await expectAccessible(page, "SET-17");
    await shoot(page, locale, "SET-17");
    await page.locator("[data-testid^=set-17-remove-]").first().click();
    await expect(page.getByTestId("set-17-confirm")).toBeVisible();
    await expectAccessible(page, "SET-17 confirm");
    await page.getByTestId("set-17-confirm").getByRole("button").first().click();
    await expect(page.getByTestId("set-17-friends").getByRole("listitem")).toHaveCount(1);
    await page.getByTestId("set-17-off-community").click();
    await page.getByTestId("set-17-confirm").getByRole("button").first().click();
    await expect(page.getByTestId("set-17-off-community")).toHaveCount(0);

    // The little learner has no social or sharing rows.
    await page.goto(`/parent/${A}/consents`);
    await expect(page.getByTestId("set-17-rows").locator(":scope > li")).toHaveCount(3);
    await demo(page, false);
  });
}
