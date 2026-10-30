/**
 * Calendar helpers. A `LocalDate` is a calendar day in a student's IANA timezone, written
 * `YYYY-MM-DD`. Streak days end at the student's local midnight (R23); the daily challenge and
 * the mock week roll at 00:00 IST (UTC+05:30, no daylight saving).
 */
export type LocalDate = string;
/** An instant: a `Date`, epoch milliseconds or an ISO-8601 string. */
export type Instant = Date | number | string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;
export const IST_TIMEZONE = 'Asia/Kolkata';

export function toMs(t: Instant): number {
  if (typeof t === 'number') return t;
  if (t instanceof Date) return t.getTime();
  const ms = Date.parse(t);
  if (Number.isNaN(ms)) throw new RangeError(`Invalid instant: ${t}`);
  return ms;
}

export function toIso(t: Instant): string {
  return new Date(toMs(t)).toISOString();
}

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(ms).toISOString().slice(0, 10) === value;
}

function parseDate(d: LocalDate): number {
  const m = DATE_RE.exec(d);
  if (!m) throw new RangeError(`Invalid local date: ${d}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function formatUtcDate(ms: number): LocalDate {
  return new Date(ms).toISOString().slice(0, 10);
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The wall-clock reading in `timeZone` at instant `t`. IST is computed without Intl. */
export function wallClock(t: Instant, timeZone: string): WallClock {
  const ms = toMs(t);
  if (timeZone === IST_TIMEZONE || timeZone === 'IST' || timeZone === '+05:30') {
    const d = new Date(ms + IST_OFFSET_MS);
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
    };
  }
  if (timeZone === 'UTC' || timeZone === 'Etc/UTC') {
    const d = new Date(ms);
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
    };
  }
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute'), second: get('second') };
}

/** The student's calendar day at instant `t`. */
export function localDate(t: Instant, timeZone: string): LocalDate {
  const w = wallClock(t, timeZone);
  return `${String(w.year).padStart(4, '0')}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

/** The IST calendar day: the daily challenge date (R23) and the mock week. */
export function istDate(t: Instant): LocalDate {
  return localDate(t, IST_TIMEZONE);
}

/** Hour of day (0–23) in `timeZone`. */
export function localHour(t: Instant, timeZone: string): number {
  return wallClock(t, timeZone).hour;
}

/** Minutes since local midnight in `timeZone`. */
export function localMinutes(t: Instant, timeZone: string): number {
  const w = wallClock(t, timeZone);
  return w.hour * 60 + w.minute;
}

/** Offset of `timeZone` from UTC at instant `t`, in minutes (IST = 330). */
export function utcOffsetMinutes(t: Instant, timeZone: string): number {
  const ms = toMs(t);
  const w = wallClock(ms, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/**
 * The instant at which local wall-clock time `minutes` after midnight of `day` occurs in
 * `timeZone` (for a time skipped by a DST jump, the first valid instant after it).
 */
export function zonedInstant(day: LocalDate, minutes: number, timeZone: string): number {
  const wallAsUtc = parseDate(day) + minutes * 60_000;
  let guess = wallAsUtc - utcOffsetMinutes(wallAsUtc, timeZone) * 60_000;
  for (let i = 0; i < 3; i++) {
    const next = wallAsUtc - utcOffsetMinutes(guess, timeZone) * 60_000;
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

/** The first instant of `day` in `timeZone`. */
export function startOfLocalDay(day: LocalDate, timeZone: string): number {
  return zonedInstant(day, 0, timeZone);
}

/** The first instant of the day after `day`: "end of today" for due cards. */
export function endOfLocalDay(day: LocalDate, timeZone: string): number {
  return startOfLocalDay(addDays(day, 1), timeZone);
}

export function addDays(day: LocalDate, n: number): LocalDate {
  return formatUtcDate(parseDate(day) + n * DAY_MS);
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(day: LocalDate): number {
  return new Date(parseDate(day)).getUTCDay();
}

/** Monday of the week containing `day` (weeks run Monday to Sunday). */
export function weekStartMonday(day: LocalDate): LocalDate {
  return addDays(day, -((weekday(day) + 6) % 7));
}

export function monthKey(day: LocalDate): string {
  return day.slice(0, 7);
}

export function monthStart(day: LocalDate): LocalDate {
  return `${day.slice(0, 7)}-01`;
}

export function monthEnd(day: LocalDate): LocalDate {
  const [y, m] = [Number(day.slice(0, 4)), Number(day.slice(5, 7))];
  return formatUtcDate(Date.UTC(y, m, 1) - DAY_MS);
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Every day from `from` to `to`, inclusive. */
export function eachDay(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Parses "HH:MM" into minutes after midnight. */
export function parseHhmm(value: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) throw new RangeError(`Invalid time: ${value}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** True when `minutes` falls in a window that may cross midnight (e.g. 21:00–07:00). */
export function inWindow(minutes: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}
