/**
 * Playwright for the web app (no `playwright install`: browsers come from PLAYWRIGHT_BROWSERS_PATH).
 *
 * - `fake` (default): the e2e build (`pnpm build:e2e`) on vite preview, with the in-process fake API.
 * - `real-api`: the e2e-real build (`pnpm build:e2e-real`) against apps/api on 127.0.0.1:8000.
 *   Start the API first (see e2e/real-api.spec.ts); Pro goes through the API's local FakeRazorpay.
 * - `e2e/screens.spec.ts` takes the screenshot matrix when SHOTS_DIR is set (skipped otherwise).
 */
import { defineConfig, devices } from "@playwright/test";

const realOnly = process.argv.some((a) => a.includes("real-api"));

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    {
      name: "fake",
      testIgnore: /real-api\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4317" },
    },
    {
      name: "real-api",
      testMatch: /real-api\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4318" },
    },
  ],
  webServer: realOnly
    ? { command: "pnpm run preview:e2e-real", url: "http://127.0.0.1:4318", reuseExistingServer: true, timeout: 60_000 }
    : { command: "pnpm run preview:e2e", url: "http://127.0.0.1:4317", reuseExistingServer: true, timeout: 60_000 },
});
