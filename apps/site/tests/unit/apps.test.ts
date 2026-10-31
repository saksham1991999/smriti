import { describe, expect, it } from "vitest";
import {
  appsForExam,
  brandDomain,
  checkIosUrl,
  checkPlayUrl,
  loadStoreApps,
  parseStoreList,
  upcomingApps,
} from "../../src/config/apps";
import { loadSiteConfig } from "../../src/config/site";

describe("brand domain", () => {
  it("reads packages/config/brand.json and rejects anything but a bare domain", () => {
    expect(brandDomain()).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
    expect(() => brandDomain({ domain: "https://x.org" })).toThrow(/bare domain/);
    expect(() => brandDomain({})).toThrow(/bare domain/);
  });

  it("is the default site and web app origin", () => {
    const keep = { site: process.env.SITE_URL, app: process.env.WEB_APP_URL };
    delete process.env.SITE_URL;
    delete process.env.WEB_APP_URL;
    try {
      const cfg = loadSiteConfig();
      expect(cfg.siteUrl).toBe(`https://${brandDomain()}`);
      expect(cfg.webAppUrl).toBe(`https://app.${brandDomain()}`);
      process.env.SITE_URL = "https://staging.example.org/";
      expect(loadSiteConfig().siteUrl).toBe("https://staging.example.org");
    } finally {
      if (keep.site === undefined) delete process.env.SITE_URL;
      else process.env.SITE_URL = keep.site;
      if (keep.app !== undefined) process.env.WEB_APP_URL = keep.app;
    }
  });
});

describe("store links", () => {
  it("has every variant from packages/config and no store links until configured", () => {
    const apps = loadStoreApps(undefined, undefined);
    expect(apps.map((a) => a.id)).toEqual(["all", "jee", "neet", "upsc", "ssc"]);
    for (const a of apps) {
      expect(a.play).toBeUndefined();
      expect(a.ios).toBeUndefined();
      expect(a.appName.en.length).toBeGreaterThan(0);
      expect(a.appName.hi.length).toBeGreaterThan(0);
    }
  });

  it("accepts a Play URL only for the variant's own package", () => {
    const jee = loadStoreApps(undefined, undefined).find((a) => a.id === "jee")!;
    const url = `https://play.google.com/store/apps/details?id=${jee.androidPackage}`;
    expect(loadStoreApps(`jee=${url}`, undefined).find((a) => a.id === "jee")!.play).toBe(url);
    expect(() => checkPlayUrl("https://play.google.com/store/apps/details?id=com.other", jee.androidPackage)).toThrow(/not the listing/);
    expect(() => checkPlayUrl("http://play.google.com/store/apps/details?id=x", "x")).toThrow(/not a Google Play/);
    expect(() => checkPlayUrl("https://example.org/store/apps/details?id=x", "x")).toThrow(/not a Google Play/);
  });

  it("accepts App Store app pages only", () => {
    expect(checkIosUrl("https://apps.apple.com/in/app/some-app/id123456789")).toContain("id123456789");
    expect(checkIosUrl("https://apps.apple.com/app/id123456789")).toContain("id123456789");
    expect(() => checkIosUrl("https://apps.apple.com/in/developer/x/id1")).toThrow(/App Store app page/);
    expect(() => checkIosUrl("https://example.org/app/id1")).toThrow(/App Store app page/);
  });

  it("rejects unknown, repeated and malformed entries", () => {
    expect(() => parseStoreList("X", "cbse=https://a")).toThrow(/unknown variant/);
    expect(() => parseStoreList("X", "jee=https://a,jee=https://b")).toThrow(/twice/);
    expect(() => parseStoreList("X", "https://a")).toThrow(/variant=url/);
    expect(parseStoreList("X", " , ").size).toBe(0);
  });

  it("lists an exam's own app first, then the all-exams app", () => {
    const apps = loadStoreApps(undefined, undefined);
    expect(appsForExam(apps, "neet-ug").map((a) => a.id)).toEqual(["neet", "all"]);
    expect(appsForExam(apps, "unknown")).toEqual([]);
  });

  it("names the exam apps with nothing released as upcoming, never the all-exams app", () => {
    const apps = loadStoreApps(undefined, undefined);
    expect(upcomingApps(apps, []).map((a) => a.id)).toEqual(["jee", "neet", "upsc", "ssc"]);
    expect(upcomingApps(apps, ["jee-main", "neet-ug"]).map((a) => a.id)).toEqual(["upsc", "ssc"]);
  });
});
