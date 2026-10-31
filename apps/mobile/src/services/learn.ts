import type { Schemas } from '@smriti/api-client';
import { localDate } from '@smriti/app-core';

import type { ChapterView, SubjectView, TopicView } from '../content/repo';
import type { SmritiApp } from './app';
import type { TopicState } from './progress';
import { cardTopic } from './reviews';

/**
 * LRN-01 and LRN-02 from the device only: the manifest gives chapters and topics, `topic_status`
 * gives progress, and `srs_cards` gives today's review rows. Nothing here waits for the network.
 */

export type ChapterStatus = 'not_started' | 'in_progress' | 'learned';

export interface ChapterProgress {
  done: number;
  total: number;
  percent: number;
  status: ChapterStatus;
  /** The topic the CTA continues (in progress) or starts (next not learned), null when all learned. */
  next: TopicView | null;
  nextInProgress: boolean;
  /** Sum of bundle minutes for topics not yet learned; null when no topic has a bundle estimate. */
  minutesLeft: number | null;
}

export function chapterProgress(chapter: ChapterView, states: Map<string, TopicState>): ChapterProgress {
  const total = chapter.topics.length;
  let done = 0;
  let pct = 0;
  let minutes = 0;
  let known = false;
  let next: TopicView | null = null;
  let nextInProgress = false;
  for (const tp of chapter.topics) {
    const st = states.get(tp.id);
    if (st?.status === 'learned') {
      done++;
      pct += 100;
      continue;
    }
    pct += st?.percent ?? 0;
    if (tp.minutes !== null) {
      minutes += tp.minutes;
      known = true;
    }
    if (st?.status === 'in_progress' && !nextInProgress) {
      next = tp;
      nextInProgress = true;
    } else if (!next) next = tp;
  }
  const percent = total ? Math.round(pct / total) : 0;
  const status: ChapterStatus = total > 0 && done === total ? 'learned' : pct > 0 ? 'in_progress' : 'not_started';
  return { done, total, percent, status, next, nextInProgress, minutesLeft: known ? Math.ceil(minutes) : null };
}

export interface SubjectProgress {
  done: number;
  total: number;
  percent: number;
  chapters: Map<string, ChapterProgress>;
}

export function subjectProgress(subject: SubjectView, states: Map<string, TopicState>): SubjectProgress {
  const chapters = new Map(subject.chapters.map((c) => [c.id, chapterProgress(c, states)] as const));
  const all = [...chapters.values()];
  const done = all.filter((c) => c.status === 'learned').length;
  const percent = all.length ? Math.round(all.reduce((s, c) => s + c.percent, 0) / all.length) : 0;
  return { done, total: all.length, percent, chapters };
}

export type ChapterFilter = 'all' | 'in_progress' | 'not_started' | 'weak';

export interface WeakChapters {
  /** Whether LRN-01 offers the "Weak" chip at all. */
  offered: boolean;
  chapters: Set<string>;
}

/**
 * LRN-01 "Weak": chapters with a weak spot from `/v1/practice/weak-spots` (the server's rules,
 * practice §9.2). Offered only once the owner has set `learn.weak_filter_min_attempts`, the
 * server has enough answers (`needs_more_answers` null) and the subject's weak-spot rows count at
 * least that many attempts. Nothing is guessed on the device.
 */
export function weakChapters(subject: SubjectView, weak: Pick<Schemas['WeakSpots'], 'items' | 'needs_more_answers'> | null | undefined, minAttempts: number | null): WeakChapters {
  const none: WeakChapters = { offered: false, chapters: new Set() };
  if (minAttempts === null || !weak || weak.needs_more_answers !== null) return none;
  const chapterOf = new Map(subject.chapters.flatMap((c) => c.topics.map((t) => [t.id, c.id] as const)));
  const mine = weak.items.filter((w) => chapterOf.has(w.topic_id));
  const attempts = mine.reduce((n, w) => n + w.attempts, 0);
  if (attempts < minAttempts) return none;
  return { offered: true, chapters: new Set(mine.map((w) => chapterOf.get(w.topic_id)!)) };
}

export function filterChapters(subject: SubjectView, progress: SubjectProgress, filter: ChapterFilter, weak?: WeakChapters): ChapterView[] {
  if (filter === 'all') return subject.chapters;
  if (filter === 'weak') return subject.chapters.filter((c) => weak?.chapters.has(c.id) ?? false);
  return subject.chapters.filter((c) => progress.chapters.get(c.id)?.status === filter);
}

export interface UnitSection {
  unitId: string;
  /** The unit's name when the manifest carries unit names; null shows no header. */
  name: string | null;
  chapters: ChapterView[];
}

/** LRN-01 unit sections: chapters grouped by unit in syllabus order, named only from content. */
export function unitSections(subject: SubjectView, chapters: ChapterView[]): UnitSection[] {
  const names = new Map((subject.units ?? []).map((u) => [u.id, u.name] as const));
  if (names.size === 0) return chapters.length ? [{ unitId: '', name: null, chapters }] : [];
  const out: UnitSection[] = [];
  for (const c of chapters) {
    const last = out[out.length - 1];
    if (last && last.unitId === c.unitId) last.chapters.push(c);
    else out.push({ unitId: c.unitId, name: names.get(c.unitId) ?? null, chapters: [c] });
  }
  return out;
}

/** Cards due by the end of today per topic (LRN-02 review rows, A14). */
export async function dueByTopic(app: SmritiApp): Promise<Map<string, number>> {
  const today = localDate(app.now(), app.deps.timeZone());
  const out = new Map<string, number>();
  for (const c of await app.deps.stores.storage.srs_cards.all()) {
    if (c.suspended || c.state === 0) continue;
    if (localDate(Date.parse(c.due_at), app.deps.timeZone()) > today) continue;
    const topic = cardTopic(c);
    if (topic) out.set(topic, (out.get(topic) ?? 0) + 1);
  }
  return out;
}
