import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { CoverageReport } from "../generated/types.js";
import { computeCoverage } from "./coverage.js";
import { Findings, type Finding } from "./findings.js";
import { loadContentSet, type ContentSet } from "./load.js";
import { loadTokens, runRules } from "./rules.js";

export { computeCoverage } from "./coverage.js";
export { Findings } from "./findings.js";
export type { Finding, Severity } from "./findings.js";
export { loadContentSet } from "./load.js";
export type { ContentSet, ConceptEntry, Loaded, QuestionEntry, TopicEntry } from "./load.js";
export { findCycles, loadTokens, requiredLocales, runRules } from "./rules.js";
export { MEDIA_REF, mediaRefs, walkContent } from "./walk.js";
export { hasReleases, isChapterReleased, releasedScope, RELEASES_FILE } from "./releases.js";
export type { ReleasedScope } from "./releases.js";
export type { Visit } from "./walk.js";
export type { Tokens } from "./rules.js";

export interface RootReport {
  /** Path of the content root, relative to the repo root. */
  root: string;
  fixture: boolean;
  files: number;
  errors: number;
  warnings: number;
  coverage: CoverageReport[];
  findings: Finding[];
}

export interface CheckReport {
  schema: "content-check-report@1";
  ok: boolean;
  totals: { files: number; errors: number; warnings: number };
  roots: RootReport[];
}

export interface CheckOptions {
  /** Absolute repo root. Defaults to the nearest folder with pnpm-workspace.yaml. */
  repoRoot?: string;
  /** Content roots to check. Defaults to content/ (without fixtures/) and content/fixtures/. */
  roots?: string[];
  /** Treat warnings as failures. */
  strict?: boolean;
}

export function findRepoRoot(from = dirname(fileURLToPath(import.meta.url))): string {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("could not find the repo root (pnpm-workspace.yaml)");
    dir = parent;
  }
}

/** True when the root is a fixture course (content/fixtures or a copy of it). */
export function isFixtureRoot(root: string): boolean {
  return /(^|[/\\])fixtures([/\\]|$)/.test(resolve(root));
}

/** Load one content root and run every rule and the coverage report on it. */
export function checkRoot(root: string, repoRoot: string): { set: ContentSet; report: RootReport } {
  const findings = new Findings();
  const absRoot = resolve(root);
  const fixture = isFixtureRoot(absRoot);
  const set = loadContentSet(absRoot, findings, {
    repoRoot,
    // The real content root skips the fixture course; both are checked as separate sets.
    skipDirs: fixture ? [] : ["fixtures"],
    // Repo-level sim manifests count for real content.
    simRoots: fixture ? [] : [join(repoRoot, "sims")],
  });
  set.isFixtureRoot = fixture;
  // Fixture flags depend on the root, so re-run them now that the set knows it.
  const tokens = loadTokens(repoRoot);
  runRules(set, findings, tokens);
  const coverage: CoverageReport[] = [];
  for (const profileId of [...set.profiles.keys()].sort()) {
    const report = computeCoverage(set, profileId, findings);
    if (report) coverage.push(report);
  }
  const sorted = findings.sorted();
  return {
    set,
    report: {
      root: relative(repoRoot, absRoot) || ".",
      fixture,
      files: set.files.length,
      errors: findings.errorCount,
      warnings: findings.warningCount,
      coverage,
      findings: sorted,
    },
  };
}

export function runContentCheck(options: CheckOptions = {}): CheckReport {
  const repoRoot = options.repoRoot ?? findRepoRoot();
  const roots = options.roots ?? [join(repoRoot, "content"), join(repoRoot, "content", "fixtures")];
  const reports = roots.filter((r) => existsSync(r)).map((r) => checkRoot(r, repoRoot).report);
  const totals = {
    files: reports.reduce((a, r) => a + r.files, 0),
    errors: reports.reduce((a, r) => a + r.errors, 0),
    warnings: reports.reduce((a, r) => a + r.warnings, 0),
  };
  return {
    schema: "content-check-report@1",
    ok: totals.errors === 0 && (!options.strict || totals.warnings === 0),
    totals,
    roots: reports,
  };
}
