// The store apps the site links to, from the variants in packages/config (TRD §3.1), and the
// brand domain the site and web app live on (packages/config/brand.json).
//
// Store URLs are not in the variant files because an app has none until it is published. They
// come from two build-time settings, each a comma-separated `variant=url` list (the same shape as
// ANDROID_APP_LINK_CERTS):
//   STORE_URLS_PLAY  jee=https://play.google.com/store/apps/details?id=<androidPackage>,...
//   STORE_URLS_IOS   jee=https://apps.apple.com/in/app/<name>/id<number>,...
// A variant without a URL shows "coming soon" as plain text, never a link that goes nowhere.

import brandJson from "../../../../packages/config/brand.json";
import allJson from "../../../../packages/config/variants/all.json";
import jeeJson from "../../../../packages/config/variants/jee.json";
import neetJson from "../../../../packages/config/variants/neet.json";
import sscJson from "../../../../packages/config/variants/ssc.json";
import upscJson from "../../../../packages/config/variants/upsc.json";

export const VARIANT_IDS = ["all", "jee", "neet", "upsc", "ssc"] as const;
export type VariantId = (typeof VARIANT_IDS)[number];

export interface StoreApp {
  id: VariantId;
  /** Store name of the app, from the variant file. */
  appName: { en: string; hi: string };
  androidPackage: string;
  /** Exam ids the app covers (`content.exams.id`, the same ids as the site index). */
  examIds: string[];
  /** Release phase (PRD §17): SSC ships in Phase 2. */
  phase: number;
  play: string | undefined;
  ios: string | undefined;
}

interface VariantFile {
  id: string;
  appName: { en: string; hi: string };
  androidPackage: string;
  examIds: string[];
  phase: number;
}

const VARIANTS: readonly VariantFile[] = [allJson, jeeJson, neetJson, upscJson, sscJson];

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** The brand domain, for example `smriti.app`. */
export function brandDomain(raw: unknown = brandJson): string {
  const domain = (raw as { domain?: unknown }).domain;
  if (typeof domain !== "string" || !DOMAIN.test(domain)) {
    throw new Error("packages/config/brand.json must hold a bare domain like example.org");
  }
  return domain;
}

/** Parses `variant=url,variant=url`. Unknown variants and repeated ones fail the build. */
export function parseStoreList(name: string, raw: string | undefined): Map<VariantId, string> {
  const out = new Map<VariantId, string>();
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const item = part.trim();
    if (!item) continue;
    const eq = item.indexOf("=");
    const id = item.slice(0, eq).trim();
    const url = item.slice(eq + 1).trim();
    if (eq < 1 || !url) throw new Error(`${name}: expected variant=url, got "${item}"`);
    if (!(VARIANT_IDS as readonly string[]).includes(id)) throw new Error(`${name}: unknown variant "${id}"`);
    if (out.has(id as VariantId)) throw new Error(`${name}: variant "${id}" is listed twice`);
    out.set(id as VariantId, url);
  }
  return out;
}

/** A Play link must open this variant's own listing; anything else fails the build. */
export function checkPlayUrl(url: string, androidPackage: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`STORE_URLS_PLAY: not a URL: ${url}`);
  }
  if (u.protocol !== "https:" || u.hostname !== "play.google.com" || u.pathname !== "/store/apps/details") {
    throw new Error(`STORE_URLS_PLAY: ${url} is not a Google Play listing`);
  }
  if (u.searchParams.get("id") !== androidPackage) {
    throw new Error(`STORE_URLS_PLAY: ${url} is not the listing for ${androidPackage}`);
  }
  return u.toString();
}

/** An App Store link must be an apps.apple.com app page with its numeric id. */
export function checkIosUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`STORE_URLS_IOS: not a URL: ${url}`);
  }
  if (u.protocol !== "https:" || u.hostname !== "apps.apple.com" || !/^\/([a-z]{2}\/)?app\/([^/]+\/)?id\d+\/?$/.test(u.pathname)) {
    throw new Error(`STORE_URLS_IOS: ${url} is not an App Store app page`);
  }
  return u.toString();
}

export function loadStoreApps(playRaw: string | undefined, iosRaw: string | undefined): StoreApp[] {
  const play = parseStoreList("STORE_URLS_PLAY", playRaw);
  const ios = parseStoreList("STORE_URLS_IOS", iosRaw);
  return VARIANTS.map((v) => {
    const id = v.id as VariantId;
    const p = play.get(id);
    const i = ios.get(id);
    return {
      id,
      appName: v.appName,
      androidPackage: v.androidPackage,
      examIds: v.examIds,
      phase: v.phase,
      play: p === undefined ? undefined : checkPlayUrl(p, v.androidPackage),
      ios: i === undefined ? undefined : checkIosUrl(i),
    };
  });
}

/**
 * Exam apps with no exam in the site index yet. The site lists them as "coming soon" (or
 * "coming later" after Phase 1), by name only: no pages, no chapters and no numbers.
 */
export function upcomingApps(apps: readonly StoreApp[], releasedExamIds: readonly string[]): StoreApp[] {
  const released = new Set(releasedExamIds);
  return apps.filter((a) => a.id !== "all" && !a.examIds.some((e) => released.has(e)));
}

/** The apps that cover an exam: its own exam app first, then the all-exams app. */
export function appsForExam(apps: readonly StoreApp[], examId: string): StoreApp[] {
  const covering = apps.filter((a) => a.examIds.includes(examId));
  return [...covering.filter((a) => a.id !== "all"), ...covering.filter((a) => a.id === "all")];
}
