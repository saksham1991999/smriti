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

/** Little learner activities (PRD §6 "Class 1–5: story, song and play"), as bundle modes. */
export const ACTIVITY_KINDS = ["story", "song", "play"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** The extras schema behind each activity kind. */
export const ACTIVITY_SCHEMAS = { story: "storybook@1", song: "song@1", play: "play@1" } as const;

/** Play round kinds (play@1). */
export const PLAY_ROUND_KINDS = ["tap", "match", "sort", "drag", "trace"] as const;

/**
 * Words little learners never hear as feedback (LES-02 little learner: never "Not quite"; the
 * wrong-answer band says "Let's try again together!"). English matches whole words, Hindi any
 * occurrence. The content check refuses them in play@1 feedback, prompts and hints, and
 * lesson-core's gentle mode uses the same list.
 */
export const NEGATIVE_FEEDBACK_WORDS = {
  en: ["wrong", "incorrect", "fail", "failed", "fails", "failure", "mistake", "mistakes", "not quite", "bad", "oops", "try harder"],
  hi: ["गलत", "ग़लत", "असफल", "फेल", "फ़ेल", "नाकाम", "ठीक नहीं"],
} as const satisfies Record<string, readonly string[]>;

/** The negative feedback words in a text (empty when the text is gentle). */
export function negativeFeedbackWords(text: string): string[] {
  const lower = text.toLowerCase();
  const hits: string[] = [];
  for (const w of NEGATIVE_FEEDBACK_WORDS.en) {
    const re = new RegExp(`(^|[^\\p{L}])${w.replace(/ /g, "\\s+")}($|[^\\p{L}])`, "u");
    if (re.test(lower)) hits.push(w);
  }
  for (const w of NEGATIVE_FEEDBACK_WORDS.hi) if (text.includes(w)) hits.push(w);
  return hits;
}
