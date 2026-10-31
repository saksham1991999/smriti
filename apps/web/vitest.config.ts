import { join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify("test") },
  resolve: {
    dedupe: ["react", "react-dom", "zustand", "@tanstack/react-query"],
    alias: {
      "@fake-api": join(here, "src", "dev", "fake-api", "index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    setupFiles: ["test/setup.ts"],
    css: false,
    // jsdom flows slow down several times in a full parallel `turbo run test`; vitest's 5 s
    // default is too tight there (the same flake as lesson-player-web).
    testTimeout: 30000,
  },
});
