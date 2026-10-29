import { describe, expect, it } from 'vitest';
import {
  INDICATORS,
  KA_ACETIC,
  KW,
  baseFraction,
  colourName,
  curve,
  equivalenceVolume,
  isEndPoint,
  phAfter,
  solutionColour,
  type TitrationSetup,
} from '../src/model';

const strong: TitrationSetup = { analyte: 'strong', acidConc: 0.1, acidVolume: 25, baseConc: 0.1 };
const weak: TitrationSetup = { ...strong, analyte: 'weak' };

describe('strong acid + strong base', () => {
  it('starts at pH 1 for 0.1 M HCl', () => {
    expect(phAfter(strong, 0)).toBeCloseTo(1, 4);
  });

  it('half-way: [H⁺] = (2.5 − 1.25) mmol / 37.5 mL', () => {
    expect(phAfter(strong, 12.5)).toBeCloseTo(-Math.log10(1.25 / 37.5), 4);
  });

  it('equivalence at 25 mL with pH 7', () => {
    expect(equivalenceVolume(strong)).toBe(25);
    expect(phAfter(strong, 25)).toBeCloseTo(7, 4);
  });

  it('excess base: 1 mL past equivalence gives [OH⁻] = 0.1 mmol / 51 mL', () => {
    expect(phAfter(strong, 26)).toBeCloseTo(14 + Math.log10(0.1 / 51), 4);
  });

  it('the pH only rises as base is added', () => {
    const c = curve(strong, 50, 0.05);
    for (let i = 1; i < c.length; i += 1) expect(c[i]![1]).toBeGreaterThanOrEqual(c[i - 1]![1] - 1e-9);
  });
});

describe('weak acid (acetic) + strong base', () => {
  it('starts at the pH of 0.1 M acetic acid (exact quadratic)', () => {
    const h = (-KA_ACETIC + Math.sqrt(KA_ACETIC ** 2 + 4 * KA_ACETIC * 0.1)) / 2;
    expect(phAfter(weak, 0)).toBeCloseTo(-Math.log10(h), 3);
  });

  it('half-equivalence: pH ≈ pKa (buffer)', () => {
    expect(phAfter(weak, 12.5)).toBeCloseTo(-Math.log10(KA_ACETIC), 2);
  });

  it('equivalence is basic: acetate hydrolysis, [OH⁻] = √(Kb·C)', () => {
    const kb = KW / KA_ACETIC;
    const oh = Math.sqrt(kb * 0.05);
    expect(phAfter(weak, 25)).toBeCloseTo(14 + Math.log10(oh), 2);
    expect(phAfter(weak, 25)).toBeGreaterThan(8.5);
  });
});

describe('indicators', () => {
  it('base fraction is ½ at pKin', () => {
    for (const ind of Object.values(INDICATORS)) expect(baseFraction(ind, ind.pKin)).toBeCloseTo(0.5, 12);
  });

  it('phenolphthalein is colourless in acid and pink in base', () => {
    const ph = INDICATORS.phenolphthalein;
    expect(solutionColour(ph, 3)[3]).toBeLessThan(0.01);
    const pink = solutionColour(ph, 12);
    expect(pink[0]).toBeGreaterThan(pink[1]); // red over green
    expect(pink[3]).toBeGreaterThan(0.7);
  });

  it('names the colour in words', () => {
    expect(colourName(INDICATORS.phenolphthalein, 4)).toBe('colourless');
    expect(colourName(INDICATORS.phenolphthalein, 12)).toBe('pink');
    expect(colourName(INDICATORS.methyl_orange, 2)).toBe('red');
    expect(colourName(INDICATORS.methyl_orange, 6)).toBe('yellow');
    expect(colourName(INDICATORS.bromothymol_blue, 7.1)).toBe('green');
    expect(colourName(INDICATORS.bromothymol_blue, 10)).toBe('blue');
  });

  it('phenolphthalein end point with strong acid is within two drops after equivalence', () => {
    const ind = INDICATORS.phenolphthalein;
    expect(isEndPoint(strong, ind, 24.9)).toBe(false);
    expect(isEndPoint(strong, ind, 25.05)).toBe(true);
    expect(isEndPoint(strong, ind, 26)).toBe(false);
  });

  it('methyl orange changes far before equivalence with a weak acid (wrong indicator)', () => {
    const ind = INDICATORS.methyl_orange;
    let first = -1;
    for (let v = 0; v <= 50; v += 0.05) {
      if (baseFraction(ind, phAfter(weak, v)) >= 0.5) {
        first = v;
        break;
      }
    }
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(5);
  });
});
