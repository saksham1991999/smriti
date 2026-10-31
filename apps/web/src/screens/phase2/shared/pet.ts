import { useAppStore } from "@smriti/app-core/react";
import { useOnboarding } from "../../../lib/onboarding";

export interface PetInfo {
  name: string;
  species: "cat" | "dog";
}

/** The study buddy from the synced state, or the one named during onboarding; null if none yet. */
export function usePet(): PetInfo | null {
  const pet = useAppStore((x) => x.pet);
  const localName = useOnboarding((x) => x.petName);
  const localSpecies = useOnboarding((x) => x.petSpecies);
  if (pet?.name) return { name: pet.name, species: pet.species === "dog" ? "dog" : "cat" };
  if (localName) return { name: localName, species: localSpecies === "dog" ? "dog" : "cat" };
  return null;
}
