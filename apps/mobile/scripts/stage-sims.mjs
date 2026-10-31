#!/usr/bin/env node
// Copies built sims (sims/<id>/dist, from `pnpm --filter "./sims/*" build`) into <out>/<id>/<version>/,
// the layout the CDN uses (R2 sims/{id}/{version}/, TRD §7.3). For local runs: serve <out> and set
// EXPO_PUBLIC_SIM_BASE_URL to its URL. Production sims are published by the content pipeline.
//
//   node scripts/stage-sims.mjs dist-web/sims
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sims = join(here, '..', '..', '..', 'sims');
const out = resolve(process.argv[2] ?? join(here, '..', 'dist-sims'));

let staged = 0;
const missing = [];
for (const dir of readdirSync(sims).sort()) {
  if (dir.startsWith('_')) continue;
  const manifest = join(sims, dir, 'manifest.json');
  const dist = join(sims, dir, 'dist');
  if (!existsSync(manifest)) continue;
  if (!existsSync(join(dist, 'index.html'))) {
    missing.push(dir);
    continue;
  }
  const m = JSON.parse(readFileSync(manifest, 'utf8'));
  const target = join(out, m.id, m.version);
  mkdirSync(target, { recursive: true });
  cpSync(dist, target, { recursive: true });
  staged++;
}
console.log(`sims: ${staged} staged -> ${out}`);
if (missing.length) console.log(`not built (run the sim builds first): ${missing.join(', ')}`);
