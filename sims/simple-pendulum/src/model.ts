/**
 * Simple pendulum: a point mass on a light, inextensible string, no friction.
 *
 *   equation of motion   θ″ = −(g/L) sin θ           (no small-angle approximation)
 *   small-angle period   T₀ = 2π √(L/g)
 *   exact period         T  = 2π √(L/g) / AGM(1, cos(θ₀/2))
 *
 * The exact period uses the arithmetic–geometric mean form of the complete
 * elliptic integral, which converges in a few steps. The motion is integrated
 * with fourth-order Runge–Kutta. Mass does not appear: the period does not
 * depend on it. Pure functions, no DOM.
 */

export type Planet = 'earth' | 'moon' | 'mars' | 'jupiter';

/** Surface gravity, m/s². Earth uses the 9.8 m/s² school value. */
export const GRAVITY: Record<Planet, number> = {
  earth: 9.8,
  moon: 1.62,
  mars: 3.71,
  jupiter: 24.79,
};

export function smallAnglePeriod(length: number, g: number): number {
  if (length <= 0 || g <= 0) throw new Error('length and g must be positive');
  return 2 * Math.PI * Math.sqrt(length / g);
}

export function agm(a: number, b: number): number {
  let x = a;
  let y = b;
  for (let i = 0; i < 40 && Math.abs(x - y) > 1e-15 * x; i += 1) {
    const nx = (x + y) / 2;
    y = Math.sqrt(x * y);
    x = nx;
  }
  return (x + y) / 2;
}

/** Period for release from rest at amplitude θ₀ (radians, below π). */
export function exactPeriod(length: number, g: number, amplitudeRad: number): number {
  const theta = Math.abs(amplitudeRad);
  if (theta >= Math.PI) throw new Error('amplitude must be below 180°');
  return smallAnglePeriod(length, g) / agm(1, Math.cos(theta / 2));
}

export interface PendulumState {
  theta: number;
  omega: number;
}

/** One RK4 step of θ″ = −(g/L) sin θ. */
export function rk4Step(s: PendulumState, length: number, g: number, dt: number): PendulumState {
  const k = g / length;
  const acc = (theta: number): number => -k * Math.sin(theta);
  const k1t = s.omega;
  const k1w = acc(s.theta);
  const k2t = s.omega + (dt / 2) * k1w;
  const k2w = acc(s.theta + (dt / 2) * k1t);
  const k3t = s.omega + (dt / 2) * k2w;
  const k3w = acc(s.theta + (dt / 2) * k2t);
  const k4t = s.omega + dt * k3w;
  const k4w = acc(s.theta + dt * k3t);
  return {
    theta: s.theta + (dt / 6) * (k1t + 2 * k2t + 2 * k3t + k4t),
    omega: s.omega + (dt / 6) * (k1w + 2 * k2w + 2 * k3w + k4w),
  };
}

/** Advance by `dt` using fixed sub-steps, so accuracy does not depend on the frame rate. */
export function advance(s: PendulumState, length: number, g: number, dt: number, maxStep = 1 / 480): PendulumState {
  const n = Math.max(1, Math.ceil(dt / maxStep));
  let out = s;
  for (let i = 0; i < n; i += 1) out = rk4Step(out, length, g, dt / n);
  return out;
}

/** Energy per unit mass (relative to the lowest point), for checking the integrator. */
export function energyPerMass(s: PendulumState, length: number, g: number): number {
  return 0.5 * length * length * s.omega * s.omega + g * length * (1 - Math.cos(s.theta));
}

/** Period measured from the simulation: time between upward zero crossings. */
export function measuredPeriod(length: number, g: number, amplitudeRad: number, dt = 1 / 2000): number {
  let s: PendulumState = { theta: amplitudeRad, omega: 0 };
  let t = 0;
  const crossings: number[] = [];
  const limit = 4 * exactPeriod(length, g, amplitudeRad);
  while (t < limit && crossings.length < 3) {
    const next = rk4Step(s, length, g, dt);
    if (s.theta < 0 && next.theta >= 0) {
      // Linear interpolation of the crossing time inside the step.
      crossings.push(t + dt * (-s.theta / (next.theta - s.theta)));
    }
    s = next;
    t += dt;
  }
  const a = crossings[0];
  const b = crossings[1];
  if (a === undefined || b === undefined) throw new Error('no full oscillation found');
  return b - a;
}
