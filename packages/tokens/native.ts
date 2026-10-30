// React Native theme computed from tokens.json. No React Native import here, so it is plain data:
// packages/ui-native reads it through its ThemeProvider. Font family names match the
// @expo-google-fonts packages (Plus Jakarta Sans, Noto Sans Devanagari), loaded with expo-font.
import { resolveColors, heatmapSteps } from "./src/theme";
import {
  font,
  mockPalette,
  periodic,
  periodicBlocks,
  type PeriodicBlock,
  type PeriodicBlockColors,
  motion,
  radius,
  shadow,
  size,
  space,
  subjects,
  thirdParty,
  type,
  typeStyleNames,
  type ColorSet,
  type ExamKey,
  type Mode,
  type SubjectColors,
  type SubjectFamily,
  type TypeStyleName,
} from "./src/tokens";
import { parseColor } from "./src/color";

export type FontWeight = 500 | 600 | 700 | 800;

/** expo-font family names, one per weight, because Android can't pick weights of a custom font. */
export const fontFamilies: Record<"latin" | "devanagari", Record<FontWeight, string>> = {
  latin: {
    500: "PlusJakartaSans_500Medium",
    600: "PlusJakartaSans_600SemiBold",
    700: "PlusJakartaSans_700Bold",
    800: "PlusJakartaSans_800ExtraBold",
  },
  devanagari: {
    500: "NotoSansDevanagari_500Medium",
    600: "NotoSansDevanagari_600SemiBold",
    700: "NotoSansDevanagari_700Bold",
    800: "NotoSansDevanagari_800ExtraBold",
  },
};
export const fontNames = { latin: font.latin, devanagari: font.devanagari, mono: font.mono };

export interface NativeTextStyle {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  /** Kept for platforms that ignore per-weight families (web through react-native-web). */
  fontWeight: "500" | "600" | "700" | "800";
}

export type Script = "latin" | "devanagari";

export function textStyle(name: TypeStyleName, script: Script = "latin"): NativeTextStyle {
  const t = type[name];
  const lh = script === "devanagari" ? Math.round(t.lineHeight * type.devanagariLineHeightScale) : t.lineHeight;
  return {
    fontFamily: fontFamilies[script][t.weight],
    fontSize: t.size,
    lineHeight: lh,
    letterSpacing: t.tracking,
    fontWeight: String(t.weight) as NativeTextStyle["fontWeight"],
  };
}

export const nativeType: Record<Script, Record<TypeStyleName, NativeTextStyle>> = {
  latin: Object.fromEntries(typeStyleNames.map((n) => [n, textStyle(n, "latin")])) as Record<TypeStyleName, NativeTextStyle>,
  devanagari: Object.fromEntries(typeStyleNames.map((n) => [n, textStyle(n, "devanagari")])) as Record<TypeStyleName, NativeTextStyle>,
};

export interface NativeShadow {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  elevation: number;
}

function toNativeShadow(s: { x: number; y: number; blur: number; color: string }, elevation: number): NativeShadow {
  const c = parseColor(s.color);
  const hex = `#${[c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  return { shadowColor: hex, shadowOpacity: c.a, shadowRadius: s.blur / 2, shadowOffset: { width: s.x, height: s.y }, elevation };
}

const noShadow: NativeShadow = { shadowColor: "transparent", shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0 };

export interface NativeTheme {
  mode: Mode;
  exam: ExamKey;
  colors: ColorSet;
  subjects: Record<SubjectFamily, SubjectColors>;
  heat: { fill: string; text: string }[];
  mockPalette: typeof mockPalette;
  periodic: Record<PeriodicBlock, PeriodicBlockColors>;
  google: { fill: string; stroke: string; text: string };
  googleNeutral: { fill: string; text: string };
  apple: { fill: string; text: string; stroke?: string };
  type: Record<Script, Record<TypeStyleName, NativeTextStyle>>;
  space: typeof space;
  radius: typeof radius;
  size: typeof size;
  shadow: { card: NativeShadow; raised: NativeShadow; cta: NativeShadow };
  motion: typeof motion;
  fonts: typeof fontFamilies;
}

/** The full React Native theme for a mode and exam app. Dark mode drops shadows (DESIGN.md §9). */
export function getNativeTheme(mode: Mode, exam: ExamKey = "all"): NativeTheme {
  const c = resolveColors(mode, exam);
  const light = mode === "light";
  const cta: NativeShadow = light
    ? { shadowColor: c.primary, shadowOpacity: shadow.ctaGlow.colorFromPrimaryAlpha, shadowRadius: shadow.ctaGlow.blur / 2, shadowOffset: { width: shadow.ctaGlow.x, height: shadow.ctaGlow.y }, elevation: 6 }
    : noShadow;
  return {
    mode,
    exam,
    colors: c,
    subjects: Object.fromEntries(Object.entries(subjects).map(([k, v]) => [k, v[mode]])) as Record<SubjectFamily, SubjectColors>,
    heat: heatmapSteps(mode).map(({ fill, text }) => ({ fill, text })),
    mockPalette,
    periodic: Object.fromEntries(periodicBlocks.map((b) => [b, periodic.block[b][mode]])) as Record<PeriodicBlock, PeriodicBlockColors>,
    google: thirdParty.google[mode],
    googleNeutral: thirdParty.google.neutral,
    apple: light ? thirdParty.apple.black : thirdParty.apple.white,
    type: nativeType,
    space,
    radius,
    size,
    shadow: {
      card: light ? toNativeShadow(shadow.card, 2) : noShadow,
      raised: light ? toNativeShadow(shadow.raised, 8) : noShadow,
      cta,
    },
    motion,
    fonts: fontFamilies,
  };
}

export const nativeThemes = { light: getNativeTheme("light"), dark: getNativeTheme("dark") };
