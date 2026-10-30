// Fixed strings that the shared components render themselves (a11y labels, rating labels, the Google label).
// Screen copy never lives here: screens pass their text as props from packages/i18n.
// The catalogue now lives in packages/i18n as the `ui` namespace (src/locales/{en,hi}/ui.json);
// this module re-exports it unchanged so existing imports keep working. Edit the JSON there.
import { uiStringsEn, uiStringsHi, type UIStringKey, type UIStrings } from "@smriti/i18n/ui";

export { uiStringsEn, uiStringsHi, type UIStringKey, type UIStrings };

export type Locale = "en" | "hi";

export const uiStrings: Record<Locale, UIStrings> = { en: uiStringsEn, hi: uiStringsHi };

/** Fill `{name}` placeholders. Unknown placeholders are left as they are, so gaps are visible in QA. */
export function format(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Bound translator for a locale with optional overrides from the app's i18n catalogue. */
export function createTranslator(locale: Locale, overrides?: Partial<UIStrings>) {
  const table: UIStrings = { ...uiStrings[locale], ...(overrides ?? {}) };
  return (key: UIStringKey, vars?: Record<string, string | number>): string => format(table[key], vars);
}
export type Translate = ReturnType<typeof createTranslator>;
