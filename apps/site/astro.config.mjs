// Astro config for the marketing and SEO site (TRD §4.1). Static output only: no server,
// no session, no sign-in (docs/flows/auth.md §5.4).
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import { readFileSync } from "node:fs";

// The brand domain (packages/config/brand.json) is the default origin, as in src/config/site.ts.
const brand = JSON.parse(readFileSync(new URL("../../packages/config/brand.json", import.meta.url), "utf8"));
const site = (process.env.SITE_URL?.trim() || `https://${brand.domain}`).replace(/\/+$/, "");

// Draft legal pages carry noindex until legal review, so they stay out of the sitemap too.
const NOT_IN_SITEMAP = [/\/privacy\/$/, /\/terms\/$/, /\/childrens-data\/$/, /\/404\/?$/];

export default defineConfig({
  site,
  output: "static",
  trailingSlash: "always",
  // CSS is small (about 5 KB compressed), so it is inlined: no render-blocking requests (TRD §15 LCP).
  build: { format: "directory", inlineStylesheets: "always" },
  compressHTML: true,
  prefetch: false,
  integrations: [
    react(),
    sitemap({
      filter: (page) => !NOT_IN_SITEMAP.some((re) => re.test(page)),
      i18n: { defaultLocale: "en", locales: { en: "en", hi: "hi" } },
    }),
  ],
  vite: {
    // packages/tokens/tokens.json lives outside the app folder.
    server: { fs: { allow: ["../.."] } },
  },
});
