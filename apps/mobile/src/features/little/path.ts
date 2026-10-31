import { pathWindow, type LittleActivityKind, type LittlePathNode } from '@smriti/app-core';

import type { SubjectView } from '../../content/repo';
import type { SmritiApp } from '../../services/app';
import { loadTopicStates } from '../../services/progress';

export interface LittleNode extends LittlePathNode {
  title: string;
  /** Kinds with no content type yet (`song`, `play`): shown, never playable (app-core `playNode`). */
  coming: boolean;
}

export interface LittlePathModel {
  subjects: SubjectView[];
  subject: SubjectView | null;
  nodes: LittleNode[];
  /** Index into `nodes` of the current node. */
  current: number;
}

/**
 * HOME-06's path for one subject: its lessons in syllabus order (LES-01 little learner variant).
 * Storybooks (`storybook@1`, LRN-11) join the path when a published bundle carries them; the
 * seed pack has none. Song and play activities have no content type yet (app-core `path.ts`),
 * so each subject ends with one of each, shown as "Coming soon" and never opened.
 */
export async function loadLittlePath(app: SmritiApp, subjectId: string | null): Promise<LittlePathModel> {
  const locale = app.ui.getState().locale;
  const exam = app.examProfileId();
  const subjects = app.deps.content.subjects(locale, exam);
  const subject = subjects.find((s) => s.id === subjectId) ?? subjects[0] ?? null;
  const states = await loadTopicStates(app);
  const pro = app.isPro();
  const lessons: LittleNode[] = (subject?.chapters ?? []).flatMap((c) =>
    c.topics.map((t) => ({
      id: t.id,
      kind: 'lesson' as const,
      ref: t.id,
      title: t.name,
      minutes: t.minutes ?? 5,
      done: states.get(t.id)?.status === 'learned',
      locked: !pro && !t.freeDeepDive && !c.free,
      available: app.deps.content.load(locale, t.id, 'deep_dive', exam) !== null,
      coming: false,
    })),
  );
  const coming = (kind: LittleActivityKind): LittleNode => ({ id: `${subject?.id ?? 'none'}:${kind}`, kind, ref: '', title: '', minutes: 0, done: false, locked: false, available: false, coming: true });
  const all = subject ? [...lessons, coming('song'), coming('play')] : [];
  const win = pathWindow(all, 7);
  return { subjects, subject, nodes: win.nodes as LittleNode[], current: win.current - win.start };
}
