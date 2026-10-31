// Generates src/generated/types.ts from the JSON Schemas with json-schema-to-typescript.
// `--check` fails when the committed file is out of date (run in lint).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { compile, type JSONSchema } from "json-schema-to-typescript";

import { schemaFiles, type SchemaFile } from "../src/schemas.js";

const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(here, "..", "schemas");
const outFile = join(here, "..", "src", "generated", "types.ts");

/**
 * The top-level documents. Their $defs come along through references, so each type is emitted once.
 * json-schema-to-typescript resolves relative $refs against the file path.
 */
const roots: SchemaFile[] = [
  "common.schema.json",
  "exam.schema.json",
  "blueprint.schema.json",
  "subject.schema.json",
  "chapter.schema.json",
  "exam-map.schema.json",
  "card.schema.json",
  "lesson.schema.json",
  "questions.schema.json",
  "pyq-paper.schema.json",
  "mnemonics.schema.json",
  "media-requests.schema.json",
  "sim.schema.json",
  "extras.schema.json",
  "coverage-inputs.schema.json",
  "coverage.schema.json",
  "seed-pack-spec.schema.json",
  "releases.schema.json",
  "seed-pack.schema.json",
  "bundle.schema.json",
  "manifest.schema.json",
  "patch.schema.json",
  "publish-history.schema.json",
  "forge-draft.schema.json",
];

/**
 * One combined schema whose $defs reference each root file, so shared definitions are emitted
 * exactly once and names stay stable.
 */
async function generate(): Promise<string> {
  const defs: Record<string, JSONSchema> = {};
  for (const file of roots) {
    const schema = schemaFiles[file] as { title?: string; $defs?: Record<string, unknown> };
    if (file !== "common.schema.json" && schema.title) {
      defs[schema.title] = { $ref: `./${file}` } as JSONSchema;
    }
    for (const name of Object.keys(schema.$defs ?? {})) {
      if (defs[name]) continue;
      defs[name] = { $ref: `./${file}#/$defs/${name}` } as JSONSchema;
    }
  }
  const combined: JSONSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "SmritiContentTypes",
    type: "object",
    additionalProperties: false,
    properties: {},
    $defs: defs,
  } as JSONSchema;
  const ts = await compile(combined, "SmritiContentTypes", {
    cwd: schemaDir,
    bannerComment:
      "/* eslint-disable */\n/**\n * Generated from packages/content-schema/schemas by scripts/gen-types.ts.\n * Do not edit by hand: change the schema and run `pnpm --filter @smriti/content-schema gen:types`.\n */",
    additionalProperties: false,
    unreachableDefinitions: true,
    strictIndexSignatures: true,
    ignoreMinAndMaxItems: true,
    style: { printWidth: 100, singleQuote: false, trailingComma: "all" },
    $refOptions: { resolve: { http: false } } as never,
  });
  // The combined wrapper type itself is empty and not useful.
  return ts.replace(/export interface SmritiContentTypes \{\}\n\n?/, "");
}

const check = process.argv.includes("--check");
const output = await generate();
if (check) {
  let current = "";
  try {
    current = readFileSync(outFile, "utf8");
  } catch {
    current = "";
  }
  if (current !== output) {
    console.error("src/generated/types.ts is out of date. Run: pnpm --filter @smriti/content-schema gen:types");
    process.exit(1);
  }
  console.log("generated types are up to date");
} else {
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, output);
  console.log(`wrote ${outFile}`);
}
