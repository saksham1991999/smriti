// Build-time configuration for the site. Everything here is read from the environment when
// `astro build` runs (the site is static), with safe defaults for local work.
//
// "Smriti" is a working name (PRD, TRD §18 D7): brand strings live here, never in pages.
// The default domains use the reserved `.example` TLD on purpose, so nothing points at a
// real domain until the owner picks one.

export type Locale = "en" | "hi";
export const LOCALES: readonly Locale[] = ["en", "hi"] as const;
export const DEFAULT_LOCALE: Locale = "en";

const env = (name: string): string | undefined => {
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? undefined : v.trim();
};

const stripSlash = (url: string): string => url.replace(/\/+$/, "");

export interface Brand {
  /** Product name per locale, for example "Smriti" / "स्मृति". */
  name: Record<Locale, string>;
  /** Shown after the name in titles. */
  titleSuffix: Record<Locale, string>;
  /** Legal entity line for the footer, until the owner sets one. */
  legalName: string | undefined;
  /** Support contact shown on the legal drafts, if configured. */
  supportEmail: string | undefined;
}

export interface Pricing {
  /** Pro monthly price in rupees, tax-inclusive (R38). */
  monthlyInr: number;
  /** Introductory first-month price, only for eligible new accounts (R38). */
  introInr: number;
}

export interface SiteConfig {
  siteUrl: string;
  webAppUrl: string;
  brand: Brand;
  pricing: Pricing;
  /** Cookie-free analytics collector. Unset means the typed no-op transport. */
  analyticsEndpoint: string | undefined;
  /** Preview deployments: robots.txt disallows all and pages carry noindex. */
  noindex: boolean;
  /** Fail the build when the content index is the local fixture (production builds). */
  requireContentIndex: boolean;
  contentIndexPath: string | undefined;
}

function numberEnv(name: string, fallback: number): number {
  const raw = env(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  return n;
}

export function loadSiteConfig(): SiteConfig {
  return {
    siteUrl: stripSlash(env("SITE_URL") ?? "https://www.smriti.example"),
    webAppUrl: stripSlash(env("WEB_APP_URL") ?? "https://app.smriti.example"),
    brand: {
      name: { en: env("BRAND_NAME_EN") ?? "Smriti", hi: env("BRAND_NAME_HI") ?? "स्मृति" },
      titleSuffix: { en: env("BRAND_NAME_EN") ?? "Smriti", hi: env("BRAND_NAME_HI") ?? "स्मृति" },
      legalName: env("BRAND_LEGAL_NAME"),
      supportEmail: env("BRAND_SUPPORT_EMAIL"),
    },
    pricing: {
      monthlyInr: numberEnv("PRICE_PRO_MONTHLY_INR", 99),
      introInr: numberEnv("PRICE_PRO_INTRO_INR", 1),
    },
    analyticsEndpoint: env("SITE_ANALYTICS_ENDPOINT"),
    noindex: env("SITE_NOINDEX") === "1" || env("SITE_NOINDEX") === "true",
    requireContentIndex: env("SITE_REQUIRE_CONTENT_INDEX") === "1" || env("SITE_REQUIRE_CONTENT_INDEX") === "true",
    contentIndexPath: env("CONTENT_INDEX_PATH"),
  };
}

export const site: SiteConfig = loadSiteConfig();
