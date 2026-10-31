/**
 * Parent mode rules (SET-13 to SET-17), free of React: the week switcher, the chart summary, the
 * waiting requests, the controls form and the consent rows. Weeks run Monday to Sunday, as the
 * server's (`week_start` in apps/api parent_mode).
 */
import type { Schemas } from "@smriti/api-client";

export type ChildCard = Schemas["ChildCard"];
export type Controls = Schemas["Controls"];
export type Scope = Schemas["ConsentOut"]["scopes"][number];

/** "2026-11-02" for a local date. */
export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Parses "YYYY-MM-DD" as a local date (no time zone shift). */
export function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** The Monday of the week holding `day`. */
export function weekStart(day: Date): string {
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoDay(d);
}

/** The Monday `n` weeks from `start` (negative goes back). */
export function shiftWeek(start: string, n: number): string {
  const d = parseDay(start);
  d.setDate(d.getDate() + n * 7);
  return isoDay(d);
}

/** The week switcher can't go past the current week. */
export const canGoNext = (start: string, today: Date) => start < weekStart(today);

/** The day with the most minutes, for the chart's text summary; null for a quiet week. */
export function busiestDay(days: readonly Schemas["DayMinutes"][]): Schemas["DayMinutes"] | null {
  return days.reduce<Schemas["DayMinutes"] | null>((best, d) => (d.minutes > 0 && (!best || d.minutes > best.minutes) ? d : best), null);
}

/** Bar heights as whole percents of the busiest day (0 for every bar in a quiet week). */
export function barHeights(days: readonly Schemas["DayMinutes"][]): number[] {
  const max = Math.max(0, ...days.map((d) => d.minutes));
  return days.map((d) => (max ? Math.round((d.minutes / max) * 100) : 0));
}

/** "Needs you": pending time requests and consent requests, child by child. */
export type Need = { kind: "time"; child: ChildCard; requestId: string } | { kind: "consent"; child: ChildCard };
export function needs(cards: readonly ChildCard[]): Need[] {
  return cards.flatMap((child) => [
    ...(child.time_requests ?? []).filter((r) => r.status === "pending").map((r) => ({ kind: "time" as const, child, requestId: r.id })),
    ...(child.consent_pending ? [{ kind: "consent" as const, child }] : []),
  ]);
}

/** Little learners (class 1 to 5) get the picture rhymes and tutor button switches. */
export const isLittle = (band: string | null | undefined) => band === "u10";
/** Social and sharing need a teen account; under-13s have no social. */
export const isTeen = (band: string | null | undefined) => band === "13_17";

export const LIMITS = [null, 15, 30, 45, 60, 90, 120] as const;
export type Limit = (typeof LIMITS)[number];

/** The controls form: daily limit, allowed hours and the switches. */
export interface ControlsForm {
  limit: Limit;
  hoursOn: boolean;
  from: string;
  to: string;
  breaks: boolean;
  askBeforeSwitching: boolean;
  pictureRhymes: boolean;
  tutorButton: boolean;
  weeklyReport: boolean;
}

export function toForm(c: Schemas["ControlsOut"]): ControlsForm {
  const limit = LIMITS.find((l) => l === (c.daily_limit_min ?? null)) ?? null;
  return {
    limit,
    hoursOn: !!(c.allowed_from && c.allowed_to),
    from: (c.allowed_from ?? "07:00").slice(0, 5),
    to: (c.allowed_to ?? "21:00").slice(0, 5),
    breaks: c.break_reminders,
    askBeforeSwitching: c.ask_before_switching,
    pictureRhymes: c.picture_rhymes,
    tutorButton: c.tutor_button,
    weeklyReport: c.weekly_report,
  };
}

/** The allowed hours are valid when off, or when the start is before the end. */
export const hoursValid = (f: Pick<ControlsForm, "hoursOn" | "from" | "to">) => !f.hoursOn || (/^\d\d:\d\d$/.test(f.from) && /^\d\d:\d\d$/.test(f.to) && f.from < f.to);

/** The PUT body; the consent-linked switches (tutor, social) pass through unchanged. */
export function toControls(f: ControlsForm, base: Schemas["ControlsOut"]): Controls {
  return {
    daily_limit_min: f.limit,
    allowed_from: f.hoursOn ? f.from : null,
    allowed_to: f.hoursOn ? f.to : null,
    break_reminders: f.breaks,
    ask_before_switching: f.askBeforeSwitching,
    picture_rhymes: f.pictureRhymes,
    tutor_button: f.tutorButton,
    weekly_report: f.weeklyReport,
    tutor_enabled: base.tutor_enabled,
    social_enabled: base.social_enabled,
  };
}

/** Which controls changed, for `parent_limit_changed {limit_type, value_bucket}` (no exact times). */
export function changes(before: ControlsForm, after: ControlsForm): { limit_type: string; value_bucket: string }[] {
  const out: { limit_type: string; value_bucket: string }[] = [];
  if (before.limit !== after.limit) out.push({ limit_type: "daily_limit", value_bucket: limitBucket(after.limit) });
  if (before.hoursOn !== after.hoursOn || (after.hoursOn && (before.from !== after.from || before.to !== after.to))) out.push({ limit_type: "allowed_hours", value_bucket: after.hoursOn ? "on" : "off" });
  const flags: [keyof ControlsForm, string][] = [
    ["breaks", "break_reminders"],
    ["askBeforeSwitching", "ask_before_switching"],
    ["pictureRhymes", "picture_rhymes"],
    ["tutorButton", "tutor_button"],
    ["weeklyReport", "weekly_report"],
  ];
  for (const [k, name] of flags) if (before[k] !== after[k]) out.push({ limit_type: name, value_bucket: after[k] ? "on" : "off" });
  return out;
}

export function limitBucket(l: Limit): string {
  if (l === null) return "off";
  if (l <= 30) return "15_30";
  if (l <= 60) return "45_60";
  return "90_120";
}

/** The guardian scopes in the doc's order. The saved account can't be turned off here. */
export const SCOPES: readonly Scope[] = ["account", "social", "community", "voice", "uploads"];
export interface ConsentRow {
  scope: Scope;
  allowed: boolean;
  since: string | null;
  canTurnOff: boolean;
}
export function consentRows(consent: Schemas["ConsentOut"] | null | undefined, band: string | null): ConsentRow[] {
  const live = consent && !consent.revoked_at ? consent : null;
  return SCOPES.filter((s) => isTeen(band) || (s !== "social" && s !== "community")).map((scope) => {
    const allowed = !!live?.scopes.includes(scope);
    return { scope, allowed, since: allowed ? (live?.consented_at ?? null) : null, canTurnOff: allowed && scope !== "account" };
  });
}

/** A friend's shown name: nickname, pet name or display name; hidden and deleted people get none. */
export const friendName = (p: Schemas["Person"]) => (p.name.kind === "hidden" || p.name.kind === "deleted" ? null : (p.name.text ?? null));
