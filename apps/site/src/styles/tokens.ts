// Turns packages/tokens/tokens.json into CSS custom properties at build time, so components
// use var(--…) only and never a raw hex value (AGENTS "Styling: tokens only").
// When packages/tokens ships its own CSS build, this file switches to importing it.

import tokens from "../../../../packages/tokens/tokens.json";

type Mode = "light" | "dark";
type ColorSet = Record<string, string>;

const kebab = (s: string): string => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function colorVars(set: ColorSet): string {
  return Object.entries(set)
    .map(([k, v]) => `--${kebab(k)}:${v};`)
    .join("");
}

interface SubjectMode {
  tint: string;
  strong: string;
  onStrong: string;
  text: string;
}
const subjects = tokens.subject as Record<string, Record<Mode, SubjectMode>>;

function subjectVars(s: SubjectMode): string {
  return `--tint:${s.tint};--strong:${s.strong};--on-strong:${s.onStrong};--stext:${s.text};`;
}

/** Exam accents swap `primary` only (DESIGN §2.3). Tints and text come from the matching subject family. */
const ACCENT_FAMILY: Record<string, string | null> = { all: null, jee: null, neet: "biology", upsc: "polity", ssc: "maths" };

function accentVars(mode: Mode, accent: string): string {
  // examAccent also carries a `$description` string, hence the cast through unknown.
  const a = (tokens.examAccent as unknown as Record<string, { light: string; dark: string; onAccentLight?: string } | undefined>)[accent];
  if (!a) return "";
  const family = ACCENT_FAMILY[accent];
  const base = tokens.color[mode];
  if (!family) {
    return `--primary:${a[mode]};--primary-text:${base.primary};--primary-tint:${base.primaryTint};--on-primary:${base.onPrimary};--primary-pressed:${base.primaryPressed};`;
  }
  const fam = subjects[family]![mode];
  const onPrimary = mode === "light" ? (a.onAccentLight ?? base.onPrimary) : base.onPrimary;
  return `--primary:${a[mode]};--primary-text:${fam.text};--primary-tint:${fam.tint};--on-primary:${onPrimary};--primary-pressed:${mode === "light" ? fam.text : a[mode]};`;
}

// --glow must be re-declared wherever --primary changes, because var() resolves where it is declared.
const glowVar = `--glow:${tokens.shadow.ctaGlow.x}px ${tokens.shadow.ctaGlow.y}px ${tokens.shadow.ctaGlow.blur}px color-mix(in srgb, var(--primary) ${Math.round(tokens.shadow.ctaGlow.colorFromPrimaryAlpha * 100)}%, transparent);`;

function modeBlock(mode: Mode): string {
  const c = tokens.color[mode] as ColorSet;
  const shadow =
    mode === "light"
      ? `--sh-card:${tokens.shadow.card.x}px ${tokens.shadow.card.y}px ${tokens.shadow.card.blur}px ${tokens.shadow.card.color};` +
        `--sh-raised:${tokens.shadow.raised.x}px ${tokens.shadow.raised.y}px ${tokens.shadow.raised.blur}px ${tokens.shadow.raised.color};` +
        glowVar
      : "--sh-card:none;--sh-raised:none;--glow:none;";
  const logo = Object.entries(tokens.logo)
    .filter(([k]) => !k.startsWith("$"))
    .map(([k, v]) => `--logo-${kebab(k)}:${v};`)
    .join("");
  return (
    colorVars(c) +
    `--primary-text:${c.primary};` +
    shadow +
    logo +
    subjectVars(subjects.physics![mode]) +
    `color-scheme:${mode};`
  );
}

function scoped(mode: Mode): string {
  const families = Object.keys(subjects)
    .map((f) => `.s-${f}{${subjectVars(subjects[f]![mode])}}`)
    .join("");
  const accents = Object.keys(tokens.examAccent)
    .filter((k) => !k.startsWith("$"))
    .map((k) => `.x-${k}{${accentVars(mode, k)}${mode === "light" ? glowVar : "--glow:none;"}}`)
    .join("");
  return families + accents;
}

// Scope each rule under the theme selector, both on the root itself (exam accents sit on <html>)
// and on descendants (subject families), so the dark values win over the dark :root block.
const nested = (prefix: string, css: string): string =>
  css.replace(/(^|\})\s*([^{}]+)\{/g, (_m, close: string, sel: string) => `${close}${prefix}${sel.trim()},${prefix} ${sel.trim()}{`);

const staticVars = (() => {
  const t = tokens.type;
  const typeVars = (["display", "title", "heading", "body", "label", "caption"] as const)
    .map((k) => `--fs-${k}:${t[k].size}px;--lh-${k}:${t[k].lineHeight}px;--fw-${k}:${t[k].weight};--ls-${k}:${t[k].tracking}px;`)
    .join("");
  const space = Object.entries(tokens.space)
    .map(([k, v]) => `--sp-${k}:${v}px;`)
    .join("");
  const radius = Object.entries(tokens.radius)
    .map(([k, v]) => `--r-${kebab(k)}:${v}px;`)
    .join("");
  const d = tokens.motion.duration;
  const e = tokens.motion.easing.standard;
  const motion = `--dur-fast:${d.fast}ms;--dur-base:${d.base}ms;--dur-slow:${d.slow}ms;--dur-emphasis:${d.emphasis}ms;--ease:cubic-bezier(${e.join(",")});--press-scale:${tokens.motion.pressScale};`;
  const size = `--touch:${tokens.size.touchMin}px;--btn-h:${tokens.size.buttonHeight}px;--btn-h-sm:${tokens.size.buttonHeightSmall}px;`;
  const fonts = `--f-latin:"Plus Jakarta Sans Variable","${tokens.font.latin}","Noto Sans Devanagari Variable",system-ui,sans-serif;--f-deva:"Plus Jakarta Sans Variable","Noto Sans Devanagari Variable","${tokens.font.devanagari}",system-ui,sans-serif;--deva-lh:${tokens.type.devanagariLineHeightScale};`;
  return typeVars + space + radius + motion + size + fonts;
})();

export const tokenCss: string =
  `:root{${staticVars}${modeBlock("light")}}` +
  scoped("light") +
  `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${modeBlock("dark")}}${nested(':root:not([data-theme="light"])', scoped("dark"))}}` +
  `:root[data-theme="dark"]{${modeBlock("dark")}}` +
  nested(':root[data-theme="dark"]', scoped("dark"));

/** Theme colours for <meta name="theme-color">. */
export const themeColor = { light: tokens.color.light.bg, dark: tokens.color.dark.bg };

export type BlockLetter = "s" | "p" | "d" | "f";
/**
 * Periodic-table block tints. DESIGN has no block tokens yet (memory-labs flow §12 G9), so the
 * teaser borrows subject families. Every cell also prints its block letter (never colour alone).
 */
export const BLOCK_FAMILY: Record<BlockLetter, string> = { s: "physics", p: "biology", d: "chemistry", f: "maths" };
