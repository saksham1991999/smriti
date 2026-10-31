import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { HeadersError, inlineScriptHashes, originOf, siteHeaders, webHeaders } from "../src/headers.ts";

const ENV = {
  VITE_APP_ENV: "production",
  VITE_API_BASE_URL: "https://api.example.test",
  VITE_CDN_BASE_URL: "https://cdn.example.test/",
  VITE_SUPABASE_URL: "https://abc.supabase.co",
  VITE_SENTRY_DSN: "https://publickey@o1.ingest.example.test/2",
};

function csp(headers: string, path = "/*"): string {
  const start = headers.indexOf(`${path}\n`);
  const line = headers.slice(start).split("\n").find((l) => l.trim().startsWith("Content-Security-Policy:"));
  return (line ?? "").trim().slice("Content-Security-Policy: ".length);
}

function directive(policy: string, name: string): string[] {
  const d = policy.split("; ").find((p) => p.startsWith(`${name} `));
  return d ? d.split(" ").slice(1) : [];
}

test("web CSP allows only our API, CDN, Supabase and Razorpay", () => {
  const h = webHeaders(ENV, '<script type="module" src="/assets/index-abc.js"></script>');
  const policy = csp(h);
  assert.deepEqual(directive(policy, "connect-src"), [
    "'self'",
    "https://api.example.test",
    "https://cdn.example.test",
    "https://abc.supabase.co",
    "wss://abc.supabase.co",
    "https://o1.ingest.example.test",
    "https://lumberjack.razorpay.com",
  ]);
  assert.deepEqual(directive(policy, "script-src"), ["'self'", "https://checkout.razorpay.com"]);
  assert.deepEqual(directive(policy, "img-src"), ["'self'", "data:", "blob:", "https://cdn.example.test"]);
  assert.ok(policy.includes("frame-ancestors 'none'"));
  assert.ok(!policy.includes("unsafe-eval"));
  // The DSN's public key never lands in the header.
  assert.ok(!h.includes("publickey"));
});

test("web cache rules: hashed assets immutable, everything else no-cache", () => {
  const h = webHeaders(ENV);
  assert.match(h, /\/\*\n(?:.*\n)*?\s+Cache-Control: no-cache/);
  assert.match(h, /\/assets\/\*\n\s+! Cache-Control\n\s+Cache-Control: public, max-age=31536000, immutable/);
});

test("sims get CORS, CORP and their own CSP", () => {
  const h = webHeaders(ENV);
  const sims = h.slice(h.indexOf("/sims/*\n"), h.indexOf("/sims/*/assets/*"));
  assert.ok(sims.includes("! Content-Security-Policy"));
  assert.ok(sims.includes("Cross-Origin-Resource-Policy: cross-origin"));
  assert.ok(sims.includes("Access-Control-Allow-Origin: *"));
  assert.ok(csp(h, "/sims/*").includes("frame-ancestors 'self'"));
});

test("origins must be https outside local", () => {
  assert.throws(() => webHeaders({ ...ENV, VITE_API_BASE_URL: "http://api.example.test" }), HeadersError);
  assert.throws(() => webHeaders({ ...ENV, VITE_API_BASE_URL: "" }), /required/);
  assert.ok(webHeaders({ ...ENV, VITE_APP_ENV: "local", VITE_API_BASE_URL: "http://127.0.0.1:8000" }).includes("http://127.0.0.1:8000"));
  assert.equal(originOf(undefined, "X"), null);
});

test("inline scripts are allowed by hash; data blocks are not hashed", () => {
  const body = "console.log(1)";
  const html = `<script>${body}</script><script type="application/ld+json">{"a":1}</script><script type="module">${body}</script><script src="/x.js"></script>`;
  const expected = `'sha256-${createHash("sha256").update(body).digest("base64")}'`;
  assert.deepEqual(inlineScriptHashes([html]), [expected]);
  const site = siteHeaders({ CDN_BASE_URL: "https://cdn.example.test" }, [html]);
  assert.ok(csp(site).includes(`script-src 'self' ${expected}`));
  assert.ok(!site.includes("unsafe-inline';") || !csp(site).includes("script-src 'self' 'unsafe-inline'"));
  assert.match(site, /\/_astro\/\*\n\s+! Cache-Control\n\s+Cache-Control: public, max-age=31536000, immutable/);
});
