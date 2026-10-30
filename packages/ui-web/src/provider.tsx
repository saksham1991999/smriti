import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { ExamKey, Mode } from "@smriti/tokens";
import {
  createTranslator,
  DEFAULT_ASSET_BASE_URL,
  joinAssetUrl,
  type Locale,
  type PetMood,
  type PetSpecies,
  type PlantHealth,
  type PlantStage,
  type Translate,
  type UIStrings,
} from "@smriti/tokens/ui";

/** Renders the pet or plant instead of the still image, e.g. a Rive view once anim-maker ships the .riv files. */
export type PetRenderer = (p: { species: PetSpecies; mood: PetMood; size: number; alt?: string; reducedMotion: boolean }) => ReactNode;
export type PlantRenderer = (p: { stage: PlantStage; health: PlantHealth; size: number; alt?: string; reducedMotion: boolean }) => ReactNode;

export interface UIContextValue {
  locale: Locale;
  t: Translate;
  /** Resolves an illustration name to a URL. */
  assetUrl: (name: string) => string;
  /** Alt text for an illustration name in the current locale (from the image index), if known. */
  altFor: (name: string) => string | undefined;
  reducedMotion: boolean;
  renderPet?: PetRenderer;
  renderPlant?: PlantRenderer;
}

export interface UIProviderProps {
  locale?: Locale;
  /** Overrides from the app's i18n catalogue (packages/i18n). */
  strings?: Partial<UIStrings>;
  /** Base URL for Agnes webp files (CDN in production). Default "/assets/". */
  assetBaseUrl?: string;
  /** Full control over asset URLs, e.g. content-hashed names from the image index. */
  resolveAsset?: (name: string) => string;
  altText?: (name: string, locale: Locale) => string | undefined;
  /** Forces reduced motion on or off; by default follows prefers-reduced-motion. */
  reducedMotion?: boolean;
  renderPet?: PetRenderer;
  renderPlant?: PlantRenderer;
  children: ReactNode;
}

function useSystemReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

const defaultT = createTranslator("en");
const UIContext = createContext<UIContextValue>({
  locale: "en",
  t: defaultT,
  assetUrl: (name) => joinAssetUrl(DEFAULT_ASSET_BASE_URL, name),
  altFor: () => undefined,
  reducedMotion: false,
});

export function UIProvider({ locale = "en", strings, assetBaseUrl = DEFAULT_ASSET_BASE_URL, resolveAsset, altText, reducedMotion, renderPet, renderPlant, children }: UIProviderProps) {
  const system = useSystemReducedMotion();
  const value = useMemo<UIContextValue>(
    () => ({
      locale,
      t: createTranslator(locale, strings),
      assetUrl: resolveAsset ?? ((name) => joinAssetUrl(assetBaseUrl, name)),
      altFor: (name) => altText?.(name, locale),
      reducedMotion: reducedMotion ?? system,
      renderPet,
      renderPlant,
    }),
    [locale, strings, assetBaseUrl, resolveAsset, altText, reducedMotion, system, renderPet, renderPlant],
  );
  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export const useUI = (): UIContextValue => useContext(UIContext);

export interface ThemeScopeProps {
  /** Omit to follow the system setting (prefers-color-scheme). */
  mode?: Mode;
  exam?: ExamKey;
  locale?: Locale;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * Applies a colour mode, an exam accent and a language to a subtree through data attributes, which
 * tokens.css reads. Put one at the app root (or set the same attributes on <html>); nest one to force
 * light mode, as the mock runner does.
 */
export function ThemeScope({ mode, exam, locale, className, style, children }: ThemeScopeProps) {
  return (
    <div
      data-theme={mode}
      data-exam={exam && exam !== "all" ? exam : undefined}
      lang={locale}
      className={`bg-bg text-ink font-sans ${className ?? ""}`}
      style={style}
    >
      {children}
    </div>
  );
}
