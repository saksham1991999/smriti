import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createI18n, type Locale, type MessageKey, type MessageValues, type Translator } from "@smriti/i18n";
import { prefs } from "../platform/web";
import type { Localised } from "./contentTypes";

export type T = (key: MessageKey, values?: MessageValues) => string;

interface I18nValue {
  locale: Locale;
  t: T;
  /** Picks the current locale from a `{ en, hi }` content field. */
  loc: (l: Localised) => string;
  setLocale: (l: Locale) => void;
  translator: Translator;
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
  const brandName = brand[locale];
  const translator = useMemo(() => createI18n({ locale, brand: brandName }), [locale, brandName]);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const setLocale = useCallback(
    (l: Locale) => {
      prefs.set("locale", l);
      setLocaleState(l);
      onLocaleChange?.(l);
    },
    [onLocaleChange],
  );
  const value = useMemo<I18nValue>(
    () => ({ locale, t: translator.t, loc: (l) => l[locale] ?? l.en, setLocale, translator }),
    [locale, translator, setLocale],
  );
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
