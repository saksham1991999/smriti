import {
  PLANT_HEALTH,
  addDays,
  compareDates,
  daysBetween,
  displayHealth,
  localDate,
  localMinutes,
  parseHhmm,
  toMs,
  zonedInstant,
  type KeyValueStore,
  type PetState,
  type PlantHealth,
  type PlantStage,
  type WidgetSnapshot,
} from '@smriti/app-core';
import type { MessageKey, MessageValues } from '@smriti/i18n';
import { requireOptionalNativeModule } from 'expo';

import { routeForLink } from '../services/links';

/**
 * The home-screen widgets (G-5; me-money NTF-08 small plant, NTF-09 medium pet and today, NTF-10
 * large plan). app-core's `widgetSnapshot()` gives the data; this file turns it into the payload
 * the native widgets read and hands it to the `SmritiWidget` native module
 * (`apps/mobile/modules/smriti-widget`), which writes it to the App Group (iOS) or
 * SharedPreferences (Android) and asks the OS to redraw.
 *
 * Every string is localised here, in EN or HI from `@smriti/i18n`, so the native code holds no
 * copy except the "no snapshot yet" placeholder and the widget gallery names (generated from the
 * same catalogue by the config plugin). The natives only choose between prepared strings, with
 * the rules in `widgetView` below; the Swift and Kotlin ports follow it line by line.
 */

export interface WidgetBridge {
  write(snapshot: WidgetSnapshot): Promise<void>;
  read(): Promise<WidgetSnapshot | null>;
}

export const WIDGET_KEY = 'widget.snapshot.v1';
export const WIDGET_PAYLOAD_VERSION = 1;
/** Older than this, the widget hides numbers except the streak (NTF-08 "stale over 72 h"). */
export const WIDGET_STALE_MS = 72 * 3600 * 1000;

/** Writes to the profile key-value store only (tests, web, or a build without the native module). */
export class KvWidgetBridge implements WidgetBridge {
  constructor(private readonly kv: KeyValueStore) {}
  async write(snapshot: WidgetSnapshot) {
    await this.kv.set(WIDGET_KEY, JSON.stringify(snapshot));
  }
  async read() {
    const raw = await this.kv.get(WIDGET_KEY);
    return raw ? (JSON.parse(raw) as WidgetSnapshot) : null;
  }
}

// ── Images: the seed-pack illustrations copied into the widget targets ──────────

/** Pet art per persistent state. There is no separate `content`, `tired` or `missing_you` art yet. */
const PET_ART: Record<PetState, string> = {
  happy: 'base',
  content: 'base',
  sleepy: 'sleepy',
  tired: 'sleepy',
  missing_you: 'worried',
  resting: 'resting',
};

/** Only the sapling has health variants in the seed art; other stages show their healthy image. */
export function plantImage(stage: PlantStage, health: PlantHealth): string {
  return stage === 'sapling' && health !== 'thriving' ? `plant-sapling-${health}` : `plant-${stage}`;
}

export function petImage(species: 'cat' | 'dog', state: PetState): string {
  return `${species}-${PET_ART[state]}`;
}

/** Every illustration a widget may show (the config plugin copies exactly these). */
export const WIDGET_IMAGES: readonly string[] = [
  ...new Set([
    'plant-seed',
    ...(['seed', 'sprout', 'sapling', 'flowering', 'tree'] as const).flatMap((s) => PLANT_HEALTH.map((h) => plantImage(s, h))),
    ...(['cat', 'dog'] as const).flatMap((sp) => (Object.keys(PET_ART) as PetState[]).map((st) => petImage(sp, st))),
  ]),
];

// ── Payload ────────────────────────────────────────────────────────────────────

export interface WidgetText {
  streak: string;
  watered: string;
  not_yet: string;
  morning: string | null;
  evening: string;
  rest_day: string;
  stale: string;
  pet_label: string | null;
  progress: string;
  /** `0/{goal} min`, for a snapshot from an earlier day. */
  progress_new_day: string;
  goal_met: string;
  review: string;
  reviews_waiting: string;
  all_caught_up: string;
  rescue: string;
  countdown: string;
  today: string;
  done: string;
  new_day: string;
  items: string[];
}

export interface WidgetLinks {
  garden: string;
  rescue: string;
  pet: string;
  review: string;
  home: string;
  plan: string;
  items: string[];
}

export interface WidgetPayload {
  payload_version: number;
  snapshot: WidgetSnapshot;
  goal_minutes: number;
  text: WidgetText;
  images: { plant: Record<PlantHealth, string>; pet: string | null; placeholder: string };
  links: WidgetLinks;
}

export interface WidgetLocalizer {
  t: (key: MessageKey, values?: MessageValues) => string;
  /** The app's URL scheme (`smriti-jee`). */
  scheme: string;
  goalMinutes: number;
}

const MONTHS = { en: 'en-IN', hi: 'hi-IN' } as const;

function countdown(snapshot: WidgetSnapshot, t: WidgetLocalizer['t']): string {
  const exam = snapshot.exam;
  if (!exam) return t('me_money:NTF-10.no_exam_date');
  if (exam.date_precision === 'month') {
    const d = new Date(`${exam.target_date.slice(0, 7)}-01T00:00:00Z`);
    const month = new Intl.DateTimeFormat(MONTHS[snapshot.locale], { month: 'long', timeZone: 'UTC' }).format(d);
    return t('me_money:NTF-10.countdown_month', { exam: exam.name, month, year: String(d.getUTCFullYear()) });
  }
  const n = Math.max(0, daysBetween(snapshot.local_day, exam.target_date.slice(0, 10)));
  return t('me_money:NTF-10.countdown_day', { exam: exam.name, n });
}

export function buildWidgetPayload(snapshot: WidgetSnapshot, l: WidgetLocalizer): WidgetPayload {
  const { t } = l;
  const link = (path: string) => `${l.scheme}://${routeForLink(path).replace(/^\//, '')}`;
  const planMinutes = snapshot.plan_items.reduce((n, i) => n + i.minutes, 0);
  const pet = snapshot.pet;
  const stateWord = pet ? t(`me_money:ME-04.state_${pet.state}` as MessageKey) : '';
  const petLabel = pet ? (pet.name ? t('me_money:NTF-09.pet_label', { pet: pet.name, state: stateWord }) : stateWord) : null;
  const done = Math.round(snapshot.goal_progress * l.goalMinutes);
  const under10 = snapshot.is_under10;
  const plant = Object.fromEntries(
    PLANT_HEALTH.map((h) => [h, plantImage(snapshot.plant.stage, displayHealth(h, { under10 }))]),
  ) as Record<PlantHealth, string>;
  return {
    payload_version: WIDGET_PAYLOAD_VERSION,
    snapshot,
    goal_minutes: l.goalMinutes,
    text: {
      streak: t('me_money:NTF-08.streak', { n: snapshot.streak }),
      watered: t('me_money:NTF-08.watered'),
      not_yet: t('me_money:NTF-08.not_yet'),
      morning: planMinutes > 0 ? t('me_money:NTF-08.morning', { min: planMinutes }) : null,
      evening: t('me_money:NTF-08.evening'),
      rest_day: t('me_money:NTF-08.rest_day'),
      stale: t('me_money:NTF-08.stale'),
      pet_label: petLabel,
      progress: t('me_money:NTF-09.progress', { x: done, goal: l.goalMinutes }),
      progress_new_day: t('me_money:NTF-09.progress', { x: 0, goal: l.goalMinutes }),
      goal_met: t('me_money:NTF-09.goal_met'),
      // Under-10s: the button reads "Play" and opens Home (NTF-09 states).
      review: under10 ? t('learn:HOME-06.little_learner_play') : t('me_money:NTF-09.review', { n: snapshot.due_cards }),
      reviews_waiting: t('me_money:NTF-09.reviews_waiting_stale'),
      all_caught_up: t('me_money:NTF-09.all_caught_up'),
      rescue: t('me_money:NTF-09.rescue'),
      countdown: countdown(snapshot, t),
      today: t('me_money:NTF-10.today'),
      done: t('me_money:NTF-10.done'),
      new_day: t('me_money:NTF-10.new_day'),
      items: snapshot.plan_items.map((i) => t('me_money:NTF-10.item', { topic: i.title, min: i.minutes })),
    },
    images: { plant, pet: pet ? petImage(pet.species, pet.state) : null, placeholder: 'plant-seed' },
    links: {
      garden: link('/garden'),
      rescue: link('/memory'),
      pet: link('/me'),
      review: under10 ? link('/learn') : link('/memory'),
      home: link('/learn'),
      plan: link('/learn'),
      items: snapshot.plan_items.map((i) => link(i.deep_link)),
    },
  };
}

// ── What the widget shows at a given time (the natives mirror this) ─────────────

export type WidgetLine = 'rest_day' | 'watered' | 'evening' | 'morning' | 'not_yet';

export interface WidgetView {
  stale: boolean;
  /** The snapshot is from an earlier local day: progress resets and health is predicted. */
  newDay: boolean;
  health: PlantHealth;
  plantImage: string;
  line: WidgetLine;
  lineText: string;
  lineLink: string;
  goalMet: boolean;
  progress: number;
  /** Medium widget progress line (hidden when stale: only the streak stays a number). */
  progressText: string | null;
  /** Medium widget pill. */
  pill: { text: string; link: string };
  /** Large widget rows, or `new_day` when the plan is from yesterday. */
  plan: { header: string; rows: { text: string; link: string }[]; done: boolean };
  /** Large widget countdown (hidden when stale). */
  countdown: string | null;
}

const rank = (h: PlantHealth) => PLANT_HEALTH.indexOf(h);

/** Health predicted for today from the last activity day and the thresholds in the snapshot. */
export function predictedHealth(s: WidgetSnapshot, today: string): PlantHealth {
  if (!s.last_activity_day || compareDates(today, s.local_day) <= 0) return s.plant.health;
  const missed = Math.max(0, daysBetween(s.last_activity_day, today) - 1);
  let target: PlantHealth = 'thriving';
  for (const h of ['droopy', 'dry', 'wilted', 'dormant'] as const) if (missed >= s.health_by_missed_days[h]) target = h;
  const health = rank(target) > rank(s.plant.health) ? target : s.plant.health;
  return displayHealth(health, { under10: s.is_under10 });
}

export function widgetView(p: WidgetPayload, nowMs: number): WidgetView {
  const s = p.snapshot;
  const today = localDate(nowMs, s.tz);
  const minutes = localMinutes(nowMs, s.tz);
  const stale = nowMs - toMs(s.written_at) > WIDGET_STALE_MS;
  const newDay = compareDates(today, s.local_day) > 0;
  const health = predictedHealth(s, today);
  const goalMet = !newDay && s.goal_met_today;
  const restDay = !newDay && s.rest_day_today;
  const quietEnd = parseHhmm(s.quiet_end);
  let line: WidgetLine;
  if (restDay) line = 'rest_day';
  else if (goalMet) line = 'watered';
  else if (minutes >= s.evening_hour * 60) line = 'evening';
  else if (minutes >= quietEnd && minutes < 12 * 60 && p.text.morning && !newDay) line = 'morning';
  else line = 'not_yet';
  const lineText = stale ? p.text.stale : line === 'morning' ? (p.text.morning ?? p.text.not_yet) : p.text[line];
  const lineLink = line === 'evening' && !s.is_under10 ? p.links.rescue : p.links.garden;
  const evening = line === 'evening';
  const pill = stale
    ? { text: p.text.reviews_waiting, link: p.links.review }
    : s.is_under10
      ? { text: p.text.review, link: p.links.review }
      : evening
        ? { text: p.text.rescue, link: p.links.rescue }
        : s.due_cards > 0 && !newDay
          ? { text: p.text.review, link: p.links.review }
          : { text: p.text.all_caught_up, link: p.links.home };
  const rows = newDay || stale ? [] : p.text.items.map((text, i) => ({ text, link: p.links.items[i] ?? p.links.plan }));
  return {
    stale,
    newDay,
    health,
    plantImage: p.images.plant[health],
    line,
    lineText,
    lineLink,
    goalMet,
    progress: newDay ? 0 : s.goal_progress,
    progressText: stale ? null : newDay ? p.text.progress_new_day : goalMet ? p.text.goal_met : p.text.progress,
    pill,
    plan: { header: stale ? p.text.stale : newDay ? p.text.new_day : p.text.today, rows, done: goalMet && !stale },
    countdown: stale ? null : p.text.countdown,
  };
}

/** Timeline entries for iOS (NTF-08): now, 12:00, the evening hour and the next midnight. */
export function widgetTimeline(p: WidgetPayload, nowMs: number): number[] {
  const tz = p.snapshot.tz;
  const today = localDate(nowMs, tz);
  const next = [zonedInstant(today, 12 * 60, tz), zonedInstant(today, p.snapshot.evening_hour * 60, tz), zonedInstant(addDays(today, 1), 0, tz)];
  return [nowMs, ...next.filter((t) => t > nowMs)];
}

// ── Native bridge ─────────────────────────────────────────────────────────────

export interface SmritiWidgetNativeModule {
  /** Saves the payload JSON for the widgets and reloads their timelines. */
  setPayload(json: string): Promise<void>;
  /** Clears it (sign-out, profile switch): the widgets show the placeholder. */
  clear(): Promise<void>;
}

export function nativeWidgetModule(): SmritiWidgetNativeModule | null {
  return requireOptionalNativeModule<SmritiWidgetNativeModule>('SmritiWidget');
}

/**
 * Keeps the key-value copy (the in-app NTF-11 preview reads it) and hands the localised payload
 * to the native widgets when the module is in the build.
 */
export class NativeWidgetBridge implements WidgetBridge {
  private readonly kvBridge: KvWidgetBridge;
  constructor(
    kv: KeyValueStore,
    private readonly localizer: () => WidgetLocalizer,
    private readonly native: SmritiWidgetNativeModule | null = nativeWidgetModule(),
  ) {
    this.kvBridge = new KvWidgetBridge(kv);
  }
  async write(snapshot: WidgetSnapshot) {
    await this.kvBridge.write(snapshot);
    if (!this.native) return;
    await this.native.setPayload(JSON.stringify(buildWidgetPayload(snapshot, this.localizer())));
  }
  read() {
    return this.kvBridge.read();
  }
  async clear() {
    await this.native?.clear();
  }
}
