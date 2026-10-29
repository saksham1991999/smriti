// Typed view of tokens.json. tokens.json is the source of truth (DESIGN.md); never put values here.
import raw from "../tokens.json";

type Strip<T> = { [K in keyof T as K extends `$${string}` ? never : K]: T[K] };
const strip = <T extends object>(o: T): Strip<T> =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("$"))) as Strip<T>;

export type Mode = "light" | "dark";

/** Every colour token name (`bg`, `surface`, `ink`, `primary`, ...). */
export type ColorName = keyof typeof raw.color.light;
export type ColorSet = Record<ColorName, string>;

export const colors: Record<Mode, ColorSet> = { light: raw.color.light, dark: raw.color.dark };

export type SubjectFamily = keyof typeof raw.subject;
export interface SubjectColors {
  tint: string;
  strong: string;
  onStrong: string;
  text: string;
}
export const subjects: Record<SubjectFamily, Record<Mode, SubjectColors>> = raw.subject;
export const subjectFamilies = Object.keys(raw.subject) as SubjectFamily[];

/** Subject id (as used in content and the API) to its colour family. */
export const subjectMap: Record<string, SubjectFamily> = strip(raw.subjectMap) as Record<string, SubjectFamily>;

export type ExamKey = keyof Strip<typeof raw.examAccent>;
export interface ExamAccent {
  light: string;
  dark: string;
  onAccentLight: string;
  onAccentDark: string;
  tintLight: string;
  tintDark: string;
  pressedLight: string;
  pressedDark: string;
  textLight: string;
  textDark: string;
}
export const examAccent: Record<ExamKey, ExamAccent> = strip(raw.examAccent);
export const examKeys = Object.keys(examAccent) as ExamKey[];

export const logo = strip(raw.logo);

export type MockPaletteState = keyof Strip<typeof raw.mockPalette>;
export type MockPaletteShape = "square" | "pentagon-down" | "pentagon-up" | "circle" | "circle-tick";
export interface MockPaletteEntry {
  fill: string;
  border: string;
  text: string;
  shape: MockPaletteShape;
}
export const mockPalette = strip(raw.mockPalette) as Record<MockPaletteState, MockPaletteEntry>;
export const mockPaletteStates = Object.keys(mockPalette) as MockPaletteState[];

export interface SequentialStep {
  mix: number;
  text: "ink" | "onPrimary";
}
export const dataViz = { sequential: raw.dataViz.sequential as SequentialStep[] };

const tp = strip(raw.thirdParty);
export const thirdParty = {
  google: strip(tp.google),
  apple: strip(tp.apple),
};

export const font = raw.font;

export type TypeStyleName = "display" | "title" | "heading" | "body" | "label" | "caption";
export interface TypeStyle {
  size: number;
  lineHeight: number;
  weight: 500 | 600 | 700 | 800;
  tracking: number;
}
export const typeStyleNames: TypeStyleName[] = ["display", "title", "heading", "body", "label", "caption"];
export const type = {
  display: raw.type.display as TypeStyle,
  title: raw.type.title as TypeStyle,
  heading: raw.type.heading as TypeStyle,
  body: raw.type.body as TypeStyle,
  label: raw.type.label as TypeStyle,
  caption: raw.type.caption as TypeStyle,
  /** Hindi uses the same sizes with 1.15x the line height so matras never clip (DESIGN.md §3). */
  devanagariLineHeightScale: raw.type.devanagariLineHeightScale,
};

export type SpaceKey = keyof typeof raw.space;
export const space: Record<SpaceKey, number> = raw.space;

export type RadiusName = keyof typeof raw.radius;
export const radius: Record<RadiusName, number> = raw.radius;

export interface ShadowToken {
  x: number;
  y: number;
  blur: number;
  color: string;
}
export const shadow = {
  card: raw.shadow.card as ShadowToken,
  raised: raw.shadow.raised as ShadowToken,
  /** The primary CTA glow: the primary colour at this alpha. */
  ctaGlow: raw.shadow.ctaGlow,
};

export type SizeName = keyof typeof raw.size;
export const size: Record<SizeName, number> = raw.size;

export type DurationName = keyof typeof raw.motion.duration;
export type EasingName = keyof typeof raw.motion.easing;
export type SpringName = keyof typeof raw.motion.spring;
export const motion = {
  duration: raw.motion.duration as Record<DurationName, number>,
  easing: raw.motion.easing as Record<EasingName, [number, number, number, number]>,
  spring: raw.motion.spring as Record<SpringName, { damping: number; stiffness: number }>,
  pressScale: raw.motion.pressScale,
};

/** The whole token file, typed, without `$description` keys. */
export const tokens = {
  colors,
  subjects,
  subjectMap,
  examAccent,
  logo,
  mockPalette,
  dataViz,
  thirdParty,
  font,
  type,
  space,
  radius,
  shadow,
  size,
  motion,
};
export type Tokens = typeof tokens;
