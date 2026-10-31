/**
 * `@smriti/i18n`: English and Hindi UI strings for web and mobile.
 *
 * The catalogues in `src/locales/{en,hi}/<area>.json` are generated from the copy tables in
 * `docs/ux/*.md` by `scripts/extract.mjs` (never edited by hand: fix the doc, then re-run). The
 * exception is the `ui` namespace (component strings, see `./ui`), which is maintained by hand. Keys are
 * `<SCREEN-ID>.<row>`, e.g. `auth:AUTH-01.title_lesson_3`. Messages are ICU (plural, select).
 * Hindi uses आप everywhere; तुम only in keys containing `little_learner` (R3).
 */
import { createI18n as createI18nCore, type CreateI18nOptions, type Namespace, NAMESPACES, type Translator } from './core';
import enAuth from './locales/en/auth.json';
import enLearn from './locales/en/learn.json';
import enMeMoney from './locales/en/me_money.json';
import enMemoryLabs from './locales/en/memory_labs.json';
import enOnboarding from './locales/en/onboarding.json';
import enPractice from './locales/en/practice.json';
import enTutorSocial from './locales/en/tutor_social.json';
import enUi from './locales/en/ui.json';
import hiAuth from './locales/hi/auth.json';
import hiLearn from './locales/hi/learn.json';
import hiMeMoney from './locales/hi/me_money.json';
import hiMemoryLabs from './locales/hi/memory_labs.json';
import hiOnboarding from './locales/hi/onboarding.json';
import hiPractice from './locales/hi/practice.json';
import hiTutorSocial from './locales/hi/tutor_social.json';
import hiUi from './locales/hi/ui.json';
import screens from './locales/screens.json';

export { GLOSSARY_HI } from './glossary';
export { uiStringsEn, uiStringsHi, type UIStringKey, type UIStrings } from './ui';
export * from './core';

export const resources = {
  en: {
    auth: enAuth,
    learn: enLearn,
    me_money: enMeMoney,
    memory_labs: enMemoryLabs,
    onboarding: enOnboarding,
    practice: enPractice,
    tutor_social: enTutorSocial,
    ui: enUi,
  },
  hi: {
    auth: hiAuth,
    learn: hiLearn,
    me_money: hiMeMoney,
    memory_labs: hiMemoryLabs,
    onboarding: hiOnboarding,
    practice: hiPractice,
    tutor_social: hiTutorSocial,
    ui: hiUi,
  },
} as const;

export interface ScreenInfo {
  ns: Namespace;
  title: string;
  priority: string | null;
  line: number;
}

/** Screen id → area, title and mock priority, from the UX docs. */
export const SCREENS = screens as Record<string, ScreenInfo>;

/**
 * Creates an i18next instance with ICU. Every catalogue is bundled (no network, works offline)
 * unless `load` is given; for lazy loading without bundling them, import from `@smriti/i18n/core`.
 */
export function createI18n(opts: CreateI18nOptions): Translator {
  return createI18nCore({ ...opts, resources: opts.resources ?? (opts.load ? undefined : resources) });
}

/** Every message as `[namespace, key, en, hi]` (lint, coverage, translation tools). */
export function allMessages(): [Namespace, string, string, string][] {
  const out: [Namespace, string, string, string][] = [];
  for (const ns of NAMESPACES) {
    const en = resources.en[ns] as Record<string, string>;
    const hi = resources.hi[ns] as Record<string, string>;
    for (const key of Object.keys(en)) out.push([ns, key, en[key] ?? '', hi[key] ?? '']);
  }
  return out;
}
