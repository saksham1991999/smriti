/**
 *   node tools/deploy/src/headers-cli.ts web <apps/web/dist>
 *   node tools/deploy/src/headers-cli.ts site <apps/site/dist>
 *
 * Writes `<dist>/_headers` for Cloudflare static assets from the build's environment (the same
 * VITE_* values the web build used; CDN_BASE_URL and SITE_ANALYTICS_ENDPOINT for the site).
 * Prints the policy's origins, never a value that could be secret (none of these are).
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { HeadersError, siteHeaders, webHeaders } from "./headers.ts";

function htmlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...htmlFiles(p));
    else if (name.endsWith(".html")) out.push(p);
  }
  return out;
}

function main(argv: string[]): number {
  const [kind, dist] = argv;
  if ((kind !== "web" && kind !== "site") || !dist) {
    console.error("usage: headers-cli.ts web|site <dist folder>");
    return 2;
  }
  if (!existsSync(join(dist, "index.html"))) {
    console.error(`${dist}/index.html not found: build the ${kind} first`);
    return 1;
  }
  try {
    const text =
      kind === "web"
        ? webHeaders(process.env, readFileSync(join(dist, "index.html"), "utf8"))
        : siteHeaders(process.env, htmlFiles(dist).map((f) => readFileSync(f, "utf8")));
    writeFileSync(join(dist, "_headers"), text);
  } catch (e) {
    if (e instanceof HeadersError) {
      console.error(`headers: ${e.message}`);
      return 1;
    }
    throw e;
  }
  console.log(`wrote ${join(dist, "_headers")}`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
