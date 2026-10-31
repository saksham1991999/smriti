import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The site as built before any subject is released (`pnpm build:unreleased`): no exam pages,
// honest "coming soon" states, no sample content and no numbers about content.

test("home says coming soon, with no exam links and no sample banner", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".fixture-banner")).toHaveCount(0);
  await expect(page.locator(".eyebrow-chip")).toHaveText(/Coming soon for JEE, NEET and UPSC/);
  await expect(page.locator('a[href^="/exams/"]:not([href="/exams/"])')).toHaveCount(0);
  const upcoming = page.locator("#exams [data-upcoming]");
  await expect(upcoming).toHaveCount(4);
  await expect(page.locator('#exams [data-upcoming="ssc"] .pill')).toHaveText("Coming later");
  await expect(upcoming.locator("a")).toHaveCount(0);
  await expect(page.locator("#try")).toHaveCount(0);
  await expect(page.locator("footer")).toContainText("Coming soon");
  await expect(page.locator("#faq")).toContainText("are coming soon");
});

test("Hindi home says coming soon too", async ({ page }) => {
  await page.goto("/hi/");
  await expect(page.locator(".eyebrow-chip")).toContainText("जल्द आ रहा है");
  await expect(page.locator("#exams [data-upcoming]")).toHaveCount(4);
});

test("exam pages do not exist, and the exams page lists what is coming", async ({ page }) => {
  const res = await page.goto("/exams/jee-main/");
  expect(res?.status()).toBe(404);
  await page.goto("/exams/");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("[data-upcoming]")).toHaveCount(4);
});

test("the web app CTA and legal pages still work", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('#apps a[data-placement="apps"]')).toHaveAttribute("href", /\/start\?lang=en/);
  for (const path of ["/privacy/", "/terms/", "/childrens-data/"]) {
    expect((await page.goto(path))?.status()).toBe(200);
  }
});

test("sitemap has only the pages that exist", async ({ request }) => {
  const xml = await (await request.get("/sitemap-0.xml")).text();
  expect(xml).toContain("/exams/</loc>");
  expect(xml).not.toMatch(/\/exams\/[a-z0-9-]+\/<\/loc>/);
});

test("axe: coming-soon home has no serious violations", async ({ page }) => {
  await page.goto("/");
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});
