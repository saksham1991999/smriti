import { defineConfig } from "vitest/config";

export default defineConfig({
  // Sized for a full parallel turbo test run (the 5 s default made that run flaky).
  test: { environment: "node", include: ["test/**/*.test.ts"], testTimeout: 30000 },
});
