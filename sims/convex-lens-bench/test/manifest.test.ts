import { describe, expect, it } from 'vitest';
import { checkSimPackage, type SimManifest } from '@smriti/sim-kit';
import manifest from '../manifest.json';
import en from '../strings.en.json';
import hi from '../strings.hi.json';
import { isSharpOnScreen, solveLens } from '../src/model';

describe('convex-lens-bench package', () => {
  it('has a complete, valid manifest and matching strings', () => {
    expect(
      checkSimPackage(manifest as unknown as SimManifest, { en, hi }, ['object_region', 'image_real', 'image_virtual', 'screen_sharp']),
    ).toEqual([]);
  });

  it('a sharp image is reachable with 0.5 cm screen steps for every object step', () => {
    for (let d = 2; d <= 45; d += 0.5) {
      const img = solveLens(10, d, 3);
      if (img.nature !== 'real' || img.v === null || img.v > 45) continue;
      const nearest = Math.round(img.v / 0.5) * 0.5;
      expect(isSharpOnScreen(img, nearest)).toBe(true);
    }
  });

  it('the same-size task is reachable: object at 2F gives m = −1', () => {
    expect(solveLens(10, 20, 3).m).toBeCloseTo(-1, 12);
  });
});
