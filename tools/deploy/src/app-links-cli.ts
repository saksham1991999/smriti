/**
 *   node tools/deploy/src/app-links-cli.ts <apps/site/dist>
 *
 * Writes `<dist>/.well-known/apple-app-site-association` and `<dist>/.well-known/assetlinks.json`
 * for the site on the brand domain (see app-links.ts). Inputs, all public:
 *   APP_LINKS_ENV            production | staging (bundle id suffix, as in apps/mobile/app.config.ts)
 *   APPLE_TEAM_ID            the Apple team id; without it no AASA file is written
 *   ANDROID_APP_LINK_CERTS   variant=SHA256|SHA256,...; variants without one are left out
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { allVariants } from "@smriti/config";

import { AppLinksError, appleAppSiteAssociation, assetLinks, parseCerts, type LinkEnv } from "./app-links.ts";

function main(argv: string[]): number {
  const [dist] = argv;
  if (!dist || !existsSync(dist)) {
    console.error("usage: app-links-cli.ts <built site folder>");
    return 2;
  }
  const env = process.env.APP_LINKS_ENV ?? "staging";
  if (env !== "production" && env !== "staging") {
    console.error("APP_LINKS_ENV must be production or staging");
    return 2;
  }
  const variants = Object.values(allVariants());
  const dir = join(dist, ".well-known");
  mkdirSync(dir, { recursive: true });
  try {
    const teamId = process.env.APPLE_TEAM_ID ?? "";
    if (teamId) {
      const aasa = appleAppSiteAssociation(variants, teamId, env as LinkEnv);
      writeFileSync(join(dir, "apple-app-site-association"), `${JSON.stringify(aasa, null, 2)}\n`);
      console.log(`apple-app-site-association: ${variants.length} apps (${env})`);
    } else {
      console.log("APPLE_TEAM_ID is not set: no apple-app-site-association written");
    }
    const { statements, missing } = assetLinks(variants, parseCerts(process.env.ANDROID_APP_LINK_CERTS ?? ""), env as LinkEnv);
    writeFileSync(join(dir, "assetlinks.json"), `${JSON.stringify(statements, null, 2)}\n`);
    console.log(`assetlinks.json: ${statements.length} packages (${env})`);
    if (missing.length) console.log(`no signing certificate for: ${missing.join(", ")} (ANDROID_APP_LINK_CERTS)`);
  } catch (e) {
    if (e instanceof AppLinksError) {
      console.error(e.message);
      return 1;
    }
    throw e;
  }
  return 0;
}

process.exit(main(process.argv.slice(2)));
