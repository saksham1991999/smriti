// Builds dist/tokens.css: CSS custom properties for light, dark (data-theme and prefers-color-scheme),
// exam accents (data-exam), subjects (data-subject) and Hindi line heights (:lang(hi)).
import { resolveColors, heatmapSteps } from "./theme";
import {
  colors,
  examKeys,
  font,
  logo,
  mockPalette,
  motion,
  radius,
  shadow,
  size,
  space,
  subjectFamilies,
  subjects,
  thirdParty,
  type,
  typeStyleNames,
  type ColorSet,
  type ExamKey,
  type Mode,
} from "./tokens";

export const CSS_PREFIX = "sm";

export const kebab = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** `--sm-ink-muted` for the colour token `inkMuted`. */
export const cssVar = (name: string): string => `--${CSS_PREFIX}-${kebab(name)}`;
export const cssVarRef = (name: string): string => `var(${cssVar(name)})`;

type Decl = [string, string | number];

const px = (n: number) => `${n}px`;
const block = (selector: string, decls: Decl[], indent = ""): string =>
  `${indent}${selector} {\n${decls.map(([k, v]) => `${indent}  ${k}: ${v};`).join("\n")}\n${indent}}`;

function colorDecls(set: ColorSet): Decl[] {
  return Object.entries(set).map(([k, v]) => [cssVar(k), v]);
}

function modeDecls(mode: Mode): Decl[] {
  const d: Decl[] = [["color-scheme", mode], ...colorDecls(colors[mode])];
  for (const fam of subjectFamilies) {
    const s = subjects[fam][mode];
    d.push([cssVar(`${fam}Tint`), s.tint], [cssVar(`${fam}Strong`), s.strong], [cssVar(`${fam}OnStrong`), s.onStrong], [cssVar(`${fam}Text`), s.text]);
  }
  // The active subject defaults to physics; [data-subject] on a component re-points it.
  d.push(...subjectPointer("physics"));
  heatmapSteps(mode).forEach((step, i) => {
    d.push([cssVar(`heat-${i}`), step.fill], [cssVar(`heat-${i}-text`), step.text]);
  });
  const g = thirdParty.google[mode];
  d.push([cssVar("googleFill"), g.fill], [cssVar("googleStroke"), g.stroke], [cssVar("googleText"), g.text]);
  const apple = mode === "light" ? thirdParty.apple.black : thirdParty.apple.white;
  d.push([cssVar("appleFill"), apple.fill], [cssVar("appleText"), apple.text]);
  const sh = (s: { x: number; y: number; blur: number; color: string }) => `${s.x}px ${s.y}px ${s.blur}px ${s.color}`;
  d.push(
    [cssVar("shadowCard"), mode === "light" ? sh(shadow.card) : "none"],
    [cssVar("shadowRaised"), mode === "light" ? sh(shadow.raised) : "none"],
    [cssVar("ctaGlowAlpha"), mode === "light" ? `${Math.round(shadow.ctaGlow.colorFromPrimaryAlpha * 100)}%` : "0%"],
  );
  return d;
}

function subjectPointer(fam: string): Decl[] {
  return [
    [cssVar("subjectTint"), cssVarRef(`${fam}Tint`)],
    [cssVar("subjectStrong"), cssVarRef(`${fam}Strong`)],
    [cssVar("subjectOnStrong"), cssVarRef(`${fam}OnStrong`)],
    [cssVar("subjectText"), cssVarRef(`${fam}Text`)],
  ];
}

function examDecls(mode: Mode, exam: ExamKey): Decl[] {
  const c = resolveColors(mode, exam);
  return (["primary", "primaryPressed", "onPrimary", "primaryTint", "primaryText"] as const).map((k) => [cssVar(k), c[k]]);
}

function staticDecls(): Decl[] {
  const d: Decl[] = [
    [cssVar("fontSans"), `"${font.latin}", "${font.devanagari}", system-ui, sans-serif`],
    [cssVar("fontDeva"), `"${font.devanagari}", "${font.latin}", system-ui, sans-serif`],
    [cssVar("fontMono"), `"${font.mono}", ui-monospace, monospace`],
    [cssVar("fontGoogle"), `"${thirdParty.google.font.family}", "Roboto", "${font.devanagari}", system-ui, sans-serif`],
  ];
  for (const n of typeStyleNames) {
    const t = type[n];
    d.push(
      [cssVar(`text${cap(n)}Size`), px(t.size)],
      [cssVar(`text${cap(n)}Lh`), px(t.lineHeight)],
      [cssVar(`text${cap(n)}Weight`), t.weight],
      [cssVar(`text${cap(n)}Tracking`), px(t.tracking)],
    );
  }
  for (const [k, v] of Object.entries(space)) d.push([cssVar(`space-${k}`), px(v)]);
  for (const [k, v] of Object.entries(radius)) d.push([cssVar(`radius${cap(k)}`), px(v)]);
  for (const [k, v] of Object.entries(size)) d.push([cssVar(`size${cap(k)}`), px(v)]);
  for (const [k, v] of Object.entries(motion.duration)) d.push([cssVar(`duration${cap(k)}`), `${v}ms`]);
  for (const [k, v] of Object.entries(motion.easing)) d.push([cssVar(`ease${cap(k)}`), `cubic-bezier(${v.join(", ")})`]);
  d.push([cssVar("pressScale"), motion.pressScale]);
  for (const [state, e] of Object.entries(mockPalette)) {
    d.push([cssVar(`mock${cap(state)}Fill`), e.fill], [cssVar(`mock${cap(state)}Border`), e.border], [cssVar(`mock${cap(state)}Text`), e.text]);
  }
  for (const [k, v] of Object.entries(logo)) d.push([cssVar(`logo${cap(k)}`), v]);
  d.push([cssVar("googleNeutralFill"), thirdParty.google.neutral.fill], [cssVar("googleNeutralText"), thirdParty.google.neutral.text]);
  return d;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function hindiDecls(): Decl[] {
  return typeStyleNames.map((n) => [
    cssVar(`text${cap(n)}Lh`),
    px(Math.round(type[n].lineHeight * type.devanagariLineHeightScale * 10) / 10),
  ]);
}

export function buildTokensCss(): string {
  const out: string[] = [
    "/* Generated by packages/tokens/scripts/generate.ts from tokens.json. Do not edit. */",
    block(":root", staticDecls()),
    block(':root,\n[data-theme="light"]', modeDecls("light")),
    block('[data-theme="dark"]', modeDecls("dark")),
    `@media (prefers-color-scheme: dark) {\n${block(':root:not([data-theme="light"])', modeDecls("dark"), "  ")}\n}`,
  ];
  for (const exam of examKeys) {
    if (exam === "all") continue;
    const sel = `[data-exam="${exam}"]`;
    out.push(block(sel, examDecls("light", exam)));
    out.push(block(`[data-theme="dark"]${sel},\n[data-theme="dark"] ${sel}`, examDecls("dark", exam)));
    out.push(
      `@media (prefers-color-scheme: dark) {\n${block(`:root:not([data-theme="light"])${sel},\n  :root:not([data-theme="light"]) ${sel}`, examDecls("dark", exam), "  ")}\n}`,
    );
  }
  for (const fam of subjectFamilies) out.push(block(`[data-subject="${fam}"]`, subjectPointer(fam)));
  out.push(block(":lang(hi)", hindiDecls()));
  return `${out.join("\n\n")}\n`;
}
