// Illustration metadata (Agnes AI images copied from the mock kit, DESIGN §6).
import data from "../data/illustrations.json";
import type { Locale } from "../config/site";

export interface ArtMeta {
  file: string;
  width: number;
  height: number;
  transparent: boolean;
  alt: { en: string; hi: string };
}

const images = data.images as Record<string, ArtMeta>;
export type ArtName = keyof typeof data.images;

/** Widths made by scripts/prepare-assets.mjs. Keep in sync with WIDTHS there. */
export const ART_WIDTHS = [320, 640] as const;

export function art(name: ArtName): ArtMeta {
  const m = images[name];
  if (!m) throw new Error(`Unknown illustration ${String(name)}`);
  return m;
}

/** Alt text from the kit manifest, with the working brand name swapped for the configured one. */
export function altText(name: ArtName, lang: Locale, brand: Record<Locale, string>): string {
  const a = art(name).alt[lang];
  return lang === "hi" ? a.replace(/स्मृति/g, brand.hi) : a.replace(/Smriti/g, brand.en);
}

export function srcset(name: ArtName): string {
  const m = art(name);
  const base = name as string;
  const parts = ART_WIDTHS.filter((w) => w < m.width).map((w) => `/assets/w/${base}-${w}.webp ${w}w`);
  parts.push(`/assets/${m.file} ${m.width}w`);
  return parts.join(", ");
}

/** Subject id → illustration, for subject tiles. Unknown subjects show no art. */
const SUBJECT_ART: Record<string, ArtName> = {
  phy: "subject-physics",
  chem: "subject-chemistry",
  bio: "subject-biology",
  math: "subject-maths",
  quant: "subject-maths",
  history: "subject-history",
  "art-culture": "subject-history",
  social: "subject-history",
  geography: "subject-geography",
  polity: "subject-polity",
  economy: "subject-economy",
  gk: "subject-polity",
  english: "subject-english",
  hindi: "subject-english",
  reasoning: "subject-reasoning",
  environment: "subject-evs",
  "science-tech": "subject-physics",
};

export function subjectArt(subjectId: string): ArtName | undefined {
  return SUBJECT_ART[subjectId];
}
