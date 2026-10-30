// Reports the gzip size of the first route (TRD §15 budget: 350 KB gzip) and of every chunk.
// Usage: node scripts/bundle-size.mjs [distDir] [--budget=350]
// The first route is index.html's entry script plus everything it preloads or links (JS and CSS).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const args = process.argv.slice(2);
const dist = args.find((a) => !a.startsWith("--")) ?? "dist";
const budgetKb = Number(args.find((a) => a.startsWith("--budget="))?.split("=")[1] ?? 350);

const gz = (file) => gzipSync(readFileSync(file), { level: 9 }).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

const html = readFileSync(join(dist, "index.html"), "utf8");
const refs = new Set();
for (const m of html.matchAll(/(?:src|href)="\/?(assets\/[^"]+\.(?:js|css))"/g)) refs.add(m[1]);

// Static imports of the entry chunk are fetched before first paint too; follow them.
const queue = [...refs].filter((r) => r.endsWith(".js"));
while (queue.length) {
  const file = queue.shift();
  const src = readFileSync(join(dist, file), "utf8");
  for (const m of src.matchAll(/(?:^|[;\s])import\s*(?:[\w${}\s,*]+from\s*)?["']\.\/([^"']+\.js)["']/g)) {
    const ref = `assets/${m[1]}`;
    if (!refs.has(ref)) {
      refs.add(ref);
      queue.push(ref);
    }
  }
}

// Boot also awaits the core UI catalogues of one locale (src/lib/i18n.tsx CORE_NAMESPACES), which are
// dynamic chunks named after their namespace. Hindi chunks are told apart by their Devanagari text.
const CORE = ["learn", "ui", "onboarding"];
const assetFiles = readdirSync(join(dist, "assets"));
const catalogue = { en: [], hi: [] };
for (const ns of CORE) {
  for (const f of assetFiles.filter((name) => name.startsWith(`${ns}-`) && name.endsWith(".js"))) {
    const ref = `assets/${f}`;
    if (refs.has(ref)) continue;
    const text = readFileSync(join(dist, ref), "utf8");
    const isHi = (text.match(/[ऀ-ॿ]/g)?.length ?? 0) > text.length / 10;
    catalogue[isHi ? "hi" : "en"].push(ref);
  }
}

let first = 0;
const rows = [];
for (const ref of refs) {
  const size = gz(join(dist, ref));
  first += size;
  rows.push([ref, size]);
}
rows.sort((a, b) => b[1] - a[1]);
const sum = (list) => list.reduce((n, ref) => n + gz(join(dist, ref)), 0);
const enCat = sum(catalogue.en);
const hiCat = sum(catalogue.hi);
console.log(`First route, code and CSS (${refs.size} files):`);
for (const [ref, size] of rows) console.log(`  ${kb(size).padStart(10)}  ${ref}`);
console.log(`  ${kb(first).padStart(10)}  code and CSS`);
console.log(`  ${kb(enCat).padStart(10)}  core catalogues, English (${catalogue.en.length} chunks)`);
console.log(`  ${kb(hiCat).padStart(10)}  core catalogues, Hindi (English, the fallback, follows when idle)`);
const enTotal = first + enCat;
const hiTotal = first + hiCat;
console.log(`  ${kb(enTotal).padStart(10)}  total gzip, English (budget ${budgetKb} KB)`);
console.log(`  ${kb(hiTotal).padStart(10)}  total gzip, Hindi (budget ${budgetKb} KB)`);
first = Math.max(enTotal, hiTotal);

const all = readdirSync(join(dist, "assets"))
  .filter((f) => /\.(js|css)$/.test(f))
  .map((f) => [f, gz(join(dist, "assets", f))])
  .sort((a, b) => b[1] - a[1]);
console.log(`\nAll chunks (${all.length}), largest first:`);
for (const [f, size] of all.slice(0, 25)) console.log(`  ${kb(size).padStart(10)}  ${f}${refs.has(`assets/${f}`) ? "  [first route]" : ""}`);

if (first / 1024 > budgetKb) {
  console.error(`\nOver budget: ${kb(first)} > ${budgetKb} KB`);
  process.exitCode = 1;
}
