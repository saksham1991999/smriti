import type { PetState } from '../rules/pet';
import { displayHealth, type PlantHealth, type PlantStage } from '../rules/plant';
import { localDate, parseHhmm, toIso, type Instant, type LocalDate } from '../time';

/**
 * `widgetSnapshot()` (me-money §6.6, NTF-08/09/10): the JSON the app writes to the App Group
 * (iOS) or SharedPreferences (Android) after a sync, a state change or an app open. Widgets
 * apply the stale-data rules themselves from these fields, so the snapshot carries the
 * thresholds as data. No account ids, no email; the pet's name never reaches the lock screen
 * (the widget drops it there).
 */

export const WIDGET_SCHEMA_VERSION = 1;

export interface WidgetPlanItem {
  /** Already localised by the app. */
  title: string;
  subject_family: string;
  minutes: number;
  deep_link: string;
}

export interface WidgetSnapshot {
  schema_version: number;
  written_at: string;
  local_day: LocalDate;
  tz: string;
  locale: 'en' | 'hi';
  theme_pref: 'system' | 'light' | 'dark';
  signed_in: boolean;
  is_under10: boolean;
  streak: number;
  goal_met_today: boolean;
  goal_progress: number;
  freeze_held: boolean;
  rest_day_today: boolean;
  last_activity_day: LocalDate | null;
  plant: { species: string; skin: string | null; stage: PlantStage; health: PlantHealth };
  pet: { species: 'cat' | 'dog'; name: string | null; state: PetState; outfit: string | null } | null;
  health_by_missed_days: Record<Exclude<PlantHealth, 'thriving'>, number>;
  due_cards: number;
  plan_items: WidgetPlanItem[];
  exam: { name: string; target_date: string; date_precision: 'day' | 'month' } | null;
  /**
   * Proposed additions (not in the §6.6 field list): the widget needs these for the evening and
   * morning rules. `evening_hour` is `widget.evening_hour`, or 3 h before quiet hours if earlier.
   */
  evening_hour: number;
  quiet_end: string;
}

export interface WidgetSnapshotInput {
  now: Instant;
  timeZone: string;
  locale: 'en' | 'hi';
  themePref: WidgetSnapshot['theme_pref'];
  signedIn: boolean;
  isUnder10: boolean;
  streak: number;
  goalProgress: number;
  freezeHeld: boolean;
  restDayToday: boolean;
  lastActivityDay: LocalDate | null;
  plant: WidgetSnapshot['plant'];
  pet: WidgetSnapshot['pet'];
  healthByMissedDays: WidgetSnapshot['health_by_missed_days'];
  dueCards: number;
  planItems: readonly WidgetPlanItem[];
  exam: WidgetSnapshot['exam'];
  quietStart: string;
  quietEnd: string;
  /** `widget.evening_hour` (owner-set, may be null). */
  eveningHour: number | null;
}

/** Pet states below `sleepy` that an under-10 widget never shows. */
const UNDER10_PET_FLOOR: readonly PetState[] = ['tired', 'missing_you'];

export function widgetEveningHour(eveningHour: number | null, quietStart: string): number {
  const beforeQuiet = Math.floor(((parseHhmm(quietStart) - 180 + 1440) % 1440) / 60);
  return eveningHour === null ? beforeQuiet : Math.min(eveningHour, beforeQuiet);
}

export function widgetSnapshot(input: WidgetSnapshotInput): WidgetSnapshot {
  const progress = Number.isFinite(input.goalProgress) ? Math.min(1, Math.max(0, input.goalProgress)) : 0;
  const pet = input.pet
    ? {
        ...input.pet,
        state: input.isUnder10 && UNDER10_PET_FLOOR.includes(input.pet.state) ? ('sleepy' as const) : input.pet.state,
      }
    : null;
  return {
    schema_version: WIDGET_SCHEMA_VERSION,
    written_at: toIso(input.now),
    local_day: localDate(input.now, input.timeZone),
    tz: input.timeZone,
    locale: input.locale,
    theme_pref: input.themePref,
    signed_in: input.signedIn,
    is_under10: input.isUnder10,
    streak: Math.max(0, Math.floor(input.streak)),
    goal_met_today: progress >= 1,
    goal_progress: Math.round(progress * 100) / 100,
    freeze_held: input.freezeHeld,
    rest_day_today: input.restDayToday,
    last_activity_day: input.lastActivityDay,
    plant: { ...input.plant, health: displayHealth(input.plant.health, { under10: input.isUnder10 }) },
    pet,
    health_by_missed_days: { ...input.healthByMissedDays },
    due_cards: Math.max(0, Math.floor(input.dueCards)),
    plan_items: input.planItems.slice(0, 3).map((i) => ({ ...i })),
    exam: input.exam ? { ...input.exam } : null,
    evening_hour: widgetEveningHour(input.eveningHour, input.quietStart),
    quiet_end: input.quietEnd,
  };
}
