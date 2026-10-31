export { checkAnswer, isSingleAnswer, normalizeTyped, parseNumber, scoreAnswer, wrongMarks } from "./answers.js";
export type { Answer, AnyQuestion, CheckDetail, CheckResult, EventResponse, NumberReason } from "./answers.js";
export { evaluatePlacement, evaluateTestOut } from "./check-result.js";
export type { PlacementResult, TestOutResult } from "./check-result.js";
export { lessonConfig, RULED_DEFAULTS } from "./config.js";
export type { LessonConfig, XpConfig } from "./config.js";
export { envelope, uuidv7 } from "./events.js";
export type {
  AnswerContext,
  AnswerSubmittedPayload,
  Confidence,
  EventEnvelope,
  EventLessonMode,
  LessonCardViewedPayload,
  LessonCompletedPayload,
  LessonEvent,
  LessonStartedPayload,
  TimedEvent,
} from "./events.js";
export { hintFor, simCardFor, struckOptions, toughOne, workedSolution } from "./help.js";
export type { Hint } from "./help.js";
export { checkInteractive, checkSimTask, widgetHasTask } from "./interactive.js";
export type { WidgetResponse, WidgetResult } from "./interactive.js";
export { answerContext, currentCard, initialState, isReadOnly, reduce, resumePoint } from "./machine.js";
export type { CardOutcome, LessonAction, LessonState, LessonSummary, Phase, Rating, ReviewItem, TimedAction } from "./machine.js";
export {
  cardVisible,
  findQuestion,
  nextBite,
  planCheck,
  planFix,
  planLesson,
  selectPlacement,
  selectTestOut,
  visibleBites,
} from "./plan.js";
export type { Bite, CheckQuestion, LessonPlan, LessonPlanOptions, Missed, PlanCard, PlayerMode } from "./plan.js";
export { playerRules } from "./rules.js";
export type { PlayerRules } from "./rules.js";
export {
  activityIds,
  initialPlay,
  initialSong,
  initialStory,
  isGentleText,
  lineAt,
  nextMove,
  planPlay,
  planSong,
  planStory,
  reducePlay,
  reduceSong,
  reduceStory,
  roundMoves,
  STORY_AUTO_ADVANCE_MS,
  TRACE_BRUSH,
  traceCoverage,
} from "./little.js";
export type {
  ActivityCompletion,
  ActivityKind,
  AudioEvent,
  AudioPort,
  GlyphMask,
  TracePoint,
  PlayAction,
  PlayMove,
  PlayPlan,
  PlayState,
  SongAction,
  SongPlan,
  SongState,
  StoryAction,
  StoryPlan,
  StoryState,
} from "./little.js";
export { NEGATIVE_FEEDBACK_WORDS, negativeFeedbackWords } from "@smriti/content-schema";
export { LessonSession } from "./session.js";
export type { SessionOptions } from "./session.js";
