import type { LocalDate } from '../time';

/**
 * The little learner path and plan (HOME-06, learn §5.6, PRD §6 "Class 1–5: story, song and play").
 *
 * Content: storybooks (`storybook@1`, LRN-11; completing one counts as a lesson), lessons
 * (`lesson@1`, played in the LES-01 little-learner variant), songs (`song@1`) and play
 * activities (`play@1`: tap, match, sort, drag, trace). Stories, songs and play ship in activity
 * bundles (modes `story`, `song`, `play`) and are listed per topic in the manifest's
 * `topics[].activities`. The song and play screens have no ID in the docs yet; `LL-SONG` and
 * `LL-PLAY` are proposed names (owner to confirm).
 */

export type LittleActivityKind = 'story' | 'lesson' | 'song' | 'play';
/** Kinds with a content type and a screen today. */
export const SUPPORTED_LITTLE_ACTIVITIES: readonly LittleActivityKind[] = ['story', 'lesson', 'song', 'play'];

export interface LittlePathNode {
  id: string;
  kind: LittleActivityKind;
  /** The activity id (`sb.…`, `sg.…`, `pl.…`) for stories, songs and play; the topic id for lessons. */
  ref: string;
  /** The topic whose activity bundle holds a story, song or play item (its manifest topic key). */
  topicId?: string;
  minutes: number;
  done: boolean;
  /** Pro-gated: a `Lock` badge, "Ask a grown-up" aloud, LRN-05 `u10` variant behind the gate. */
  locked: boolean;
  /** Bundle on the device (offline: a cloud badge and the "Needs internet" line). */
  available: boolean;
}

export type LittleRoute = 'LRN-11' | 'LES-01' | 'LL-SONG' | 'LL-PLAY';

/** Where a node opens; null for kinds with no screen yet. */
export function littleRoute(kind: LittleActivityKind): LittleRoute | null {
  switch (kind) {
    case 'story':
      return 'LRN-11';
    case 'lesson':
      return 'LES-01';
    case 'song':
      return 'LL-SONG';
    case 'play':
      return 'LL-PLAY';
    default:
      return null;
  }
}

/** The current node: the first one not done that can be played (nothing is locked by order). */
export function currentNodeIndex(nodes: readonly LittlePathNode[]): number {
  const playable = (n: LittlePathNode) => !n.done && littleRoute(n.kind) !== null;
  const i = nodes.findIndex(playable);
  return i === -1 ? Math.max(0, nodes.length - 1) : i;
}

/** The nodes in view (HOME-06: at most 7), keeping the current node in the window. */
export function pathWindow(nodes: readonly LittlePathNode[], maxInView = 7): { start: number; nodes: LittlePathNode[]; current: number } {
  const current = currentNodeIndex(nodes);
  const size = Math.max(1, maxInView);
  const start = Math.max(0, Math.min(current - 1, nodes.length - size));
  return { start, nodes: nodes.slice(start, start + size), current };
}

export type PlayOutcome =
  | { kind: 'open'; route: LittleRoute; ref: string; topicId?: string }
  | { kind: 'ask_grown_up' }
  | { kind: 'needs_internet' }
  | { kind: 'not_ready' };

/** What [Play] (or a node tap) does. */
export function playNode(node: LittlePathNode, online: boolean): PlayOutcome {
  const route = littleRoute(node.kind);
  if (!route) return { kind: 'not_ready' };
  if (node.locked) return { kind: 'ask_grown_up' };
  if (!node.available && !online) return { kind: 'needs_internet' };
  return { kind: 'open', route, ref: node.ref, ...(node.topicId ? { topicId: node.topicId } : {}) };
}

export interface LittlePlanItem {
  id: string;
  kind: 'review' | LittleActivityKind;
  minutes: number;
  route: 'MEM-03' | LittleRoute;
  ref: string | null;
}

export interface LittlePlan {
  day: LocalDate;
  goalMinutes: number;
  items: LittlePlanItem[];
  totalMinutes: number;
}

/**
 * Today's plan for a little learner (widgets and the HOME-06 pet line): the next playable,
 * unlocked nodes up to the goal (the parent picks 5 or 10 minutes), after any picture-card
 * reviews due. Locked and unsupported nodes are skipped, never shown as a to-do.
 */
export function buildLittlePlan(input: {
  day: LocalDate;
  goalMinutes: number;
  nodes: readonly LittlePathNode[];
  reviewsDue: number;
  secondsPerCard: number;
}): LittlePlan {
  const items: LittlePlanItem[] = [];
  let used = 0;
  if (input.reviewsDue > 0) {
    const minutes = Math.max(1, Math.ceil((input.reviewsDue * input.secondsPerCard) / 60));
    items.push({ id: 'review', kind: 'review', minutes, route: 'MEM-03', ref: null });
    used += minutes;
  }
  for (const node of input.nodes) {
    if (node.done || node.locked) continue;
    const route = littleRoute(node.kind);
    if (!route) continue;
    if (used >= input.goalMinutes && items.some((i) => i.kind !== 'review')) break;
    items.push({ id: `${node.kind}:${node.id}`, kind: node.kind, minutes: node.minutes, route, ref: node.ref });
    used += node.minutes;
  }
  return { day: input.day, goalMinutes: input.goalMinutes, items, totalMinutes: used };
}
