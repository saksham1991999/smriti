/**
 * Acid–base titration at 25 °C: NaOH from a burette into an acid in a flask.
 *
 * pH comes from the exact charge balance, solved numerically, so the whole
 * curve (start, buffer region, equivalence and excess base) is right without
 * region-by-region approximations:
 *
 *   [H⁺] + [Na⁺] = [OH⁻] + [Cl⁻] + [A⁻]
 *   [OH⁻] = Kw / [H⁺]
 *   [A⁻]  = C_HA · Ka / (Ka + [H⁺])          (weak acid only)
 *
 * The left side minus the right side rises monotonically with [H⁺], so
 * bisection always converges.
 */

export type Analyte = 'strong' | 'weak';
export type IndicatorId = 'phenolphthalein' | 'methyl_orange' | 'bromothymol_blue';

/** Ionic product of water at 298 K. */
export const KW = 1.0e-14;
/** Acid dissociation constant of acetic acid at 298 K, as tabulated in NCERT Class 11 Chemistry (Unit 7, Equilibrium). */
export const KA_ACETIC = 1.74e-5;

export interface TitrationSetup {
  analyte: Analyte;
  /** Acid concentration, mol/L. */
  acidConc: number;
  /** Acid volume in the flask, mL. */
  acidVolume: number;
  /** NaOH concentration, mol/L. */
  baseConc: number;
}

export function equivalenceVolume(s: TitrationSetup): number {
  return (s.acidConc * s.acidVolume) / s.baseConc;
}

/** pH of the flask after `vb` mL of base. */
export function phAfter(s: TitrationSetup, vb: number): number {
  if (vb < 0) throw new Error('volume added cannot be negative');
  const total = s.acidVolume + vb; // mL; volumes are additive for dilute solutions
  const na = (s.baseConc * vb) / total;
  const acid = (s.acidConc * s.acidVolume) / total;
  const balance = (h: number): number => {
    const conjugate = s.analyte === 'strong' ? acid : (acid * KA_ACETIC) / (KA_ACETIC + h);
    return h + na - KW / h - conjugate;
  };
  // Bisection on pH between −1 and 15.
  let lo = -1;
  let hi = 15;
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    // Higher pH → lower [H⁺] → lower balance.
    if (balance(10 ** -mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/* ------------------------------------------------------------- indicators */

/** RGBA colour (0–255, alpha 0–1) of a solution: physical data, not a UI colour. */
export type Rgba = [number, number, number, number];

export interface Indicator {
  id: IndicatorId;
  /** pH where half the indicator is in its base form. */
  pKin: number;
  /** Visible colour-change range (standard tables). */
  range: [number, number];
  acidColour: Rgba;
  baseColour: Rgba;
}

/*
 * Colours of the indicator forms in dilute solution. Phenolphthalein is
 * colourless in acid and pink in base; methyl orange red in acid and yellow in
 * base; bromothymol blue yellow in acid and blue in base.
 */
export const INDICATORS: Record<IndicatorId, Indicator> = {
  phenolphthalein: { id: 'phenolphthalein', pKin: 9.4, range: [8.2, 10.0], acidColour: [255, 255, 255, 0], baseColour: [226, 52, 140, 0.78] },
  methyl_orange: { id: 'methyl_orange', pKin: 3.7, range: [3.1, 4.4], acidColour: [214, 40, 40, 0.72], baseColour: [247, 196, 30, 0.7] },
  bromothymol_blue: { id: 'bromothymol_blue', pKin: 7.1, range: [6.0, 7.6], acidColour: [240, 200, 40, 0.65], baseColour: [40, 92, 214, 0.7] },
};

/** Fraction of the indicator in its base form (Henderson–Hasselbalch). */
export function baseFraction(ind: Indicator, ph: number): number {
  return 1 / (1 + 10 ** (ind.pKin - ph));
}

/** Colour of the flask: the two forms mixed by their fractions (premultiplied alpha). */
export function solutionColour(ind: Indicator, ph: number): Rgba {
  const a = baseFraction(ind, ph);
  const [r1, g1, b1, al1] = ind.acidColour;
  const [r2, g2, b2, al2] = ind.baseColour;
  const alpha = al1 * (1 - a) + al2 * a;
  if (alpha < 1e-6) return [255, 255, 255, 0];
  const mix = (c1: number, c2: number): number => Math.round((c1 * al1 * (1 - a) + c2 * al2 * a) / alpha);
  return [mix(r1, r2), mix(g1, g2), mix(b1, b2), alpha];
}

/** The base form is the main colour now (half or more of the indicator has changed). */
export function hasChanged(ind: Indicator, ph: number): boolean {
  return baseFraction(ind, ph) >= 0.5;
}

/**
 * End point: the indicator has just changed. It has changed at `vb`, but had
 * not changed `windowMl` earlier (two drops of 0.05 mL by default).
 */
export function isEndPoint(s: TitrationSetup, ind: Indicator, vb: number, windowMl = 0.1): boolean {
  if (!hasChanged(ind, phAfter(s, vb))) return false;
  return !hasChanged(ind, phAfter(s, Math.max(0, vb - windowMl)));
}

export type ColourName = 'colourless' | 'pale_pink' | 'pink' | 'red' | 'orange' | 'yellow' | 'green' | 'blue';

/** The colour in words, so colour is never the only signal. */
export function colourName(ind: Indicator, ph: number): ColourName {
  const a = baseFraction(ind, ph);
  switch (ind.id) {
    case 'phenolphthalein':
      return a < 0.1 ? 'colourless' : a < 0.5 ? 'pale_pink' : 'pink';
    case 'methyl_orange':
      return a < 0.25 ? 'red' : a < 0.75 ? 'orange' : 'yellow';
    case 'bromothymol_blue':
      return a < 0.25 ? 'yellow' : a < 0.75 ? 'green' : 'blue';
  }
}

/** A full curve for tests and charts: [volume, pH] pairs. */
export function curve(s: TitrationSetup, maxMl: number, stepMl: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let v = 0; v <= maxMl + 1e-9; v += stepMl) out.push([Number(v.toFixed(4)), phAfter(s, v)]);
  return out;
}
