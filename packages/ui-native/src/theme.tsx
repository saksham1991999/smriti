import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AccessibilityInfo, useColorScheme, type ImageSourcePropType } from "react-native";
import { subjectFamily, type ExamKey, type Mode, type SubjectColors } from "@smriti/tokens";
import { getNativeTheme, type NativeTheme } from "@smriti/tokens/native";
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
  theme: NativeTheme;
  mode: Mode;
  exam: ExamKey;
  locale: Locale;
  t: Translate;
  /** Image source for an illustration name: a CDN URI by default, or a bundled require() from resolveAsset. */
  assetSource: (name: string) => ImageSourcePropType;
  altFor: (name: string) => string | undefined;
  reducedMotion: boolean;
  renderPet?: PetRenderer;
  renderPlant?: PlantRenderer;
}

export interface UIProviderProps {
  /** Omit to follow the system colour scheme. */
  mode?: Mode;
  exam?: ExamKey;
  locale?: Locale;
  strings?: Partial<UIStrings>;
  /** Base URL for Agnes webp files (the CDN). Default "/assets/"; set an absolute https URL in the app. */
  assetBaseUrl?: string;
  /** Bundled images (the seed pack) or content-hashed URLs. Return undefined to fall back to assetBaseUrl. */
  resolveAsset?: (name: string) => ImageSourcePropType | undefined;
  altText?: (name: string, locale: Locale) => string | undefined;
  /** Forces reduced motion; by default follows the OS setting. */
  reducedMotion?: boolean;
  renderPet?: PetRenderer;
  renderPlant?: PlantRenderer;
  children: ReactNode;
}

function useSystemReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => alive && setReduced(v))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", setReduced);
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return reduced;
}

const fallbackT = createTranslator("en");
const UIContext = createContext<UIContextValue>({
  theme: getNativeTheme("light"),
  mode: "light",
  exam: "all",
  locale: "en",
  t: fallbackT,
  assetSource: (name) => ({ uri: joinAssetUrl(DEFAULT_ASSET_BASE_URL, name) }),
  altFor: () => undefined,
  reducedMotion: false,
});

/** Theme (mode + exam accent), language, strings, asset resolution and the Rive seams for every component. */
export function UIProvider({ mode, exam = "all", locale = "en", strings, assetBaseUrl = DEFAULT_ASSET_BASE_URL, resolveAsset, altText, reducedMotion, renderPet, renderPlant, children }: UIProviderProps) {
  const scheme = useColorScheme();
  const systemReduced = useSystemReducedMotion();
  const resolvedMode: Mode = mode ?? (scheme === "dark" ? "dark" : "light");
  const value = useMemo<UIContextValue>(
    () => ({
      theme: getNativeTheme(resolvedMode, exam),
      mode: resolvedMode,
      exam,
      locale,
      t: createTranslator(locale, strings),
      assetSource: (name) => resolveAsset?.(name) ?? { uri: joinAssetUrl(assetBaseUrl, name) },
      altFor: (name) => altText?.(name, locale),
      reducedMotion: reducedMotion ?? systemReduced,
      renderPet,
      renderPlant,
    }),
    [resolvedMode, exam, locale, strings, assetBaseUrl, resolveAsset, altText, reducedMotion, systemReduced, renderPet, renderPlant],
  );
  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export interface ThemeScopeProps {
  mode?: Mode;
  exam?: ExamKey;
  locale?: Locale;
  children: ReactNode;
}

/** Re-themes a subtree (mode, exam accent, language) and keeps the parent's assets, strings and renderers. */
export function ThemeScope({ mode, exam, locale, children }: ThemeScopeProps) {
  const parent = useContext(UIContext);
  const value = useMemo<UIContextValue>(() => {
    const m = mode ?? parent.mode;
    const e = exam ?? parent.exam;
    const l = locale ?? parent.locale;
    return { ...parent, theme: getNativeTheme(m, e), mode: m, exam: e, locale: l, t: l === parent.locale ? parent.t : createTranslator(l) };
  }, [parent, mode, exam, locale]);
  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export const useUI = (): UIContextValue => useContext(UIContext);
export const useTheme = (): NativeTheme => useContext(UIContext).theme;

/** Colours of a subject id or family in the current mode. */
export function useSubject(subject?: string): SubjectColors {
  const theme = useTheme();
  return theme.subjects[subjectFamily(subject)];
}
