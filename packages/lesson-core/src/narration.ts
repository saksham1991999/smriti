/**
 * Card narration and pet reactions, shared by the web and native players so both behave alike.
 *
 * Narration (LES-01 card header, LES-01.1): a story or explainer card may carry a `narration`
 * audio ref. The [Listen] button shows only when that audio is ready on the device and the host
 * gave the player an audio port, so a player without audio is silent and fully usable. Narration
 * never auto-plays except for little learners (`playerRules().narrationAutoPlay`), and never while
 * the app is muted. A tap on [Listen] always plays: it is the student's own request.
 *
 * Pet reactions (LRN-11 "pet avatar in the corner reacts at page turns", LES-01 little learner
 * "reacts (hop on correct, think on wrong)"): a mood from the under-10 set (DESIGN.md §6.3:
 * happy, excited, curious, sleepy) and whether to hop. Reduced motion never hops; the mood still
 * changes, so the reaction is not motion alone.
 */
import type { Phase } from "./machine.js";
import type { PlanCard } from "./plan.js";
import type { PlayerRules } from "./rules.js";

/** The narration audio ref of a plan card (story and explainer cards carry one), or null. */
export function cardNarration(card: PlanCard | null | undefined): string | null {
  const n = (card?.card as { narration?: unknown } | null | undefined)?.narration;
  return typeof n === "string" && n !== "" ? n : null;
}

/** The bundle-relative url of a media ref once it is ready, or null (never a stand-in). */
export function readyMediaUrl(media: Readonly<Record<string, { status: string; url?: string | null } | undefined>>, ref: string | null): string | null {
  if (!ref) return null;
  const m = media[ref];
  return m && m.status === "ready" && m.url ? m.url : null;
}

/**
 * Whether narration starts by itself when a card opens: only where the rules say so (little
 * learners), never when the app is muted, and never on a card the student went back to.
 */
export function autoNarrate(rules: Pick<PlayerRules, "narrationAutoPlay">, opts: { muted: boolean; readOnly: boolean }): boolean {
  return rules.narrationAutoPlay && !opts.muted && !opts.readOnly;
}

/** How long a pet reaction lasts before the pet settles back to `happy`. */
export const PET_REACTION_MS = 1200;

export type PetReactionEvent = "page_turn" | "story_end" | "correct" | "wrong" | "shown";

export interface PetReaction {
  mood: "happy" | "excited" | "curious";
  hop: boolean;
}

/** The pet's reaction to an event (null: at rest). */
export function petReaction(event: PetReactionEvent | null, reducedMotion: boolean): PetReaction {
  const move = !reducedMotion;
  switch (event) {
    case "page_turn":
    case "story_end":
    case "correct":
      return { mood: "excited", hop: move };
    case "wrong":
    case "shown":
      // "Think" on wrong: curious is the under-10 thinking face. No hop: it is not a celebration.
      return { mood: "curious", hop: false };
    case null:
      return { mood: "happy", hop: false };
  }
}

/**
 * The reaction a lesson phase calls for (LES-01 little learner: the corner pet hops on correct and
 * thinks on wrong). The guided finish (the answer shown with the pet) thinks too. Other phases: at rest.
 */
export function lessonPetEvent(phase: Phase): PetReactionEvent | null {
  switch (phase) {
    case "feedback":
      return "correct";
    case "hint":
    case "explain":
      return "wrong";
    case "guided":
      return "shown";
    default:
      return null;
  }
}
