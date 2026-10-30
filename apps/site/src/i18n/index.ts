// Site i18n: the two catalogues, a tiny {placeholder} formatter, and locale-aware helpers.
// When packages/i18n lands, these catalogues move there under a `site` namespace.

import type { Locale } from "../config/site";
import { en } from "./en";
import { hi } from "./hi";
import type { Messages } from "./types";

export type { Messages } from "./types";

const catalogues: Record<Locale, Messages> = { en, hi };

export function messages(lang: Locale): Messages {
  return catalogues[lang];
}

export type Vars = Record<string, string | number>;

/** Replaces {name} placeholders. Unknown placeholders are left visible so tests catch them. */
export function fmt(template: string, vars: Vars = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole,
  );
}

function join(items: readonly string[], last: string): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${last} ${items[items.length - 1]}`;
}

/** "A, B and C" / "A, B और C" (no serial comma in either language). */
export function list(lang: Locale, items: readonly string[]): string {
  return join(items, lang === "hi" ? "और" : "and");
}

/** "A, B or C" / "A, B या C". */
export function listOr(lang: Locale, items: readonly string[]): string {
  return join(items, lang === "hi" ? "या" : "or");
}

export function formatDate(lang: Locale, iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

export function formatNumber(lang: Locale, n: number): string {
  return new Intl.NumberFormat(lang === "hi" ? "hi-IN" : "en-IN").format(n);
}

/** Picks the locale's side of a { en, hi } content field. */
export function pick(lang: Locale, field: { en: string; hi: string }): string {
  return field[lang];
}

export const htmlLang: Record<Locale, string> = { en: "en-IN", hi: "hi-IN" };
