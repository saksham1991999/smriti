import type { CardsIndexRow, SrsCardRow } from '../storage/types';
import { addDays, endOfLocalDay, localDate, toIso, toMs, type Instant, type LocalDate } from '../time';
import type { SrsScheduler } from './scheduler';
import type { CardsQueuedSource, SyncEventPayloads } from '../sync/types';

/**
 * Today's review queue (memory-labs §5.1), built on the device from `srs_cards`, offline:
 * 1. due by the end of today (profile timezone), not suspended, not buried;
 * 2. cards whose bundle isn't on the device and can't be fetched now are counted as "needs internet";
 * 3. the backlog rule may switch to the comeback plan (R22; see comeback.ts);
 * 4. new cards up to `memory.new_cards_per_day` minus those already introduced today
 *    (none while a comeback plan is active);
 * 5. order: learning/relearning first, then reviews by lowest retrievability, then new; then
 *    interleave topics; siblings never on the same day (the later one is buried until tomorrow);
 * 6. capped at `memory.daily_review_cap` minus today's reviews; the rest rolls over.
 */

export interface QueueConfig {
  newCardsPerDay: number;
  dailyReviewCap: number;
}

export interface QueueInput {
  cards: readonly SrsCardRow[];
  now: Instant;
  timeZone: string;
  scheduler: SrsScheduler;
  /** False when the card's bundle isn't on the device and can't be fetched now. */
  isAvailable?: (card: SrsCardRow) => boolean;
  /** Reviews already rated today (count against the daily cap). */
  reviewedToday: number;
  /** New cards already introduced today. */
  newIntroducedToday: number;
  comebackActive?: boolean;
  config: QueueConfig;
}

export interface DailyQueue {
  /** Cards for today, in order; Home shows `cards.length` (the capped count, R22). */
  cards: SrsCardRow[];
  /** Every due card, before the cap (for the backlog rule; never shown on Home). */
  dueTotal: number;
  needsInternet: number;
  newCards: number;
  rolledOver: number;
  /** Card refs to bury until tomorrow (siblings of cards in today's queue). */
  buryUntilTomorrow: string[];
  tomorrow: LocalDate;
}

const isNew = (c: SrsCardRow) => c.state === 0;
const isShortStep = (c: SrsCardRow) => c.state === 1 || c.state === 3;

export function buildDailyQueue(input: QueueInput): DailyQueue {
  const today = localDate(input.now, input.timeZone);
  const tomorrow = addDays(today, 1);
  const endOfToday = endOfLocalDay(today, input.timeZone);
  const available = input.isAvailable ?? (() => true);

  const live = input.cards.filter((c) => !c.suspended && !(c.buried_until && c.buried_until > today));
  const reviewedTodaySiblings = new Set(
    input.cards
      .filter((c) => c.sibling_key && c.last_review_at && localDate(c.last_review_at, input.timeZone) === today)
      .map((c) => c.sibling_key as string),
  );

  const due = live.filter((c) => !isNew(c) && toMs(c.due_at) < endOfToday);
  let needsInternet = 0;
  const dueAvailable = due.filter((c) => {
    if (available(c)) return true;
    needsInternet += 1;
    return false;
  });

  const newSlots = input.comebackActive ? 0 : Math.max(0, input.config.newCardsPerDay - input.newIntroducedToday);
  const newCards = live.filter((c) => isNew(c) && available(c)).slice(0, newSlots);

  const r = (c: SrsCardRow) => input.scheduler.retrievability(c, input.now);
  const ordered = [
    ...dueAvailable.filter(isShortStep).sort((a, b) => toMs(a.due_at) - toMs(b.due_at)),
    ...dueAvailable
      .filter((c) => c.state === 2)
      .map((c) => ({ c, r: r(c) }))
      .sort((a, b) => a.r - b.r || toMs(a.c.due_at) - toMs(b.c.due_at))
      .map((x) => x.c),
    ...newCards,
  ];

  // Siblings: keep the first by priority, bury the rest; none if one was already reviewed today.
  const seen = new Set(reviewedTodaySiblings);
  const bury: string[] = [];
  const unique = ordered.filter((c) => {
    if (!c.sibling_key) return true;
    if (seen.has(c.sibling_key)) {
      bury.push(c.card_ref);
      return false;
    }
    seen.add(c.sibling_key);
    return true;
  });

  const room = Math.max(0, input.config.dailyReviewCap - input.reviewedToday);
  const capped = unique.slice(0, room);
  return {
    cards: interleaveTopics(capped),
    dueTotal: due.length,
    needsInternet,
    newCards: capped.filter(isNew).length,
    rolledOver: Math.max(0, unique.length - capped.length),
    buryUntilTomorrow: bury,
    tomorrow,
  };
}

/** Reorders so no two cards of the same topic are adjacent when the mix allows it; stable otherwise. */
export function interleaveTopics<T extends { topic_id?: string | null }>(cards: readonly T[]): T[] {
  const rest = [...cards];
  const out: T[] = [];
  let lastTopic: string | null | undefined;
  while (rest.length > 0) {
    let idx = rest.findIndex((c) => !c.topic_id || c.topic_id !== lastTopic);
    if (idx < 0) idx = 0;
    const [picked] = rest.splice(idx, 1);
    if (!picked) break;
    out.push(picked);
    lastTopic = picked.topic_id;
  }
  return out;
}

/** One session (`memory.session_size`: 10, 20, 40 or all). */
export function sessionSlice<T>(queue: readonly T[], sessionSize: number | 'all'): T[] {
  return sessionSize === 'all' ? [...queue] : queue.slice(0, sessionSize);
}

/** Quick review (widgets): up to 5 due cards, lowest retrievability first (memory-labs §5.4). */
export function quickReviewSet(queue: readonly SrsCardRow[], scheduler: SrsScheduler, now: Instant, size = 5): SrsCardRow[] {
  return [...queue]
    .filter((c) => !isNew(c))
    .sort((a, b) => scheduler.retrievability(a, now) - scheduler.retrievability(b, now))
    .slice(0, size);
}

export interface QueueForConceptsInput {
  conceptIds: readonly string[];
  /** Where the request came from (memory-labs §5.14); mapped to the wire `source`. */
  source: QueueRequestSource;
  cards: readonly SrsCardRow[];
  index: readonly CardsIndexRow[];
  now: Instant;
  timeZone: string;
  scheduler: SrsScheduler;
  /** The student's target retention (0.9 standard). */
  targetRetention: number;
  /** `memory.queue_from_practice_max`. */
  maxNew: number;
  /** Cards already in today's queue (to respect `memory.daily_review_cap`). */
  todayQueued: number;
  dailyReviewCap: number;
}

export interface QueueForConceptsResult {
  /** New schedule rows for system cards of these concepts the student had not started. */
  started: SrsCardRow[];
  /** Existing rows moved into today's queue (or tomorrow when today is full). */
  pulledForward: SrsCardRow[];
  /** The `cards_queued` event payload (ids only, sync contract v1.1). */
  event: SyncEventPayloads['cards_queued'];
}

export type QueueRequestSource = 'mock_report' | 'practice_summary' | 'solution' | 'lesson' | 'comeback';

/** UI origin to the wire `cards_queued.source`: everything from practice and mocks is `practice`. */
export function cardsQueuedSource(source: QueueRequestSource): CardsQueuedSource {
  return source === 'lesson' || source === 'comeback' ? source : 'practice';
}

/**
 * `queueCardsForConcepts()` (memory-labs §5.14): "Fix next" and "add cards to reviews".
 * Starts unstarted system cards (outside the new-card cap, up to `maxNew`), pulls started cards
 * whose recall is below target into today, leaves due and suspended cards alone, and respects
 * the daily cap (overflow goes to tomorrow). Idempotent: a card already due today is unchanged.
 */
export function queueCardsForConcepts(input: QueueForConceptsInput): QueueForConceptsResult {
  const concepts = new Set(input.conceptIds);
  const today = localDate(input.now, input.timeZone);
  const endOfToday = endOfLocalDay(today, input.timeZone);
  const startOfTomorrowIso = toIso(endOfToday);
  const nowIso = toIso(input.now);
  const byRef = new Map(input.cards.map((c) => [c.card_ref, c]));
  let room = Math.max(0, input.dailyReviewCap - input.todayQueued);
  const dueAt = () => (room-- > 0 ? nowIso : startOfTomorrowIso);

  const started: SrsCardRow[] = [];
  for (const ix of input.index) {
    if (started.length >= input.maxNew) break;
    const ref = `c:${ix.card_id}`;
    if (byRef.has(ref) || !ix.concept_ids.some((c) => concepts.has(c))) continue;
    started.push(
      input.scheduler.newCard(ref, input.now, {
        due_at: dueAt(),
        topic_id: ix.topic_id,
        concept_ids: ix.concept_ids,
        sibling_key: ix.sibling_key ?? null,
        introduced_on: today,
      }),
    );
  }

  const pulledForward: SrsCardRow[] = [];
  for (const c of input.cards) {
    if (c.suspended || c.state === 0) continue;
    if (!(c.concept_ids ?? []).some((x) => concepts.has(x))) continue;
    if (toMs(c.due_at) < endOfToday) continue; // already due today
    if (input.scheduler.retrievability(c, input.now) >= input.targetRetention) continue;
    pulledForward.push({ ...c, due_at: dueAt(), updated_at: nowIso });
  }

  return {
    started,
    pulledForward,
    event: { concept_ids: [...concepts], source: cardsQueuedSource(input.source) },
  };
}
