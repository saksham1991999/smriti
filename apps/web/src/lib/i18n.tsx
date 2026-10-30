import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createInstance } from "i18next";
import ICU from "i18next-icu";
import type { Locale, MessageKey, MessageValues, Namespace } from "@smriti/i18n";
import { prefs } from "../platform/web";
import type { Localised } from "./contentTypes";

export type T = (key: MessageKey, values?: MessageValues) => string;

/**
 * The web app's translator: the catalogues and i18next options of `createI18n` in `@smriti/i18n`,
 * but each locale's namespaces are separate chunks. Boot loads the core namespaces of one locale
 * (plus English, the fallback); routes that need more name them (`withNamespaces`), so their
 * catalogues load alongside the screen's chunk. TRD §15: the first route carries one locale, not all.
 */
export interface WebTranslator {
  readonly locale: Locale;
  t: T;
  exists(key: string): boolean;
}

type Loader = () => Promise<{ default: Record<string, string> }>;

const LOADERS: Record<Locale, Record<Namespace, Loader>> = {
  en: {
    auth: () => import("@smriti/i18n/locales/en/auth.json"),
    learn: () => import("@smriti/i18n/locales/en/learn.json"),
    me_money: () => import("@smriti/i18n/locales/en/me_money.json"),
    memory_labs: () => import("@smriti/i18n/locales/en/memory_labs.json"),
    onboarding: () => import("@smriti/i18n/locales/en/onboarding.json"),
    practice: () => import("@smriti/i18n/locales/en/practice.json"),
    tutor_social: () => import("@smriti/i18n/locales/en/tutor_social.json"),
    ui: () => import("@smriti/i18n/locales/en/ui.json"),
  },
  hi: {
    auth: () => import("@smriti/i18n/locales/hi/auth.json"),
    learn: () => import("@smriti/i18n/locales/hi/learn.json"),
    me_money: () => import("@smriti/i18n/locales/hi/me_money.json"),
    memory_labs: () => import("@smriti/i18n/locales/hi/memory_labs.json"),
    onboarding: () => import("@smriti/i18n/locales/hi/onboarding.json"),
    practice: () => import("@smriti/i18n/locales/hi/practice.json"),
    tutor_social: () => import("@smriti/i18n/locales/hi/tutor_social.json"),
    ui: () => import("@smriti/i18n/locales/hi/ui.json"),
  },
};
const ALL_NAMESPACES = Object.keys(LOADERS.en) as Namespace[];
/** What the shell, onboarding and sign-in render with; everything else loads with its route. */
export const CORE_NAMESPACES: Namespace[] = ["learn", "ui", "onboarding"];

// One i18next instance for the app; bundles are added as they arrive and `t` is fixed per locale.
const i18n = createInstance();
void i18n.use(new ICU()).init({
  lng: "en",
  fallbackLng: "en",
  supportedLngs: ["en", "hi"],
  ns: [],
  defaultNS: "learn",
  resources: {},
  keySeparator: false,
  nsSeparator: ":",
  initAsync: false,
  returnNull: false,
  returnEmptyString: false,
  interpolation: { escapeValue: false },
});

const pending = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let current: Locale = "en";

function loadBundle(locale: Locale, ns: Namespace): Promise<void> {
  const id = `${locale}:${ns}`;
  let p = pending.get(id);
  if (!p) {
    p = LOADERS[locale][ns]().then((m) => {
      i18n.addResourceBundle(locale, ns, m.default, true, true);
      for (const l of listeners) l();
    });
    // A failed chunk (offline before the service worker cached it) may be retried later.
    p.catch(() => pending.delete(id));
    pending.set(id, p);
  }
  return p;
}

const has = (locale: Locale, ns: Namespace) => i18n.hasResourceBundle(locale, ns);

function whenIdle(cb: () => void): void {
  if (typeof globalThis.requestIdleCallback === "function") globalThis.requestIdleCallback(() => cb());
  else setTimeout(cb, 1500);
}

/**
 * Loads namespaces for a locale. The Hindi catalogues are complete (extract.mjs checks every row),
 * so a screen never waits for English; the English fallback follows when the browser is idle and
 * fills in any key a future catalogue misses.
 */
export async function ensureNamespaces(namespaces: readonly Namespace[], locale: Locale = current): Promise<void> {
  await Promise.all(namespaces.map((ns) => loadBundle(locale, ns)));
  if (locale !== "en") whenIdle(() => void Promise.all(namespaces.map((ns) => loadBundle("en", ns))).catch(() => undefined));
}

/** Boot: the core namespaces of the starting locale, loaded alongside the local database. */
export function preloadLocale(locale: Locale): Promise<void> {
  current = locale;
  return ensureNamespaces(CORE_NAMESPACES, locale);
}

/** Wraps a lazy route chunk so it resolves only once its namespaces are in memory too. */
export function withNamespaces<M>(namespaces: readonly Namespace[], load: () => Promise<M>): () => Promise<M> {
  return () => Promise.all([load(), ensureNamespaces(namespaces)]).then(([m]) => m);
}

/** Namespaces loaded for `from`, which a switch to another locale must load before it shows. */
const loadedFor = (from: Locale) => ALL_NAMESPACES.filter((ns) => has(from, ns));

function translator(locale: Locale, brand: string): WebTranslator {
  const fixed = i18n.getFixedT(locale);
  return {
    locale,
    t: (key, values) => fixed(key, { brand, ...values }) as string,
    exists: (key) => i18n.exists(key, { lng: locale }),
  };
}

interface I18nValue {
  locale: Locale;
  t: T;
  /** Picks the current locale from a `{ en, hi }` content field. */
  loc: (l: Localised) => string;
  setLocale: (l: Locale) => void;
  translator: WebTranslator;
}

const I18nContext = createContext<I18nValue | null>(null);

export function initialLocale(): Locale {
  const saved = prefs.get("locale");
  if (saved === "en" || saved === "hi") return saved;
  if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("hi")) return "hi";
  return "en";
}

export function I18nProvider({ brand, children, onLocaleChange }: { brand: Localised; children: ReactNode; onLocaleChange?: (l: Locale) => void }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  // The locale on screen: it trails `locale` while a switch loads its catalogues.
  const [shown, setShown] = useState<Locale | null>(() => (CORE_NAMESPACES.every((ns) => has(locale, ns)) ? locale : null));
  // Bumped whenever a bundle arrives, so text from a late namespace fills in.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const l = () => setVersion((v) => v + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  useEffect(() => {
    let live = true;
    const needed = [...new Set([...CORE_NAMESPACES, ...(shown ? loadedFor(shown) : [])])];
    void ensureNamespaces(needed, locale).then(() => {
      if (!live) return;
      current = locale;
      setShown(locale);
    });
    return () => {
      live = false;
    };
    // `shown` is read once per switch; re-running when it changes would only repeat a finished load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);
  useEffect(() => {
    if (!shown) return;
    document.documentElement.lang = shown;
    // Once the first screen is up, fetch the rest of this locale's catalogues while the app is idle.
    whenIdle(() => void ensureNamespaces(ALL_NAMESPACES, shown).catch(() => undefined));
  }, [shown]);
  const brandName = shown ? brand[shown] : "";
  const tr = useMemo(
    () => (shown ? translator(shown, brandName) : null),
    // `version` makes a new `t`, so memoised screens re-render with a namespace that just arrived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, brandName, version],
  );
  const setLocale = useCallback(
    (l: Locale) => {
      prefs.set("locale", l);
      setLocaleState(l);
      onLocaleChange?.(l);
    },
    [onLocaleChange],
  );
  const value = useMemo<I18nValue | null>(
    () => (tr ? { locale: tr.locale, t: tr.t, loc: (l) => l[tr.locale] ?? l.en, setLocale, translator: tr } : null),
    [tr, setLocale],
  );
  if (!value) return null;
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(I18nContext);
  if (!v) throw new Error("useI18n needs <I18nProvider>");
  return v;
}

export const useT = () => useI18n().t;

/** Splits a catalogue row that lists several labels ("A · B · C") when no numbered key exists. */
export function parts(text: string): string[] {
  return text.split(" · ").map((s) => s.trim());
}

/** Formats paise as a tax-inclusive rupee price ("₹1", "₹99"), R38. */
export function rupees(paise: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "hi" ? "hi-IN" : "en-IN", { style: "currency", currency: "INR", maximumFractionDigits: paise % 100 ? 2 : 0 }).format(paise / 100);
}

export function formatDate(d: Date | string | number, locale: Locale, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  return new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", opts).format(new Date(d));
}
