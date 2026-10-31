import type { LocalDate } from '../time';

/**
 * Today's plan (HOME-02). Online, `GET /v1/plan/today` (from `learn.daily_plans`) wins; offline,
 * app-core builds a local plan with the same item kinds and order: reviews, new topic, drill, mock
 * (learn flow §8). The plan fits the daily goal (minutes); the daily challenge rides along.
 */

export type PlanItemKind = 'review' | 'learn' | 'revise' | 'drill' | 'mock' | 'daily_challenge';

export interface PlanItem {
  id: string;
  kind: PlanItemKind;
  minutes: number;
  /** `topic_id`, concept ids, mock id or card count, depending on kind. */
  ref: { topicId?: string; conceptIds?: string[]; mockId?: string; cards?: number; mode?: 'deep_dive' | 'quick_revision' };
  /** Screen the item opens (learn flow §8 routes). */
  route: 'MEM-02' | 'MEM-03' | 'LES-01' | 'LRN-07' | 'PRC-03' | 'MOCK-02' | 'PRC-11';
}

export interface Plan {
  day: LocalDate;
  goalMinutes: number;
  items: PlanItem[];
  totalMinutes: number;
  source: 'server' | 'local';
}

export interface LocalPlanInput {
  day: LocalDate;
  goalMinutes: number;
  /** Today's capped review count, or the comeback chunk. */
  reviewsDue: number;
  comebackActive: boolean;
  secondsPerCard: number;
  newTopic: { topicId: string; minutes: number; mode: 'deep_dive' | 'quick_revision' } | null;
  drill: { conceptIds: string[]; minutes: number } | null;
  mock: { mockId: string; minutes: number } | null;
  dailyChallengeOpen: boolean;
}

export function buildLocalPlan(input: LocalPlanInput): Plan {
  const items: PlanItem[] = [];
  let used = 0;
  if (input.reviewsDue > 0) {
    const minutes = Math.max(1, Math.ceil((input.reviewsDue * input.secondsPerCard) / 60));
    items.push({
      id: 'review',
      kind: 'review',
      minutes,
      ref: { cards: input.reviewsDue },
      route: input.comebackActive ? 'MEM-02' : 'MEM-03',
    });
    used += minutes;
  }
  if (input.newTopic && (used < input.goalMinutes || items.length === 0)) {
    const kind: PlanItemKind = input.newTopic.mode === 'quick_revision' ? 'revise' : 'learn';
    items.push({
      id: `${kind}:${input.newTopic.topicId}`,
      kind,
      minutes: input.newTopic.minutes,
      ref: { topicId: input.newTopic.topicId, mode: input.newTopic.mode },
      route: kind === 'revise' ? 'LRN-07' : 'LES-01',
    });
    used += input.newTopic.minutes;
  }
  if (input.drill && used + input.drill.minutes <= input.goalMinutes) {
    items.push({ id: 'drill', kind: 'drill', minutes: input.drill.minutes, ref: { conceptIds: input.drill.conceptIds }, route: 'PRC-03' });
    used += input.drill.minutes;
  }
  if (input.mock && used + input.mock.minutes <= input.goalMinutes) {
    items.push({ id: `mock:${input.mock.mockId}`, kind: 'mock', minutes: input.mock.minutes, ref: { mockId: input.mock.mockId }, route: 'MOCK-02' });
    used += input.mock.minutes;
  }
  if (input.dailyChallengeOpen) {
    items.push({ id: 'daily_challenge', kind: 'daily_challenge', minutes: 1, ref: {}, route: 'PRC-11' });
    used += 1;
  }
  return { day: input.day, goalMinutes: input.goalMinutes, items, totalMinutes: used, source: 'local' };
}

/** The first unfinished item: what the hero card follows. */
export function firstOpenItem(plan: Plan, doneIds: ReadonlySet<string>): PlanItem | null {
  return plan.items.find((i) => !doneIds.has(i.id)) ?? null;
}

export function planDone(plan: Plan, doneIds: ReadonlySet<string>): boolean {
  return plan.items.length > 0 && plan.items.every((i) => doneIds.has(i.id));
}

/** The daily goal ring (minutes): separate from the streak (R1). */
export function goalProgress(minutesToday: number, goalMinutes: number): { fraction: number; met: boolean } {
  const fraction = goalMinutes <= 0 ? 1 : Math.min(1, minutesToday / goalMinutes);
  return { fraction, met: fraction >= 1 };
}
