import { describe, expect, it } from 'vitest';
import { apexTime, maxHeight, niceCeil, pathPoints, positionAt, range, snapStep, tickStep, timeOfFlight, vx, vy, type Launch } from '../src/model';

const at = (v0: number, angle: number, g = 9.8, h0 = 0): Launch => ({ v0, angle, g, h0 });

describe('projectile model', () => {
  it('the card case at 45°: range 40.8 m and maximum height 10.2 m (v0 = 20 m/s, g = 9.8)', () => {
    expect(range(at(20, 45))).toBeCloseTo(40.8, 1);
    expect(maxHeight(at(20, 45))).toBeCloseTo(10.2, 1);
    // Closed forms: R = v0² sin 2θ / g, H = v0² sin²θ / 2g.
    expect(range(at(20, 45))).toBeCloseTo(400 / 9.8, 10);
    expect(maxHeight(at(20, 45))).toBeCloseTo((400 * 0.5) / 19.6, 10);
  });

  it('the card case at 30° and 60°: both ranges are 35.3 m (complementary angles)', () => {
    expect(range(at(20, 30))).toBeCloseTo(35.3, 1);
    expect(range(at(20, 60))).toBeCloseTo(35.3, 1);
    expect(range(at(20, 30))).toBeCloseTo(range(at(20, 60)), 10);
  });

  it('NCERT Example 3.8 (v0 = 28 m/s at 30°): H 10.0 m, T 2.9 s, R 69 m', () => {
    const l = at(28, 30);
    expect(maxHeight(l)).toBeCloseTo(10.0, 1);
    expect(timeOfFlight(l)).toBeCloseTo(2.9, 1);
    expect(Math.round(range(l))).toBe(69);
  });

  it('the range is largest at 45° and equal for 45° ± α on level ground', () => {
    const best = range(at(20, 45));
    for (let a = 0; a <= 90; a += 1) expect(range(at(20, a))).toBeLessThanOrEqual(best + 1e-9);
    for (const d of [5, 15, 30, 40]) expect(range(at(20, 45 + d))).toBeCloseTo(range(at(20, 45 - d)), 9);
  });

  it('vx stays constant; vy falls by g each second and is zero at the top', () => {
    const l = at(20, 45);
    expect(vx(l)).toBeCloseTo(20 * Math.SQRT1_2, 12);
    expect(vy(l, 1) - vy(l, 2)).toBeCloseTo(9.8, 12);
    expect(vy(l, apexTime(l))).toBe(0);
    expect(positionAt(l, apexTime(l)).y).toBeCloseTo(maxHeight(l), 10);
  });

  it('lands on the ground at the time of flight; from a height it flies longer', () => {
    const l = at(20, 45);
    expect(positionAt(l, timeOfFlight(l)).y).toBeCloseTo(0, 9);
    const high = at(20, 45, 9.8, 10);
    expect(positionAt(high, timeOfFlight(high)).y).toBeCloseTo(0, 9);
    expect(timeOfFlight(high)).toBeGreaterThan(timeOfFlight(l));
    expect(maxHeight(high)).toBeCloseTo(10 + maxHeight(l), 10);
    // Thrown level from 20 m: T = √(2h/g).
    expect(timeOfFlight(at(10, 0, 9.8, 20))).toBeCloseTo(Math.sqrt(40 / 9.8), 12);
  });

  it('straight up has zero range; the path never dips below ground', () => {
    expect(range(at(20, 90))).toBe(0);
    expect(Math.min(...pathPoints(at(20, 60), 50).map((p) => p.y))).toBeGreaterThanOrEqual(0);
  });

  it('Step lands on exact 0.05 s multiples; tidy axes', () => {
    let t = 0;
    for (let i = 0; i < 20; i += 1) t = snapStep(t + 0.05, 0.05);
    expect(t).toBeCloseTo(1, 12);
    expect([niceCeil(93.7), niceCeil(46.8), niceCeil(20.8), niceCeil(9)]).toEqual([100, 50, 25, 10]);
    expect(tickStep(100)).toBe(20);
  });

  it('refuses non-physical input', () => {
    expect(() => range(at(20, 45, 0))).toThrow();
    expect(() => range(at(20, 120))).toThrow();
    expect(() => range(at(-1, 45))).toThrow();
  });
});
