import { createHash } from "node:crypto";

/**
 * Canonical JSON: object keys sorted, no whitespace, undefined fields dropped. Two builds of the
 * same content give the same bytes, so the same hash.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Canonical bytes of a value and their sha256. */
export function hashed(value: unknown): { bytes: Buffer; hash: string } {
  const bytes = Buffer.from(canonicalJson(value), "utf8");
  return { bytes, hash: sha256Hex(bytes) };
}

/** Namespace for every UUIDv5 the publisher derives (content.exam_blueprints, mnemonics, media). */
export const SMRITI_CONTENT_NAMESPACE = "5b0d6f0e-8e43-4b8f-9a51-2f6c3d7e1a90";

/** RFC 4122 version 5 UUID (SHA-1, name-based): stable ids for rows whose key is not text. */
export function uuidv5(name: string, namespace = SMRITI_CONTENT_NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(ns).update(name, "utf8").digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = ((b[6] as number) & 0x0f) | 0x50;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
