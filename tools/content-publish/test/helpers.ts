import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findRepoRoot } from "@smriti/content-schema/check";

export const repoRoot = findRepoRoot(__dirname);
export const fixtures = join(repoRoot, "content", "fixtures");
export const NOW = new Date("2026-10-30T00:00:00.000Z");

const temps: string[] = [];

export function tempDir(prefix = "smriti-publish-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/** A writable copy of the fixture course (the folder name keeps it a fixture root). */
export function fixtureCopy(): string {
  const root = join(tempDir(), "fixtures");
  cpSync(fixtures, root, { recursive: true });
  return root;
}

/**
 * The fixture course turned into a "real" content root (test data): no fixture flags, a folder
 * name that is not `fixtures`, and approved media whose files live in R2 (no source_path). Its
 * repo root is a temporary folder whose tokens map the fixture subject, so the check passes.
 * Nothing is released and there are no seed packs. Media that is not approved stays requested,
 * which is what the release-gate tests need.
 */
export function realCourse(): { root: string; repo: string } {
  const dir = tempDir();
  const repo = join(dir, "repo");
  const root = join(dir, "course");
  mkdirSync(join(repo, "packages", "tokens"), { recursive: true });
  const tokens = JSON.parse(readFileSync(join(repoRoot, "packages", "tokens", "tokens.json"), "utf8")) as { subjectMap: Record<string, string> };
  tokens.subjectMap.fx = "physics";
  writeFileSync(join(repo, "packages", "tokens", "tokens.json"), JSON.stringify(tokens));
  writeFileSync(join(repo, "pnpm-workspace.yaml"), "packages: []\n");
  cpSync(fixtures, root, { recursive: true });
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".json") ? [join(d, e.name)] : []));
  for (const file of walk(root)) {
    const doc = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
    delete doc.fixture;
    if (doc.schema === "media-requests@1") for (const r of doc.requests) if (r.result) delete r.result.source_path;
    if (doc.schema === "releases@1") doc.profiles = {};
    writeFileSync(file, JSON.stringify(doc, null, 2));
  }
  // Seed packs copy real files into the app; this course's files "live in R2".
  rmSync(join(root, "seed-packs"), { recursive: true, force: true });
  return { root, repo };
}

/** Releases these chapters (and whole subjects) of the fixture profile in content/releases.json. */
export function release(root: string, scope: { subjects?: string[]; chapters?: string[] }): void {
  editJson(root, "releases.json", (d) => {
    d.profiles = { "fx-exam-2027": { subjects: scope.subjects ?? [], chapters: scope.chapters ?? [] } };
  });
}

/** Approves every media request that is not approved yet (test data: the files "live in R2"). */
export function approveAll(root: string): void {
  editJson(root, "media/requests/fx/chapter-a.json", (d) => {
    for (const r of d.requests) {
      if (r.status === "approved") continue;
      r.status = "approved";
      r.result =
        r.kind === "sim"
          ? { sim_id: "fx-sim", sha256: "0".repeat(64), reused: false }
          : { sha256: createHash("sha256").update(r.id).digest("hex"), asset_id: null, reused: false, mime: "application/octet-stream", bytes: 1000 };
    }
  });
}

export function editJson(root: string, rel: string, fn: (doc: Record<string, any>) => void): void {
  const path = join(root, rel);
  const doc = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
  fn(doc);
  writeFileSync(path, JSON.stringify(doc, null, 2));
}

export function cleanup(): void {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
}
