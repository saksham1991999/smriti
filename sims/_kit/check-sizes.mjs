#!/usr/bin/env node
// Builds every sim with SIM_SIZE_CHECK=1 and fails when a committed manifest's `size_bytes`
// differs from what the build produces (the build would otherwise rewrite it silently).
//   node sims/_kit/check-sizes.mjs            all sims
//   node sims/_kit/check-sizes.mjs ohms-law-circuit simple-pendulum
// Run by this package's `lint`, so `pnpm lint` in CI catches a stale size.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const simsDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const only = process.argv.slice(2);
const sims = readdirSync(simsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
  .map((d) => d.name)
  .filter((id) => existsSync(join(simsDir, id, 'manifest.json')) && existsSync(join(simsDir, id, 'vite.config.ts')))
  .filter((id) => only.length === 0 || only.includes(id));

const failed = [];
for (const id of sims) {
  const dir = join(simsDir, id);
  const before = readFileSync(join(dir, 'manifest.json'), 'utf8');
  try {
    execFileSync('pnpm', ['exec', 'vite', 'build', '--logLevel', 'error'], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SIM_SIZE_CHECK: '1' },
    });
    console.log(`sims:check ${id}: ok (${JSON.parse(before).size_bytes} bytes)`);
  } catch (err) {
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    const line = out.split('\n').find((l) => l.includes('size_bytes')) ?? out.trim().split('\n').slice(-3).join('\n');
    console.error(`sims:check ${id}: FAILED\n  ${line}`);
    failed.push(id);
  }
}
if (failed.length > 0) process.exit(1);
