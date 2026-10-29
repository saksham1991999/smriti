/**
 * Strings and number formatting. Every visible string comes from the sim's
 * `strings.{en,hi}.json` (sim-builder); numbers use the locale's format.
 */

import type { LocalizedText, Locale } from '@smriti/sim-bridge';

export type StringTable = Record<string, string>;
export interface Strings {
  en: StringTable;
  hi: StringTable;
}

export type Vars = Record<string, string | number>;

export interface I18n {
  locale: Locale;
  t(key: string, vars?: Vars): string;
  /** Both languages of a key, for readings and task prompts sent to the host. */
  both(key: string, vars?: { en?: Vars; hi?: Vars }): LocalizedText;
  num(value: number, decimals: number): string;
}

/** Keys missing from either table, so tests can keep the two in step. */
export function missingKeys(strings: Strings): { en: string[]; hi: string[] } {
  const en = Object.keys(strings.en);
  const hi = Object.keys(strings.hi);
  return { en: hi.filter((k) => !(k in strings.en)), hi: en.filter((k) => !(k in strings.hi)) };
}

function fill(template: string, vars: Vars | undefined): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

const formatters = new Map<string, Intl.NumberFormat>();

/**
 * Locale number format with a true minus sign. Hindi keeps Latin digits, as
 * the app and NCERT Hindi-medium books do.
 */
export function formatNumber(value: number, decimals: number, locale: Locale): string {
  const key = `${locale}:${decimals}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      numberingSystem: 'latn',
    });
    formatters.set(key, f);
  }
  // Avoid "-0.0".
  const rounded = Math.abs(value) < 0.5 * 10 ** -decimals ? 0 : value;
  return f.format(rounded).replace('-', '−');
}

export function createI18n(strings: Strings, locale: Locale): I18n {
  const table = strings[locale];
  return {
    locale,
    t(key, vars) {
      const s = table[key] ?? strings.en[key];
      if (s === undefined) throw new Error(`missing string ${key}`);
      return fill(s, vars);
    },
    both(key, vars) {
      const en = strings.en[key];
      const hi = strings.hi[key];
      if (en === undefined || hi === undefined) throw new Error(`missing string ${key}`);
      return { en: fill(en, vars?.en), hi: fill(hi, vars?.hi) };
    },
    num(value, decimals) {
      return formatNumber(value, decimals, locale);
    },
  };
}
