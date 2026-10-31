import type { SyncEventPayloads } from './types';

/**
 * Topic marks that used to live only on the device (sync contract v1.6, learn §6.4 and X13):
 *
 * - `topic_tested_out`: LES-13 after a passed Test out. Each passed topic becomes learned with
 *   `learned_via: 'test_out'`, unless it is already learned (then it keeps its row).
 * - `topic_test_out_undone`: LES-13 "Undo this". Each topic that check marked goes back to the
 *   status it had before (`previous_status`, or not started), but only while its mark is still the
 *   check's (`learned_via: 'test_out'`).
 * - `chapter_reset`: LRN-02 "Reset chapter progress". Every topic of the chapter goes back to not
 *   started, whatever marked it; lesson positions go too. Review cards, XP and the streak stay.
 * - `placement_checked` (v1.7): LES-13 after Find my level. The subject's earlier placement marks
 *   that are still placement's, and that this check doesn't repeat, go back to not started (a redo
 *   replaces them, learn §6.5); then each topic it pre-marks, if not started, becomes learned
 *   with `learned_via: 'placement'`. Rows in progress or learned another way stay.
 * - `lesson_completed` (a lesson mode, not `quick_check`): the topic becomes learned via lesson,
 *   unless it is already learned; a placement mark becomes the lesson's (it is confirmed, v1.7).
 *
 * `applyTopicMark` is the rule both sides run: the device on its own rows, and the server on
 * `learn.topic_status`. Golden vector: `test-vectors/topic_marks.json` (checked by the API's
 * `tests/test_topic_marks.py`). A device that deletes a row where the rule says `not_started`
 * shows the same thing: no row is "not started".
 */

export type TopicMarkStatus = 'not_started' | 'in_progress' | 'learned';
export type TopicLearnedVia = 'lesson' | 'test_out' | 'placement' | 'chapter_test';

export interface TopicMarkRow {
  status: TopicMarkStatus;
  learned_via: TopicLearnedVia | null;
}

export type TopicMarkEvent =
  | { type: 'topic_tested_out'; payload: SyncEventPayloads['topic_tested_out'] }
  | { type: 'topic_test_out_undone'; payload: SyncEventPayloads['topic_test_out_undone'] }
  | { type: 'chapter_reset'; payload: SyncEventPayloads['chapter_reset'] }
  | { type: 'placement_checked'; payload: SyncEventPayloads['placement_checked'] }
  | { type: 'lesson_completed'; payload: Pick<SyncEventPayloads['lesson_completed'], 'topic_id' | 'mode'> };

export interface TopicMarkContext {
  /** The topics of each chapter, from content (the server reads `content.topics`). */
  chapterTopics: Readonly<Record<string, readonly string[]>>;
  /** `topic_ids` of each applied `topic_tested_out`, by `check_id`. */
  checks: Record<string, readonly string[]>;
  /** (v1.7) The topics of each subject, from content (the server joins chapters and topics). */
  subjectTopics?: Readonly<Record<string, readonly string[]>>;
  /** (v1.7) `topic_ids` of each applied `placement_checked`, by `check_id`. */
  placements?: Record<string, readonly string[]>;
}

const LESSON_MODES: ReadonlySet<string> = new Set(['deep_dive', 'quick_revision', 'onboarding']);

/** Why the server rejects a mark event, or null when it applies. */
export type TopicMarkRejection = 'invalid_payload' | 'already_recorded' | null;

/**
 * Applies one event to `rows` in place and records the check in `ctx.checks`. Returns the
 * server's rejection code (and changes nothing) when the event can't apply.
 */
export function applyTopicMark(rows: Record<string, TopicMarkRow>, event: TopicMarkEvent, ctx: TopicMarkContext): TopicMarkRejection {
  if (event.type === 'topic_tested_out') {
    const p = event.payload;
    const inChapter = new Set(ctx.chapterTopics[p.chapter_id] ?? []);
    if (!inChapter.size || !p.topic_ids.every((t) => inChapter.has(t))) return 'invalid_payload';
    if (ctx.checks[p.check_id]) return 'already_recorded';
    ctx.checks[p.check_id] = [...p.topic_ids];
    for (const t of p.topic_ids) {
      if (rows[t]?.status === 'learned') continue;
      rows[t] = { status: 'learned', learned_via: 'test_out' };
    }
    return null;
  }
  if (event.type === 'placement_checked') {
    const p = event.payload;
    const subject = new Set(ctx.subjectTopics?.[p.subject_id] ?? []);
    if (!subject.size || !p.topic_ids.every((t) => subject.has(t))) return 'invalid_payload';
    const placements = (ctx.placements ??= {});
    if (placements[p.check_id]) return 'already_recorded';
    const keep = new Set(p.topic_ids);
    placements[p.check_id] = [...keep];
    for (const t of subject) {
      const row = rows[t];
      if (row?.status === 'learned' && row.learned_via === 'placement' && !keep.has(t)) rows[t] = { status: 'not_started', learned_via: null };
    }
    for (const t of keep) {
      const row = rows[t];
      if (!row || row.status === 'not_started') rows[t] = { status: 'learned', learned_via: 'placement' };
    }
    return null;
  }
  if (event.type === 'lesson_completed') {
    const p = event.payload;
    if (!LESSON_MODES.has(p.mode)) return null;
    const row = rows[p.topic_id];
    if (row?.status === 'learned' && row.learned_via !== 'placement') return null;
    rows[p.topic_id] = { status: 'learned', learned_via: 'lesson' };
    return null;
  }
  if (event.type === 'topic_test_out_undone') {
    const marked = ctx.checks[event.payload.check_id];
    if (!marked) return 'invalid_payload';
    for (const t of event.payload.topics) {
      const row = rows[t.topic_id];
      if (!marked.includes(t.topic_id) || row?.learned_via !== 'test_out') continue;
      rows[t.topic_id] = { status: t.previous_status ?? 'not_started', learned_via: null };
    }
    return null;
  }
  const topics = ctx.chapterTopics[event.payload.chapter_id] ?? [];
  if (!topics.length) return 'invalid_payload';
  for (const t of topics) if (rows[t]) rows[t] = { status: 'not_started', learned_via: null };
  return null;
}

/** LES-13 after a Test out: the passed topics (lesson-core `TestOutResult.passed`). */
export function topicTestedOutPayload(checkId: string, chapterId: string, passed: readonly string[]): SyncEventPayloads['topic_tested_out'] {
  return { check_id: checkId, kind: 'test_out', chapter_id: chapterId, topic_ids: [...new Set(passed)] };
}

/** One mark a check made, with the row it replaced (the device's `TestOutMark`). */
export interface TopicMarkUndo {
  topicId: string;
  previous: { status: TopicMarkStatus } | null;
}

/** LES-13 "Undo this": only the marks this check made, each with what it replaced. */
export function topicTestOutUndonePayload(checkId: string, marks: readonly TopicMarkUndo[]): SyncEventPayloads['topic_test_out_undone'] {
  return {
    check_id: checkId,
    topics: marks.map((m) => ({
      topic_id: m.topicId,
      previous_status: m.previous && m.previous.status !== 'learned' ? m.previous.status : null,
    })),
  };
}

/** LES-13 after Find my level: the topics it pre-marks (lesson-core `PlacementResult.premarkTopics`). */
export function placementCheckedPayload(checkId: string, subjectId: string, premarkTopics: readonly string[]): SyncEventPayloads['placement_checked'] {
  return { check_id: checkId, subject_id: subjectId, topic_ids: [...new Set(premarkTopics)] };
}

/** LRN-02 "Reset chapter progress". */
export function chapterResetPayload(chapterId: string): SyncEventPayloads['chapter_reset'] {
  return { chapter_id: chapterId };
}
