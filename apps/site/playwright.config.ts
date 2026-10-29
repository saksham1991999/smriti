import { defineConfig, devices } from "@playwright/test";

// Smoke tests against the built site (`pnpm build` first). Uses the preinstalled Chromium.
const PORT = Number(process.env.SITE_TEST_PORT ?? 4321);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "off" },
  webServer: {
    command: `node scripts/serve-dist.mjs ${PORT} dist`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    { name: "phone", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],
});
