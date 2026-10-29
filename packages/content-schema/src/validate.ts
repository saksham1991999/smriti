import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { DOC_SCHEMAS, SCHEMA_BASE, isDocSchemaId, schemaFiles, type SchemaFile } from "./schemas.js";

export interface SchemaIssue {
  /** JSON pointer into the document, "" for the root. */
  path: string;
  message: string;
  keyword: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T; schema: string }
  | { ok: false; errors: SchemaIssue[]; schema: string | null };

let ajvInstance: Ajv2020 | null = null;
const compiled = new Map<SchemaFile, ValidateFunction>();

/** The shared Ajv instance with every Smriti schema registered. */
export function getAjv(): Ajv2020 {
  if (ajvInstance) return ajvInstance;
  const ajv = new Ajv2020({
    allErrors: true,
    discriminator: true,
    strict: true,
    strictRequired: false,
    allowUnionTypes: true,
  });
  // ajv-formats ships CommonJS; its default export is the plugin function.
  const plugin = addFormats as unknown as (a: Ajv2020) => Ajv2020;
  plugin(ajv);
  for (const schema of Object.values(schemaFiles)) {
    ajv.addSchema(schema as object);
  }
  ajvInstance = ajv;
  return ajv;
}

export function getValidator(file: SchemaFile): ValidateFunction {
  const existing = compiled.get(file);
  if (existing) return existing;
  const fn = getAjv().getSchema(SCHEMA_BASE + file);
  if (!fn) throw new Error(`schema not registered: ${file}`);
  compiled.set(file, fn);
  return fn;
}

/**
 * Ajv reports every failing branch of a oneOf. With a discriminator only the matching branch is
 * checked, so the errors are already focused; this drops duplicates and the generic oneOf/if noise.
 */
export function formatErrors(errors: ErrorObject[] | null | undefined): SchemaIssue[] {
  if (!errors) return [];
  const seen = new Set<string>();
  const out: SchemaIssue[] = [];
  for (const e of errors) {
    if (e.keyword === "oneOf" && errors.length > 1) continue;
    let message = e.message ?? "is invalid";
    if (e.keyword === "additionalProperties" || e.keyword === "unevaluatedProperties") {
      const p = e.params as { additionalProperty?: string; unevaluatedProperty?: string };
      message = `has unknown property "${p.additionalProperty ?? p.unevaluatedProperty ?? "?"}"`;
    } else if (e.keyword === "enum") {
      const p = e.params as { allowedValues?: unknown[] };
      message = `must be one of ${JSON.stringify(p.allowedValues)}`;
    } else if (e.keyword === "const") {
      const p = e.params as { allowedValue?: unknown };
      message = `must be ${JSON.stringify(p.allowedValue)}`;
    } else if (e.keyword === "discriminator") {
      const p = e.params as { tag?: string; tagValue?: unknown };
      message = `has an unknown ${p.tag ?? "type"} ${JSON.stringify(p.tagValue)}`;
    }
    const key = `${e.instancePath}|${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path: e.instancePath, message, keyword: e.keyword });
  }
  return out;
}

/** Validate against one schema file. */
export function validateWith<T = unknown>(file: SchemaFile, doc: unknown): ValidationResult<T> {
  const fn = getValidator(file);
  if (fn(doc)) return { ok: true, value: doc as T, schema: file };
  return { ok: false, errors: formatErrors(fn.errors), schema: file };
}

/** Validate a content document, choosing the schema from its `schema` field. */
export function validateDocument<T = unknown>(doc: unknown): ValidationResult<T> {
  const tag = typeof doc === "object" && doc !== null ? (doc as { schema?: unknown }).schema : undefined;
  if (!isDocSchemaId(tag)) {
    return {
      ok: false,
      schema: null,
      errors: [
        {
          path: "/schema",
          keyword: "schema",
          message:
            tag === undefined
              ? "is missing (every content file names its schema, for example \"lesson@1\")"
              : `names an unknown schema ${JSON.stringify(tag)}`,
        },
      ],
    };
  }
  return validateWith<T>(DOC_SCHEMAS[tag], doc);
}
