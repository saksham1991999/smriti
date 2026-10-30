// Vite config for the web app (TRD §4.2). Modes:
//   production (default `vite build`) talks to the real API from VITE_API_BASE_URL and must never
//   contain the fake API: the `no-fake-api` plugin fails the build if anything under src/dev/ is pulled in.
//   fake (`pnpm dev`) and e2e (`pnpm build:e2e`) run against the in-process fake in src/dev/fake-api.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const here = dirname(fileURLToPath(import.meta.url));
const devDir = join(here, "src", "dev");

/** Fails a production build that includes the fake API or any other dev-only module. */
function noFakeApi(mode: string): Plugin {
  return {
    name: "smriti-no-fake-api",
    enforce: "pre",
    load(id) {
      if (mode === "production" && id.startsWith(devDir)) {
        this.error(`Dev-only module in a production build: ${id.slice(here.length)}`);
      }
      return null;
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    noFakeApi(mode),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      manifest: {
        name: "Smriti",
        short_name: "Smriti",
        start_url: "/",
        display: "standalone",
        icons: [{ src: "/assets/app-icon.webp", sizes: "768x768", type: "image/webp" }],
      },
      workbox: {
        // App shell plus the art; sims are cached when first opened.
        globPatterns: ["**/*.{js,css,html,webp,woff2,svg}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/sims\//, /^\/v1\//],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          { urlPattern: ({ url }) => url.pathname.startsWith("/sims/"), handler: "StaleWhileRevalidate", options: { cacheName: "sims" } },
        ],
      },
    }),
  ],
  server: { port: 5190, host: "127.0.0.1", fs: { allow: [join(here, "..", "..")] } },
  preview: { port: 4317, host: "127.0.0.1" },
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/katex")) return "katex";
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/") || id.includes("node_modules/scheduler")) return "react";
          if (id.includes("@tanstack")) return "tanstack";
          if (id.includes("node_modules/i18next") || id.includes("intl-messageformat") || id.includes("@formatjs")) return "i18n-runtime";
          return undefined;
        },
      },
    },
  },
}));
