import { compareDates, type LocalDate } from '../time';
import { DEFAULT_RULES, type RulesConfig } from './config';
import type { PlantHealth } from './plant';

/**
 * The pet (PRD §7, TRD §10, me-money §3.3). `mood` and `energy` are 0–100. The persistent state
 * label follows plant health (me-money §3.3 table), so the pet and plant always tell the same
 * story:
 *
 *   thriving → happy · droopy → content · dry → sleepy · wilted → tired, or missing_you when
 *   energy is low · dormant → resting
 *
 * Mood is kept inside the band of the plant's health (a floor and a ceiling from
 * `game.pet.state_min_mood`): care can make the pet smile within its band, but only studying
 * (which revives the plant) brings a resting pet back. Energy decays per missed day and rises with
 * play and treats. Never dies; little learners never see below `sleepy`.
 *
 * The decay and gain amounts are not in any doc: they are proposed flags (`game.pet.*`).
 */

export const PET_STATES = ['happy', 'content', 'sleepy', 'tired', 'missing_you', 'resting'] as const;
export type PetState = (typeof PET_STATES)[number];
export type PetCareAction = 'pet' | 'play' | 'treat';

export interface PetStats {
  mood: number;
  energy: number;
  /** Last day the roll-up applied (decay or study gain). */
  lastDecayDay: LocalDate | null;
}

export interface PetCareCounters {
  day: LocalDate;
  /** Mood gained today from non-study care (capped at `game.pet.care_mood_cap_per_day`). */
  careMood: number;
  plays: number;
  treats: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The mood band for a plant health: [floor, ceiling]. */
export function moodBand(health: PlantHealth, cfg: Pick<RulesConfig, 'pet'> = DEFAULT_RULES): [number, number] {
  const m = cfg.pet.stateMinMood;
  switch (health) {
    case 'thriving':
      return [m.happy, 100];
    case 'droopy':
      return [m.content, m.happy - 1];
    case 'dry':
      return [m.sleepy, m.content - 1];
    case 'wilted':
      return [m.tired, m.sleepy - 1];
    case 'dormant':
      return [0, m.tired - 1];
  }
}

export function newPet(cfg: Pick<RulesConfig, 'pet'> = DEFAULT_RULES): PetStats {
  return { mood: cfg.pet.start.mood, energy: cfg.pet.start.energy, lastDecayDay: null };
}

/** The state label (stored in `game.pets.state`, used by copy and widgets). */
export function derivePetState(
  stats: Pick<PetStats, 'mood' | 'energy'>,
  opts: { under10?: boolean } = {},
  cfg: Pick<RulesConfig, 'pet'> = DEFAULT_RULES,
): PetState {
  const m = cfg.pet.stateMinMood;
  let state: PetState;
  if (stats.mood >= m.happy) state = 'happy';
  else if (stats.mood >= m.content) state = 'content';
  else if (stats.mood >= m.sleepy) state = 'sleepy';
  else if (stats.mood >= m.tired) state = stats.energy < cfg.pet.missingYouEnergyBelow ? 'missing_you' : 'tired';
  else state = 'resting';
  if (opts.under10 && (state === 'tired' || state === 'missing_you' || state === 'resting')) return 'sleepy';
  return state;
}

export interface PetDayInput {
  day: LocalDate;
  qualified: boolean;
  /** Rescue, freeze, rest day or incident: no decay that day. */
  healthDay: boolean;
  /** The plant's health after the same day closed. */
  plantHealth: PlantHealth;
}

/** The nightly roll-up for the pet. Run after `closePlantDay` for the same day. */
export function closePetDay(pet: PetStats, input: PetDayInput, cfg: Pick<RulesConfig, 'pet'> = DEFAULT_RULES): PetStats {
  if (pet.lastDecayDay && compareDates(input.day, pet.lastDecayDay) <= 0) {
    throw new RangeError(`Day ${input.day} is already closed for the pet`);
  }
  let { mood, energy } = pet;
  if (input.qualified) {
    mood += cfg.pet.studyGain.mood;
    energy += cfg.pet.studyGain.energy;
  } else if (!input.healthDay) {
    mood -= cfg.pet.decayPerMissedDay.mood;
    energy -= cfg.pet.decayPerMissedDay.energy;
  }
  const [lo, hi] = moodBand(input.plantHealth, cfg);
  return { mood: clamp(mood, lo, hi), energy: clamp(energy, 0, 100), lastDecayDay: input.day };
}

export type CareBlockReason = 'cap' | 'no_treat';

/**
 * A care action (`POST /v1/pet/care`). Petting raises mood a little (+5 a day from all non-study
 * care), play raises energy (3 a day), a treat (from the inventory) raises energy (1 a day).
 * "Study together" is not a care action: it opens a lesson.
 */
export function applyCare(
  pet: PetStats,
  action: PetCareAction,
  counters: PetCareCounters,
  ctx: { day: LocalDate; plantHealth: PlantHealth; treatsHeld: number },
  cfg: Pick<RulesConfig, 'pet'> = DEFAULT_RULES,
): { ok: true; pet: PetStats; counters: PetCareCounters; usedTreat: boolean } | { ok: false; reason: CareBlockReason } {
  const c: PetCareCounters = counters.day === ctx.day ? { ...counters } : { day: ctx.day, careMood: 0, plays: 0, treats: 0 };
  const [lo, hi] = moodBand(ctx.plantHealth, cfg);
  let { mood, energy } = pet;
  let usedTreat = false;
  switch (action) {
    case 'pet': {
      const room = cfg.pet.careMoodCapPerDay - c.careMood;
      if (room <= 0) return { ok: false, reason: 'cap' };
      const gain = Math.min(room, cfg.pet.petMoodGain);
      c.careMood += gain;
      mood += gain;
      break;
    }
    case 'play':
      if (c.plays >= cfg.pet.playsPerDay) return { ok: false, reason: 'cap' };
      c.plays += 1;
      energy += cfg.pet.playEnergyGain;
      break;
    case 'treat':
      if (c.treats >= cfg.pet.treatsPerDay) return { ok: false, reason: 'cap' };
      if (ctx.treatsHeld <= 0) return { ok: false, reason: 'no_treat' };
      c.treats += 1;
      usedTreat = true;
      energy += cfg.pet.treatEnergyGain;
      break;
  }
  return { ok: true, pet: { ...pet, mood: clamp(mood, lo, hi), energy: clamp(energy, 0, 100) }, counters: c, usedTreat };
}

/** Maps our care action to the sync contract's `pet_care.action` (`treat` is sent as `feed`). */
export function careActionToWire(action: PetCareAction): 'pet' | 'feed' | 'play' {
  return action === 'treat' ? 'feed' : action;
}
