// Tailwind preset for Smriti web surfaces. Every value is a CSS variable from dist/tokens.css,
// so light, dark (data-theme / prefers-color-scheme), exam accents (data-exam), subjects
// (data-subject) and Hindi line heights (:lang(hi)) all switch without new classes.
//
// Tailwind v4:  @import "tailwindcss"; @config "@smriti/tokens/tailwind-preset";  (or a config with presets: [preset])
// Tailwind v3:  presets: [smritiPreset] in tailwind.config.ts
// Always import "@smriti/tokens/tokens.css" once, before your own CSS.
import { cssVarRef, kebab } from "./src/css";
import { colors, mockPaletteStates, motion, radius, size, space, subjectFamilies, typeStyleNames } from "./src/tokens";

const v = cssVarRef;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const colorEntries: Record<string, string> = {
  transparent: "transparent",
  current: "currentColor",
  inherit: "inherit",
};
for (const name of Object.keys(colors.light)) colorEntries[kebab(name)] = v(name);
for (const fam of subjectFamilies) {
  colorEntries[`${fam}-tint`] = v(`${fam}Tint`);
  colorEntries[`${fam}-strong`] = v(`${fam}Strong`);
  colorEntries[`${fam}-on-strong`] = v(`${fam}OnStrong`);
  colorEntries[`${fam}-text`] = v(`${fam}Text`);
}
colorEntries["subject-tint"] = v("subjectTint");
colorEntries["subject-strong"] = v("subjectStrong");
colorEntries["subject-on-strong"] = v("subjectOnStrong");
colorEntries["subject-text"] = v("subjectText");
for (let i = 0; i < 5; i++) {
  colorEntries[`heat-${i}`] = v(`heat-${i}`);
  colorEntries[`heat-${i}-text`] = v(`heat-${i}-text`);
}
for (const s of mockPaletteStates) {
  colorEntries[`mock-${kebab(s)}-fill`] = v(`mock${cap(s)}Fill`);
  colorEntries[`mock-${kebab(s)}-border`] = v(`mock${cap(s)}Border`);
  colorEntries[`mock-${kebab(s)}-text`] = v(`mock${cap(s)}Text`);
}
// Brand exception (DESIGN.md §5): only GoogleButton and AppleButton may use these.
colorEntries["google-fill"] = v("googleFill");
colorEntries["google-stroke"] = v("googleStroke");
colorEntries["google-text"] = v("googleText");
colorEntries["google-neutral-fill"] = v("googleNeutralFill");
colorEntries["google-neutral-text"] = v("googleNeutralText");
colorEntries["apple-fill"] = v("appleFill");
colorEntries["apple-text"] = v("appleText");

const fontSize: Record<string, [string, { lineHeight: string; fontWeight: string; letterSpacing: string }]> = {};
for (const n of typeStyleNames) {
  fontSize[n] = [
    v(`text${cap(n)}Size`),
    { lineHeight: v(`text${cap(n)}Lh`), fontWeight: v(`text${cap(n)}Weight`), letterSpacing: v(`text${cap(n)}Tracking`) },
  ];
}

// Tailwind's own 4 px spacing scale is kept (p-4 = 16 px, in rem so it follows the browser text size);
// every token step (4, 8, 12 … 64) is on it. Component sizes are added as named keys: h-touch-min,
// h-button-height, h-tab-bar …
const spacing: Record<string, string> = {};
for (const k of Object.keys(size)) spacing[kebab(k)] = v(`size${cap(k)}`);
/** The token spacing steps, for consumers that want them by name: p-space-4 = var(--sm-space-4). */
for (const k of Object.keys(space)) spacing[`space-${k}`] = v(`space-${k}`);

const borderRadius: Record<string, string> = { none: "0px" };
for (const k of Object.keys(radius)) borderRadius[kebab(k)] = v(`radius${cap(k)}`);
borderRadius.full = v("radiusPill");

const transitionDuration: Record<string, string> = {};
for (const k of Object.keys(motion.duration)) transitionDuration[k] = v(`duration${cap(k)}`);
const transitionTimingFunction: Record<string, string> = {};
for (const k of Object.keys(motion.easing)) transitionTimingFunction[k] = v(`ease${cap(k)}`);

export const smritiPreset = {
  // Colours already switch through CSS variables; `dark:` is only for the rare non-colour difference.
  darkMode: ["selector", '[data-theme="dark"]'] as ["selector", string],
  theme: {
    colors: colorEntries,
    fontFamily: { sans: v("fontSans"), deva: v("fontDeva"), mono: v("fontMono"), google: v("fontGoogle") },
    fontSize,
    borderRadius,
    extend: {
      spacing,
      boxShadow: {
        card: v("shadowCard"),
        raised: v("shadowRaised"),
        cta: `0 10px 24px color-mix(in srgb, ${v("primary")} ${v("ctaGlowAlpha")}, transparent)`,
      },
      transitionDuration,
      transitionTimingFunction,
      minHeight: { touch: v("sizeTouchMin") },
      minWidth: { touch: v("sizeTouchMin") },
      scale: { press: v("pressScale") },
    },
  },
};

export default smritiPreset;
