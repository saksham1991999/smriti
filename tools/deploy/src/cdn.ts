/**
 * The CDN Worker in front of R2 (infra/cloudflare/cdn, TRD §8): `cdn.<domain>/c/*` serves the
 * content bucket (bundles, patches, manifests), and every other path serves the assets bucket
 * (media `assets/{sha256}.*`, sims `sims/{id}/...`).
 *
 * - Read-only: GET, HEAD and CORS preflight. Everything here is public, so any origin may read it
 *   (`Access-Control-Allow-Origin: *`), and `Cross-Origin-Resource-Policy: cross-origin` lets the
 *   web app and sandboxed sims embed it even under cross-origin isolation.
 * - Cache-Control comes from the object's own metadata, which the publisher sets on upload
 *   (immutable for content-addressed files, 5 minutes for manifests). Without metadata the path
 *   decides: content-addressed names are immutable, everything else gets 5 minutes.
 * - Conditional and range requests go to R2 (`onlyIf`, `range`), so a 304 or 206 costs no body.
 *
 * The types below are the minimal parts of the Workers R2 API this uses, so the logic runs and is
 * tested under Node with fakes.
 */

export interface R2ObjectLike {
  key: string;
  size: number;
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: { contentType?: string; cacheControl?: string; contentEncoding?: string };
  range?: { offset?: number; length?: number };
  writeHttpMetadata(headers: Headers): void;
}
export interface R2ObjectBodyLike extends R2ObjectLike {
  body: ReadableStream | null;
}
export interface R2BucketLike {
  get(key: string, options?: { onlyIf?: Headers; range?: Headers }): Promise<R2ObjectBodyLike | R2ObjectLike | null>;
  head(key: string): Promise<R2ObjectLike | null>;
}
export interface CdnEnv {
  ASSETS_BUCKET: R2BucketLike;
  CONTENT_BUCKET: R2BucketLike;
}

export const IMMUTABLE = "public, max-age=31536000, immutable";
export const SHORT = "public, max-age=300";
const HASHED = /(^|[/._-])[0-9a-f]{64}([._-]|$)|-[A-Za-z0-9_-]{8,}\.(js|css|woff2|wasm)$/;

export function route(pathname: string): { bucket: "content" | "assets"; key: string } | null {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (path.includes("..") || path.includes("\\") || path.includes("\0")) return null;
  if (path.startsWith("/c/")) {
    const key = path.slice(3);
    return key ? { bucket: "content", key } : null;
  }
  const key = path.replace(/^\/+/, "");
  if (!key || key.endsWith("/")) return null;
  return { bucket: "assets", key };
}

export function cacheControl(key: string, fromObject?: string): string {
  if (fromObject) return fromObject;
  return HASHED.test(key) ? IMMUTABLE : SHORT;
}

function baseHeaders(): Headers {
  const h = new Headers();
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Expose-Headers", "ETag, Content-Length, Content-Range");
  h.set("Cross-Origin-Resource-Policy", "cross-origin");
  h.set("Timing-Allow-Origin", "*");
  h.set("X-Content-Type-Options", "nosniff");
  return h;
}

function hasBody(o: R2ObjectLike | R2ObjectBodyLike): o is R2ObjectBodyLike {
  return "body" in o && o.body !== undefined;
}

export async function handle(request: Request, bindings: CdnEnv): Promise<Response> {
  const headers = baseHeaders();
  if (request.method === "OPTIONS") {
    headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Range, If-None-Match, If-Modified-Since");
    headers.set("Access-Control-Max-Age", "86400");
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    headers.set("Allow", "GET, HEAD, OPTIONS");
    return new Response(null, { status: 405, headers });
  }
  const target = route(new URL(request.url).pathname);
  if (!target) return new Response("Not found", { status: 404, headers });
  const bucket = target.bucket === "content" ? bindings.CONTENT_BUCKET : bindings.ASSETS_BUCKET;

  const object =
    request.method === "HEAD"
      ? await bucket.head(target.key)
      : await bucket.get(target.key, { onlyIf: request.headers, range: request.headers });
  if (!object) {
    headers.set("Cache-Control", "public, max-age=60");
    return new Response("Not found", { status: 404, headers });
  }
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", cacheControl(target.key, object.httpMetadata?.cacheControl));
  headers.set("Accept-Ranges", "bytes");
  if (request.method === "HEAD") {
    headers.set("Content-Length", String(object.size));
    return new Response(null, { status: 200, headers });
  }
  // R2 answers a failed precondition with the object's metadata and no body.
  if (!hasBody(object)) return new Response(null, { status: 304, headers });
  const range = object.range;
  if (range && request.headers.has("Range")) {
    const offset = range.offset ?? 0;
    const length = range.length ?? object.size - offset;
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}
