import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    // Sized for a full parallel turbo test run, where tests run several times slower than alone
    // (the 5 s default made that run flaky). The same value in every package.
    testTimeout: 30000,
    environment: "jsdom",
    include: ["test/**/*.test.tsx", "test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    css: false,
  },
});
