#!/usr/bin/env node
// Builds the site as it looks before any subject is released, into dist-unreleased/, for the
// "coming soon" e2e tests. It points CONTENT_INDEX_PATH at a folder whose publish-report.json
// says `"site_index": null`, exactly what the publisher writes when nothing is released, and
// sets SITE_REQUIRE_CONTENT_INDEX=1 as production does.
//
//   node scripts/build-unreleased.mjs

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "site-unreleased-"));
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, "publish-report.json"),
  `${JSON.stringify({ schema: "publish-report@1", site_index: null, published_at: new Date(0).toISOString() }, null, 2)}\n`,
);

const env = { ...process.env, CONTENT_INDEX_PATH: join(out, "site-index.json"), SITE_REQUIRE_CONTENT_INDEX: "1" };
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, env, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run(process.execPath, ["scripts/prepare-assets.mjs"]);
run(process.execPath, ["node_modules/astro/bin/astro.mjs", "build", "--outDir", "dist-unreleased"]);
