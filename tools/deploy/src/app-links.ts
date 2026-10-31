/**
 * App link files for the brand domain (iOS universal links, Android App Links), built from the
 * variants in @smriti/config: each variant claims its `deepLinkPath` on the brand domain.
 *
 * - `/.well-known/apple-app-site-association`: one `applinks` entry per variant, `TEAMID.bundleId`.
 *   The all-exams app claims `/`, so it is listed last and the exam apps' paths match first.
 * - `/.well-known/assetlinks.json`: one statement per Android package that has a signing
 *   certificate fingerprint (Play Console > App integrity > App signing). A package without one
 *   can't be verified, so it is left out and reported.
 *
 * Every build associates with the brand domain, which the production site serves, so that file
 * lists the store bundle ids (production and staging builds, apps/mobile/app.config.ts). The
 * staging site lists the `.preview` builds' ids instead, for checking the files before a release.
 */

export interface LinkVariant {
  id: string;
  bundleId: string;
  androidPackage: string;
  deepLinkPath: string;
}

export type LinkEnv = "production" | "staging";

export class AppLinksError extends Error {}

export function suffixFor(env: LinkEnv): string {
  return env === "production" ? "" : ".preview";
}

/** Exam apps first, the all-exams app (path `/`) last; then by id for a stable file. */
function ordered(variants: readonly LinkVariant[]): LinkVariant[] {
  return [...variants].sort((a, b) => {
    const rootA = a.deepLinkPath === "/" ? 1 : 0;
    const rootB = b.deepLinkPath === "/" ? 1 : 0;
    return rootA - rootB || a.id.localeCompare(b.id);
  });
}

function components(path: string): { "/": string }[] {
  return path === "/" ? [{ "/": "/*" }] : [{ "/": path }, { "/": `${path}/*` }];
}

export function appleAppSiteAssociation(variants: readonly LinkVariant[], teamId: string, env: LinkEnv): object {
  if (!/^[A-Z0-9]{10}$/.test(teamId)) throw new AppLinksError("APPLE_TEAM_ID must be the 10-character Apple team id");
  const suffix = suffixFor(env);
  return {
    applinks: {
      details: ordered(variants).map((v) => ({
        appIDs: [`${teamId}.${v.bundleId}${suffix}`],
        components: components(v.deepLinkPath),
      })),
    },
  };
}

const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/** `ANDROID_APP_LINK_CERTS`: `variant=FP|FP,variant=FP`, each FP a SHA-256 in colon form. */
export function parseCerts(raw: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const pair of raw.split(",").map((p) => p.trim()).filter(Boolean)) {
    const [variant, list] = pair.split("=", 2);
    if (!variant || !list) throw new AppLinksError(`ANDROID_APP_LINK_CERTS: "${pair}" is not variant=fingerprint`);
    const fps = list.split("|").map((f) => f.trim().toUpperCase()).filter(Boolean);
    for (const fp of fps) {
      if (!FINGERPRINT.test(fp)) throw new AppLinksError(`ANDROID_APP_LINK_CERTS: ${variant} has a fingerprint that is not SHA-256`);
    }
    out.set(variant.trim(), [...(out.get(variant.trim()) ?? []), ...fps]);
  }
  return out;
}

export function assetLinks(
  variants: readonly LinkVariant[],
  certs: Map<string, string[]>,
  env: LinkEnv,
): { statements: object[]; missing: string[] } {
  const suffix = suffixFor(env);
  const known = new Set(variants.map((v) => v.id));
  const unknown = [...certs.keys()].filter((k) => !known.has(k));
  if (unknown.length) throw new AppLinksError(`ANDROID_APP_LINK_CERTS names unknown variants: ${unknown.join(", ")}`);
  const statements: object[] = [];
  const missing: string[] = [];
  for (const v of ordered(variants)) {
    const fps = certs.get(v.id) ?? [];
    if (!fps.length) {
      missing.push(v.id);
      continue;
    }
    statements.push({
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: `${v.androidPackage}${suffix}`, sha256_cert_fingerprints: fps },
    });
  }
  return { statements, missing };
}
