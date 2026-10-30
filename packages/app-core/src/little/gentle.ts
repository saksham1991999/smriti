import { PET_STATES, type PetState } from '../rules/pet';
import { displayHealth, revivalQuest, type PlantHealth, type PlantStage, type PlantState, type RevivalQuest } from '../rules/plant';

/**
 * Gentle states for under-10s (me-money §3.3, learn §5.6, DESIGN §6.3, PRD §7: the pet and plant
 * never die and are never shown in distress). The stored state stays true to the rules; only
 * what is shown is clamped, so a child who grows out of the band sees the real state.
 *
 * Doc note: me-money pairs the pet's `sleepy` with a `dry` plant, while learn §5.6 stops the plant
 * at `droopy`. Both clamps are applied as written, so a gentle pet may be sleepy next to a droopy
 * plant.
 */

/** Persistent states a gentle pet may show (me-money §3.3). */
export const GENTLE_PET_STATES: readonly PetState[] = ['happy', 'content', 'sleepy'];

export const PET_REACTIONS = ['excited', 'proud', 'curious', 'thinking'] as const;
export type PetReaction = (typeof PET_REACTIONS)[number];
/** Transient reactions a gentle pet may play (me-money §3.3, learn §5.6). */
export const GENTLE_PET_REACTIONS: readonly PetReaction[] = ['excited', 'curious'];

/** The pet state to show: anything below `sleepy` shows as `sleepy` in gentle mode. */
export function gentlePetState(state: PetState, gentle: boolean): PetState {
  if (!gentle) return state;
  return PET_STATES.indexOf(state) > PET_STATES.indexOf('sleepy') ? 'sleepy' : state;
}

/**
 * The reaction to play. In gentle mode `proud` plays as `excited` and `thinking` as `curious`
 * (the nearest allowed reaction; the mapping is ours, the docs list only the allowed two).
 */
export function gentleReaction(reaction: PetReaction, gentle: boolean): PetReaction {
  if (!gentle || GENTLE_PET_REACTIONS.includes(reaction)) return reaction;
  return reaction === 'proud' ? 'excited' : 'curious';
}

export interface PlantDisplay {
  stage: PlantStage;
  health: PlantHealth;
  /** ME-08 revival quest card, never shown in gentle mode (it would show a wilted plant). */
  revivalQuest: RevivalQuest | null;
  /** "Plant a new seed" and growth are shown to everyone. */
  growthPoints: number;
}

export function plantDisplay(plant: PlantState, gentle: boolean): PlantDisplay {
  return {
    stage: plant.stage,
    health: displayHealth(plant.health, { under10: gentle }),
    revivalQuest: gentle ? null : revivalQuest(plant),
    growthPoints: plant.growthPoints,
  };
}

/** Rive inputs (DESIGN §7.2): the pet file reads `under10` to keep to the gentle moods. */
export function petRiveInputs(state: PetState, gentle: boolean): { state: PetState; under10: boolean } {
  return { state: gentlePetState(state, gentle), under10: gentle };
}
