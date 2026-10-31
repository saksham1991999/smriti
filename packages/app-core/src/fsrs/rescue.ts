import type { SyncEventPayloads } from '../sync/types';
import type { PlantHealth } from '../rules/plant';
import type { SrsCardRow } from '../storage/types';
import { toMs, type Instant } from '../time';
import type { SrsScheduler } from './scheduler';

/**
 * The 2-minute rescue (memory-labs §5.13, A25, A26): a few cards on a tired evening that keep
 * the plant from drooping, without pretending the streak day is done.
 */

export interface RescueOfferInput {
  todayQualified: boolean;
  /** The HOME-01 streak card is in its at-risk (thirsty) state. */
  plantThirsty: boolean;
  plantHealth: PlantHealth;
  comebackActive: boolean;
  littleLearner: boolean;
  /** Any schedule card exists (due or not). */
  hasCards: boolean;
}

/**
 * Offered when today isn't a streak day yet and the plant is thirsty, droopy, dry or wilted.
 * Not when it is resting (the revival quest takes over), during a comeback plan, or for little
 * learners (their normal session is already 5 cards).
 */
export function shouldOfferRescue(i: RescueOfferInput): boolean {
  if (i.todayQualified || i.comebackActive || i.littleLearner || !i.hasCards) return false;
  if (i.plantHealth === 'dormant') return false;
  return i.plantThirsty || i.plantHealth === 'droopy' || i.plantHealth === 'dry' || i.plantHealth === 'wilted';
}

/**
 * The rescue set: `memory.rescue_cards` (5) cards. Due cards first, lowest retrievability first;
 * if fewer are due, the cards closest to being due fill the gap.
 */
export function buildRescueSet(cards: readonly SrsCardRow[], now: Instant, scheduler: SrsScheduler, size = 5): SrsCardRow[] {
  const t = toMs(now);
  const live = cards.filter((c) => !c.suspended && c.state !== 0);
  const due = live
    .filter((c) => toMs(c.due_at) <= t)
    .map((c) => ({ c, r: scheduler.retrievability(c, now) }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.c);
  if (due.length >= size) return due.slice(0, size);
  const soon = live.filter((c) => toMs(c.due_at) > t).sort((a, b) => toMs(a.due_at) - toMs(b.due_at));
  return [...due, ...soon].slice(0, size);
}

/** MEM-32 end-screen line: how many reviews are left before today becomes a streak day. */
export function rescueOutcome(reviewsToday: number, reviewsToQualify: number, freezeWillCover: boolean) {
  const left = Math.max(0, reviewsToQualify - reviewsToday);
  return { streakKept: left === 0, reviewsLeft: left, freezeWillCover: left > 0 && freezeWillCover };
}

/** The `rescue_completed` payload (sync contract v1.1). */
export function rescueCompletedPayload(cards: number, msTotal: number): SyncEventPayloads['rescue_completed'] {
  return { cards: Math.max(0, Math.floor(cards)), ms_total: Math.max(0, Math.round(msTotal)) };
}
