/**
 * The `ui` namespace: fixed strings the shared components render themselves (a11y labels,
 * rating labels, the Google label). Screen copy never lives here.
 *
 * Unlike the screen catalogues, `locales/{en,hi}/ui.json` are maintained by hand (they have no
 * copy table in docs/ux). Placeholders are single-brace `{name}`, valid ICU, so the same strings
 * work in `@smriti/tokens`' small formatter and in i18next. Plurals are separate `.zero`, `.one`
 * and `.other` keys, picked by `pluralCategory` in `@smriti/tokens/ui`.
 *
 * This entry imports only JSON, so `@smriti/tokens` can re-export it without pulling in i18next.
 */
import en from './locales/en/ui.json';
import hi from './locales/hi/ui.json';

export const uiStringsEn = en;
export type UIStringKey = keyof typeof en;
export type UIStrings = Record<UIStringKey, string>;
export const uiStringsHi: UIStrings = hi;
