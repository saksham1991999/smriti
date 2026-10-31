import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    setupFiles: ["test/setup.ts"],
    css: false,
    // The whole-lesson flows take 1.5 s alone and reached 4 s in a full parallel `turbo run test`,
    // close to vitest's 5 s default; that timeout was the flake. Sized for a loaded machine, like
    // lesson-core and content-publish.
    testTimeout: 30000,
  },
});
