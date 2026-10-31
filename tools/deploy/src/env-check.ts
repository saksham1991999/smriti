/**
 * `pnpm env:check`: fails when code reads an environment variable that no `.env.example`
 * documents, or when `.env.example` lists a name that nothing reads (see env-scan.ts for the rules).
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
if (report.undocumented.length || report.dead.length) {
  console.error(`env:check failed: ${report.undocumented.length} undocumented, ${report.dead.length} unused`);
  process.exit(1);
}
console.log("env:check: every variable the code reads is documented, and every documented name is used");
