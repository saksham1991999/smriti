/**
 * Origin and URL checks.
 *
 * Web: sims run in a sandboxed iframe (`sandbox="allow-scripts"`, no
 * `allow-same-origin`) on a separate sims origin, so their messages arrive
 * with origin `"null"`. The host then relies on `event.source` being the
 * iframe's window and accepts `"null"` only when told to (`allowOpaque`).
 *
 * Mobile: the WebView reports the page URL with each message; the host only
 * accepts messages from URLs inside the sim's own folder.
 */

export interface OriginPolicy {
  /** Exact origins (`https://sims.example.app`) or `https://*.example.app` wildcards. */
  allowed: readonly string[];
  /** Accept the opaque origin `"null"` (sandboxed iframes, file:// pages). */
  allowOpaque?: boolean;
}

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

/** Lower-cases scheme and host and drops default ports. Returns null if `origin` is not an origin. */
export function normalizeOrigin(origin: string): string | null {
  if (origin === 'null') return 'null';
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.origin === 'null' || url.pathname.length > 1 || url.search || url.hash || url.username) return null;
  const port = url.port && url.port !== DEFAULT_PORTS[url.protocol] ? `:${url.port}` : '';
  return `${url.protocol}//${url.hostname.toLowerCase()}${port}`;
}

function matchesWildcard(origin: string, pattern: string): boolean {
  // pattern: scheme://*.domain[:port]
  const match = /^(https?:)\/\/\*\.([a-z0-9.-]+)(:\d+)?$/i.exec(pattern);
  if (!match) return false;
  const [, scheme, domain, port = ''] = match;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== scheme?.toLowerCase()) return false;
  const actualPort = url.port ? `:${url.port}` : '';
  if (actualPort !== port) return false;
  const host = url.hostname.toLowerCase();
  const base = (domain ?? '').toLowerCase();
  return host.endsWith(`.${base}`) && host.length > base.length + 1;
}

export function isOriginAllowed(origin: string, policy: OriginPolicy): boolean {
  if (origin === 'null') return policy.allowOpaque === true;
  const normalized = normalizeOrigin(origin);
  if (normalized === null) return false;
  for (const entry of policy.allowed) {
    if (entry === '*') return true;
    if (entry.includes('*')) {
      if (matchesWildcard(normalized, entry)) return true;
      continue;
    }
    if (normalizeOrigin(entry) === normalized) return true;
  }
  return false;
}

/**
 * True when `url` lies inside one of `prefixes` (folder URLs ending in `/`).
 * `URL` resolves `..` and percent-encoded dots first, so `…/sims/a/../b/` is
 * not inside `…/sims/a/`.
 */
export function isUrlUnderPrefix(url: string, prefixes: readonly string[]): boolean {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  const clean = `${target.protocol}//${target.host}${decodeSafe(target.pathname)}`;
  for (const prefix of prefixes) {
    let base: URL;
    try {
      base = new URL(prefix);
    } catch {
      continue;
    }
    if (!base.pathname.endsWith('/')) continue;
    const basePath = `${base.protocol}//${base.host}${decodeSafe(base.pathname)}`;
    if (clean.startsWith(basePath)) return true;
  }
  return false;
}

function decodeSafe(path: string): string {
  try {
    const decoded = decodeURIComponent(path);
    // A decoded path that still climbs is never inside a prefix.
    return decoded.split('/').includes('..') ? '/\u0000invalid' : decoded;
  } catch {
    return '/\u0000invalid';
  }
}
