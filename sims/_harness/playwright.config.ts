import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.SIMS_PORT ?? 4174);

/**
 * E2E for every sim through the harness. Build first:
 *   pnpm --filter @smriti/sim-harness build:all && pnpm --filter @smriti/sim-harness test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: `node serve.mjs --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/_harness/dist/index.html`,
    reuseExistingServer: true,
    timeout: 10_000,
  },
});
