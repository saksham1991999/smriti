import type { CardType, QuestionType, QuestionUse } from "./generated/types.js";

export const CARD_TYPES = [
  "story",
  "explainer",
  "formula",
  "animation",
  "interactive",
  "sim",
  "model3d",
  "pano360",
  "derivation",
  "worked_example",
  "question",
  "memory_hook",
  "roleplay",
  "video",
  "experiment",
  "summary",
  "cheat_sheet_ref",
  "common_traps",
] as const satisfies readonly CardType[];

export const QUESTION_TYPES = [
  "mcq_single",
  "mcq_multi",
  "numerical",
  "integer",
  "matrix_match",
  "match_list",
  "assertion_reason",
  "statement_based",
  "paragraph",
  "fill_blank",
  "order_steps",
] as const satisfies readonly QuestionType[];

export const INTERACTIVE_WIDGETS = [
  "drag_sort",
  "slider",
  "graph",
  "tap_reveal",
  "label_diagram",
  "order_steps",
] as const;

/** Card types that teach (count as a teaching card for coverage). */
export const TEACHING_CARD_TYPES: readonly CardType[] = [
  "story",
  "explainer",
  "formula",
  "animation",
  "interactive",
  "sim",
  "model3d",
  "pano360",
  "derivation",
  "worked_example",
  "roleplay",
  "video",
  "experiment",
];

/** Cards that need the network at runtime (flow 7.9). Skipping them is never a miss. */
export const ONLINE_ONLY_CARD_TYPES: readonly CardType[] = ["video", "roleplay"];

/** Question uses whose answer keys never ship to devices. */
export const SERVER_ONLY_USES: readonly QuestionUse[] = ["mock", "daily"];

/** Card id mode abbreviations. */
export const CARD_MODE_CODE = { deep_dive: "dd", quick_revision: "qr" } as const;

export const MEDIA_PREFIX_KINDS = {
  img: ["image", "diagram", "comic"],
  anim: ["animation_rive", "animation_lottie"],
  sim: ["sim"],
  m3d: ["model3d"],
  pano: ["pano360"],
  audio: ["audio_tts", "audio_song"],
} as const;

/** Single-answer types: after a first wrong try the chosen option is struck out. */
export const SINGLE_ANSWER_TYPES: readonly QuestionType[] = [
  "mcq_single",
  "assertion_reason",
  "statement_based",
];
