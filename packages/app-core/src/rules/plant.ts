import { addDays, compareDates, daysBetween, type LocalDate } from '../time';
import { DEFAULT_RULES, type RulesConfig } from './config';

/**
 * The streak plant (PRD §7, R2, R12, R37, me-money §3.4, APP_FLOW §3.6).
 *
 * Growth: one point per streak day, never lost. Stages at 1/7/30/100 study days.
 * Health: from days since the last *health day* (a streak day, a 2-minute rescue, or a day
 * protected by a freeze, a rest day or an incident). 1 missed day → droopy, 3 → dry, 7 → wilted,
 * 21 → dormant ("Resting"). Never dead.
 * Revival: study days only (never a rescue): droopy 1, dry 2 in a row, wilted 3, dormant 5.
 * Wilted and dormant run a revival quest: a missed day keeps the dots already filled and
 * the health stays where it is (unless the gap grows past the next threshold).
 */

export const PLANT_STAGES = ['seed', 'sprout', 'sapling', 'flowering', 'tree'] as const;
export type PlantStage = (typeof PLANT_STAGES)[number];
export const PLANT_HEALTH = ['thriving', 'droopy', 'dry', 'wilted', 'dormant'] as const;
export type PlantHealth = (typeof PLANT_HEALTH)[number];

export interface PlantState {
  /** One per streak day; only goes up. */
  growthPoints: number;
  stage: PlantStage;
  health: PlantHealth;
  /** Study days into the current revival (R12). */
  revivalProgress: number;
  /** Consecutive closed days with no health day. */
  missedStreak: number;
  lastHealthDay: LocalDate | null;
  closedThrough: LocalDate | null;
}

export const NEW_PLANT: PlantState = {
  growthPoints: 0,
  stage: 'seed',
  health: 'thriving',
  revivalProgress: 0,
  missedStreak: 0,
  lastHealthDay: null,
  closedThrough: null,
};

export interface PlantDayInput {
  day: LocalDate;
  /** A streak day (R1, R23). */
  qualified: boolean;
  /** A finished 2-minute rescue (`activity_days.rescue_done`). */
  rescue?: boolean;
  /** Freeze used, rest day, protected exam day, or incident freeze: watered for the day. */
  protected?: boolean;
}

export type PlantEvent =
  | { kind: 'stage_up'; stage: PlantStage }
  | { kind: 'revived'; from: PlantHealth }
  | { kind: 'health_dropped'; from: PlantHealth; to: PlantHealth }
  | { kind: 'revival_day'; progress: number; of: number };

const healthRank = (h: PlantHealth) => PLANT_HEALTH.indexOf(h);
const isQuestHealth = (h: PlantHealth) => h === 'wilted' || h === 'dormant';

export function stageForPoints(points: number, thresholds: RulesConfig['plantStageDays'] = DEFAULT_RULES.plantStageDays): PlantStage {
  let idx = 0;
  thresholds.forEach((t, i) => {
    if (points >= t) idx = i + 1;
  });
  return PLANT_STAGES[idx] ?? 'tree';
}

/** Study days needed for the next stage, or null at Tree. */
export function nextStageAt(points: number, thresholds: RulesConfig['plantStageDays'] = DEFAULT_RULES.plantStageDays): number | null {
  return thresholds.find((t) => t > points) ?? null;
}

export function healthForMissedDays(
  missed: number,
  t: RulesConfig['plantHealthMissedDays'] = DEFAULT_RULES.plantHealthMissedDays,
): PlantHealth {
  if (missed >= t.dormant) return 'dormant';
  if (missed >= t.wilted) return 'wilted';
  if (missed >= t.dry) return 'dry';
  if (missed >= t.droopy) return 'droopy';
  return 'thriving';
}

export function closePlantDay(
  state: PlantState,
  input: PlantDayInput,
  cfg: Pick<RulesConfig, 'plantStageDays' | 'plantHealthMissedDays' | 'plantRevivalDays'> = DEFAULT_RULES,
): { state: PlantState; events: PlantEvent[] } {
  if (state.closedThrough && compareDates(input.day, state.closedThrough) <= 0) {
    throw new RangeError(`Day ${input.day} is already closed (through ${state.closedThrough})`);
  }
  const events: PlantEvent[] = [];
  let s: PlantState = { ...state, closedThrough: input.day };

  if (input.qualified) {
    const growthPoints = s.growthPoints + 1;
    const byPoints = stageForPoints(growthPoints, cfg.plantStageDays);
    const stage = PLANT_STAGES.indexOf(byPoints) > PLANT_STAGES.indexOf(s.stage) ? byPoints : s.stage;
    if (stage !== s.stage) events.push({ kind: 'stage_up', stage });
    s = { ...s, growthPoints, stage, missedStreak: 0, lastHealthDay: input.day };
    if (s.health !== 'thriving') {
      const need = cfg.plantRevivalDays[s.health];
      const progress = s.revivalProgress + 1;
      if (progress >= need) {
        events.push({ kind: 'revived', from: s.health });
        s = { ...s, health: 'thriving', revivalProgress: 0 };
      } else {
        events.push({ kind: 'revival_day', progress, of: need });
        s = { ...s, revivalProgress: progress };
      }
    }
    return { state: s, events };
  }

  if (input.rescue || input.protected) {
    // Watered: health does not get worse tonight, but it is not a revival day.
    return { state: { ...s, missedStreak: 0, lastHealthDay: input.day }, events };
  }

  const missedStreak = s.missedStreak + 1;
  const target = healthForMissedDays(missedStreak, cfg.plantHealthMissedDays);
  if (healthRank(target) > healthRank(s.health)) {
    events.push({ kind: 'health_dropped', from: s.health, to: target });
    s = { ...s, health: target, revivalProgress: 0, missedStreak };
  } else {
    // Droopy and dry need study days in a row; a revival quest keeps its dots.
    const revivalProgress = isQuestHealth(s.health) ? s.revivalProgress : 0;
    s = { ...s, missedStreak, revivalProgress };
  }
  return { state: s, events };
}

/** Closes every day after `closedThrough` through `through`; days without input are missed. */
export function rollPlant(
  state: PlantState,
  inputs: readonly PlantDayInput[],
  through: LocalDate,
  cfg: Pick<RulesConfig, 'plantStageDays' | 'plantHealthMissedDays' | 'plantRevivalDays'> = DEFAULT_RULES,
): { state: PlantState; events: PlantEvent[] } {
  const byDay = new Map(inputs.map((i) => [i.day, i]));
  const first = state.closedThrough ? addDays(state.closedThrough, 1) : [...inputs].sort((a, b) => compareDates(a.day, b.day))[0]?.day;
  const events: PlantEvent[] = [];
  if (!first || compareDates(first, through) > 0) return { state, events };
  let s = state;
  for (let d = first; compareDates(d, through) <= 0; d = addDays(d, 1)) {
    const r = closePlantDay(s, byDay.get(d) ?? { day: d, qualified: false }, cfg);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

export interface RevivalQuest {
  kind: 'wilted' | 'dormant';
  days: number;
  done: number;
}

/** The ME-08 revival quest, when the plant is wilted or resting. Copy uses `{days}` from here. */
export function revivalQuest(state: PlantState, cfg: Pick<RulesConfig, 'plantRevivalDays'> = DEFAULT_RULES): RevivalQuest | null {
  if (state.health !== 'wilted' && state.health !== 'dormant') return null;
  return { kind: state.health, days: cfg.plantRevivalDays[state.health], done: state.revivalProgress };
}

/** Study days still needed to bring the plant back to thriving (droopy 1, dry 2, …). */
export function revivalDaysLeft(state: PlantState, cfg: Pick<RulesConfig, 'plantRevivalDays'> = DEFAULT_RULES): number {
  if (state.health === 'thriving') return 0;
  return Math.max(0, cfg.plantRevivalDays[state.health] - state.revivalProgress);
}

/**
 * Health predicted for `today` from the last health day, for widgets and the local scheduler
 * when the snapshot is stale (me-money §6.6). Today itself is still open, so it is not missed yet.
 */
export function predictHealth(
  state: Pick<PlantState, 'health' | 'lastHealthDay' | 'closedThrough' | 'missedStreak'>,
  today: LocalDate,
  cfg: Pick<RulesConfig, 'plantHealthMissedDays'> = DEFAULT_RULES,
): PlantHealth {
  if (!state.closedThrough) return state.health;
  const extra = Math.max(0, daysBetween(state.closedThrough, today) - 1);
  const target = healthForMissedDays(state.missedStreak + extra, cfg.plantHealthMissedDays);
  return healthRank(target) > healthRank(state.health) ? target : state.health;
}

/** Little learners (class 1–5): the plant is never shown below droopy (learn §5.6). */
export function displayHealth(health: PlantHealth, opts: { under10: boolean }): PlantHealth {
  if (opts.under10 && healthRank(health) > healthRank('droopy')) return 'droopy';
  return health;
}

/** "Plant a new seed" appears in the garden from the Tree stage (day 100). */
export function canPlantNewSeed(state: PlantState): boolean {
  return state.stage === 'tree';
}

/** Rive `stage` input 0–4. */
export function stageIndex(stage: PlantStage): number {
  return PLANT_STAGES.indexOf(stage);
}

/** The thresholds as data for the widget snapshot (`health_by_missed_days`). */
export function healthByMissedDays(cfg: Pick<RulesConfig, 'plantHealthMissedDays'> = DEFAULT_RULES): Record<Exclude<PlantHealth, 'thriving'>, number> {
  return { ...cfg.plantHealthMissedDays };
}
