/**
 * Token theme for sims. Every colour comes from packages/tokens/tokens.json
 * (DESIGN.md §2): the core set for light or dark, the sim's subject family as
 * `--s-*`, and every family as `--f-{family}-*` for secondary elements.
 * Sims never hard-code colours.
 */

import type { ThemeName } from '@smriti/sim-bridge';
import tokens from '../../../packages/tokens/tokens.json';

export type SubjectFamily = keyof typeof tokens.subject;
export const FAMILIES = Object.keys(tokens.subject) as SubjectFamily[];

type CoreColour = keyof typeof tokens.color.light;

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** CSS custom properties for a theme and family. Pure, so it can be tested. */
export function themeVariables(theme: ThemeName, family: SubjectFamily): Record<string, string> {
  const vars: Record<string, string> = {};
  const core = tokens.color[theme];
  for (const key of Object.keys(core) as CoreColour[]) vars[`--${kebab(key)}`] = core[key];

  const own = tokens.subject[family][theme];
  vars['--s-tint'] = own.tint;
  vars['--s-strong'] = own.strong;
  vars['--s-on-strong'] = own.onStrong;
  vars['--s-text'] = own.text;
  for (const f of FAMILIES) {
    const c = tokens.subject[f][theme];
    vars[`--f-${f}-tint`] = c.tint;
    vars[`--f-${f}-strong`] = c.strong;
    vars[`--f-${f}-on-strong`] = c.onStrong;
    vars[`--f-${f}-text`] = c.text;
  }

  for (const [k, v] of Object.entries(tokens.radius)) vars[`--r-${kebab(k)}`] = `${v}px`;
  for (const [k, v] of Object.entries(tokens.space)) vars[`--sp-${k}`] = `${v}px`;
  for (const [k, v] of Object.entries(tokens.type)) {
    if (typeof v !== 'object') continue;
    vars[`--t-${k}-size`] = `${v.size}px`;
    vars[`--t-${k}-lh`] = `${v.lineHeight}px`;
    vars[`--t-${k}-weight`] = `${v.weight}`;
    vars[`--t-${k}-tracking`] = `${v.tracking}px`;
  }
  vars['--lh-deva'] = `${tokens.type.devanagariLineHeightScale}`;
  vars['--touch-min'] = `${tokens.size.touchMin}px`;
  vars['--button-h'] = `${tokens.size.buttonHeight}px`;
  vars['--button-h-sm'] = `${tokens.size.buttonHeightSmall}px`;
  vars['--icon'] = `${tokens.size.icon}px`;
  vars['--icon-sm'] = `${tokens.size.iconSm}px`;
  vars['--d-fast'] = `${tokens.motion.duration.fast}ms`;
  vars['--d-base'] = `${tokens.motion.duration.base}ms`;
  vars['--d-slow'] = `${tokens.motion.duration.slow}ms`;
  vars['--ease'] = `cubic-bezier(${tokens.motion.easing.standard.join(',')})`;
  vars['--press-scale'] = `${tokens.motion.pressScale}`;

  // Dark mode drops shadows (DESIGN §4, §9).
  const sh = tokens.shadow;
  vars['--sh-card'] = theme === 'dark' ? 'none' : `${sh.card.x}px ${sh.card.y}px ${sh.card.blur}px ${sh.card.color}`;
  vars['--sh-raised'] = theme === 'dark' ? 'none' : `${sh.raised.x}px ${sh.raised.y}px ${sh.raised.blur}px ${sh.raised.color}`;
  vars['--font-latin'] = `'${tokens.font.latin}'`;
  vars['--font-deva'] = `'${tokens.font.devanagari}'`;
  return vars;
}

export function applyTheme(root: HTMLElement, theme: ThemeName, family: SubjectFamily): void {
  for (const [k, v] of Object.entries(themeVariables(theme, family))) root.style.setProperty(k, v);
  root.dataset.theme = theme;
  root.dataset.family = family;
  root.style.colorScheme = theme;
}

/** The subject family for a subject id (`phy` → `physics`), through `subjectMap`. */
export function familyForSubject(subjectId: string): SubjectFamily {
  const map = tokens.subjectMap as Record<string, string>;
  const family = map[subjectId];
  if (family && (FAMILIES as string[]).includes(family)) return family as SubjectFamily;
  throw new Error(`no subject family for ${subjectId}`);
}
