#!/usr/bin/env node
// Copies the Agnes illustrations the site uses from design/mocks/assets into public/assets,
// and writes src/data/illustrations.json with each file's alt text (en, hi), size, source,
// licence and review status from the mock kit's manifest. Run it after changing USED below.
//
//   node scripts/sync-illustrations.mjs
//
// Only the files listed here are copied (the brief: copy only what the site uses).
// Prompts and generator model names are deliberately not copied (AGENTS.md rule 4).

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, "..");
const kit = join(site, "..", "..", "design", "mocks", "assets");

export const USED = [
  "ui-language-hello.webp",
  "scene-welcome.webp",
  "scene-exam-goal.webp",
  "cat-reading.webp",
  "cat-thinking.webp",
  "cat-celebrate.webp",
  "cat-plant.webp",
  "cat-price-tag.webp",
  "dog-thinking.webp",
  "dog-wave.webp",
  "memory-hook-sample.webp",
  "plant-sprout.webp",
  "plant-flowering.webp",
  "subject-physics.webp",
  "subject-chemistry.webp",
  "subject-biology.webp",
  "subject-maths.webp",
  "subject-history.webp",
  "subject-geography.webp",
  "subject-polity.webp",
  "subject-economy.webp",
  "subject-english.webp",
  "subject-reasoning.webp",
  "subject-evs.webp",
];

const manifest = JSON.parse(readFileSync(join(kit, "manifest.json"), "utf8"));
const byFile = new Map(manifest.images.map((m) => [m.file, m]));

mkdirSync(join(site, "public", "assets"), { recursive: true });
const out = {};
for (const file of USED) {
  const m = byFile.get(file);
  if (!m) throw new Error(`${file} is not in design/mocks/assets/manifest.json`);
  if (!m.alt?.en || !m.alt?.hi) throw new Error(`${file} has no en/hi alt text`);
  copyFileSync(join(kit, file), join(site, "public", "assets", file));
  out[file.replace(/\.webp$/, "")] = {
    file,
    preset: m.preset,
    width: m.delivered_px[0],
    height: m.delivered_px[1],
    transparent: Boolean(m.transparent),
    alt: m.alt,
    source: m.source,
    licence: m.licence,
    status: m.status,
    sha256: m.sha256,
  };
}

const doc = {
  $description:
    "Illustrations used by the site, copied from design/mocks/assets by scripts/sync-illustrations.mjs. Generated with Agnes AI through the visual-director workflow (DESIGN.md §6). Status is the kit's review status: the mascots and plant are not yet approved by the owner.",
  images: out,
};
writeFileSync(join(site, "src", "data", "illustrations.json"), JSON.stringify(doc, null, 2) + "\n");
console.log(`copied ${USED.length} illustrations`);
