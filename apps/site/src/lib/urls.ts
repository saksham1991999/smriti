// URL helpers: locale paths on the site, and hand-off links into the web app.
// The site never signs anyone in (docs/flows/auth.md §5.4). "Sign in" goes to the web app's
// AUTH-29 page, and every "Start" CTA goes to the web app's /start (onboarding §6.12).

import type { Locale } from "../config/site";

/** Site path for a locale. `path` is the English path, starting and ending with "/". */
export function localePath(lang: Locale, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (lang === "en") return p;
  return p === "/" ? "/hi/" : `/hi${p}`;
}

/** Strip the locale prefix from a site path, giving the English path. */
export function basePath(pathname: string): string {
  if (pathname === "/hi" || pathname === "/hi/") return "/";
  return pathname.startsWith("/hi/") ? pathname.slice(3) : pathname;
}

export function alternates(path: string): Record<Locale, string> {
  return { en: localePath("en", path), hi: localePath("hi", path) };
}

export function absolute(siteUrl: string, path: string): string {
  return new URL(path, `${siteUrl}/`).toString();
}

export interface StartParams {
  lang: Locale;
  /** Where on the site the CTA sits, sent as the campaign id only (onboarding §6.12). */
  placement: string;
  exam?: string | undefined;
  topic?: string | undefined;
  lab?: string | undefined;
}

/** `app.<domain>/start?…`: onboarding with preselections, or ENT-06 for a topic. */
export function startUrl(webAppUrl: string, p: StartParams): string {
  const u = new URL("/start", `${webAppUrl}/`);
  u.searchParams.set("lang", p.lang);
  if (p.exam) u.searchParams.set("exam", p.exam);
  if (p.topic) u.searchParams.set("topic", p.topic);
  if (p.lab) u.searchParams.set("lab", p.lab);
  u.searchParams.set("utm_source", "site");
  u.searchParams.set("utm_medium", "cta");
  u.searchParams.set("utm_campaign", p.placement);
  return u.toString();
}

/** `app.<domain>/login?next=`: the web app's sign-in page (AUTH-29). */
export function signInUrl(webAppUrl: string, next = "/"): string {
  const u = new URL("/login", `${webAppUrl}/`);
  u.searchParams.set("next", next);
  return u.toString();
}
