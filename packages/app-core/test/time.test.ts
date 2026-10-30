import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  UUID_RE,
  addDays,
  createIdGenerator,
  createNonce,
  daysBetween,
  eachDay,
  endOfLocalDay,
  inWindow,
  isLocalDate,
  istDate,
  localDate,
  localHour,
  localMinutes,
  monthEnd,
  monthStart,
  parseHhmm,
  sha256Hex,
  startOfLocalDay,
  toHex,
  utcOffsetMinutes,
  utf8Encode,
  uuidv7,
  weekStartMonday,
  weekday,
  zonedInstant,
  type CryptoLike,
} from '../src';

const crypto = webcrypto as unknown as CryptoLike;
const IST = 'Asia/Kolkata';
const NY = 'America/New_York';

describe('local dates and IST', () => {
  it('rolls the IST day at 18:30 UTC (local midnight), without DST', () => {
    expect(istDate('2026-03-01T18:29:59.999Z')).toBe('2026-03-01');
    expect(istDate('2026-03-01T18:30:00.000Z')).toBe('2026-03-02');
    // IST has no daylight saving: the same offset in January and July.
    expect(utcOffsetMinutes('2026-01-15T00:00:00Z', IST)).toBe(330);
    expect(utcOffsetMinutes('2026-07-15T00:00:00Z', IST)).toBe(330);
  });

  it('IST fast path agrees with Intl for a year of instants', () => {
    for (let h = 0; h < 365 * 24; h += 7) {
      const t = Date.UTC(2026, 0, 1) + h * 3_600_000 + 17 * 60_000;
      const viaIntl = new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
      expect(istDate(t)).toBe(viaIntl);
    }
  });

  it('local midnight differs by timezone', () => {
    const t = '2026-05-10T20:00:00Z'; // 01:30 IST on the 11th, 16:00 in New York on the 10th
    expect(localDate(t, IST)).toBe('2026-05-11');
    expect(localDate(t, NY)).toBe('2026-05-10');
    expect(localDate(t, 'UTC')).toBe('2026-05-10');
    expect(localHour(t, IST)).toBe(1);
    expect(localMinutes(t, IST)).toBe(90);
  });

  it('handles DST zones: start and end of a 23-hour and a 25-hour day', () => {
    // US DST starts 2026-03-08 and ends 2026-11-01.
    const springStart = startOfLocalDay('2026-03-08', NY);
    expect(endOfLocalDay('2026-03-08', NY) - springStart).toBe(23 * 3_600_000);
    const fallStart = startOfLocalDay('2026-11-01', NY);
    expect(endOfLocalDay('2026-11-01', NY) - fallStart).toBe(25 * 3_600_000);
    expect(new Date(springStart).toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(utcOffsetMinutes('2026-07-01T12:00:00Z', NY)).toBe(-240);
  });

  it('zonedInstant maps a skipped wall time to a valid instant', () => {
    const t = zonedInstant('2026-03-08', 150, NY); // 02:30 does not exist
    expect(localDate(t, NY)).toBe('2026-03-08');
    expect(localHour(t, NY)).toBeGreaterThanOrEqual(1);
    expect(zonedInstant('2026-03-08', 0, IST)).toBe(Date.UTC(2026, 2, 7, 18, 30));
  });

  it('calendar arithmetic', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(daysBetween('2026-01-01', '2026-03-01')).toBe(59);
    expect(daysBetween('2026-03-01', '2026-01-01')).toBe(-59);
    expect(weekday('2026-10-29')).toBe(4);
    expect(weekStartMonday('2026-11-01')).toBe('2026-10-26'); // Sunday belongs to the previous week
    expect(weekStartMonday('2026-10-26')).toBe('2026-10-26');
    expect(monthStart('2026-02-17')).toBe('2026-02-01');
    expect(monthEnd('2026-02-17')).toBe('2026-02-28');
    expect(monthEnd('2028-02-01')).toBe('2028-02-29');
    expect(eachDay('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });

  it('validates dates and times', () => {
    expect(isLocalDate('2026-02-29')).toBe(false);
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(isLocalDate('2026-1-1')).toBe(false);
    expect(parseHhmm('21:30')).toBe(1290);
    expect(() => parseHhmm('9:30')).toThrow();
    expect(inWindow(parseHhmm('23:00'), parseHhmm('21:00'), parseHhmm('07:00'))).toBe(true);
    expect(inWindow(parseHhmm('06:59'), parseHhmm('21:00'), parseHhmm('07:00'))).toBe(true);
    expect(inWindow(parseHhmm('07:00'), parseHhmm('21:00'), parseHhmm('07:00'))).toBe(false);
    expect(inWindow(600, 540, 720)).toBe(true);
    expect(inWindow(600, 600, 600)).toBe(false);
  });
});

describe('crypto helpers', () => {
  it('utf8Encode matches TextEncoder, including Devanagari and emoji', () => {
    for (const s of ['abc', 'आप कैसे हैं', '😀 x', '']) {
      expect([...utf8Encode(s)]).toEqual([...new TextEncoder().encode(s)]);
    }
  });

  it('sha256Hex of a known value', async () => {
    expect(await sha256Hex(crypto, 'abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('nonce: raw is 64 hex chars, hashed is its SHA-256', async () => {
    const n = await createNonce(crypto);
    expect(n.raw).toMatch(/^[0-9a-f]{64}$/);
    expect(n.hashed).toBe(await sha256Hex(crypto, n.raw));
    const m = await createNonce(crypto);
    expect(m.raw).not.toBe(n.raw);
  });

  it('uuidv7 encodes the timestamp and version', () => {
    const t = Date.UTC(2026, 9, 29, 10, 0, 0);
    const id = uuidv7(crypto, t);
    expect(id).toMatch(UUID_RE);
    expect(id[14]).toBe('7');
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(t);
  });

  it('id generator is monotonic within one millisecond', () => {
    const gen = createIdGenerator(crypto, () => 1_000);
    const ids = Array.from({ length: 50 }, gen);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(50);
  });

  it('toHex', () => {
    expect(toHex(Uint8Array.from([0, 15, 255]))).toBe('000fff');
  });
});
