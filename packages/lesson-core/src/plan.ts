/**
 * Card plans: which cards a lesson shows, in what order, by mode and the exam's depth
 * (learn §7.1, §7.2). Bundles hold every depth; the plan hides cards deeper than the exam needs
 * and cuts the Deep Dive into bites.
 */
import type { BundleCard, BundleQuestion, TypedBundle } from "@smriti/content-schema";
import { ONLINE_ONLY_CARD_TYPES } from "@smriti/content-schema";

import type { AnyQuestion } from "./answers.js";
import type { LessonConfig } from "./config.js";

/**
 * `little`: a Deep Dive bite in the little learner player (class 1–5, LES-01/LES-02 "little
 * learner"): no combos, no confidence step, gentle hints and the guided finish (playerRules).
 */
export type PlayerMode = "deep_dive" | "quick_revision" | "onboarding" | "quick_check" | "fix_mistakes" | "little";

export interface PlanCard {
  /** Unique within the plan: the card id, `{card}#{child}` for paragraph children, `q:{id}` for checks. */
  key: string;
  /** The content card id, or null for check and fix rounds built from questions. */
  cardId: string | null;
  card: BundleCard | null;
  question: AnyQuestion | null;
  /** The shared passage, for paragraph children. */
  passage: string | null;
  topicId: string;
  chapterId: string | null;
  biteId: string | null;
  depth: number;
  concepts: string[];
  /** Needs the network (video, role play): skipping is never a miss. */
  onlineOnly: boolean;
}

export interface LessonPlan {
  mode: PlayerMode;
  /** The topic for events (for a chapter check, the scope id the host chose). */
  topicId: string;
  /** The bundle hash, sent as bundle_version. */
  bundleVersion: string;
  locale: string;
  cards: PlanCard[];
  biteId: string | null;
  biteIndex: number;
  biteCount: number;
  /** Cards that may be shown before LES-09 "Preview finished", or null for no limit. */
  previewLimit: number | null;
  /** Hints on a first wrong try (not in checks). */
  hints: boolean;
  attemptsAllowed: 1 | 2;
  combos: boolean;
  /** Quick Revision: summary cards are self-rated, questions rated by result. */
  rapid: boolean;
  /** lesson_started and lesson_completed (not for Fix mistakes). */
  lessonEvents: boolean;
  /** Questions available as siblings for Fix mistakes. */
  questionPool: Record<string, BundleQuestion>;
}

/** Is a card within the exam's depth? Without an exam map, the bundle's own range decides. */
export function cardVisible(card: { depth: number; concepts: string[] }, examDepth: Record<string, number> | null): boolean {
  if (!examDepth) return true;
  const depths = card.concepts.map((c) => examDepth[c]).filter((d): d is number => d !== undefined);
  if (depths.length === 0) return false;
  return card.depth <= Math.max(...depths);
}

export interface Bite {
  id: string;
  title: string;
  cardIds: string[];
  estimatedMinutes: number;
}

/** The bundle's bites with hidden cards removed; empty bites are dropped. */
export function visibleBites(bundle: TypedBundle, examDepth: Record<string, number> | null): Bite[] {
  const visible = new Set(bundle.cards.filter((c) => cardVisible(c, examDepth)).map((c) => c.id));
  const bites: Bite[] = bundle.bites.length
    ? bundle.bites.map((b) => ({ id: b.id, title: b.title, cardIds: b.card_ids, estimatedMinutes: b.estimated_minutes }))
    : [{ id: "all", title: bundle.topic.name, cardIds: bundle.cards.map((c) => c.id), estimatedMinutes: bundle.estimated_minutes ?? 0 }];
  return bites
    .map((b) => ({ ...b, cardIds: b.cardIds.filter((id) => visible.has(id)) }))
    .filter((b) => b.cardIds.length > 0);
}

function expandCard(bundle: TypedBundle, card: BundleCard, biteId: string | null): PlanCard[] {
  const base = {
    cardId: card.id,
    card,
    topicId: bundle.topic.id,
    chapterId: bundle.topic.chapter,
    biteId,
    depth: card.depth,
    concepts: card.concepts,
    onlineOnly: ONLINE_ONLY_CARD_TYPES.includes(card.type),
  };
  if (card.type !== "question") return [{ ...base, key: card.id, question: null, passage: null }];
  const q = bundle.questions[card.question];
  if (!q) throw new Error(`bundle ${bundle.id} has no question ${card.question}`);
  if (q.type === "paragraph") {
    return q.children.map((child) => ({
      ...base,
      key: `${card.id}#${child.id}`,
      question: child,
      passage: q.passage,
      concepts: child.concepts.map((c) => c.id),
    }));
  }
  return [{ ...base, key: card.id, question: q, passage: null }];
}

export interface LessonPlanOptions {
  mode: "deep_dive" | "quick_revision" | "onboarding" | "little";
  bundleVersion: string;
  /** concept id -> exam depth, from the manifest; null shows every card. */
  examDepth: Record<string, number> | null;
  /** The bite to play (Deep Dive and onboarding); default: the first, or by level for onboarding. */
  biteId?: string;
  /** A Pro-locked Deep Dive: only the first `previewCards` cards of the whole lesson. */
  previewLimited?: boolean;
  /** Onboarding: the self-rated level from ONB-07. */
  level?: "new" | "basics" | "revising";
  config: LessonConfig;
}

export function planLesson(bundle: TypedBundle, opts: LessonPlanOptions): LessonPlan {
  const byId = new Map(bundle.cards.map((c) => [c.id, c]));
  const bites = visibleBites(bundle, opts.examDepth);
  const common = {
    topicId: bundle.topic.id,
    bundleVersion: opts.bundleVersion,
    locale: bundle.locale,
    hints: true,
    attemptsAllowed: 2 as const,
    combos: opts.mode !== "little",
    lessonEvents: true,
    questionPool: bundle.questions,
  };
  if (opts.mode === "quick_revision") {
    const cards = bites.flatMap((b) => b.cardIds).flatMap((id) => expandCard(bundle, byId.get(id)!, null));
    return { ...common, mode: "quick_revision", cards, biteId: null, biteIndex: 0, biteCount: 1, previewLimit: null, rapid: true };
  }
  let index = 0;
  if (opts.biteId) {
    index = bites.findIndex((b) => b.id === opts.biteId);
    if (index < 0) throw new Error(`bite ${opts.biteId} is not in ${bundle.id} at this depth`);
  } else if (opts.mode === "onboarding" && opts.level && opts.level !== "new") {
    // Start at the first bite that is not all L1 (learn §7.1, onboarding contract).
    const later = bites.findIndex((b) => b.cardIds.some((id) => (byId.get(id)?.depth ?? 1) > 1));
    index = later < 0 ? 0 : later;
  }
  const bite = bites[index];
  if (!bite) throw new Error(`${bundle.id} has no cards at this depth`);
  const cards = bite.cardIds.flatMap((id) => expandCard(bundle, byId.get(id)!, bite.id));
  let previewLimit: number | null = null;
  if ((opts.mode === "deep_dive" || opts.mode === "little") && opts.previewLimited) {
    const before = bites.slice(0, index).reduce((n, b) => n + b.cardIds.length, 0);
    previewLimit = Math.max(0, opts.config.previewCards - before);
  }
  return {
    ...common,
    mode: opts.mode,
    cards,
    biteId: bite.id,
    biteIndex: index,
    biteCount: bites.length,
    previewLimit,
    rapid: false,
  };
}

/** The next bite to play after the completed ones, or null when the Deep Dive is done. */
export function nextBite(bundle: TypedBundle, examDepth: Record<string, number> | null, completed: Iterable<string>): Bite | null {
  const done = new Set(completed);
  return visibleBites(bundle, examDepth).find((b) => !done.has(b.id)) ?? null;
}

export interface CheckQuestion {
  question: BundleQuestion;
  topicId: string;
  chapterId: string;
}

/**
 * A check (LES-12): Find my level or Test out. Question cards only, one try, no hints, the
 * explanation after each answer, no combos.
 */
export function planCheck(
  questions: CheckQuestion[],
  opts: { scopeId: string; bundleVersion: string; locale: string },
): LessonPlan {
  const cards: PlanCard[] = questions.flatMap(({ question, topicId, chapterId }): PlanCard[] => {
    const base = { cardId: null, card: null, topicId, chapterId, biteId: null, onlineOnly: false };
    if (question.type === "paragraph") {
      return question.children.map((child) => ({
        ...base,
        key: `q:${child.id}`,
        question: child,
        passage: question.passage,
        depth: child.depth,
        concepts: child.concepts.map((c) => c.id),
      }));
    }
    return [{ ...base, key: `q:${question.id}`, question, passage: null, depth: question.depth, concepts: question.concepts.map((c) => c.id) }];
  });
  return {
    mode: "quick_check",
    topicId: opts.scopeId,
    bundleVersion: opts.bundleVersion,
    locale: opts.locale,
    cards,
    biteId: null,
    biteIndex: 0,
    biteCount: 1,
    previewLimit: null,
    hints: false,
    attemptsAllowed: 1,
    combos: false,
    rapid: false,
    lessonEvents: true,
    questionPool: {},
  };
}

const CHECKABLE_USES = new Set(["lesson", "practice"]);

/**
 * Test out questions (learn §6.4): per topic, up to `perTopic` lesson-check and practice
 * questions from the practice bundles already on the device. Topics without any are left out
 * ("Not in this check").
 */
export function selectTestOut(practiceBundles: TypedBundle[], perTopic: number): CheckQuestion[] {
  return practiceBundles.flatMap((b) =>
    Object.values(b.questions)
      .filter((q) => q.use.some((u) => CHECKABLE_USES.has(u)))
      .sort((x, y) => x.id.localeCompare(y.id))
      .slice(0, perTopic)
      .map((question) => ({ question, topicId: b.topic.id, chapterId: b.topic.chapter })),
  );
}

/**
 * Find my level (learn §6.5): one placement question per early chapter, in syllabus order, at
 * L2-L3 where available. `bundles` are practice bundles in syllabus order.
 */
export function selectPlacement(bundles: TypedBundle[], count: number): CheckQuestion[] {
  const out: CheckQuestion[] = [];
  const chapters = new Set<string>();
  for (const b of bundles) {
    if (out.length >= count) break;
    if (chapters.has(b.topic.chapter)) continue;
    const candidates = Object.values(b.questions)
      .filter((q) => q.use.includes("placement"))
      .sort((x, y) => {
        const fit = (q: BundleQuestion) => (q.depth >= 2 && q.depth <= 3 ? 0 : 1);
        return fit(x) - fit(y) || x.id.localeCompare(y.id);
      });
    const q = candidates[0];
    if (!q) continue;
    chapters.add(b.topic.chapter);
    out.push({ question: q, topicId: b.topic.id, chapterId: b.topic.chapter });
  }
  return out;
}

export interface Missed {
  questionId: string;
  concepts: string[];
  topicId: string;
  chapterId: string | null;
}

/**
 * Fix mistakes (LES-14): the bite's missed questions, each swapped for an unseen sibling on the
 * same concept when the pool has one, up to `learn.fix_mistakes_max`.
 */
export function planFix(
  missed: Missed[],
  pool: Record<string, BundleQuestion>,
  seen: Iterable<string>,
  opts: { topicId: string; bundleVersion: string; locale: string; config: LessonConfig },
): LessonPlan {
  const used = new Set(seen);
  for (const m of missed) used.add(m.questionId);
  const limit = opts.config.fixMistakesMax ?? missed.length;
  const cards: PlanCard[] = [];
  for (const m of missed.slice(0, limit)) {
    const sibling = Object.values(pool)
      .filter((q) => !used.has(q.id) && q.type !== "paragraph" && q.use.some((u) => CHECKABLE_USES.has(u)))
      .filter((q) => q.concepts.some((c) => m.concepts.includes(c.id)))
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    const q = sibling ?? findQuestion(pool, m.questionId);
    if (!q) continue;
    used.add(q.id);
    cards.push({
      key: `q:${q.id}`,
      cardId: null,
      card: null,
      question: q,
      passage: null,
      topicId: m.topicId,
      chapterId: m.chapterId,
      biteId: null,
      depth: q.depth,
      concepts: q.concepts.map((c) => c.id),
      onlineOnly: false,
    });
  }
  return {
    mode: "fix_mistakes",
    topicId: opts.topicId,
    bundleVersion: opts.bundleVersion,
    locale: opts.locale,
    cards,
    biteId: null,
    biteIndex: 0,
    biteCount: 1,
    previewLimit: null,
    hints: true,
    attemptsAllowed: 2,
    combos: false,
    rapid: false,
    lessonEvents: false,
    questionPool: pool,
  };
}

/** A question by id, including paragraph children. */
export function findQuestion(pool: Record<string, BundleQuestion>, id: string): AnyQuestion | undefined {
  const direct = pool[id];
  if (direct) return direct;
  for (const q of Object.values(pool)) {
    if (q.type === "paragraph") {
      const child = q.children.find((c) => c.id === id);
      if (child) return child;
    }
  }
  return undefined;
}
