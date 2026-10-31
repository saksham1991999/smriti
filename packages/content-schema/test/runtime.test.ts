import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as root from "../src/index.js";
import * as runtime from "../src/runtime.js";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Follows relative imports from a file and returns every module it pulls in. */
function moduleGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)) {
      const spec = m[1] ?? "";
      if (spec.startsWith(".")) visit(join(dirname(file), spec.replace(/\.js$/, ".ts")));
      else seen.add(`pkg:${spec}`);
    }
  };
  visit(entry);
  return seen;
}

describe("runtime entry", () => {
  it("exports the same runtime helpers as the package root", () => {
    for (const name of ["localize", "splitMath", "blankIds", "convertUnit", "BLANK_TOKEN", "ONLINE_ONLY_CARD_TYPES", "mathKey"]) {
      expect(name in runtime, name).toBe(true);
      expect((runtime as Record<string, unknown>)[name]).toBe((root as Record<string, unknown>)[name]);
    }
  });

  it("pulls in no validator, no JSON schema and no other package", () => {
    const graph = [...moduleGraph(join(src, "runtime.ts"))];
    expect(graph.filter((m) => m.startsWith("pkg:"))).toEqual([]);
    expect(graph.some((m) => /validate|schemas/.test(m))).toBe(false);
  });
});
