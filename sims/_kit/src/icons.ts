/**
 * Phosphor icons (MIT, DESIGN §5), bold weight, bundled so sims stay offline.
 * Only the icons sims use are imported.
 */

import arrowCounterClockwise from '@phosphor-icons/core/assets/bold/arrow-counter-clockwise-bold.svg?raw';
import check from '@phosphor-icons/core/assets/bold/check-bold.svg?raw';
import drop from '@phosphor-icons/core/assets/bold/drop-bold.svg?raw';
import minus from '@phosphor-icons/core/assets/bold/minus-bold.svg?raw';
import pause from '@phosphor-icons/core/assets/bold/pause-bold.svg?raw';
import play from '@phosphor-icons/core/assets/bold/play-bold.svg?raw';
import plus from '@phosphor-icons/core/assets/bold/plus-bold.svg?raw';
import skipForward from '@phosphor-icons/core/assets/bold/skip-forward-bold.svg?raw';
import timer from '@phosphor-icons/core/assets/bold/timer-bold.svg?raw';

export const ICONS = {
  reset: arrowCounterClockwise,
  check,
  drop,
  minus,
  pause,
  play,
  plus,
  step: skipForward,
  timer,
} as const;

export type IconName = keyof typeof ICONS;

const parser = typeof DOMParser !== 'undefined' ? new DOMParser() : null;

/** A decorative icon element (`aria-hidden`); the control around it carries the label. */
export function icon(name: IconName, size = 20): SVGElement {
  if (!parser) throw new Error('icons need a DOM');
  const doc = parser.parseFromString(ICONS[name], 'image/svg+xml');
  const svg = document.importNode(doc.documentElement, true) as unknown as SVGElement;
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  return svg;
}
