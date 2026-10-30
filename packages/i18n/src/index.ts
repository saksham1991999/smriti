/**
 * `@smriti/i18n`: English and Hindi UI strings for web and mobile.
 *
 * The catalogues in `src/locales/{en,hi}/<area>.json` are generated from the copy tables in
 * `docs/ux/*.md` by `scripts/extract.mjs` (never edited by hand: fix the doc, then re-run). Keys are
 * `<SCREEN-ID>.<row>`, e.g. `auth:AUTH-01.title_lesson_3`. Messages are ICU (plural, select).
 * Hindi uses आप everywhere; तुम only in keys containing `little_learner` (R3).
 */
import { createInstance, type i18n as I18nInstance } from 'i18next';
import ICU from 'i18next-icu';

import enAuth from './locales/en/auth.json';
import enLearn from './locales/en/learn.json';
import enMeMoney from './locales/en/me_money.json';
import enMemoryLabs from './locales/en/memory_labs.json';
import enOnboarding from './locales/en/onboarding.json';
import enPractice from './locales/en/practice.json';
import enTutorSocial from './locales/en/tutor_social.json';
import hiAuth from './locales/hi/auth.json';
import hiLearn from './locales/hi/learn.json';
import hiMeMoney from './locales/hi/me_money.json';
import hiMemoryLabs from './locales/hi/memory_labs.json';
import hiOnboarding from './locales/hi/onboarding.json';
import hiPractice from './locales/hi/practice.json';
import hiTutorSocial from './locales/hi/tutor_social.json';
import screens from './locales/screens.json';

export { GLOSSARY_HI } from './glossary';

export const LOCALES = ['en', 'hi'] as const;
export type Locale = (typeof LOCALES)[number];

export const resources = {
  en: {
    auth: enAuth,
    learn: enLearn,
    me_money: enMeMoney,
    memory_labs: enMemoryLabs,
    onboarding: enOnboarding,
    practice: enPractice,
    tutor_social: enTutorSocial,
  },
  hi: {
    auth: hiAuth,
    learn: hiLearn,
    me_money: hiMeMoney,
    memory_labs: hiMemoryLabs,
    onboarding: hiOnboarding,
    practice: hiPractice,
    tutor_social: hiTutorSocial,
  },
} as const;

export type Namespace = keyof (typeof resources)['en'];
export const NAMESPACES = Object.keys(resources.en) as Namespace[];

/** Keys of one namespace (`AUTH-01.title_lesson_3`). */
export type KeyOf<N extends Namespace> = Extract<keyof (typeof resources)['en'][N], string>;
/** A namespaced key (`auth:AUTH-01.title_lesson_3`), what `t` takes. */
export type MessageKey = { [N in Namespace]: `${N}:${KeyOf<N>}` }[Namespace];

/** Builds a typed key: `k('auth', 'AUTH-01.title_lesson_3')`. */
export function k<N extends Namespace, K extends KeyOf<N>>(ns: N, key: K): `${N}:${K}` {
  return `${ns}:${key}`;
}

export type MessageValues = Record<string, string | number | boolean | Date | null | undefined>;

export interface ScreenInfo {
  ns: Namespace;
  title: string;
  priority: string | null;
  line: number;
}

/** Screen id → area, title and mock priority, from the UX docs. */
export const SCREENS = screens as Record<string, ScreenInfo>;

export interface CreateI18nOptions {
  locale: Locale;
  /** The app name for `{brand}` (from `@smriti/config` variant `appName`). */
  brand: string;
  /** Little-learner mode (class 1–5): `tr` prefers the `little_learner` variant of a key. */
  littleLearner?: boolean;
}

export interface Translator {
  readonly i18n: I18nInstance;
  readonly locale: Locale;
  /** Translates a key. `{brand}` is filled automatically. A missing key returns the key. */
  t(key: MessageKey, values?: MessageValues): string;
  /** Like `t`, but uses the little-learner variant of the key when the mode is on and one exists. */
  tr(key: MessageKey, values?: MessageValues): string;
  exists(key: string): boolean;
  setLocale(locale: Locale): Promise<void>;
  setLittleLearner(on: boolean): void;
}

/** Candidate little-learner keys for `ns:SCREEN.slug`, most specific first. */
export function littleLearnerVariants(key: string): string[] {
  const m = /^([^:]+):([^.]+)\.(.+)$/.exec(key);
  if (!m) return [];
  const [, ns, screen, slug] = m;
  if (slug?.includes('little_learner')) return [];
  return [`${ns}:${screen}.${slug}_little_learner`, `${ns}:${screen}.little_learner_${slug}`];
}

/** Creates an i18next instance with ICU and every catalogue bundled (no network, works offline). */
export function createI18n(opts: CreateI18nOptions): Translator {
  const i18n = createInstance();
  void i18n.use(new ICU()).init({
    lng: opts.locale,
    fallbackLng: 'en',
    supportedLngs: [...LOCALES],
    ns: NAMESPACES,
    defaultNS: 'learn',
    resources: resources as unknown as Record<string, Record<string, Record<string, string>>>,
    keySeparator: false,
    nsSeparator: ':',
    initAsync: false,
    returnNull: false,
    returnEmptyString: false,
    interpolation: { escapeValue: false },
  });
  let littleLearner = Boolean(opts.littleLearner);
  const t = (key: string, values?: MessageValues) => i18n.t(key, { brand: opts.brand, ...values }) as string;
  return {
    i18n,
    get locale() {
      return (i18n.language as Locale) ?? opts.locale;
    },
    t,
    tr(key, values) {
      if (littleLearner) {
        for (const v of littleLearnerVariants(key)) if (i18n.exists(v)) return t(v, values);
      }
      return t(key, values);
    },
    exists: (key) => i18n.exists(key),
    async setLocale(locale) {
      await i18n.changeLanguage(locale);
    },
    setLittleLearner(on) {
      littleLearner = on;
    },
  };
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
