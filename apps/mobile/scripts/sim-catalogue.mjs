#!/usr/bin/env node
// Writes src/content/labs.generated.json from sims/*/manifest.json (the Labs tab list, LAB-01):
// id, title (EN/HI), subject, tasks (LAB-03/04 run them through sim-bridge), readings, size and
// licence. Run after a sim is added or changed.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sims = join(here, '..', '..', '..', 'sims');
const out = join(here, '..', 'src', 'content', 'labs.generated.json');

const labs = [];
for (const dir of readdirSync(sims).sort()) {
  if (dir.startsWith('_')) continue;
  const file = join(sims, dir, 'manifest.json');
  if (!existsSync(file)) continue;
  const m = JSON.parse(readFileSync(file, 'utf8'));
  labs.push({
    id: m.id,
    version: m.version,
    title: m.title,
    subject: m.subject,
    concepts: m.concepts,
    tasks: Array.isArray(m.tasks) ? m.tasks.length : 0,
    taskSpecs: Array.isArray(m.tasks) ? m.tasks : [],
    readings: Array.isArray(m.readings) ? m.readings : [],
    capabilities: Array.isArray(m.capabilities) ? m.capabilities : [],
    preferredOrientation: m.preferredOrientation ?? 'any',
    entry: m.entry ?? 'index.html',
    sizeBytes: m.size_bytes ?? null,
    licence: m.licence,
    attribution: m.attribution ?? null,
    aspect: m.aspect,
  });
}
writeFileSync(out, `${JSON.stringify(labs, null, 2)}\n`);
console.log(`labs: ${labs.length} sims -> ${out}`);
