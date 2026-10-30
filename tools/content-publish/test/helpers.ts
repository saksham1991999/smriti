import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

export function editJson(root: string, rel: string, fn: (doc: Record<string, any>) => void): void {
  const path = join(root, rel);
  const doc = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
  fn(doc);
  writeFileSync(path, JSON.stringify(doc, null, 2));
}

export function cleanup(): void {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
}
