// Astro config for the marketing and SEO site (TRD §4.1). Static output only: no server,
// no session, no sign-in (docs/flows/auth.md §5.4).
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";

const site = (process.env.SITE_URL || "https://www.smriti.example").replace(/\/+$/, "");

// Draft legal pages carry noindex until legal review, so they stay out of the sitemap too.
const NOT_IN_SITEMAP = [/\/privacy\/$/, /\/terms\/$/, /\/404\/?$/];

export default defineConfig({
  site,
  output: "static",
  trailingSlash: "always",
  build: { format: "directory", inlineStylesheets: "auto" },
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
