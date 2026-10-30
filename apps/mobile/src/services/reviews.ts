import {
  buildComebackPlan,
  buildDailyQueue,
  buildRescueSet,
  comebackChunkFor,
  comebackStartedPayload,
  localDate,
  memoryConfigFromFlags,
  parseCardRef,
  rescueCompletedPayload,
  secondsPerCard,
  sessionSlice,
  shouldOfferComeback,
  SrsScheduler,
  type ComebackPlan,
  type DailyQueue,
  type IntervalPreview,
  type MemoryConfig,
  type ReviewRating,
  type SrsCardRow,
} from '@smriti/app-core';
import type { AnyQuestion } from '@smriti/lesson-core';

import type { SmritiApp } from './app';
import { deviceQuestion } from './drill';
import type { Confidence } from './mocks';

/**
 * Reviews (MEM-01 to MEM-04) on the device: the schedule is `srs_cards`, which `/v1/sync/state`
 * fills, and FSRS runs here (app-core's scheduler, the server's parameters). A rating updates the
 * card and writes `review_rated` with the new FSRS state in one transaction, so it works offline
 * and the server can check it. The rescue (R23) and the comeback plan (R22) come from app-core.
 */

export interface CardFace {
  kind: 'content' | 'user' | 'question';
  front: string;
  back: string;
  topicId: string | null;
  question: AnyQuestion | null;
}

const STATS_KEY = (day: string) => `review-stats:${day}`;
const HISTORY_KEY = 'review-history';
const PLAN_KEY = 'comeback-plan';
const DAY = 86_400_000;

interface DayStats {
  reviewed: number;
  introduced: number;
  durations: number[];
}

function text(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'text' in v && typeof (v as { text: unknown }).text === 'string') return (v as { text: string }).text;
  return '';
}

/** Topic id from a content card id (`{topic}:dd:01`) or a question id (`q.{topic}.0001`). */
export function topicOfRef(kind: 'content' | 'question', id: string): string | null {
  if (kind === 'content') return id.split(':')[0] ?? null;
  const m = /^q\.(.+)\.[^.]+$/.exec(id);
  return m ? m[1]! : null;
}

/** What a card shows, from the bundles and the decks on this device; null when it isn't here. */
export async function cardFace(app: SmritiApp, row: SrsCardRow): Promise<CardFace | null> {
  const ref = parseCardRef(row.card_ref);
  if (!ref) return null;
  const locale = app.ui.getState().locale;
  const exam = app.examProfileId();
  if (ref.kind === 'user') {
    const c = await app.deps.stores.storage.cards.get(ref.id);
    return c && !c.deleted_at ? { kind: 'user', front: text(c.front), back: text(c.back), topicId: null, question: null } : null;
  }
  if (ref.kind === 'question') {
    const topicId = row.topic_id ?? topicOfRef('question', ref.id);
    const q = deviceQuestion(app, topicId, ref.id);
    if (!q) return null;
    const sol = (q as unknown as { solution?: { feynman?: unknown } }).solution;
    return { kind: 'question', front: text((q as unknown as { stem?: unknown }).stem), back: text(sol?.feynman), topicId, question: q };
  }
  const topicId = row.topic_id ?? topicOfRef('content', ref.id);
  if (!topicId) return null;
  for (const mode of ['deep_dive', 'quick_revision'] as const) {
    const b = app.deps.content.load(locale, topicId, mode, exam);
    const card = b?.bundle.cards.find((c) => (c as { id?: string }).id === ref.id) as Record<string, unknown> | undefined;
    if (card) {
      const front = text(card.title) || text(card.front) || text(card.prompt) || text(card.hook);
      const back = text(card.body) || text(card.back) || text(card.summary) || text(card.text);
      if (front || back) return { kind: 'content', front: front || back, back: front ? back : '', topicId, question: null };
    }
  }
  return null;
}

export class Reviews {
  readonly config: MemoryConfig;
  readonly scheduler: SrsScheduler;

  constructor(private readonly app: SmritiApp) {
    this.config = memoryConfigFromFlags(app.flags);
    this.scheduler = new SrsScheduler({ ...this.config.scheduler });
  }

  private today(): string {
    return localDate(this.app.now(), this.app.deps.timeZone());
  }

  async stats(day = this.today()): Promise<DayStats> {
    try {
      const raw = await this.app.deps.stores.kv.get(STATS_KEY(day));
      return raw ? (JSON.parse(raw) as DayStats) : { reviewed: 0, introduced: 0, durations: [] };
    } catch {
      return { reviewed: 0, introduced: 0, durations: [] };
    }
  }

  async cards(): Promise<SrsCardRow[]> {
    return this.app.deps.stores.storage.srs_cards.all();
  }

  /** Today's queue (MEM-01): due by the end of today, new up to the daily limit, capped. */
  async queue(): Promise<DailyQueue & { plan: ComebackPlan | null }> {
    const s = await this.stats();
    const plan = await this.plan();
    const cards = await this.cards();
    const q = buildDailyQueue({
      cards,
      now: this.app.now(),
      timeZone: this.app.deps.timeZone(),
      scheduler: this.scheduler,
      reviewedToday: s.reviewed,
      newIntroducedToday: s.introduced,
      comebackActive: plan !== null,
      config: this.config.queue,
    });
    if (plan) {
      const chunk = comebackChunkFor(plan, this.today());
      const refs = new Set(chunk?.cardRefs ?? []);
      return { ...q, cards: cards.filter((c) => refs.has(c.card_ref)), plan };
    }
    return { ...q, plan: null };
  }

  /** One session's cards: the queue sliced to `memory.session_size`. */
  async session(kind: 'normal' | 'rescue'): Promise<SrsCardRow[]> {
    if (kind === 'rescue') return buildRescueSet(await this.cards(), this.app.now(), this.scheduler, this.config.rescueCards);
    return sessionSlice((await this.queue()).cards, this.config.sessionSize);
  }

  preview(row: SrsCardRow): IntervalPreview[] {
    return this.scheduler.preview(row, this.app.now());
  }

  /** Rates a card: the new schedule and `review_rated` are written together. */
  async rate(row: SrsCardRow, rating: ReviewRating, confidence: Confidence | null, msToAnswer: number): Promise<SrsCardRow> {
    const now = this.app.now();
    const res = this.scheduler.schedule(row, rating, now);
    const today = this.today();
    const next: SrsCardRow = { ...res.card, introduced_on: row.introduced_on ?? (row.state === 0 ? today : null) };
    await this.app.record('review_rated', { card_ref: row.card_ref, rating, confidence, ms_to_answer: Math.max(0, Math.round(msToAnswer)), fsrs_state: res.fsrsState }, async (tx) => {
      await tx.srs_cards.put(next);
    });
    const s = await this.stats(today);
    const updated: DayStats = { reviewed: s.reviewed + 1, introduced: s.introduced + (row.state === 0 ? 1 : 0), durations: [...s.durations.slice(-49), Math.round(msToAnswer)] };
    await this.app.deps.stores.kv.set(STATS_KEY(today), JSON.stringify(updated));
    await this.bumpHistory(today, updated.reviewed);
    return next;
  }

  async finishRescue(cards: number, msTotal: number): Promise<void> {
    await this.app.record('rescue_completed', rescueCompletedPayload(cards, msTotal));
  }

  // ── Comeback plan (MEM-02) ───────────────────────────────────────────────

  private async bumpHistory(day: string, reviewed: number) {
    const h = await this.history();
    h[day] = reviewed;
    const keep = Object.keys(h).sort().slice(-30);
    await this.app.deps.stores.kv.set(HISTORY_KEY, JSON.stringify(Object.fromEntries(keep.map((k) => [k, h[k]]))));
  }

  private async history(): Promise<Record<string, number>> {
    try {
      return JSON.parse((await this.app.deps.stores.kv.get(HISTORY_KEY)) ?? '{}') as Record<string, number>;
    } catch {
      return {};
    }
  }

  async plan(): Promise<ComebackPlan | null> {
    try {
      const raw = await this.app.deps.stores.kv.get(PLAN_KEY);
      const p = raw ? (JSON.parse(raw) as ComebackPlan) : null;
      if (!p) return null;
      const last = p.chunks[p.chunks.length - 1]?.day;
      return last && last >= this.today() ? p : null;
    } catch {
      return null;
    }
  }

  /** The comeback offer: the backlog is well over the student's usual day (R22). */
  async comebackOffer(): Promise<{ plan: ComebackPlan; daysAway: number } | null> {
    if (await this.plan()) return null;
    const q = await this.queue();
    const h = await this.history();
    const active = Object.values(h).filter((n) => n > 0).slice(-14);
    if (!shouldOfferComeback(q.dueTotal, active, this.config.comeback)) return null;
    const lastDay = Object.keys(h).sort().pop();
    const daysAway = lastDay ? Math.max(0, Math.round((this.app.now() - Date.parse(`${lastDay}T00:00:00Z`)) / DAY)) : 0;
    return { plan: await this.buildPlan(), daysAway };
  }

  async buildPlan(chosenDays?: number): Promise<ComebackPlan> {
    const now = this.app.now();
    const all = await this.cards();
    const backlog = all.filter((c) => !c.suspended && Date.parse(c.due_at) <= now);
    const s = await this.stats();
    return buildComebackPlan({
      backlog,
      now,
      today: this.today(),
      scheduler: this.scheduler,
      goalMinutes: this.app.store.getState().profile?.daily_goal_minutes ?? this.app.ui.getState().onboarding.dailyGoalMinutes ?? 10,
      secondsPerCard: secondsPerCard(s.durations, this.config.comeback),
      isCore: () => false,
      ...(chosenDays ? { chosenDays } : {}),
      longBreak: false,
      config: this.config.comeback,
    });
  }

  async startPlan(plan: ComebackPlan, daysAway: number): Promise<void> {
    await this.app.deps.stores.kv.set(PLAN_KEY, JSON.stringify(plan));
    await this.app.record('comeback_plan_started', comebackStartedPayload(plan, daysAway));
  }

  async endPlan(): Promise<void> {
    await this.app.deps.stores.kv.delete(PLAN_KEY);
  }
}

/** A minutes estimate for "{n} cards today · {m} min", from this device's own pace. */
export async function estimateMinutes(r: Reviews, cards: number): Promise<number> {
  const s = await r.stats();
  return Math.max(1, Math.round((cards * secondsPerCard(s.durations, r.config.comeback)) / 60));
}
