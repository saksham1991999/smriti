/**
 * Thin convex lens, Cartesian sign convention (distances from the optical
 * centre, positive in the direction of incident light, i.e. to the right):
 *
 *   lens formula     1/v − 1/u = 1/f      (f > 0 for a convex lens)
 *   magnification    m = h′/h = v/u
 *   power            P = 1/f  (f in metres, P in dioptres)
 *
 * The object stands on the axis to the left, so u = −d. Pure functions.
 */

export type Nature = 'real' | 'virtual' | 'none';
export type Orientation = 'inverted' | 'erect' | 'none';
export type SizeClass = 'magnified' | 'diminished' | 'same' | 'none';
export type Region = 'beyond_2f' | 'at_2f' | 'between_f_2f' | 'at_f' | 'within_f';

export interface LensImage {
  /** Object distance, signed (negative: object on the left), cm. */
  u: number;
  /** Image distance, signed, cm. Null when the image is at infinity. */
  v: number | null;
  /** Magnification; null at infinity. */
  m: number | null;
  /** Image height, cm (negative: inverted). Null at infinity. */
  imageHeight: number | null;
  nature: Nature;
  orientation: Orientation;
  size: SizeClass;
}

/** How close (cm) the object must be to F or 2F to count as "at" it. */
export const AT_TOLERANCE_CM = 0.25;
/** |m| within this of 1 counts as "same size". */
export const SAME_SIZE_TOLERANCE = 0.005;

export function imageDistance(u: number, f: number): number | null {
  if (f <= 0) throw new Error('a convex lens has f > 0');
  if (u >= 0) throw new Error('the object must be on the left (u < 0)');
  const denom = u + f;
  if (Math.abs(denom) < 1e-9) return null; // object at F: rays leave parallel
  return (u * f) / denom;
}

export function solveLens(f: number, objectDistance: number, objectHeight: number): LensImage {
  const u = -objectDistance;
  const v = imageDistance(u, f);
  if (v === null) return { u, v: null, m: null, imageHeight: null, nature: 'none', orientation: 'none', size: 'none' };
  const m = v / u;
  const abs = Math.abs(m);
  return {
    u,
    v,
    m,
    imageHeight: m * objectHeight,
    nature: v > 0 ? 'real' : 'virtual',
    orientation: m < 0 ? 'inverted' : 'erect',
    size: Math.abs(abs - 1) <= SAME_SIZE_TOLERANCE ? 'same' : abs > 1 ? 'magnified' : 'diminished',
  };
}

export function powerDioptres(fCm: number): number {
  return 100 / fCm;
}

export function objectRegion(f: number, objectDistance: number): Region {
  const d = objectDistance;
  if (Math.abs(d - 2 * f) <= AT_TOLERANCE_CM) return 'at_2f';
  if (Math.abs(d - f) <= AT_TOLERANCE_CM) return 'at_f';
  if (d > 2 * f) return 'beyond_2f';
  if (d > f) return 'between_f_2f';
  return 'within_f';
}

/** A screen at `screen` cm right of the lens shows a sharp image within this distance of v. */
export function sharpTolerance(v: number): number {
  return Math.max(0.5, 0.02 * Math.abs(v));
}

export function isSharpOnScreen(image: LensImage, screen: number): boolean {
  return image.nature === 'real' && image.v !== null && Math.abs(screen - image.v) <= sharpTolerance(image.v);
}

/**
 * Radius of the blur patch on the screen relative to the lens aperture
 * (similar triangles: the cone from the lens edge converges at v).
 */
export function blurFraction(image: LensImage, screen: number): number {
  if (image.nature !== 'real' || image.v === null) return 1;
  return Math.min(1, Math.abs(screen - image.v) / image.v);
}

/** Where the three principal rays cross the lens plane (height, cm), for drawing. */
export function principalRays(f: number, objectDistance: number, h: number): { parallel: number; centre: number; focal: number | null } {
  const d = objectDistance;
  // Ray through F1 (or aimed as if from F1 when the object is inside F) meets the lens at −hf/(d−f).
  const focal = Math.abs(d - f) < 1e-9 ? null : (-h * f) / (d - f);
  return { parallel: h, centre: 0, focal };
}
