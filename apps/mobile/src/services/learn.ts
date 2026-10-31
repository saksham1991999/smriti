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

export type ChapterFilter = 'all' | 'in_progress' | 'not_started';

export function filterChapters(subject: SubjectView, progress: SubjectProgress, filter: ChapterFilter): ChapterView[] {
  if (filter === 'all') return subject.chapters;
  return subject.chapters.filter((c) => progress.chapters.get(c.id)?.status === filter);
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
