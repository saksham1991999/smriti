/**
 * `@smriti/i18n/core`: the translator without any catalogue bundled.
 *
 * Use it with `load` (see `./loaders`) when catalogues should arrive per namespace and per locale,
 * as separate chunks (the web app's first route carries one locale, not all; TRD §15). The main
 * entry (`@smriti/i18n`) re-exports everything here and bundles every catalogue for offline apps.
 *
 * Nothing in this module imports a catalogue at runtime: the JSON imports below are type-only.
 */
import { createInstance, type i18n as I18nInstance } from 'i18next';
import ICU from 'i18next-icu';

export const LOCALES = ['en', 'hi'] as const;
export type Locale = (typeof LOCALES)[number];

/** The shape of every catalogue (types only; the English catalogue is the source of keys). */
export interface Catalogues {
  auth: typeof import('./locales/en/auth.json');
  learn: typeof import('./locales/en/learn.json');
  me_money: typeof import('./locales/en/me_money.json');
  memory_labs: typeof import('./locales/en/memory_labs.json');
  onboarding: typeof import('./locales/en/onboarding.json');
  practice: typeof import('./locales/en/practice.json');
  tutor_social: typeof import('./locales/en/tutor_social.json');
  ui: typeof import('./locales/en/ui.json');
}

export type Namespace = keyof Catalogues;
export const NAMESPACES: readonly Namespace[] = [
  'auth',
  'learn',
  'me_money',
  'memory_labs',
  'onboarding',
  'practice',
  'tutor_social',
  'ui',
];

/** Keys of one namespace (`AUTH-01.title_lesson_3`). */
export type KeyOf<N extends Namespace> = Extract<keyof Catalogues[N], string>;
/** A namespaced key (`auth:AUTH-01.title_lesson_3`), what `t` takes. */
export type MessageKey = { [N in Namespace]: `${N}:${KeyOf<N>}` }[Namespace];

/** Builds a typed key: `k('auth', 'AUTH-01.title_lesson_3')`. */
export function k<N extends Namespace, K extends KeyOf<N>>(ns: N, key: K): `${N}:${K}` {
  return `${ns}:${key}`;
}

export type MessageValues = Record<string, string | number | boolean | Date | null | undefined>;

/** One catalogue: flat `SCREEN.slug` keys to ICU messages. */
export type Catalogue = Record<string, string>;
/** Catalogues by locale and namespace (any subset). */
export type CatalogueResources = Partial<Record<Locale, Partial<Record<Namespace, Catalogue>>>>;

/**
 * Fetches one namespace of one locale. A JSON module (`{ default }`) or the plain object both work,
 * so a dynamic import of a catalogue's JSON file can be returned as is.
 */
export type CatalogueLoader = (locale: Locale, ns: Namespace) => Promise<Catalogue | { default: Catalogue }>;

export interface CreateI18nOptions {
  locale: Locale;
  /** The app name for `{brand}` (from `@smriti/config` variant `appName`). */
  brand: string;
  /** Little-learner mode (class 1–5): `tr` prefers the `little_learner` variant of a key. */
  littleLearner?: boolean;
  /** Catalogues available from the start. The main entry passes every catalogue by default. */
  resources?: CatalogueResources;
  /**
   * Lazy loading: called at most once per locale and namespace (a failed load can be retried).
   * Load what a screen needs with `loadNamespaces` before it renders.
   */
  load?: CatalogueLoader;
  /**
   * When a non-English namespace loads, its English fallback loads too, through this scheduler
   * (default: right away). The web app passes `requestIdleCallback`, since the Hindi catalogues
   * are complete and English only fills in a key a future catalogue misses.
   */
  scheduleFallback?: (task: () => void) => void;
}

export interface Translator {
  readonly i18n: I18nInstance;
  readonly locale: Locale;
  /** Translates a key. `{brand}` is filled automatically. A missing key returns the key. */
  t(key: MessageKey, values?: MessageValues): string;
  /** Like `t`, but uses the little-learner variant of the key when the mode is on and one exists. */
  tr(key: MessageKey, values?: MessageValues): string;
  exists(key: string): boolean;
  /**
   * Switches the locale. With a loader, the namespaces already loaded for the current locale are
   * loaded for the new one first, so the switch never shows keys.
   */
  setLocale(locale: Locale): Promise<void>;
  setLittleLearner(on: boolean): void;
  /** Loads namespaces for a locale (default: the current one). Resolves at once for loaded ones. */
  loadNamespaces(namespaces: readonly Namespace[], locale?: Locale): Promise<void>;
  /** Whether a namespace of a locale (default: the current one) is in memory. */
  hasNamespace(ns: Namespace, locale?: Locale): boolean;
  /** The namespaces in memory for a locale (default: the current one). */
  loadedNamespaces(locale?: Locale): Namespace[];
  /** Called whenever a catalogue arrives (so a screen can re-render). Returns an unsubscribe. */
  onLoaded(listener: () => void): () => void;
}

/** Candidate little-learner keys for `ns:SCREEN.slug`, most specific first. */
export function littleLearnerVariants(key: string): string[] {
  const m = /^([^:]+):([^.]+)\.(.+)$/.exec(key);
  if (!m) return [];
  const [, ns, screen, slug] = m;
  if (slug?.includes('little_learner')) return [];
  return [`${ns}:${screen}.${slug}_little_learner`, `${ns}:${screen}.little_learner_${slug}`];
}

const unwrapModule = (m: Catalogue | { default: Catalogue }): Catalogue =>
  'default' in m && typeof m.default === 'object' && m.default !== null ? (m.default as Catalogue) : (m as Catalogue);

/** Creates an i18next instance with ICU, from bundled catalogues, a loader, or both. */
export function createI18n(opts: CreateI18nOptions): Translator {
  const i18n = createInstance();
  void i18n.use(new ICU()).init({
    lng: opts.locale,
    fallbackLng: 'en',
    supportedLngs: [...LOCALES],
    ns: opts.load ? [] : [...NAMESPACES],
    defaultNS: 'learn',
    resources: (opts.resources ?? {}) as Record<string, Record<string, Catalogue>>,
    keySeparator: false,
    nsSeparator: ':',
    initAsync: false,
    returnNull: false,
    returnEmptyString: false,
    interpolation: { escapeValue: false },
  });
  let littleLearner = Boolean(opts.littleLearner);
  const t = (key: string, values?: MessageValues) => i18n.t(key, { brand: opts.brand, ...values }) as string;
  const current = () => (i18n.language as Locale | undefined) ?? opts.locale;
  const has = (ns: Namespace, locale: Locale = current()) => i18n.hasResourceBundle(locale, ns);

  const listeners = new Set<() => void>();
  const pending = new Map<string, Promise<void>>();
  const schedule = opts.scheduleFallback ?? ((task: () => void) => task());

  const loadOne = (locale: Locale, ns: Namespace): Promise<void> => {
    if (has(ns, locale)) return Promise.resolve();
    const load = opts.load;
    if (!load) return Promise.reject(new Error(`@smriti/i18n: no catalogue ${locale}:${ns} and no loader`));
    const id = `${locale}:${ns}`;
    let p = pending.get(id);
    if (!p) {
      p = load(locale, ns).then((m) => {
        i18n.addResourceBundle(locale, ns, unwrapModule(m), true, true);
        for (const l of listeners) l();
      });
      // A failed chunk (offline before it was cached) may be retried later.
      p.catch(() => pending.delete(id));
      pending.set(id, p);
    }
    return p;
  };

  const loadNamespaces = async (namespaces: readonly Namespace[], locale: Locale = current()) => {
    await Promise.all(namespaces.map((ns) => loadOne(locale, ns)));
    if (locale !== 'en' && opts.load) {
      const missing = namespaces.filter((ns) => !has(ns, 'en'));
      if (missing.length) schedule(() => void Promise.all(missing.map((ns) => loadOne('en', ns))).catch(() => undefined));
    }
  };

  const loadedNamespaces = (locale: Locale = current()) => NAMESPACES.filter((ns) => has(ns, locale));

  return {
    i18n,
    get locale() {
      return current();
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
      if (opts.load) await loadNamespaces(loadedNamespaces(), locale);
      await i18n.changeLanguage(locale);
    },
    setLittleLearner(on) {
      littleLearner = on;
    },
    loadNamespaces,
    hasNamespace: has,
    loadedNamespaces,
    onLoaded(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
