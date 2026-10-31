import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createI18n, NAMESPACES, type Locale, type MessageKey, type MessageValues, type Namespace } from "@smriti/i18n/core";
import { loadCatalogue } from "@smriti/i18n/loaders";
import { prefs } from "../platform/web";
import type { Localised } from "./contentTypes";

export type T = (key: MessageKey, values?: MessageValues) => string;

/**
 * The web app's translator: `createI18n` from `@smriti/i18n/core` with its per-namespace loader,
 * so each locale's namespaces are separate chunks. Boot loads the core namespaces of one locale
 * (plus English, the fallback); routes that need more name them (`withNamespaces`), so their
 * catalogues load alongside the screen's chunk. TRD §15: the first route carries one locale, not all.
 */
export interface WebTranslator {
  readonly locale: Locale;
  t: T;
  exists(key: string): boolean;
}

const ALL_NAMESPACES = NAMESPACES;
/** What the shell, onboarding and sign-in render with; everything else loads with its route. */
export const CORE_NAMESPACES: Namespace[] = ["learn", "ui", "onboarding"];

function whenIdle(cb: () => void): void {
  if (typeof globalThis.requestIdleCallback === "function") globalThis.requestIdleCallback(() => cb());
  else setTimeout(cb, 1500);
}

// One translator for the app; catalogues are added as they arrive and `t` is fixed per locale.
// A failed chunk (offline before the service worker cached it) may be retried later.
const core = createI18n({ locale: "en", brand: "", load: loadCatalogue, scheduleFallback: whenIdle });
const i18n = core.i18n;
let current: Locale = "en";

const has = (locale: Locale, ns: Namespace) => core.hasNamespace(ns, locale);

/**
 * Loads namespaces for a locale. The Hindi catalogues are complete (extract.mjs checks every row),
 * so a screen never waits for English; the English fallback follows when the browser is idle and
 * fills in any key a future catalogue misses.
 */
export function ensureNamespaces(namespaces: readonly Namespace[], locale: Locale = current): Promise<void> {
  return core.loadNamespaces(namespaces, locale);
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
const loadedFor = (from: Locale) => core.loadedNamespaces(from);

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
    return core.onLoaded(() => setVersion((v) => v + 1));
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
