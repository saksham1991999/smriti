// The CDN Worker (cdn.<domain>): read-only R2 with CORS, CORP and cache headers.
// The logic and its tests live in tools/deploy/src/cdn.ts; wrangler bundles it from there.
// Plain GETs are kept in the edge cache (Cache API), which honours each response's Cache-Control:
// a year for content-addressed files, 5 minutes for manifests, so R2 is read once per edge.
import { type CdnEnv, handle } from "../../../tools/deploy/src/cdn.ts";

// The parts of the Workers runtime used here (no @cloudflare/workers-types dependency).
interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}
declare const caches: CacheStorage & { default: Cache };

export default {
  async fetch(request: Request, env: CdnEnv, ctx: ExecutionContextLike): Promise<Response> {
    const cacheable =
      request.method === "GET" && !request.headers.has("Range") && !request.headers.has("If-None-Match") && !request.headers.has("If-Modified-Since");
    if (cacheable) {
      const hit = await caches.default.match(request);
      if (hit) return hit;
    }
    const response = await handle(request, env);
    if (cacheable && response.status === 200) ctx.waitUntil(caches.default.put(request, response.clone()));
    return response;
  },
};
