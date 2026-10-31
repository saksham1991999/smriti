/**
 * Phase 3 live mocks (MOCK-03 room and MOCK-24 leaderboard) against the fake API. The fake has one
 * live mock, `fx-live-1`; `smriti.fake-api.live` picks its window state (scheduled, open, late,
 * taken, results, too_few).
 */
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./journey";
import { makePro, seedStudent, shoot, type Locale } from "./phase2";

const ROOM = "/practice/live/fx-live-1";

async function mode(page: Page, m: string | null) {
  await page.evaluate((v) => (v ? localStorage.setItem("smriti.fake-api.live", v) : localStorage.removeItem("smriti.fake-api.live")), m);
}

for (const locale of ["en", "hi"] as Locale[]) {
  test(`live mock: room, register, calendar, open, late, taken, leaderboard (${locale})`, async ({ page }) => {
    await seedStudent(page, locale);
    await mode(page, null);

    // Unknown mock.
    await page.goto("/practice/live/nope");
    await expect(page.getByTestId("mock-03-missing")).toBeVisible();

    // Free student: the window and countdown show; registering is Pro.
    await page.goto(ROOM);
    await expect(page.getByTestId("mock-03-window")).toBeVisible();
    await expect(page.getByTestId("mock-03-countdown")).toContainText(/0?2:1\d:\d\d/);
    await expect(page.getByTestId("mock-03-unlock")).toBeVisible();
    await expectAccessible(page, "MOCK-03 free");
    await shoot(page, locale, "MOCK-03-free");
    await page.getByTestId("mock-03-unlock").click();
    await expect(page).toHaveURL(/\/pro/);

    // Pro: register, then the reminder card with the calendar file.
    await makePro(page);
    await page.goto(ROOM);
    await page.getByTestId("mock-03-register").click();
    await expect(page.getByTestId("mock-03-registered")).toBeDisabled();
    await expect(page.getByTestId("mock-03-registrations")).toContainText("1201");
    await expect(page.getByTestId("mock-03-reminder")).toContainText("15");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("mock-03-calendar").click()]);
    expect(download.suggestedFilename()).toBe("fx-live-1.ics");
    const file = readFileSync((await download.path()) ?? "", "utf8");
    expect(file).toContain("BEGIN:VEVENT");
    expect(file).toContain("SUMMARY:");
    await expectAccessible(page, "MOCK-03 registered");
    await shoot(page, locale, "MOCK-03-registered");
    await page.getByTestId("mock-03-unregister").click();
    await expect(page.getByTestId("mock-03-register")).toBeVisible();

    // The window is open: Start now, and the close countdown.
    await mode(page, "open");
    await page.reload();
    await expect(page.getByTestId("mock-03-start")).toBeEnabled();
    await expect(page.getByTestId("mock-03-late")).toHaveCount(0);
    await expectAccessible(page, "MOCK-03 open");
    await shoot(page, locale, "MOCK-03-open");

    // Late: less than the full paper is left.
    await mode(page, "late");
    await page.reload();
    await expect(page.getByTestId("mock-03-late")).toContainText(/\b(39|40)\b/);
    await shoot(page, locale, "MOCK-03-late");

    // Offline: the countdown keeps running, Start is disabled.
    await page.context().setOffline(true);
    await expect(page.getByTestId("mock-03-offline")).toBeVisible();
    await expect(page.getByTestId("mock-03-start")).toBeDisabled();
    await page.context().setOffline(false);

    // Taken: waiting for ranks, no action.
    await mode(page, "taken");
    await page.reload();
    await expect(page.getByTestId("mock-03-taken")).toBeVisible();
    await expect(page.getByTestId("mock-03-start")).toHaveCount(0);

    // Results: the leaderboard.
    await mode(page, "results");
    await page.reload();
    await page.getByTestId("mock-03-leaderboard").click();
    await expect(page.getByTestId("mock-24-top").getByRole("listitem")).toHaveCount(3);
    await expect(page.getByTestId("mock-24-table").locator("tbody tr")).toHaveCount(9);
    await expect(page.getByTestId("mock-24-you")).toContainText("57");
    await expectAccessible(page, "MOCK-24");
    await shoot(page, locale, "MOCK-24");

    // Too few ranked.
    await mode(page, "too_few");
    await page.reload();
    await expect(page.getByTestId("mock-24-pending")).toBeVisible();
    await expectAccessible(page, "MOCK-24 too few");
    await shoot(page, locale, "MOCK-24-too-few");
    await mode(page, null);
  });
}
