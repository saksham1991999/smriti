// How illustration slots find Agnes images by name. Files are `{name}.webp` under the asset base URL
// (DESIGN.md §6, made by skills/visual-director). The pet and plant use fixed naming so the Rive files
// (DESIGN.md §7.2) can replace the stills later without changing any screen.

export type PetSpecies = "cat" | "dog";
/** DESIGN.md §6.3 moods, the same inputs the Rive state machine will take. */
export type PetMood =
  | "happy"
  | "excited"
  | "proud"
  | "curious"
  | "thinking"
  | "sleepy"
  | "tired"
  | "sadButHopeful"
  | "resting";
export const petMoods: PetMood[] = ["happy", "excited", "proud", "curious", "thinking", "sleepy", "tired", "sadButHopeful", "resting"];
/** Under-10 mode only uses these (DESIGN.md §6.3). */
export const under10Moods: PetMood[] = ["happy", "excited", "curious", "sleepy"];

/** The pose file each mood uses until a dedicated image exists. */
const moodPose: Record<PetMood, string> = {
  happy: "base",
  excited: "celebrate",
  proud: "proud",
  curious: "wave",
  thinking: "thinking",
  sleepy: "sleepy",
  tired: "sleepy",
  sadButHopeful: "worried",
  resting: "resting",
};

/** Names to try in order: the mood's own file, its pose, then the base pose. */
export function petImageNames(species: PetSpecies, mood: PetMood = "happy", under10 = false): string[] {
  const m = under10 && !under10Moods.includes(mood) ? "happy" : mood;
  const names = [`${species}-${m}`, `${species}-${moodPose[m]}`, `${species}-base`];
  return [...new Set(names)];
}

/** R2: five stages, five health states, never dead. Dormant is shown to students as "Resting" (R37). */
export type PlantStage = "seed" | "sprout" | "sapling" | "flowering" | "tree";
export type PlantHealth = "thriving" | "droopy" | "dry" | "wilted" | "dormant";
export const plantStages: PlantStage[] = ["seed", "sprout", "sapling", "flowering", "tree"];
export const plantHealths: PlantHealth[] = ["thriving", "droopy", "dry", "wilted", "dormant"];

/** `plant-{stage}` when thriving, else `plant-{stage}-{health}`, falling back to the thriving image of that stage. */
export function plantImageNames(stage: PlantStage, health: PlantHealth = "thriving"): string[] {
  if (health === "thriving") return [`plant-${stage}`];
  return [`plant-${stage}-${health}`, `plant-${stage}`];
}

/** Rive input values for the plant (DESIGN.md §7.2): stage 0-4, health 0-4. */
export function plantRiveInputs(stage: PlantStage, health: PlantHealth): { stage: number; health: number } {
  return { stage: plantStages.indexOf(stage), health: plantHealths.indexOf(health) };
}

export function joinAssetUrl(base: string, name: string, ext = "webp"): string {
  const b = base.endsWith("/") ? base : `${base}/`;
  return `${b}${name}.${ext}`;
}

export const DEFAULT_ASSET_BASE_URL = "/assets/";
