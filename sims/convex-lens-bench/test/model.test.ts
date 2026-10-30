import { describe, expect, it } from 'vitest';
import { blurFraction, imageDistance, isSharpOnScreen, objectRegion, powerDioptres, principalRays, solveLens } from '../src/model';

describe('convex lens model (1/v − 1/u = 1/f)', () => {
  it('object at 2F gives a real, inverted, same-size image at 2F', () => {
    const img = solveLens(10, 20, 3);
    expect(img.v).toBeCloseTo(20, 12);
    expect(img.m).toBeCloseTo(-1, 12);
    expect(img).toMatchObject({ nature: 'real', orientation: 'inverted', size: 'same' });
    expect(img.imageHeight).toBeCloseTo(-3, 12);
  });

  it('object beyond 2F: real, inverted, diminished, between F and 2F', () => {
    const img = solveLens(10, 30, 3);
    expect(img.v).toBeCloseTo(15, 12);
    expect(img.m).toBeCloseTo(-0.5, 12);
    expect(img.size).toBe('diminished');
  });

  it('object between F and 2F: real, inverted, magnified, beyond 2F', () => {
    const img = solveLens(10, 15, 3);
    expect(img.v).toBeCloseTo(30, 12);
    expect(img.m).toBeCloseTo(-2, 12);
    expect(img.size).toBe('magnified');
  });

  it('object at F: image at infinity', () => {
    expect(imageDistance(-10, 10)).toBeNull();
    expect(solveLens(10, 10, 3)).toMatchObject({ v: null, nature: 'none' });
  });

  it('object inside F: virtual, erect, magnified, on the same side', () => {
    const img = solveLens(10, 5, 3);
    expect(img.v).toBeCloseTo(-10, 12);
    expect(img.m).toBeCloseTo(2, 12);
    expect(img).toMatchObject({ nature: 'virtual', orientation: 'erect', size: 'magnified' });
  });

  it('satisfies the lens formula for arbitrary positions', () => {
    for (const f of [5, 7.5, 12, 20]) {
      for (const d of [3, 8.5, 13, 27, 59]) {
        const img = solveLens(f, d, 2);
        if (img.v === null) continue;
        expect(1 / img.v - 1 / img.u).toBeCloseTo(1 / f, 10);
      }
    }
  });

  it('power in dioptres: f = 10 cm → +10 D', () => {
    expect(powerDioptres(10)).toBe(10);
    expect(powerDioptres(25)).toBe(4);
  });

  it('classifies the object region with a small "at" tolerance', () => {
    expect(objectRegion(10, 35)).toBe('beyond_2f');
    expect(objectRegion(10, 20.2)).toBe('at_2f');
    expect(objectRegion(10, 15)).toBe('between_f_2f');
    expect(objectRegion(10, 10)).toBe('at_f');
    expect(objectRegion(10, 4)).toBe('within_f');
  });

  it('the screen is sharp only near v for real images', () => {
    const img = solveLens(10, 30, 3); // v = 15
    expect(isSharpOnScreen(img, 15)).toBe(true);
    expect(isSharpOnScreen(img, 15.4)).toBe(true);
    expect(isSharpOnScreen(img, 16.5)).toBe(false);
    expect(isSharpOnScreen(solveLens(10, 5, 3), 10)).toBe(false);
    expect(blurFraction(img, 15)).toBe(0);
    expect(blurFraction(img, 30)).toBeCloseTo(1, 12);
  });

  it('the three principal rays meet at the image point', () => {
    const f = 10;
    const d = 30;
    const h = 3;
    const img = solveLens(f, d, h);
    const rays = principalRays(f, d, h);
    const v = img.v as number;
    // Parallel ray refracts through F2: height at v is h − h·v/f.
    expect(rays.parallel - (rays.parallel * v) / f).toBeCloseTo(img.imageHeight as number, 10);
    // Ray through the centre: height at v is −h·v/d.
    expect((-h * v) / d).toBeCloseTo(img.imageHeight as number, 10);
    // Ray through F1 leaves parallel at the image height.
    expect(rays.focal).toBeCloseTo(img.imageHeight as number, 10);
  });
});
