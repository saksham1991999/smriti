import { describe, expect, it } from "vitest";
import raw from "../tokens.json";
import { buildTokensCss, cssVar } from "../src/css";
import { resolveColors, subjectColors, subjectFamily } from "../src/theme";
import { colors, examKeys, subjectMap, subjects } from "../src/tokens";
import { smritiPreset } from "../tailwind-preset";
import { fontFamilies, getNativeTheme, textStyle } from "../native";

describe("typed tokens", () => {
  it("mirror tokens.json without $description keys", () => {
    expect(colors.light.primary).toBe(raw.color.light.primary);
    expect(Object.keys(subjectMap)).not.toContain("$description");
    expect(Object.keys(colors.light)).toEqual(Object.keys(colors.dark));
  });

  it("subjectMap points only at real families", () => {
    for (const fam of Object.values(subjectMap)) expect(subjects[fam]).toBeDefined();
  });

  it("resolves subject ids, families and unknown ids", () => {
    expect(subjectFamily("economy")).toBe("polity");
    expect(subjectFamily("chemistry")).toBe("chemistry");
    expect(subjectFamily("not-a-subject")).toBe("physics");
    expect(subjectColors("bio", "dark").strong).toBe(raw.subject.biology.dark.strong);
  });

  it("exam accents swap only the primary family", () => {
    const neet = resolveColors("light", "neet");
    expect(neet.primary).toBe(raw.examAccent.neet.light);
    expect(neet.onPrimary).toBe(raw.examAccent.neet.onAccentLight);
    expect(neet.surface).toBe(colors.light.surface);
    expect(resolveColors("dark", "all").primary).toBe(colors.dark.primary);
  });
});

describe("tokens.css", () => {
  const css = buildTokensCss();
  it("has light, dark (attribute and media query) and every exam", () => {
    expect(css).toContain(':root,\n[data-theme="light"]');
    expect(css).toContain('[data-theme="dark"] {');
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    for (const e of examKeys.filter((k) => k !== "all")) expect(css).toContain(`[data-exam="${e}"]`);
  });

  it("declares every colour token in both modes", () => {
    for (const k of Object.keys(colors.light)) {
      expect(css).toContain(`${cssVar(k)}: ${colors.light[k as keyof typeof colors.light]};`);
      expect(css).toContain(`${cssVar(k)}: ${colors.dark[k as keyof typeof colors.dark]};`);
    }
  });

  it("scales Hindi line heights by 1.15", () => {
    expect(css).toMatch(/:lang\(hi\) \{[^}]*--sm-text-display-lh: 41\.4px/);
  });

  it("drops shadows in dark mode", () => {
    const dark = css.slice(css.indexOf('[data-theme="dark"] {'));
    expect(dark).toMatch(/--sm-shadow-card: none/);
  });
});

describe("tailwind preset", () => {
  it("maps colours to CSS variables, never raw hex", () => {
    const values = Object.values(smritiPreset.theme.colors);
    expect(values.every((v) => !/^#/.test(v))).toBe(true);
    expect(smritiPreset.theme.colors["ink-muted"]).toBe("var(--sm-ink-muted)");
    expect(smritiPreset.theme.colors["subject-strong"]).toBe("var(--sm-subject-strong)");
  });

  it("has the six type styles with line height, weight and tracking", () => {
    expect(Object.keys(smritiPreset.theme.fontSize)).toEqual(["display", "title", "heading", "body", "label", "caption"]);
    expect(smritiPreset.theme.fontSize.display?.[1].lineHeight).toBe("var(--sm-text-display-lh)");
  });
});

describe("native theme", () => {
  it("uses per-weight expo-font families", () => {
    expect(textStyle("display").fontFamily).toBe(fontFamilies.latin[800]);
    expect(textStyle("body", "devanagari").fontFamily).toBe("NotoSansDevanagari_500Medium");
    expect(textStyle("body", "devanagari").lineHeight).toBe(28);
  });

  it("drops shadows in dark mode and applies exam accents", () => {
    expect(getNativeTheme("dark").shadow.card.elevation).toBe(0);
    expect(getNativeTheme("light").shadow.card.shadowOpacity).toBeCloseTo(0.06);
    expect(getNativeTheme("light", "upsc").colors.primary).toBe(raw.examAccent.upsc.light);
  });
});
