import { pathWindow, type LittlePathNode } from '@smriti/app-core';

import type { SubjectView } from '../../content/repo';
import type { SmritiApp } from '../../services/app';
import { loadTopicStates } from '../../services/progress';
import { doneActivities } from './activities';

export interface LittleNode extends LittlePathNode {
  title: string;
}

export interface LittlePathModel {
  subjects: SubjectView[];
  subject: SubjectView | null;
  nodes: LittleNode[];
  /** Index into `nodes` of the current node. */
  current: number;
}

/**
 * HOME-06's path for one subject, topic by topic in syllabus order: the topic's storybooks
 * (LRN-11), its lesson (LES-01 little learner variant), then its songs (LRN-17) and play
 * activities (LRN-18). Stories, songs and play come from the manifest's `topics[].activities`
 * and open from the topic's activity bundles; a topic without them is just its lesson.
 */
export async function loadLittlePath(app: SmritiApp, subjectId: string | null): Promise<LittlePathModel> {
  const locale = app.ui.getState().locale;
  const exam = app.examProfileId();
  const content = app.deps.content;
  const subjects = content.subjects(locale, exam);
  const subject = subjects.find((s) => s.id === subjectId) ?? subjects[0] ?? null;
  const states = await loadTopicStates(app);
  const done = await doneActivities(app);
  const pro = app.isPro();
  const all: LittleNode[] = (subject?.chapters ?? []).flatMap((c) =>
    c.topics.flatMap((t) => {
      const acts = content.activities(locale, t.id, exam).map(
        (a): LittleNode => ({
          id: a.id,
          kind: a.kind,
          ref: a.id,
          topicId: t.id,
          title: a.title,
          minutes: a.minutes ?? 0, // unknown length (a storybook): adds nothing to the plan total
          done: done.has(a.id),
          locked: !pro && !c.free,
          available: content.loadActivities(locale, t.id, a.kind, exam) !== null,
        }),
      );
      const lesson: LittleNode = {
        id: t.id,
        kind: 'lesson',
        ref: t.id,
        title: t.name,
        minutes: t.minutes ?? 5,
        done: states.get(t.id)?.status === 'learned',
        locked: !pro && !t.freeDeepDive && !c.free,
        available: content.load(locale, t.id, 'deep_dive', exam) !== null,
      };
      return [...acts.filter((a) => a.kind === 'story'), lesson, ...acts.filter((a) => a.kind !== 'story')];
    }),
  );
  const win = pathWindow(all, 7);
  return { subjects, subject, nodes: win.nodes as LittleNode[], current: win.current - win.start };
}
