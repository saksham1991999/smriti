// Vite config for the web app (TRD §4.2). Modes:
//   production (default `vite build`) talks to the real API from VITE_API_BASE_URL and must never
//   contain the fake API: the `no-fake-api` plugin fails the build if anything under src/dev/ is pulled in.
//   fake (`pnpm dev`) and e2e (`pnpm build:e2e`) run against the in-process fake in src/dev/fake-api.
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { dirname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const here = dirname(fileURLToPath(import.meta.url));
const devDir = join(here, "src", "dev");
const pkgVersion = (JSON.parse(readFileSync(join(here, "package.json"), "utf8")) as { version: string }).version;

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

const FIXTURE_CONTENT = join(here, "..", "..", "tools", "content-publish", "out");
const TYPES: Record<string, string> = { ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml" };

/**
 * Dev and e2e only: serves the published fixture content (tools/content-publish/out, written by
 * `pnpm --filter @smriti/content-publish publish:fixtures`) at /c/, where the CDN serves real
 * bundles and manifests. Production builds never include it.
 */
function fixtureContent(mode: string): Plugin | null {
  if (mode !== "fake" && mode !== "e2e" && mode !== "e2e-real") return null;
  const serve = (req: { url?: string }, res: ServerResponse, next: () => void) => {
    const path = (req.url ?? "").split("?")[0] ?? "";
    if (!path.startsWith("/c/")) return next();
    const file = normalize(join(FIXTURE_CONTENT, decodeURIComponent(path.slice(3))));
    if (!file.startsWith(FIXTURE_CONTENT + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const ext = file.slice(file.lastIndexOf("."));
    res.setHeader("Content-Type", TYPES[ext] ?? "application/octet-stream");
    res.setHeader("Cache-Control", /\.[0-9a-f]{64}\./.test(file) ? "public, max-age=31536000, immutable" : "no-cache");
    createReadStream(file).pipe(res);
  };
  return {
    name: "smriti-fixture-content",
    configureServer(server) {
      server.middlewares.use(serve);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve);
    },
  };
}

/** Modes that may run the in-process fake API. Every other mode gets a stub that throws. */
const FAKE_MODES = new Set(["fake", "e2e", "test"]);
/** Modes that run on the fixture content, so the mock runner shell can use the fixture blueprint. */
const FIXTURE_MODES = new Set(["fake", "e2e", "e2e-real", "test"]);

export default defineConfig(({ mode }) => ({
  define: { __APP_VERSION__: JSON.stringify(pkgVersion) },
  resolve: {
    // app-core pins its own React for its tests; the app must run on one copy (see the report).
    dedupe: ["react", "react-dom", "zustand", "@tanstack/react-query"],
    alias: {
      "@fake-api": FAKE_MODES.has(mode) ? join(here, "src", "dev", "fake-api", "index.ts") : join(here, "src", "boot", "noFakeApi.ts"),
      // Blueprints are not in the published manifest or an API route yet; until they are, only the
      // fixture modes get one (content/fixtures, labelled fixture) and production shows MOCK-01's empty state.
      "@mock-blueprint": FIXTURE_MODES.has(mode) ? join(here, "src", "dev", "fixtureBlueprint.ts") : join(here, "src", "boot", "noBlueprint.ts"),
    },
  },
  plugins: [
    noFakeApi(mode),
    fixtureContent(mode),
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
        navigateFallbackDenylist: [/^\/sims\//, /^\/v1\//, /^\/c\//],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          { urlPattern: ({ url }) => url.pathname.startsWith("/sims/"), handler: "StaleWhileRevalidate", options: { cacheName: "sims" } },
          // Bundles and media are content-addressed and immutable: cache first (TRD 7.2).
          {
            urlPattern: ({ url }) => /\/c\/(bundles|assets)\//.test(url.pathname),
            handler: "CacheFirst",
            options: { cacheName: "content", expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 90 } },
          },
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
