import type { OutboxRow } from '../storage/types';
import { compareDates, localDate, weekStartMonday, type LocalDate } from '../time';

/**
 * Quests (me-money §3.7). The catalogue is server data (`game.quests`). Daily quests reset at
 * 00:00 local time, weekly quests on Monday 00:00 local, event quests on their own dates.
 * Progress comes from the same events as XP, so offline progress is predicted here and confirmed
 * on sync. Completed rewards left unclaimed are auto-claimed at reset, so nothing is lost.
 */

export type QuestPeriod = 'daily' | 'weekly' | 'event';
export type QuestCounter =
  | 'lessons_completed'
  | 'reviews'
  | 'minutes'
  | 'practice_questions'
  | 'correct_answers'
  | 'mock_sections'
  | 'daily_challenge'
  | 'focus_sessions'
  | 'xp';

export interface Quest {
  id: string;
  period: QuestPeriod;
  spec: { counter: QuestCounter; target: number; filters?: { mode?: string; context?: string } };
  reward: { xp?: number; gems?: number; item_id?: string };
  active_from: LocalDate;
  active_to: LocalDate | null;
}

export interface UserQuest {
  quest_id: string;
  period_start: LocalDate;
  progress: number;
  target: number;
  completed_at: string | null;
  claimed_at: string | null;
}

export function questPeriodStart(quest: Pick<Quest, 'period' | 'active_from'>, today: LocalDate): LocalDate {
  if (quest.period === 'daily') return today;
  if (quest.period === 'weekly') return weekStartMonday(today);
  return quest.active_from;
}

export function isQuestActive(quest: Quest, today: LocalDate): boolean {
  return compareDates(quest.active_from, today) <= 0 && (quest.active_to === null || compareDates(today, quest.active_to) <= 0);
}

type EventLike = Pick<OutboxRow, 'type' | 'occurred_at' | 'payload'>;

/** How much one event adds to a counter. */
export function eventIncrement(quest: Pick<Quest, 'spec'>, e: EventLike): number {
  const f = quest.spec.filters;
  const p = e.payload as unknown as Record<string, unknown>;
  switch (quest.spec.counter) {
    case 'lessons_completed':
      return e.type === 'lesson_completed' && (!f?.mode || p['mode'] === f.mode) ? 1 : 0;
    case 'reviews':
      return e.type === 'review_rated' ? 1 : 0;
    case 'minutes':
      // Whole minutes of finished lessons and practice sessions (reviews carry no session time).
      if (e.type === 'lesson_completed' || e.type === 'practice_session_completed') return Math.floor(Number(p['ms_total'] ?? 0) / 60_000);
      return 0;
    case 'practice_questions':
      return e.type === 'answer_submitted' && (p['context'] === 'practice' || p['context'] === 'chapter_test') ? 1 : 0;
    case 'correct_answers':
      return e.type === 'answer_submitted' && p['correct'] === true && (!f?.context || p['context'] === f.context) ? 1 : 0;
    case 'mock_sections':
      return e.type === 'mock_section_submitted' ? 1 : 0;
    case 'daily_challenge':
      return e.type === 'daily_challenge_completed' ? 1 : 0;
    case 'focus_sessions':
      return e.type === 'focus_session_completed' ? 1 : 0;
    case 'xp':
      return e.type === 'lesson_completed' ? Number(p['xp'] ?? 0) : 0;
  }
}

/**
 * Predicted progress for the current period: the last synced row plus unsent local events that
 * fall in the period (local days in `timeZone`).
 */
export function predictQuest(
  quest: Quest,
  synced: UserQuest | undefined,
  unsent: readonly EventLike[],
  today: LocalDate,
  timeZone: string,
  nowIso: string,
): UserQuest {
  const start = questPeriodStart(quest, today);
  const base: UserQuest =
    synced && synced.period_start === start
      ? { ...synced }
      : { quest_id: quest.id, period_start: start, progress: 0, target: quest.spec.target, completed_at: null, claimed_at: null };
  let progress = base.progress;
  for (const e of unsent) {
    const d = localDate(e.occurred_at, timeZone);
    if (compareDates(d, start) < 0 || compareDates(d, today) > 0) continue;
    progress += eventIncrement(quest, e);
  }
  const capped = Math.min(progress, base.target);
  return {
    ...base,
    progress: capped,
    completed_at: base.completed_at ?? (capped >= base.target ? nowIso : null),
  };
}

export type ClaimBlockReason = 'not_complete' | 'already_claimed';

export function canClaim(uq: UserQuest): { ok: true } | { ok: false; reason: ClaimBlockReason } {
  if (uq.claimed_at) return { ok: false, reason: 'already_claimed' };
  if (uq.progress < uq.target) return { ok: false, reason: 'not_complete' };
  return { ok: true };
}

export function claimQuest(uq: UserQuest, nowIso: string): UserQuest {
  const check = canClaim(uq);
  if (!check.ok) throw new RangeError(`Cannot claim quest ${uq.quest_id}: ${check.reason}`);
  return { ...uq, claimed_at: nowIso };
}

/**
 * At a reset: rows from finished periods that were completed but not claimed are claimed for the
 * student (rewards returned so the UI can show them), and open rows for the new period start at 0.
 */
export function rolloverQuests(
  quests: readonly Quest[],
  userQuests: readonly UserQuest[],
  today: LocalDate,
  nowIso: string,
): { current: UserQuest[]; autoClaimed: { quest: Quest; userQuest: UserQuest }[] } {
  const byId = new Map(quests.map((q) => [q.id, q]));
  const autoClaimed: { quest: Quest; userQuest: UserQuest }[] = [];
  const current: UserQuest[] = [];
  for (const uq of userQuests) {
    const q = byId.get(uq.quest_id);
    if (!q) continue;
    if (uq.period_start === questPeriodStart(q, today) && isQuestActive(q, today)) {
      current.push(uq);
    } else if (uq.progress >= uq.target && !uq.claimed_at) {
      autoClaimed.push({ quest: q, userQuest: { ...uq, claimed_at: nowIso } });
    }
  }
  for (const q of quests) {
    if (!isQuestActive(q, today)) continue;
    const start = questPeriodStart(q, today);
    if (!current.some((uq) => uq.quest_id === q.id && uq.period_start === start)) {
      current.push({ quest_id: q.id, period_start: start, progress: 0, target: q.spec.target, completed_at: null, claimed_at: null });
    }
  }
  return { current, autoClaimed };
}
