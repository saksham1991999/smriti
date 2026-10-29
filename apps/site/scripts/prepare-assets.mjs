#!/usr/bin/env node
// Build-time image work, run before `astro dev` and `astro build`:
//   1. Smaller WebP widths of every illustration in public/assets (for srcset), in public/assets/w/.
//   2. Open Graph images (1200 × 630 JPEG) cropped from existing Agnes scenes, in public/og/.
//      No text is baked in (AGENTS rule 7); only the brand mark is placed, on white as DESIGN §12 asks.
// Outputs are generated, so they are git-ignored and rebuilt when the sources change.

import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, "..");
const pub = join(site, "public");
const illos = JSON.parse(readFileSync(join(site, "src", "data", "illustrations.json"), "utf8")).images;

export const WIDTHS = [320, 640];

const fresh = (out, src) => existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs;

async function variants() {
  mkdirSync(join(pub, "assets", "w"), { recursive: true });
  let made = 0;
  for (const [name, meta] of Object.entries(illos)) {
    const src = join(pub, "assets", meta.file);
    for (const w of WIDTHS) {
      if (w >= meta.width) continue;
      const out = join(pub, "assets", "w", `${name}-${w}.webp`);
      if (fresh(out, src)) continue;
      await sharp(src).resize({ width: w }).webp({ quality: 80, alphaQuality: 90, effort: 5 }).toFile(out);
      made++;
    }
  }
  return made;
}

const OG = [
  { out: "default.jpg", art: "scene-welcome.webp" },
  { out: "exam.jpg", art: "scene-exam-goal.webp" },
];

async function og() {
  mkdirSync(join(pub, "og"), { recursive: true });
  const mark = join(pub, "brand", "smriti-mark-256.png");
  const markPx = 120;
  const pad = 28;
  const plate = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${markPx + pad * 2}" height="${markPx + pad * 2}"><rect width="100%" height="100%" rx="36" fill="white"/></svg>`,
  );
  const markBuf = await sharp(mark).resize(markPx, markPx).png().toBuffer();
  let made = 0;
  for (const o of OG) {
    const src = join(pub, "assets", o.art);
    const out = join(pub, "og", o.out);
    if (fresh(out, src)) continue;
    await sharp(src)
      .resize(1200, 630, { fit: "cover", position: "centre" })
      .composite([
        { input: plate, left: 48, top: 48 },
        { input: markBuf, left: 48 + pad, top: 48 + pad },
      ])
      .jpeg({ quality: 84, mozjpeg: true })
      .toFile(out);
    made++;
  }
  return made;
}

const [v, o] = [await variants(), await og()];
console.log(`prepare-assets: ${v} illustration widths, ${o} OG images (others up to date)`);
