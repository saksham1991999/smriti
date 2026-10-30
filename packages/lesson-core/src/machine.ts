/**
 * The lesson player state machine (APP_FLOW §3.4, learn §7.3). A pure reducer: every action
 * carries the time, and the new state lists the events the action produced. Hosts render from
 * `phase` and the current card; they never decide lesson rules themselves.
 *
 *   loading -> card | needs_net
 *   card -> card (next / back) | question | tutor | make_it_stick | confidence | preview_end
 *   question -> feedback (right) | hint (wrong, first try) | explain (wrong again, or I don't know)
 *   hint -> question;  feedback -> card;  explain -> card (the card is queued for review)
 *   confidence -> complete;  any -> exited (progress saved)
 */
import { type Answer, type CheckResult, checkAnswer } from "./answers.js";
import type { LessonConfig } from "./config.js";
import type { AnswerContext, AnswerSubmittedPayload, Confidence, EventLessonMode, TimedEvent } from "./events.js";
import { type Hint, hintFor, struckOptions } from "./help.js";
import { checkInteractive, type InteractiveCardB, type WidgetResponse, type WidgetResult, widgetHasTask } from "./interactive.js";
import type { LessonPlan, Missed, PlanCard } from "./plan.js";

export type Phase =
  | "loading"
  | "needs_net"
  | "card"
  | "question"
  | "feedback"
  | "hint"
  | "explain"
  | "tutor"
  | "make_it_stick"
  | "confidence"
  | "complete"
  | "preview_end"
  | "exited";

/** FSRS ratings: 1 Again, 2 Hard, 3 Good, 4 Easy. */
export type Rating = 1 | 2 | 3 | 4;

export interface CardOutcome {
  key: string;
  questionId: string | null;
  /** null for cards with nothing to answer. */
  correct: boolean | null;
  attempts: number;
  firstTry: boolean;
  dontKnow: boolean;
  confidence: Confidence | null;
  skipped: boolean;
}

export interface ReviewItem {
  /** `c:<card_id>` for a lesson card, `q:<question_id>` for a question outside a card. */
  cardRef: string;
  questionId: string | null;
  concepts: string[];
  reason: "wrong_twice" | "dont_know" | "rated_again";
}

export interface LessonSummary {
  xp: number;
  correct: number;
  total: number;
  accuracy: number | null;
  msTotal: number;
  cardsSeen: number;
  missed: Missed[];
  comboReached: boolean;
}

export interface LessonState {
  plan: LessonPlan | null;
  config: LessonConfig;
  phase: Phase;
  /** Where an overlay (tutor, Make it stick) returns to. */
  overlayReturn: Phase | null;
  /** The furthest card reached; progress is saved here. */
  index: number;
  /** The card on screen; below `index` when the student went back (read-only). */
  viewIndex: number;
  attempt: 1 | 2;
  struckOptionIds: string[];
  lastResult: CheckResult | null;
  hint: Hint | null;
  /** The current card has a task (interactive or sim) not done yet: forward is blocked. */
  pendingTask: boolean;
  /** Set when the last action was refused, for the host to explain why. */
  blocked: "task" | "question" | "read_only" | null;
  outcomes: Record<string, CardOutcome>;
  seen: string[];
  streak: number;
  comboShown: boolean;
  /** True right after the answer that reached the combo, for the one celebration. */
  comboNow: boolean;
  xp: number;
  startedAt: number | null;
  cardShownAt: number | null;
  questionShownAt: number | null;
  reviewQueue: ReviewItem[];
  /** Quick Revision ratings for app-core's FSRS (review_rated is app-core's event). */
  ratings: { cardRef: string; rating: Rating }[];
  topicConfidence: Confidence | null;
  summary: LessonSummary | null;
  /** Events produced by the last action, oldest first. */
  events: TimedEvent[];
}

export type LessonAction =
  | { type: "start"; plan: LessonPlan; resumeIndex?: number }
  | { type: "offline" }
  | { type: "next" }
  | { type: "back" }
  | { type: "forward" }
  | { type: "submit"; answer: Answer; confidence?: Confidence | null }
  | { type: "dont_know" }
  | { type: "try_again" }
  | { type: "continue" }
  | { type: "widget"; response: WidgetResponse }
  | { type: "sim_task"; taskId: string; correct: boolean }
  | { type: "skip_task" }
  | { type: "skip_online" }
  | { type: "open_overlay"; overlay: "tutor" | "make_it_stick" }
  | { type: "close_overlay" }
  | { type: "rate"; rating: Rating }
  | { type: "confidence"; value: Confidence | null }
  | { type: "exit" };

export type TimedAction = LessonAction & { now: number };

export function initialState(config: LessonConfig): LessonState {
  return {
    plan: null,
    config,
    phase: "loading",
    overlayReturn: null,
    index: 0,
    viewIndex: 0,
    attempt: 1,
    struckOptionIds: [],
    lastResult: null,
    hint: null,
    pendingTask: false,
    blocked: null,
    outcomes: {},
    seen: [],
    streak: 0,
    comboShown: false,
    comboNow: false,
    xp: 0,
    startedAt: null,
    cardShownAt: null,
    questionShownAt: null,
    reviewQueue: [],
    ratings: [],
    topicConfidence: null,
    summary: null,
    events: [],
  };
}

/** The card on screen. */
export function currentCard(s: LessonState): PlanCard | null {
  return s.plan?.cards[s.viewIndex] ?? null;
}

export function isReadOnly(s: LessonState): boolean {
  return s.viewIndex < s.index;
}

/** sync.md v1.2: checks answer in context `check`, Fix mistakes in `fix`, everything else `lesson`. */
export const answerContext = (p: LessonPlan): AnswerContext =>
  p.mode === "quick_check" ? "check" : p.mode === "fix_mistakes" ? "fix" : "lesson";

/** The student is on a card or an open question (not feedback, an overlay or the end). */
const browsing = (s: LessonState): boolean => s.phase === "card" || s.phase === "question";

// Fix mistakes sends no lesson events (lessonEvents is false); the mapping only keeps the type total.
const eventMode = (p: LessonPlan): EventLessonMode =>
  p.mode === "fix_mistakes" ? "quick_check" : p.mode;

function hasTask(card: PlanCard): boolean {
  if (!card.card) return false;
  if (card.card.type === "interactive") return widgetHasTask(card.card as InteractiveCardB);
  if (card.card.type === "sim") return card.card.tasks.length > 0;
  return false;
}

/** Show the card at `index`: a question card opens in the question phase. */
function arrive(s: LessonState, now: number): LessonState {
  const card = s.plan!.cards[s.index]!;
  return {
    ...s,
    viewIndex: s.index,
    phase: card.question ? "question" : "card",
    attempt: 1,
    struckOptionIds: [],
    lastResult: null,
    hint: null,
    pendingTask: hasTask(card),
    cardShownAt: now,
    questionShownAt: card.question ? now : null,
    comboNow: false,
  };
}

function cardRef(card: PlanCard): string {
  return card.cardId && !card.passage ? `c:${card.cardId}` : `q:${card.question?.id ?? card.key}`;
}

function answerTarget(card: PlanCard): { card_id: string } | { question_id: string } {
  // A plain lesson question card is identified by its card; paragraph children, checks and fix
  // rounds by the question.
  return card.cardId && !card.passage ? { card_id: card.cardId } : { question_id: card.question!.id };
}

function withOutcome(s: LessonState, card: PlanCard, patch: Partial<CardOutcome>): Record<string, CardOutcome> {
  const prev: CardOutcome = s.outcomes[card.key] ?? {
    key: card.key,
    questionId: card.question?.id ?? null,
    correct: null,
    attempts: 0,
    firstTry: false,
    dontKnow: false,
    confidence: null,
    skipped: false,
  };
  return { ...s.outcomes, [card.key]: { ...prev, ...patch } };
}

function summarize(s: LessonState, now: number): LessonSummary {
  const plan = s.plan!;
  const questions = plan.cards.filter((c) => c.question);
  const outcomes = questions.map((c) => s.outcomes[c.key]).filter((o): o is CardOutcome => !!o && o.correct !== null);
  const correct = outcomes.filter((o) => o.correct).length;
  const missed: Missed[] = questions
    .filter((c) => {
      const o = s.outcomes[c.key];
      return o && (o.correct === false || o.attempts > 1);
    })
    .map((c) => ({ questionId: c.question!.id, concepts: c.concepts, topicId: c.topicId, chapterId: c.chapterId }));
  return {
    xp: s.xp,
    correct,
    total: questions.length,
    accuracy: outcomes.length ? correct / outcomes.length : null,
    msTotal: now - (s.startedAt ?? now),
    cardsSeen: s.seen.length,
    missed,
    comboReached: s.comboShown,
  };
}

function complete(s: LessonState, now: number): LessonState {
  const plan = s.plan!;
  const withXp = { ...s, xp: s.xp + s.config.xp.complete };
  const summary = summarize(withXp, now);
  const events: TimedEvent[] = [...s.events];
  if (plan.lessonEvents) {
    events.push({
      type: "lesson_completed",
      at: now,
      payload: {
        topic_id: plan.topicId,
        mode: eventMode(plan),
        cards_seen: summary.cardsSeen,
        correct: summary.correct,
        total: summary.total,
        ms_total: summary.msTotal,
        xp: summary.xp,
      },
    });
  }
  return { ...withXp, phase: "complete", summary, events };
}

/** Leave the current card: record the view, then go to the next card or the end. */
function advance(s: LessonState, now: number): LessonState {
  const plan = s.plan!;
  const card = plan.cards[s.index]!;
  const events = [...s.events];
  if (card.cardId) {
    events.push({
      type: "lesson_card_viewed",
      at: now,
      payload: { topic_id: plan.topicId, card_id: card.cardId, index: s.index, ms_on_card: now - (s.cardShownAt ?? now) },
    });
  }
  const seen = s.seen.includes(card.key) ? s.seen : [...s.seen, card.key];
  const next: LessonState = { ...s, events, seen, index: s.index + 1, blocked: null };
  if (next.index >= plan.cards.length) {
    // Checks and Fix mistakes end straight away; onboarding skips LES-07 (learn §7.1).
    if (plan.mode === "quick_check" || plan.mode === "fix_mistakes" || plan.mode === "onboarding") {
      return complete({ ...next, index: plan.cards.length - 1, viewIndex: plan.cards.length - 1 }, now);
    }
    return { ...next, index: plan.cards.length - 1, viewIndex: plan.cards.length - 1, phase: "confidence" };
  }
  if (plan.previewLimit !== null && next.index >= plan.previewLimit) {
    return { ...next, index: next.index - 1, viewIndex: next.index - 1, phase: "preview_end" };
  }
  return arrive(next, now);
}

export function reduce(prev: LessonState, action: TimedAction): LessonState {
  const s: LessonState = { ...prev, events: [], blocked: null, comboNow: false };
  const { now } = action;
  if (s.phase === "complete" || s.phase === "exited") return s;

  switch (action.type) {
    case "start": {
      const plan = action.plan;
      if (plan.cards.length === 0) throw new Error("a lesson plan needs at least one card");
      const resume = Math.min(Math.max(action.resumeIndex ?? 0, 0), plan.cards.length - 1);
      const limit = plan.previewLimit;
      const started: LessonState = {
        ...initialState(s.config),
        plan,
        index: limit !== null ? Math.min(resume, Math.max(limit - 1, 0)) : resume,
        startedAt: now,
      };
      if (plan.lessonEvents) {
        started.events = [
          {
            type: "lesson_started",
            at: now,
            payload: { topic_id: plan.topicId, mode: eventMode(plan), bundle_version: plan.bundleVersion, locale: plan.locale },
          },
        ];
      }
      if (limit === 0) return { ...started, phase: "preview_end" };
      return arrive(started, now);
    }

    case "offline":
      return s.phase === "loading" ? { ...s, phase: "needs_net" } : s;

    // Going back is only possible from a card or an open question; earlier cards are read-only.
    case "back":
      if (!browsing(s)) return s;
      return s.viewIndex > 0 ? { ...s, viewIndex: s.viewIndex - 1 } : s;

    case "forward":
      if (!browsing(s)) return s;
      return s.viewIndex < s.index ? { ...s, viewIndex: s.viewIndex + 1 } : s;

    case "next": {
      if (!browsing(s)) return s;
      if (isReadOnly(s)) return { ...s, viewIndex: s.viewIndex + 1 };
      if (s.phase === "question") return { ...s, blocked: "question" };
      if (s.pendingTask) return { ...s, blocked: "task" };
      return advance(s, now);
    }

    case "widget": {
      if (s.phase !== "card" || isReadOnly(s)) return s;
      const card = s.plan!.cards[s.index]!;
      if (card.card?.type !== "interactive") return s;
      const res: WidgetResult = checkInteractive(card.card as InteractiveCardB, action.response);
      return {
        ...s,
        pendingTask: s.pendingTask && !res.done,
        outcomes: res.done ? withOutcome(s, card, { correct: res.correct, attempts: (s.outcomes[card.key]?.attempts ?? 0) + 1 }) : s.outcomes,
      };
    }

    case "sim_task": {
      if (s.phase !== "card" || isReadOnly(s)) return s;
      const card = s.plan!.cards[s.index]!;
      if (card.card?.type !== "sim") return s;
      // One task done is enough to move on; the rest stay optional.
      return { ...s, pendingTask: false, outcomes: withOutcome(s, card, { correct: action.correct, attempts: 1 }) };
    }

    case "skip_task": {
      if (s.phase !== "card" || isReadOnly(s)) return s;
      const card = s.plan!.cards[s.index]!;
      // Skipped lab tasks never count as wrong (learn §7.3 rule 11).
      return { ...s, pendingTask: false, outcomes: withOutcome(s, card, { skipped: true }) };
    }

    case "skip_online": {
      if (s.phase !== "card" || isReadOnly(s)) return s;
      const card = s.plan!.cards[s.index]!;
      if (!card.onlineOnly) return s;
      return advance({ ...s, pendingTask: false, outcomes: withOutcome(s, card, { skipped: true }) }, now);
    }

    case "submit": {
      if (s.phase !== "question" || isReadOnly(s)) return s;
      const plan = s.plan!;
      const card = plan.cards[s.index]!;
      const q = card.question!;
      const result = checkAnswer(q, action.answer);
      const confidence = action.confidence ?? null;
      const payload = {
        topic_id: card.topicId,
        ...answerTarget(card),
        context: answerContext(plan),
        response: result.response,
        correct: result.correct,
        attempt: s.attempt,
        confidence,
        ms_to_answer: now - (s.questionShownAt ?? now),
      } as AnswerSubmittedPayload;
      const events: TimedEvent[] = [{ type: "answer_submitted", at: now, payload }];
      const attempts = s.attempt;
      const checkMode = plan.mode === "quick_check";

      if (result.correct) {
        const firstTry = attempts === 1;
        const streak = firstTry ? s.streak + 1 : 0;
        let xp = s.xp + (firstTry ? s.config.xp.firstTry : s.config.xp.secondTry);
        let comboShown = s.comboShown;
        let comboNow = false;
        if (plan.combos && !comboShown && streak >= s.config.comboStreakLen) {
          comboShown = true;
          comboNow = true;
          xp += s.config.xp.combo;
        }
        const ratings = plan.rapid ? [...s.ratings, { cardRef: cardRef(card), rating: (firstTry ? 3 : 2) as Rating }] : s.ratings;
        return {
          ...s,
          events,
          xp,
          streak,
          comboShown,
          comboNow,
          ratings,
          lastResult: result,
          phase: checkMode ? "explain" : "feedback",
          outcomes: withOutcome(s, card, { correct: true, attempts, firstTry, confidence }),
        };
      }

      if (attempts < plan.attemptsAllowed && plan.hints) {
        return {
          ...s,
          events,
          streak: 0,
          lastResult: result,
          phase: "hint",
          hint: hintFor(q, result, attempts),
          struckOptionIds: [...new Set([...s.struckOptionIds, ...struckOptions(q, result)])],
          outcomes: withOutcome(s, card, { attempts, confidence }),
        };
      }
      return missed(s, card, result, events, attempts, confidence, false);
    }

    case "dont_know": {
      if (s.phase !== "question" || isReadOnly(s)) return s;
      const plan = s.plan!;
      const card = plan.cards[s.index]!;
      const payload = {
        topic_id: card.topicId,
        ...answerTarget(card),
        context: answerContext(plan),
        response: null,
        correct: false,
        attempt: s.attempt,
        confidence: null,
        ms_to_answer: now - (s.questionShownAt ?? now),
      } as AnswerSubmittedPayload;
      return missed(s, card, null, [{ type: "answer_submitted", at: now, payload }], s.attempt, null, true);
    }

    case "try_again":
      if (s.phase !== "hint") return s;
      return { ...s, phase: "question", attempt: 2, questionShownAt: now, hint: null };

    case "continue":
      if (s.phase !== "feedback" && s.phase !== "explain") return s;
      return advance({ ...s, phase: "card" }, now);

    case "open_overlay": {
      const allowed = s.phase === "card" || s.phase === "question" || s.phase === "explain";
      // Onboarding has no tutor button (learn §7.1).
      if (!allowed || (action.overlay === "tutor" && s.plan?.mode === "onboarding")) return s;
      return { ...s, overlayReturn: s.phase, phase: action.overlay };
    }

    case "close_overlay":
      if (s.phase !== "tutor" && s.phase !== "make_it_stick") return s;
      return { ...s, phase: s.overlayReturn ?? "card", overlayReturn: null };

    case "rate": {
      // Quick Revision recall cards (summary) are self-rated Again / Hard / Good / Easy (R18).
      const card = currentCard(s);
      if (!s.plan?.rapid || !card || card.card?.type !== "summary" || s.phase !== "card") return s;
      const ref = cardRef(card);
      const ratings = [...s.ratings.filter((r) => r.cardRef !== ref), { cardRef: ref, rating: action.rating }];
      const reviewQueue =
        action.rating === 1 && !s.reviewQueue.some((r) => r.cardRef === ref)
          ? [...s.reviewQueue, { cardRef: ref, questionId: null, concepts: card.concepts, reason: "rated_again" as const }]
          : s.reviewQueue;
      return { ...s, ratings, reviewQueue };
    }

    case "confidence":
      if (s.phase !== "confidence") return s;
      return complete({ ...s, topicConfidence: action.value }, now);

    case "exit":
      return { ...s, phase: "exited" };
  }
}

/** Wrong for good (second wrong, one-try modes) or "I don't know yet": the worked solution. */
function missed(
  s: LessonState,
  card: PlanCard,
  result: CheckResult | null,
  events: TimedEvent[],
  attempts: number,
  confidence: Confidence | null,
  dontKnow: boolean,
): LessonState {
  const plan = s.plan!;
  const ref = cardRef(card);
  // Checks never mark anything as failed, so they queue nothing (learn §2.6).
  const queue =
    plan.mode !== "quick_check" && !s.reviewQueue.some((r) => r.cardRef === ref)
      ? [
          ...s.reviewQueue,
          { cardRef: ref, questionId: card.question!.id, concepts: card.concepts, reason: dontKnow ? ("dont_know" as const) : ("wrong_twice" as const) },
        ]
      : s.reviewQueue;
  const ratings = plan.rapid ? [...s.ratings, { cardRef: ref, rating: 1 as Rating }] : s.ratings;
  return {
    ...s,
    events,
    streak: 0,
    xp: s.xp + s.config.xp.attempt,
    lastResult: result,
    hint: null,
    phase: "explain",
    reviewQueue: queue,
    ratings,
    outcomes: withOutcome(s, card, { correct: false, attempts, firstTry: false, dontKnow, confidence }),
  };
}

/** Where to resume: the last card reached, and whether to show the LES-06 sheet (learn §7.7). */
export function resumePoint(
  saved: { lastCardIndex: number; bundleVersion: string; savedAt: number } | null,
  current: { bundleVersion: string; cardCount: number; now: number },
  config: LessonConfig,
): { index: number; showSheet: boolean; bundleChanged: boolean } {
  if (!saved) return { index: 0, showSheet: false, bundleChanged: false };
  const bundleChanged = saved.bundleVersion !== current.bundleVersion;
  const days = (current.now - saved.savedAt) / 86_400_000;
  const stale = config.resumeRestartDays !== null && days > config.resumeRestartDays;
  return {
    index: Math.min(Math.max(saved.lastCardIndex, 0), Math.max(current.cardCount - 1, 0)),
    showSheet: bundleChanged || stale,
    bundleChanged,
  };
}
