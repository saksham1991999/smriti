#!/usr/bin/env -S npx tsx
/**
 * pnpm --filter @smriti/content-schema content:check [--root <dir>]... [--out <file>]
 *   [--write-coverage] [--strict] [--quiet]
 *
 * Validates content against the schemas, checks references, the concept graph, bilingual
 * completeness and blueprints, computes the coverage report per exam profile, writes a JSON
 * report, and exits non-zero on any error (or any warning with --strict).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { findRepoRoot, runContentCheck } from "./index.js";

interface Args {
  roots: string[];
  out: string | null;
  writeCoverage: boolean;
  strict: boolean;
  quiet: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { roots: [], out: null, writeCoverage: false, strict: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--root") args.roots.push(resolve(process.env.INIT_CWD ?? process.cwd(), next()));
    else if (a === "--out") args.out = resolve(process.env.INIT_CWD ?? process.cwd(), next());
    else if (a === "--write-coverage") args.writeCoverage = true;
    else if (a === "--strict") args.strict = true;
    else if (a === "--quiet") args.quiet = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        "content:check [--root <dir>]... [--out <report.json>] [--write-coverage] [--strict] [--quiet]",
      );
      process.exit(0);
    } else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const repoRoot = findRepoRoot();
const report = runContentCheck({
  repoRoot,
  ...(args.roots.length ? { roots: args.roots } : {}),
  strict: args.strict,
});

const out = args.out ?? join(repoRoot, "packages", "content-schema", ".reports", "content-check.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

if (args.writeCoverage) {
  for (const root of report.roots) {
    for (const cov of root.coverage) {
      const file = join(repoRoot, root.root, "coverage", `${cov.exam_profile}.json`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(cov, null, 2)}\n`);
    }
  }
}

for (const root of report.roots) {
  console.log(`\n${root.root}${root.fixture ? " (fixture course)" : ""}: ${root.files} files, ${root.errors} errors, ${root.warnings} warnings`);
  for (const cov of root.coverage) {
    console.log(
      `  coverage ${cov.exam_profile}: ${cov.totals.percent}% of ${cov.totals.concepts} concepts, syllabus ${cov.syllabus.percent}%, inventory ${cov.inventory.percent}%`,
    );
    for (const s of cov.subjects) {
      console.log(`    ${s.id}: ${s.tally.percent}%${s.released ? " (released)" : ""}${s.ready ? " ready" : " not ready"}`);
    }
  }
  const shown = args.quiet ? root.findings.filter((f) => f.severity === "error") : root.findings;
  for (const f of shown) {
    console.log(`  ${f.severity === "error" ? "ERROR" : "warn "} ${f.code} ${f.file}${f.path ? ` ${f.path}` : ""}: ${f.message}`);
  }
}
console.log(`\nreport: ${out}`);
console.log(report.ok ? "content check passed" : "content check FAILED");
process.exit(report.ok ? 0 : 1);
