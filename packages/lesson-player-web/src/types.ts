/**
 * The small, local lesson interface the web player renders until `@smriti/lesson-core` and the
 * bundle format from `packages/content-schema` land. Text arrives already resolved to the
 * student's locale. When lesson-core merges, an adapter maps its cards onto these (or this file
 * re-exports its types) without touching the renderers.
 */

export type LessonMode = "deep_dive" | "quick_revision" | "onboarding" | "quick_check";

export interface ConceptCard {
  type: "concept";
  id: string;
  title: string;
  body: string;
  illustration?: string;
  illustrationAlt?: string;
  formula?: { latex: string; label: string };
}

export interface WorkedExampleCard {
  type: "worked_example";
  id: string;
  title: string;
  steps: string[];
  illustration?: string;
  illustrationAlt?: string;
}

export interface McqCard {
  type: "mcq";
  id: string;
  prompt: string;
  options: { id: string; label: string }[];
  correctId: string;
  hint: string;
  explanation: string;
}

export interface NumericCard {
  type: "numeric";
  id: string;
  prompt: string;
  answer: number;
  /** Absolute tolerance. */
  tolerance: number;
  unit?: string;
  hint: string;
  explanation: string;
}

export interface SimCard {
  type: "sim";
  id: string;
  title: string;
  simId: string;
  taskId?: string;
  caption: string;
}

export interface RecapCard {
  type: "recap";
  id: string;
  title: string;
  points: string[];
}

export type LessonCard = ConceptCard | WorkedExampleCard | McqCard | NumericCard | SimCard | RecapCard;
export type QuestionCard = McqCard | NumericCard;
export type CardType = LessonCard["type"];

export interface Lesson {
  topicId: string;
  title: string;
  /** Subject id or colour family, resolved through subjectMap. */
  subject: string;
  bundleVersion: string;
  /** Estimated minutes. */
  minutes: number;
  cards: LessonCard[];
  /** True for test and dev fixtures: placeholder text, never study content (AGENTS.md rule 1). */
  fixture?: boolean;
}

export type PlayerConfidence = "sure" | "half" | "guess";

export interface AnswerRecord {
  card: QuestionCard;
  index: number;
  /** Option id(s) for MCQ, the number for numeric; `null` for "I don't know yet". */
  response: string[] | number | null;
  correct: boolean;
  attempt: 1 | 2;
  confidence: PlayerConfidence | null;
  msToAnswer: number;
}

export interface LessonResult {
  cardsSeen: number;
  correct: number;
  total: number;
  /** Questions answered right on the first try. */
  firstTry: number;
  msTotal: number;
  /** Card ids of questions missed on both tries (the "Fix mistakes" row). */
  missed: string[];
}

/** Every visible string the player needs, from `@smriti/i18n` (learn:LES-01, LES-02). */
export interface PlayerStrings {
  close: string;
  counter: (n: number, total: number) => string;
  progressLabel: string;
  continue: string;
  check: string;
  dontKnow: string;
  correct: string;
  secondTry: string;
  xp: (xp: number) => string;
  why: string;
  notQuite: string;
  hint: string;
  tryAgain: string;
  explainHead: string;
  reviewNote: string;
  gotIt: string;
  dontKnowHead: string;
  correctPetLines: string[];
  wrongPetLine: string;
  numericLabel: string;
  unit: (unit: string) => string;
  recapTitle?: string;
  cardKind: Record<CardType, string>;
}
