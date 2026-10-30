import { describe, expect, it } from 'vitest';
import { checkSimPackage, type SimManifest } from '@smriti/sim-kit';
import manifest from '../manifest.json';
import en from '../strings.en.json';
import hi from '../strings.hi.json';
import { GRAVITY, exactPeriod } from '../src/model';

const deg = (d: number): number => (d * Math.PI) / 180;
const lengths = Array.from({ length: 191 }, (_, i) => Number((0.1 + i * 0.01).toFixed(2)));

describe('simple-pendulum package', () => {
  it('has a complete, valid manifest and matching strings', () => {
    expect(checkSimPackage(manifest as unknown as SimManifest, { en, hi }, ['planet'])).toEqual([]);
  });

  it('a 2.0 s period is reachable with 0.01 m steps on Earth and on the Moon (10° release)', () => {
    for (const g of [GRAVITY.earth, GRAVITY.moon]) {
      expect(lengths.some((L) => Math.abs(exactPeriod(L, g, deg(10)) - 2) <= 0.03)).toBe(true);
    }
  });

  it('halving the period is reachable from the default and from the 2.0 s answer', () => {
    for (const start of [0.5, 0.99, 2]) {
      const t0 = exactPeriod(start, GRAVITY.earth, deg(10));
      expect(lengths.some((L) => Math.abs(exactPeriod(L, GRAVITY.earth, deg(10)) / t0 - 0.5) <= 0.015)).toBe(true);
    }
  });
});
