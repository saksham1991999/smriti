/**
 * Cloudflare `_headers` files for the web app and the marketing site (infra/cloudflare), written
 * into the build output right before `wrangler deploy`. Static assets serve them as response headers.
 *
 * - Web app: a strict CSP whose network origins are only our API, our CDN (R2) and Supabase, all
 *   from the build's VITE_* env, plus Razorpay Checkout, which apps/web loads for payments
 *   (TRD §11). Hashed `/assets/*` are immutable. Everything else, including `index.html`, the SPA
 *   fallback and the service worker, is `no-cache`, so a deploy is picked up on the next load.
 *   `/sims/*` run in a sandboxed iframe (opaque origin), so they get CORS and
 *   `Cross-Origin-Resource-Policy: cross-origin` and a CSP of their own.
 * - Site: static Astro. Inline island scripts are allowed by their sha256 hashes, computed from the
 *   built HTML, never by 'unsafe-inline'.
 */
import { createHash } from "node:crypto";

export type Env = Record<string, string | undefined>;

export class HeadersError extends Error {}

/** The https origin of a URL, or null when unset. A non-https URL is refused unless local. */
export function originOf(url: string | undefined, name: string, allowHttp = false): string | null {
  const v = url?.trim();
  if (!v) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new HeadersError(`${name} is not a URL`);
  }
  if (u.protocol !== "https:" && !(allowHttp && u.protocol === "http:")) throw new HeadersError(`${name} must be https`);
  return u.origin;
}

/** wss:// for Supabase Realtime next to its https origin. */
function wsOrigin(origin: string): string {
  return origin.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
}

const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
const EXECUTABLE_TYPE = /\btype\s*=\s*["']?(?!module\b|text\/javascript\b|application\/javascript\b)[^"'\s>]+/i;

/** 'sha256-…' sources for every executable inline script in some HTML (JSON-LD and other data blocks are skipped). */
export function inlineScriptHashes(htmls: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const html of htmls) {
    for (const m of html.matchAll(INLINE_SCRIPT)) {
      const attrs = m[1] ?? "";
      const body = m[2] ?? "";
      if (EXECUTABLE_TYPE.test(attrs) || body.trim() === "") continue;
      out.add(`'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
    }
  }
  return [...out].sort();
}

const RAZORPAY = { script: "https://checkout.razorpay.com", frame: ["https://api.razorpay.com", "https://checkout.razorpay.com"], connect: ["https://lumberjack.razorpay.com"] };

export interface WebOrigins {
  api: string;
  cdn: string | null;
  supabase: string | null;
  analytics: string | null;
  sentry: string | null;
  /** local/test builds are served over http, where upgrade-insecure-requests would break them */
  local: boolean;
}

export function webOrigins(env: Env): WebOrigins {
  const local = env.VITE_APP_ENV === "local" || env.VITE_APP_ENV === "test";
  const api = originOf(env.VITE_API_BASE_URL, "VITE_API_BASE_URL", local);
  if (!api) throw new HeadersError("VITE_API_BASE_URL is required");
  let sentry: string | null = null;
  if (env.VITE_SENTRY_DSN?.trim()) {
    // A DSN is https://<public key>@<ingest host>/<project>; only the host goes in the policy.
    const u = new URL(env.VITE_SENTRY_DSN.trim());
    sentry = `${u.protocol}//${u.host}`;
  }
  return {
    api,
    cdn: originOf(env.VITE_CDN_BASE_URL, "VITE_CDN_BASE_URL", local),
    supabase: originOf(env.VITE_SUPABASE_URL, "VITE_SUPABASE_URL", local),
    analytics: originOf(env.VITE_ANALYTICS_URL, "VITE_ANALYTICS_URL", local),
    sentry,
    local,
  };
}

const join = (parts: (string | null | undefined)[]): string => [...new Set(parts.filter((p): p is string => !!p))].join(" ");

export function webCsp(o: WebOrigins, scriptHashes: string[] = []): string {
  return [
    "default-src 'self'",
    `script-src ${join(["'self'", ...scriptHashes, RAZORPAY.script])}`,
    // Radix and Motion set element styles at runtime; Razorpay Checkout injects a stylesheet.
    "style-src 'self' 'unsafe-inline'",
    `img-src ${join(["'self'", "data:", "blob:", o.cdn])}`,
    `media-src ${join(["'self'", "blob:", o.cdn])}`,
    "font-src 'self' data:",
    `connect-src ${join(["'self'", o.api, o.cdn, o.supabase, o.supabase && wsOrigin(o.supabase), o.analytics, o.sentry, ...RAZORPAY.connect])}`,
    `frame-src ${join(["'self'", ...RAZORPAY.frame])}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(o.local ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/** Sims: their own bundle only, framed by the app, no network beyond their own files. */
export const SIM_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join("; ");

const SECURITY = [
  "X-Content-Type-Options: nosniff",
  "Referrer-Policy: strict-origin-when-cross-origin",
  "Strict-Transport-Security: max-age=63072000; includeSubDomains",
  "Cross-Origin-Opener-Policy: same-origin-allow-popups",
];

export const IMMUTABLE = "public, max-age=31536000, immutable";
export const NO_CACHE = "no-cache";

function block(path: string, lines: string[]): string {
  return [path, ...lines.map((l) => `  ${l}`)].join("\n");
}

export function webHeaders(env: Env, indexHtml = ""): string {
  const csp = webCsp(webOrigins(env), inlineScriptHashes([indexHtml]));
  return [
    "# Generated by tools/deploy (pnpm --filter @smriti/deploy headers web <dist>). Do not edit.",
    block("/*", [
      `Content-Security-Policy: ${csp}`,
      ...SECURITY,
      "X-Frame-Options: DENY",
      // The voice tutor needs the microphone on web; nothing else is requested.
      'Permissions-Policy: camera=(), geolocation=(), microphone=(self), payment=(self "https://api.razorpay.com" "https://checkout.razorpay.com"), usb=()',
      `Cache-Control: ${NO_CACHE}`,
    ]),
    // Vite's content-hashed build output.
    block("/assets/*", ["! Cache-Control", `Cache-Control: ${IMMUTABLE}`]),
    block("/sims/*", [
      "! Content-Security-Policy",
      "! X-Frame-Options",
      `Content-Security-Policy: ${SIM_CSP}`,
      "X-Frame-Options: SAMEORIGIN",
      "Access-Control-Allow-Origin: *",
      "Cross-Origin-Resource-Policy: cross-origin",
    ]),
    block("/sims/*/assets/*", ["! Cache-Control", `Cache-Control: ${IMMUTABLE}`]),
    "",
  ].join("\n\n");
}

export function siteCsp(env: Env, scriptHashes: string[]): string {
  const cdn = originOf(env.CDN_BASE_URL, "CDN_BASE_URL");
  const analytics = originOf(env.SITE_ANALYTICS_ENDPOINT, "SITE_ANALYTICS_ENDPOINT");
  return [
    "default-src 'self'",
    `script-src ${join(["'self'", ...scriptHashes])}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${join(["'self'", "data:", cdn])}`,
    "font-src 'self' data:",
    `connect-src ${join(["'self'", analytics])}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // A local preview (SITE_URL on http) would break under it.
    ...(env.SITE_URL?.startsWith("http://") ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function siteHeaders(env: Env, htmls: Iterable<string>): string {
  return [
    "# Generated by tools/deploy (pnpm --filter @smriti/deploy headers site <dist>). Do not edit.",
    block("/*", [
      `Content-Security-Policy: ${siteCsp(env, inlineScriptHashes(htmls))}`,
      ...SECURITY,
      "X-Frame-Options: DENY",
      "Permissions-Policy: camera=(), geolocation=(), microphone=(), payment=(), usb=()",
      "Cache-Control: public, max-age=0, must-revalidate",
    ]),
    // Astro's content-hashed build output.
    block("/_astro/*", ["! Cache-Control", `Cache-Control: ${IMMUTABLE}`]),
    "",
  ].join("\n\n");
}
