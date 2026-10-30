import { describe, expect, it } from 'vitest';
import { checkSimPackage, type SimManifest } from '@smriti/sim-kit';
import manifest from '../manifest.json';
import en from '../strings.en.json';
import hi from '../strings.hi.json';
import { INDICATORS, isEndPoint, phAfter } from '../src/model';

const strong = { analyte: 'strong' as const, acidConc: 0.1, acidVolume: 25, baseConc: 0.1 };

describe('acid-base-titration package', () => {
  it('has a complete, valid manifest and matching strings', () => {
    expect(checkSimPackage(manifest as unknown as SimManifest, { en, hi }, ['end_point', 'analyte', 'indicator'])).toEqual([]);
  });

  it('the end point is reachable in whole drops and the recorded volume is within the task tolerance', () => {
    let found = -1;
    for (let drops = 0; drops <= 1000; drops += 1) {
      const v = Number((drops * 0.05).toFixed(2));
      if (isEndPoint(strong, INDICATORS.phenolphthalein, v)) {
        found = v;
        break;
      }
    }
    expect(Math.abs(found - 25)).toBeLessThanOrEqual(0.1);
  });

  it('pH above 11 is reachable within the burette', () => {
    expect(phAfter(strong, 30)).toBeGreaterThan(11);
  });

  it('the weak-acid end point with phenolphthalein is reachable in drops', () => {
    const weak = { ...strong, analyte: 'weak' as const };
    let ok = false;
    for (let drops = 0; drops <= 1000 && !ok; drops += 1) ok = isEndPoint(weak, INDICATORS.phenolphthalein, Number((drops * 0.05).toFixed(2)));
    expect(ok).toBe(true);
  });
});
