import { describe, expect, it } from 'vitest';
import { axisRange, clean, niceCeil, displacement, pathLength, position, positionRange, snapTenth, stopTime, velocity, vtAreas, type Motion } from '../src/model';

// The request's test case: u = 10 m/s, a = −2 m/s², from x = 0.
const card: Motion = { x0: 0, u: 10, a: -2 };

describe('constant-acceleration model', () => {
  it('the card case: v = 0 at 5 s, at 25 m', () => {
    expect(stopTime(card)).toBe(5);
    expect(velocity(card, 5)).toBe(0);
    expect(position(card, 5)).toBe(25);
  });

  it('the card case: back at the start at 10 s, after a 50 m path', () => {
    expect(position(card, 10)).toBe(0);
    expect(displacement(card, 10)).toBe(0);
    expect(pathLength(card, 10)).toBeCloseTo(50, 12);
  });

  it('the v-t areas are +25 m above the axis and −25 m below by 10 s', () => {
    const { above, below } = vtAreas(card, 10);
    expect(above).toBeCloseTo(25, 12);
    expect(below).toBeCloseTo(-25, 12);
    expect(above + below).toBeCloseTo(displacement(card, 10), 12);
  });

  it('the slope of the v-t line equals a, and the slope of x-t equals v', () => {
    for (const m of [card, { x0: 3, u: -4, a: 1.5 }, { x0: 0, u: 0, a: 5 }]) {
      for (const t of [0.5, 2, 7.3]) {
        const h = 1e-4;
        expect((velocity(m, t + h) - velocity(m, t - h)) / (2 * h)).toBeCloseTo(m.a, 6);
        expect((position(m, t + h) - position(m, t - h)) / (2 * h)).toBeCloseTo(velocity(m, t), 6);
      }
    }
  });

  it('path length equals |displacement| when the cart does not turn back', () => {
    const m = { x0: 2, u: 4, a: 1 };
    expect(stopTime(m)).toBeNull();
    expect(pathLength(m, 6)).toBeCloseTo(Math.abs(displacement(m, 6)), 12);
    expect(pathLength({ x0: 0, u: -3, a: 0 }, 4)).toBeCloseTo(12, 12);
  });

  it('path length is the numeric integral of |v|', () => {
    const m = { x0: -5, u: -6, a: 2.5 };
    const T = 9;
    const n = 20000;
    let sum = 0;
    for (let k = 0; k < n; k += 1) sum += Math.abs(velocity(m, ((k + 0.5) * T) / n)) * (T / n);
    expect(pathLength(m, T)).toBeCloseTo(sum, 4);
  });

  it('position range includes the turning point', () => {
    expect(positionRange(card, 10)).toEqual([0, 25]);
    expect(positionRange(card, 4)).toEqual([0, 24]);
  });

  it('Step lands on exact tenths: 50 steps of 0.1 s reach 5.0 s', () => {
    let t = 0;
    for (let i = 0; i < 50; i += 1) t = snapTenth(snapTenth(t) + 0.1);
    expect(t).toBe(5);
    expect(velocity(card, t)).toBe(0);
  });

  it('axis ends are tidy numbers', () => {
    expect([niceCeil(27.5), niceCeil(11), niceCeil(5.5), niceCeil(1.1), niceCeil(0)]).toEqual([30, 15, 6, 1.5, 0]);
    expect(axisRange(0, 25)).toEqual([0, 30]);
  });

  it('axis ranges include zero; clean hides −0', () => {
    const [lo, hi] = axisRange(5, 25);
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThan(25);
    expect(Object.is(clean(-1e-15), 0)).toBe(true);
  });

  it('refuses negative or non-finite time', () => {
    expect(() => position(card, -1)).toThrow();
    expect(() => velocity(card, Number.NaN)).toThrow();
  });
});
