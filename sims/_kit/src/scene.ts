/**
 * SVG building blocks for scenes: value badges and symbols with subscripts.
 * These draw data (values, labels), never decoration.
 */

import { attr, svg } from './dom';

export interface Badge {
  g: SVGGElement;
  set(text: string): void;
  move(x: number, y: number): void;
}

/**
 * A rounded value chip centred on (x, y). Width follows the text; the estimate
 * is replaced by the real text width once the badge is in the document.
 */
export function badge(x: number, y: number, text: string, opts: { size?: number; tone?: 'surface' | 'strong' } = {}): Badge {
  const size = opts.size ?? 14;
  const h = size + 14;
  const rect = svg('rect', { class: `badge-bg badge-${opts.tone ?? 'surface'}`, rx: h / 2, ry: h / 2, height: h, y: -h / 2 });
  const label = svg('text', {
    class: `badge-text badge-text-${opts.tone ?? 'surface'}`,
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    'font-size': size,
  });
  const g = svg('g', { class: 'badge', transform: `translate(${x} ${y})` }, rect, label);
  const fit = (): void => {
    let w = (label.textContent ?? '').length * size * 0.58;
    try {
      if (label.isConnected) w = label.getComputedTextLength();
    } catch {
      // Not rendered yet: keep the estimate.
    }
    const width = Math.ceil(w + size * 1.3);
    attr(rect, { width, x: -width / 2 });
  };
  const set = (t: string): void => {
    label.textContent = t;
    fit();
  };
  set(text);
  // Re-measure after layout and after fonts arrive.
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fit);
  if (typeof document !== 'undefined' && document.fonts) void document.fonts.ready.then(fit);
  return {
    g,
    set,
    move(nx, ny) {
      attr(g, { transform: `translate(${nx} ${ny})` });
    },
  };
}

/** "R" with subscript "1", as an SVG text element. */
export function symbol(x: number, y: number, base: string, sub: string, cls = 'sv-text', size = 15): SVGTextElement {
  return svg(
    'text',
    { x, y, class: cls, 'font-size': size, 'text-anchor': 'middle', 'dominant-baseline': 'central' },
    base,
    svg('tspan', { 'font-size': Math.round(size * 0.7), dy: size * 0.3 }, sub),
  );
}
