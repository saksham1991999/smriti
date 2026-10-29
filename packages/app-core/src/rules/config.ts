import { defaultFlags, type Flags } from '@smriti/config';

/**
 * The tunables the gamification rules read, resolved from flags. The server reads the same keys,
 * so client and server agree; the JSON test vectors pin the defaults.
 */
export interface RulesConfig {
  reviewsToQualify: number;
  freezeSlotsMax: number;
  monthlyFreezes: { free: number; pro: number };
  restDaysPerWeek: number;
  restDayPlanAheadDays: number;
  plantStageDays: readonly [number, number, number, number];
  plantHealthMissedDays: { droopy: number; dry: number; wilted: number; dormant: number };
  plantRevivalDays: { droopy: number; dry: number; wilted: number; dormant: number };
  pet: {
    start: { mood: number; energy: number };
    decayPerMissedDay: { mood: number; energy: number };
    studyGain: { mood: number; energy: number };
    stateMinMood: { happy: number; content: number; sleepy: number; tired: number };
    missingYouEnergyBelow: number;
    careMoodCapPerDay: number;
    petMoodGain: number;
    playsPerDay: number;
    playEnergyGain: number;
    treatsPerDay: number;
    treatEnergyGain: number;
  };
  treatsMaxHeld: number;
  streakMilestoneGems: Record<string, number>;
  shareMilestones: readonly number[];
}

export function rulesConfigFromFlags(flags: Flags = defaultFlags): RulesConfig {
  return {
    reviewsToQualify: flags.get('streak.reviews_to_qualify'),
    freezeSlotsMax: flags.get('streak.freeze_slots_max'),
    monthlyFreezes: flags.get('streak.monthly_freezes'),
    restDaysPerWeek: flags.get('game.rest_days_per_week'),
    restDayPlanAheadDays: flags.get('streak.rest_day_plan_ahead_days'),
    plantStageDays: flags.get('game.plant.stage_days'),
    plantHealthMissedDays: flags.get('game.plant.health_missed_days'),
    plantRevivalDays: flags.get('game.plant.revival_days'),
    pet: {
      start: flags.get('game.pet.start'),
      decayPerMissedDay: flags.get('game.pet.decay_per_missed_day'),
      studyGain: flags.get('game.pet.study_gain'),
      stateMinMood: flags.get('game.pet.state_min_mood'),
      missingYouEnergyBelow: flags.get('game.pet.missing_you_energy_below'),
      careMoodCapPerDay: flags.get('game.pet.care_mood_cap_per_day'),
      petMoodGain: flags.get('game.pet.pet_mood_gain'),
      playsPerDay: flags.get('game.pet.plays_per_day'),
      playEnergyGain: flags.get('game.pet.play_energy_gain'),
      treatsPerDay: flags.get('game.pet.treats_per_day'),
      treatEnergyGain: flags.get('game.pet.treat_energy_gain'),
    },
    treatsMaxHeld: flags.get('game.shop.treats_max_held'),
    streakMilestoneGems: flags.get('game.economy.streak_milestone_gems'),
    shareMilestones: flags.get('share.streak_milestones'),
  };
}

export const DEFAULT_RULES: RulesConfig = rulesConfigFromFlags(defaultFlags);
