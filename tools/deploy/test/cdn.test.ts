import assert from "node:assert/strict";
import { test } from "node:test";

import { cacheControl, handle, IMMUTABLE, route, SHORT, type R2BucketLike, type R2ObjectBodyLike, type R2ObjectLike } from "../src/cdn.ts";

const HASH = "a".repeat(64);

function object(key: string, text: string, cacheControl?: string): R2ObjectBodyLike {
  return {
    key,
    size: text.length,
    httpEtag: '"etag-1"',
    uploaded: new Date(0),
    httpMetadata: { contentType: "application/json", ...(cacheControl ? { cacheControl } : {}) },
    writeHttpMetadata(h: Headers) {
      h.set("Content-Type", "application/json");
    },
    body: new Response(text).body,
  };
}

function bucket(objects: Record<string, R2ObjectBodyLike>): R2BucketLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async get(key, options) {
      calls.push(`get ${key}`);
      const o = objects[key];
      if (!o) return null;
      if (options?.onlyIf?.get("If-None-Match") === o.httpEtag) {
        const { body: _body, ...meta } = o;
        return meta as R2ObjectLike;
      }
      return o;
    },
    async head(key) {
      calls.push(`head ${key}`);
      return objects[key] ?? null;
    },
  };
}

test("routing", () => {
  assert.deepEqual(route(`/c/bundles/${HASH}.json`), { bucket: "content", key: `bundles/${HASH}.json` });
  assert.deepEqual(route("/sims/ohms-law-circuit/index.html"), { bucket: "assets", key: "sims/ohms-law-circuit/index.html" });
  assert.equal(route("/c/"), null);
  assert.equal(route("/"), null);
  assert.equal(route("/sims/x/"), null);
  assert.equal(route("/c/%2e%2e/secret"), null);
  assert.equal(route("/%E0%A4%A"), null);
});

test("cache control: object metadata first, then the name", () => {
  assert.equal(cacheControl("manifests/jee/en.json", "public, max-age=300"), "public, max-age=300");
  assert.equal(cacheControl(`assets/${HASH}.webp`), IMMUTABLE);
  assert.equal(cacheControl("sims/x/assets/index-AbCdEf12.js"), IMMUTABLE);
  assert.equal(cacheControl("sims/x/index.html"), SHORT);
});

test("serves content with CORS, CORP and the object's cache control", async () => {
  const content = bucket({ [`bundles/${HASH}.json`]: object(`bundles/${HASH}.json`, "{}", IMMUTABLE) });
  const assets = bucket({});
  const res = await handle(new Request(`https://cdn.example.test/c/bundles/${HASH}.json`), { CONTENT_BUCKET: content, ASSETS_BUCKET: assets });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "{}");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(res.headers.get("Cross-Origin-Resource-Policy"), "cross-origin");
  assert.equal(res.headers.get("Cache-Control"), IMMUTABLE);
  assert.equal(res.headers.get("ETag"), '"etag-1"');
  assert.deepEqual(assets.calls, []);
});

test("sims come from the assets bucket with cross-origin CORP", async () => {
  const assets = bucket({ "sims/s/index.html": object("sims/s/index.html", "<html>") });
  const res = await handle(new Request("https://cdn.example.test/sims/s/index.html"), { CONTENT_BUCKET: bucket({}), ASSETS_BUCKET: assets });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cross-Origin-Resource-Policy"), "cross-origin");
  assert.equal(res.headers.get("Cache-Control"), SHORT);
});

test("304, 404, HEAD, preflight and refused methods", async () => {
  const content = bucket({ "manifests/a.json": object("manifests/a.json", "{}") });
  const env = { CONTENT_BUCKET: content, ASSETS_BUCKET: bucket({}) };
  const notModified = await handle(new Request("https://cdn.example.test/c/manifests/a.json", { headers: { "If-None-Match": '"etag-1"' } }), env);
  assert.equal(notModified.status, 304);
  assert.equal((await handle(new Request("https://cdn.example.test/c/missing.json"), env)).status, 404);
  const head = await handle(new Request("https://cdn.example.test/c/manifests/a.json", { method: "HEAD" }), env);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("Content-Length"), "2");
  const pre = await handle(new Request("https://cdn.example.test/c/manifests/a.json", { method: "OPTIONS" }), env);
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get("Access-Control-Allow-Methods") ?? "", /GET/);
  assert.equal((await handle(new Request("https://cdn.example.test/c/manifests/a.json", { method: "PUT", body: "x" }), env)).status, 405);
});
