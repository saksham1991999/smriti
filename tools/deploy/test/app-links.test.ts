import assert from "node:assert/strict";
import { test } from "node:test";

import { allVariants } from "@smriti/config";

import { AppLinksError, appleAppSiteAssociation, assetLinks, parseCerts, type LinkVariant } from "../src/app-links.ts";

const FP = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0").toUpperCase()).join(":");
const variants: LinkVariant[] = [
  { id: "all", bundleId: "app.x.all", androidPackage: "app.x.all", deepLinkPath: "/" },
  { id: "jee", bundleId: "app.x.jee", androidPackage: "app.x.jee", deepLinkPath: "/jee" },
];

test("AASA: one entry per app, exam paths before the all-exams root", () => {
  const aasa = appleAppSiteAssociation(variants, "ABCDE12345", "production") as {
    applinks: { details: { appIDs: string[]; components: { "/": string }[] }[] };
  };
  assert.deepEqual(aasa.applinks.details, [
    { appIDs: ["ABCDE12345.app.x.jee"], components: [{ "/": "/jee" }, { "/": "/jee/*" }] },
    { appIDs: ["ABCDE12345.app.x.all"], components: [{ "/": "/*" }] },
  ]);
  const staging = appleAppSiteAssociation(variants, "ABCDE12345", "staging") as typeof aasa;
  assert.equal(staging.applinks.details[0]?.appIDs[0], "ABCDE12345.app.x.jee.preview");
  assert.throws(() => appleAppSiteAssociation(variants, "nope", "production"), AppLinksError);
});

test("assetlinks: only packages with a signing certificate", () => {
  const certs = parseCerts(`jee=${FP.toLowerCase()}`);
  const { statements, missing } = assetLinks(variants, certs, "production");
  assert.deepEqual(statements, [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: "app.x.jee", sha256_cert_fingerprints: [FP] },
    },
  ]);
  assert.deepEqual(missing, ["all"]);
  assert.throws(() => parseCerts("jee=AB:CD"), AppLinksError);
  assert.throws(() => assetLinks(variants, parseCerts(`zzz=${FP}`), "production"), AppLinksError);
});

test("the real variants come from @smriti/config", () => {
  const real = Object.values(allVariants());
  const aasa = appleAppSiteAssociation(real, "ABCDE12345", "production") as {
    applinks: { details: { appIDs: string[] }[] };
  };
  const ids = aasa.applinks.details.map((d) => d.appIDs[0]);
  assert.equal(ids.length, real.length);
  assert.equal(ids.at(-1), `ABCDE12345.${allVariants().all.bundleId}`);
});
