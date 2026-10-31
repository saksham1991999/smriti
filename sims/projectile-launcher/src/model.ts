/**
 * Projectile motion from a launch height h0, no air resistance:
 *   x = v0 cos(θ) t,   y = h0 + v0 sin(θ) t − g t² / 2.
 * The horizontal velocity stays v0 cos(θ); only the vertical velocity changes (vy = v0 sin(θ) − g t).
 * The flight ends when y returns to 0 (the ground). Pure functions shared by the scene and tests.
 */

export interface Launch {
  /** Launch speed (m/s). */
  v0: number;
  /** Launch angle above the horizontal (degrees). */
  angle: number;
  /** Gravity (m/s²). */
  g: number;
  /** Launch height above the ground (m). */
  h0: number;
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

function check(p: Launch): void {
  if (!(p.g > 0) || !Number.isFinite(p.g)) throw new Error('g must be > 0');
  if (!(p.v0 >= 0) || !Number.isFinite(p.v0)) throw new Error('v0 must be ≥ 0');
  if (!(p.h0 >= 0) || !Number.isFinite(p.h0)) throw new Error('h0 must be ≥ 0');
  if (!(p.angle >= 0 && p.angle <= 90)) throw new Error('angle must be 0 to 90 degrees');
}

/** Values within this of zero are zero (cos 90° is not exactly 0 in floating point). */
export function clean(v: number): number {
  return Math.abs(v) < 1e-9 ? 0 : v;
}

/** Horizontal velocity (constant through the flight). */
export function vx(p: Launch): number {
  check(p);
  return clean(p.v0 * Math.cos(rad(p.angle)));
}

/** Vertical velocity at time t. */
export function vy(p: Launch, t: number): number {
  check(p);
  return clean(p.v0 * Math.sin(rad(p.angle)) - p.g * t);
}

export function positionAt(p: Launch, t: number): { x: number; y: number } {
  check(p);
  const uy = p.v0 * Math.sin(rad(p.angle));
  return { x: vx(p) * t, y: p.h0 + uy * t - 0.5 * p.g * t * t };
}

/** Time until the ball is back on the ground: the positive root of h0 + uy t − g t²/2 = 0. */
export function timeOfFlight(p: Launch): number {
  check(p);
  const uy = p.v0 * Math.sin(rad(p.angle));
  return (uy + Math.sqrt(uy * uy + 2 * p.g * p.h0)) / p.g;
}

/** Horizontal distance from the launch point to where the ball lands. */
export function range(p: Launch): number {
  return clean(vx(p) * timeOfFlight(p));
}

/** Highest point above the ground (the launch height when the ball is thrown level or below). */
export function maxHeight(p: Launch): number {
  check(p);
  const uy = Math.max(0, p.v0 * Math.sin(rad(p.angle)));
  return p.h0 + (uy * uy) / (2 * p.g);
}

/** When the ball is highest. */
export function apexTime(p: Launch): number {
  check(p);
  return Math.max(0, (p.v0 * Math.sin(rad(p.angle))) / p.g);
}

/** Points along the whole flight, for drawing the path. */
export function pathPoints(p: Launch, n: number, until = timeOfFlight(p)): Array<{ x: number; y: number }> {
  const end = Math.min(until, timeOfFlight(p));
  const out: Array<{ x: number; y: number }> = [];
  for (let k = 0; k <= n; k += 1) {
    const pt = positionAt(p, (end * k) / n);
    out.push({ x: pt.x, y: Math.max(0, pt.y) });
  }
  return out;
}

/** Times on a 0.05 s grid, so Step lands on exact multiples without drift. */
export function snapStep(t: number, step: number): number {
  return Math.round(t / step) * step;
}

/** Rounds up to a tidy axis end (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 × 10ⁿ), so little space is wasted. */
export function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v - 1e-9) return Number((m * p).toFixed(6));
  return 10 * p;
}

/** A tidy tick spacing for an axis of this length (about five ticks). */
export function tickStep(length: number): number {
  const raw = length / 5;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw - 1e-9) return m * p;
  return 10 * p;
}
