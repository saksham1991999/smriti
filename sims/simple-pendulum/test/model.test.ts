import { describe, expect, it } from 'vitest';
import { GRAVITY, advance, agm, energyPerMass, exactPeriod, measuredPeriod, smallAnglePeriod } from '../src/model';

const deg = (d: number): number => (d * Math.PI) / 180;

describe('simple pendulum model', () => {
  it('small-angle period is 2π√(L/g)', () => {
    expect(smallAnglePeriod(1, 9.8)).toBeCloseTo(2 * Math.PI * Math.sqrt(1 / 9.8), 12);
    expect(smallAnglePeriod(1, 9.8)).toBeCloseTo(2.007, 3);
  });

  it('period scales with √L: four times the length doubles the period', () => {
    expect(smallAnglePeriod(4, 9.8) / smallAnglePeriod(1, 9.8)).toBeCloseTo(2, 12);
  });

  it('AGM of 1 and 1/√2 is Gauss’s constant reciprocal (0.8472…)', () => {
    expect(agm(1, Math.SQRT1_2)).toBeCloseTo(0.8472130848, 9);
  });

  it('exact period matches the series T₀(1 + θ²/16 + 11θ⁴/3072) for moderate amplitudes', () => {
    for (const a of [5, 10, 20, 30]) {
      const t = deg(a);
      const series = smallAnglePeriod(1, 9.8) * (1 + (t * t) / 16 + (11 * t ** 4) / 3072);
      expect(exactPeriod(1, 9.8, t)).toBeCloseTo(series, 4);
    }
  });

  it('at 90° the period is 1.18034 T₀ (known value)', () => {
    expect(exactPeriod(1, 9.8, deg(90)) / smallAnglePeriod(1, 9.8)).toBeCloseTo(1.18034, 5);
  });

  it('the RK4 simulation reproduces the exact period', () => {
    for (const [L, g, a] of [
      [1, GRAVITY.earth, 10],
      [0.5, GRAVITY.moon, 45],
      [2, GRAVITY.jupiter, 60],
    ] as const) {
      expect(measuredPeriod(L, g, deg(a))).toBeCloseTo(exactPeriod(L, g, deg(a)), 4);
    }
  });

  it('the integrator conserves energy over many swings', () => {
    let s = { theta: deg(40), omega: 0 };
    const e0 = energyPerMass(s, 1, 9.8);
    for (let i = 0; i < 600; i += 1) s = advance(s, 1, 9.8, 1 / 60);
    expect(Math.abs(energyPerMass(s, 1, 9.8) - e0) / e0).toBeLessThan(1e-6);
  });

  it('refuses non-physical input', () => {
    expect(() => smallAnglePeriod(0, 9.8)).toThrow();
    expect(() => exactPeriod(1, 9.8, Math.PI)).toThrow();
  });
});
