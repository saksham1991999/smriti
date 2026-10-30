import { describe, expect, it } from 'vitest';
import kitEn from '../strings.en.json';
import kitHi from '../strings.hi.json';
import { createI18n, formatNumber, missingKeys } from '../src/i18n';
import { createLoop } from '../src/loop';
import { FAMILIES, familyForSubject, themeVariables } from '../src/theme';
import { spokenValue, withUnit } from '../src/units';

describe('theme', () => {
  it('gives the same variables in light and dark for every family', () => {
    for (const f of FAMILIES) {
      const light = themeVariables('light', f);
      const dark = themeVariables('dark', f);
      expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
      expect(light['--s-strong']).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('maps subject ids through subjectMap', () => {
    expect(familyForSubject('phy')).toBe('physics');
    expect(familyForSubject('chem')).toBe('chemistry');
    expect(() => familyForSubject('astrology')).toThrow();
  });

  it('drops shadows in dark mode', () => {
    expect(themeVariables('dark', 'physics')['--sh-card']).toBe('none');
    expect(themeVariables('light', 'physics')['--sh-card']).not.toBe('none');
  });
});

describe('i18n', () => {
  it('kit strings exist in both languages', () => {
    expect(missingKeys({ en: kitEn, hi: kitHi })).toEqual({ en: [], hi: [] });
  });

  it('fills placeholders and falls back to English for a missing Hindi key', () => {
    const i = createI18n({ en: { a: 'Set {x}', b: 'B' }, hi: { a: '{x} सेट करें' } }, 'hi');
    expect(i.t('a', { x: 5 })).toBe('5 सेट करें');
    expect(i.t('b')).toBe('B');
    expect(() => i.t('zzz')).toThrow();
    expect(() => i.both('b')).toThrow();
  });

  it('formats numbers with a true minus and no negative zero', () => {
    expect(formatNumber(-30, 1, 'en')).toBe('−30.0');
    expect(formatNumber(-0.001, 2, 'en')).toBe('0.00');
    expect(formatNumber(1234.5, 1, 'hi')).toBe('1,234.5');
    expect(formatNumber(123456.7, 0, 'en')).toBe('1,23,457');
  });
});

describe('units', () => {
  it('speaks units in both languages', () => {
    expect(spokenValue('0.50', 0.5, 'A', 'en')).toBe('0.50 amperes');
    expect(spokenValue('1', 1, 'V', 'en')).toBe('1 volt');
    expect(spokenValue('12', 12, 'Ω', 'hi')).toBe('12 ओम');
    expect(spokenValue('3', 3, 'furlong', 'en')).toBe('3 furlong');
  });

  it('writes units the SI way', () => {
    expect(withUnit('6.0', 'V')).toBe('6.0 V');
    expect(withUnit('10', '°')).toBe('10°');
    expect(withUnit('7.0', '')).toBe('7.0');
  });
});

describe('loop', () => {
  it('caps the frame rate at 30 fps in battery saver', () => {
    let cb: ((t: number) => void) | null = null;
    const raf = (fn: (t: number) => void): number => {
      cb = fn;
      return 1;
    };
    let frames = 0;
    const loop = createLoop({ fps: 30, onFrame: () => (frames += 1), raf, caf: () => undefined });
    loop.start();
    // Simulate a 60 Hz display for one second.
    for (let i = 0; i <= 60; i += 1) (cb as unknown as (t: number) => void)(i * (1000 / 60));
    expect(frames).toBeGreaterThanOrEqual(29);
    expect(frames).toBeLessThanOrEqual(31);
    loop.stop();
    expect(loop.running).toBe(false);
  });
});
