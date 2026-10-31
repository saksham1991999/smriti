/**
 * Motion in a straight line with constant acceleration:
 *   x = x0 + u t + a t² / 2,   v = u + a t,   a constant.
 * Displacement is x − x0; path length integrates |v| (the cart may turn back).
 * Pure functions, so the graphs, readouts and tests share one model.
 */

export interface Motion {
  /** Start position (m). */
  x0: number;
  /** Initial velocity (m/s). */
  u: number;
  /** Constant acceleration (m/s²). */
  a: number;
}

function checkTime(t: number): void {
  if (!Number.isFinite(t) || t < 0) throw new Error('time must be a finite number ≥ 0');
}

export function position(m: Motion, t: number): number {
  checkTime(t);
  return m.x0 + m.u * t + 0.5 * m.a * t * t;
}

export function velocity(m: Motion, t: number): number {
  checkTime(t);
  return m.u + m.a * t;
}

export function displacement(m: Motion, t: number): number {
  return position(m, t) - m.x0;
}

/** The instant v = 0 after the start, or null when the cart never stops (a = 0, or u and a have the same sign). */
export function stopTime(m: Motion): number | null {
  if (m.a === 0) return m.u === 0 ? 0 : null;
  const ts = -m.u / m.a;
  return ts >= 0 ? ts : null;
}

/**
 * Signed areas under the v-t line from 0 to t: the part above the axis (≥ 0) and the part below (≤ 0).
 * Their sum is the displacement and their difference is the path length.
 */
export function vtAreas(m: Motion, t: number): { above: number; below: number } {
  checkTime(t);
  const ts = stopTime(m);
  const pieces: Array<[number, number]> = ts !== null && ts > 0 && ts < t ? [[0, ts], [ts, t]] : [[0, t]];
  let above = 0;
  let below = 0;
  for (const [t1, t2] of pieces) {
    const d = position(m, t2) - position(m, t1);
    if (d >= 0) above += d;
    else below += d;
  }
  return { above, below };
}

/** Distance actually travelled from 0 to t: the integral of |v|. */
export function pathLength(m: Motion, t: number): number {
  const { above, below } = vtAreas(m, t);
  return above - below;
}

/** Smallest and largest position over [0, tMax] (the ends, and the turning point if it falls inside). */
export function positionRange(m: Motion, tMax: number): [number, number] {
  const ts = stopTime(m);
  const xs = [position(m, 0), position(m, tMax)];
  if (ts !== null && ts < tMax) xs.push(position(m, ts));
  return [Math.min(...xs), Math.max(...xs)];
}

/** A tidy axis range that includes zero, with a little headroom. */
export function axisRange(lo: number, hi: number): [number, number] {
  let min = Math.min(lo, 0);
  let max = Math.max(hi, 0);
  if (max - min < 1e-9) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.1;
  return [min < 0 ? -niceCeil(-min + pad) : 0, max > 0 ? niceCeil(max + pad) : 0];
}

/** Rounds up to a tidy axis end: a multiple of half the power of ten below it, and whole numbers from 2 up (27.5 to 30, 11 to 15, 5.5 to 6, 1.1 to 1.5). */
export function niceCeil(v: number): number {
  if (v <= 0) return 0;
  const half = 10 ** Math.floor(Math.log10(v)) / 2;
  const step = v >= 2 ? Math.max(1, half) : half;
  return Number((Math.ceil(v / step - 1e-9) * step).toFixed(6));
}

/** Values within this of zero are shown as zero (no "−0.00"). */
export function clean(v: number): number {
  return Math.abs(v) < 1e-9 ? 0 : v;
}

/** Times on a 0.1 s grid: Step lands on exact tenths, so 5.0 s is reachable without drift. */
export function snapTenth(t: number): number {
  return Math.round(t * 10) / 10;
}
