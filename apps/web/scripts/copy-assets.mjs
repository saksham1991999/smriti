// Copies the Agnes illustration kit the web app uses (design/mocks/assets/*.webp, licence "owned",
// see its README) into public/assets/, and writes src/assets/alt-text.json: file name → { en, hi }
// alt text from the kit's manifest. Only alt text is copied: prompts and generator details stay in
// the design folder. Run: node scripts/copy-assets.mjs
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "..", "design", "mocks", "assets");
const out = join(here, "..", "public", "assets");
mkdirSync(out, { recursive: true });

const manifest = JSON.parse(readFileSync(join(src, "manifest.json"), "utf8"));
const alt = {};
for (const img of manifest.images) {
  if (img.licence !== "owned") throw new Error(`unexpected licence for ${img.file}: ${img.licence}`);
  alt[img.file.replace(/\.webp$/, "")] = { en: img.alt.en, hi: img.alt.hi };
}
let n = 0;
for (const f of readdirSync(src)) {
  if (!f.endsWith(".webp")) continue;
  copyFileSync(join(src, f), join(out, f));
  n++;
}
mkdirSync(join(here, "..", "src", "assets"), { recursive: true });
writeFileSync(join(here, "..", "src", "assets", "alt-text.json"), JSON.stringify(alt, null, 1) + "\n");
console.log(`copied ${n} images, ${Object.keys(alt).length} alt entries`);
