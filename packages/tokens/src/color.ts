// Colour maths used by the contrast test and the generators. No colour values live here.

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseColor(input: string): Rgba {
  const s = input.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
  if (hex) {
    let h = hex[1] ?? "";
    if (h.length === 3) h = [...h].map((c) => c + c).join("");
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (rgb) {
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: rgb[4] === undefined ? 1 : Number(rgb[4]) };
  }
  throw new Error(`Unsupported colour: ${input}`);
}

const toHex2 = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0").toUpperCase();

export function toHex({ r, g, b }: Rgba): string {
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
}

/** "53 87 232" for `rgb(var(--x) / a)` style use. */
export function toRgbChannels(color: string): string {
  const { r, g, b } = parseColor(color);
  return `${r} ${g} ${b}`;
}

/** Mix `a` into `b` by `t` (0 = b, 1 = a) in sRGB, like CSS color-mix(in srgb, a t, b). */
export function mix(a: string, b: string, t: number): string {
  const x = parseColor(a);
  const y = parseColor(b);
  return toHex({ r: x.r * t + y.r * (1 - t), g: x.g * t + y.g * (1 - t), b: x.b * t + y.b * (1 - t), a: 1 });
}

/** Composite a translucent colour over an opaque background. */
export function flatten(color: string, background: string): string {
  const c = parseColor(color);
  if (c.a >= 1) return toHex(c);
  return mix(toHex(c), background, c.a);
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance. */
export function luminance(color: string): number {
  const { r, g, b } = parseColor(color);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio between two opaque colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
