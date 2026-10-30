/**
 * Guest → onboarding → first lesson → streak day 1 against the real apps/api (no fake API).
 * Billing routes don't exist on the server yet, so Pro is not part of this project.
 *
 * Start the API first (from apps/api, with the fixture content published and seeded):
 *   APP_ENV=local AI_PROVIDER=fake \
 *   CONTENT_LOCAL_DIR=<repo>/tools/content-publish/out CONTENT_MANIFEST_PATH='manifests/{exam}.{locale}.json' \
 *   CORS_ORIGINS=http://127.0.0.1:4318 uv run uvicorn smriti_api.main:app --port 8000
 * then: pnpm --filter @smriti/web e2e:real
 */
import { expect, test } from "@playwright/test";
import { expectAccessible, finishFirstWin, onboard, playLesson, type Locale } from "./journey";

const API = "http://127.0.0.1:8000";

test.beforeAll(async ({ request }) => {
  const r = await request.get(`${API}/healthz`).catch(() => null);
  test.skip(!r || !r.ok(), `apps/api is not running on ${API}`);
});

for (const locale of ["en", "hi"] as Locale[]) {
  test(`guest to streak on the real API (${locale})`, async ({ page }) => {
    const calls: string[] = [];
    page.on("response", (r) => {
      if (r.url().startsWith(API)) calls.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`);
    });

    await onboard(page, locale, { petName: locale === "hi" ? "मिट्टी" : "Mitti" });
    await playLesson(page, /\/onboarding\/first-win/);
    await finishFirstWin(page);
    await expectAccessible(page, "HOME-01");

    // The server has the events and agrees on the streak.
    await expect
      .poll(async () => {
        await page.evaluate(() => window.dispatchEvent(new Event("online")));
        return calls.filter((c) => /POST \/v1\/sync\/events 20\d/.test(c)).length;
      }, { timeout: 30_000 })
      .toBeGreaterThan(0);
    await page.reload();
    await expect(page.getByTestId("home-streak")).toBeVisible();
    await expect(page.getByTestId("home-streak")).toContainText("1");
    expect(calls.some((c) => /GET \/v1\/sync\/state 200/.test(c))).toBe(true);
    expect(calls.filter((c) => / 5\d\d$/.test(c))).toEqual([]);
  });
}
