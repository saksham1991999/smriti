/**
 * `pnpm env:check`: fails when code reads an environment variable that no `.env.example`
 * documents, when `.env.example` lists a name that nothing reads, or when packages/config's
 * SERVER_ENV_NAMES or SECRET_ENV_NAMES names a variable no `.env.example` lists (see env-scan.ts).
 * Prints names and file paths only, never values.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { check } from "./env-scan.ts";

function repoRoot(): string {
  let dir = resolve(dirname(fileURLToPath(import.meta.url)));
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const up = dirname(dir);
    if (up === dir) throw new Error("repository root not found");
    dir = up;
  }
  return dir;
}

const report = check(repoRoot());
for (const r of report.undocumented) console.error(`undocumented: ${r.name} (read in ${r.file}); add it to the .env.example for that app`);
for (const d of report.dead) console.error(`unused: ${d.name} (listed in ${d.file}); remove it, or move it under a [platform] section if a provider reads it`);
for (const s of report.stale) console.error(`stale: ${s.name} (in ${s.list}, packages/config/src/env.ts) is in no .env.example; remove it from the list`);
if (report.undocumented.length || report.dead.length || report.stale.length) {
  console.error(
    `env:check failed: ${report.undocumented.length} undocumented, ${report.dead.length} unused, ${report.stale.length} stale in packages/config`,
  );
  process.exit(1);
}
console.log("env:check: every variable the code reads is documented, and every documented name is used");
