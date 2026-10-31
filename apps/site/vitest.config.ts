import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Sized for a full parallel turbo test run, where tests run several times slower than alone
    // (the 5 s default made that run flaky). The same value in every package.
    testTimeout: 30000,
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
