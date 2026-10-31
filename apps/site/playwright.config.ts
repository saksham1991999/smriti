import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Smoke and accessibility tests against the built site (`pnpm build` first, with
// CONTENT_INDEX_PATH=fixture). When dist-unreleased/ exists (`pnpm build:unreleased`), the
// "coming soon" tests also run against it, on the next port. Uses the preinstalled Chromium.
const PORT = Number(process.env.SITE_TEST_PORT ?? 4321);
const UNRELEASED_PORT = PORT + 1;
const withUnreleased = existsSync("dist-unreleased");
const UNRELEASED = /unreleased\.spec\.ts$/;

const server = (port: number, dir: string) => ({
  command: `node scripts/serve-dist.mjs ${port} ${dir}`,
  url: `http://127.0.0.1:${port}/`,
  reuseExistingServer: !process.env.CI,
  timeout: 60_000,
});

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "off" },
  webServer: [server(PORT, "dist"), ...(withUnreleased ? [server(UNRELEASED_PORT, "dist-unreleased")] : [])],
  projects: [
    { name: "desktop", testIgnore: UNRELEASED, use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    { name: "phone", testIgnore: UNRELEASED, use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
    ...(withUnreleased
      ? [
          {
            name: "unreleased",
            testMatch: UNRELEASED,
            use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 }, baseURL: `http://127.0.0.1:${UNRELEASED_PORT}` },
          },
        ]
      : []),
  ],
});
