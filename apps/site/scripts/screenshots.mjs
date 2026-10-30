#!/usr/bin/env node
// Full-page screenshots of the built site for visual review:
// pages × widths (390, 1280) × colour schemes (light, dark).
//
//   pnpm build && node scripts/screenshots.mjs [outDir] [--pages=/,/exams/neet/]
//
// Serves dist/ itself (scripts/serve-dist.mjs) on a free port and stops it afterwards.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const outDir = resolve(args.find((a) => !a.startsWith("--")) ?? "screenshots");
const pagesArg = args.find((a) => a.startsWith("--pages="));
const PAGES = pagesArg
  ? pagesArg.slice(8).split(",")
  : ["/", "/hi/", "/exams/neet/", "/hi/exams/neet/", "/exams/jee-main/physics/sample-chapter-1/sample-topic-1-1/"];
const WIDTHS = [390, 1280];
const SCHEMES = ["light", "dark"];
const PORT = 4400 + Math.floor(Math.random() * 400);

mkdirSync(outDir, { recursive: true });

const server = spawn(process.execPath, [join(import.meta.dirname, "serve-dist.mjs"), String(PORT), "dist"], {
  stdio: ["ignore", "pipe", "pipe"],
});
await new Promise((ok, fail) => {
  const t = setTimeout(() => fail(new Error("preview did not start")), 30000);
  server.stdout.on("data", (d) => {
    if (String(d).includes(String(PORT))) {
      clearTimeout(t);
      ok();
    }
  });
  server.on("exit", (c) => fail(new Error(`preview exited ${c}`)));
});

const browser = await chromium.launch();
const shots = [];
try {
  for (const scheme of SCHEMES) {
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({
        viewport: { width, height: width < 600 ? 844 : 900 },
        deviceScaleFactor: width < 600 ? 2 : 1,
        colorScheme: scheme,
        reducedMotion: "reduce",
      });
      const page = await ctx.newPage();
      for (const p of PAGES) {
        await page.goto(`http://127.0.0.1:${PORT}${p}`, { waitUntil: "networkidle" });
        // Scroll through so lazy images and client:visible islands load.
        await page.evaluate(async () => {
          for (let y = 0; y < document.body.scrollHeight; y += 600) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 60));
          }
          window.scrollTo(0, 0);
        });
        await page.waitForTimeout(400);
        const name = `${(p.replace(/^\/|\/$/g, "").replace(/\//g, "_") || "home")}-${width}-${scheme}.png`;
        const file = join(outDir, name);
        await page.screenshot({ path: file, fullPage: true });
        shots.push(file);
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
}
console.log(shots.join("\n"));
