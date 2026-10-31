/**
 * The release gate (content/releases.json, R61): per exam profile, the subjects and chapters
 * released to production. The content check holds released scopes to 100% coverage (PRD §14);
 * a production publish builds only them. One definition, shared by the check and the publisher.
 */
import type { ContentSet } from "./load.js";

export const RELEASES_FILE = "releases.json";

/** What one exam profile has released. Empty sets: nothing is released. */
export interface ReleasedScope {
  subjects: Set<string>;
  chapters: Set<string>;
}

export function releasedScope(set: ContentSet, profileId: string): ReleasedScope {
  const scope = set.releases[0]?.doc.profiles[profileId];
  return { subjects: new Set(scope?.subjects ?? []), chapters: new Set(scope?.chapters ?? []) };
}

/** Is this chapter released (its whole subject, or the chapter itself)? */
export function isChapterReleased(scope: ReleasedScope, chapter: { id: string; subject: string }): boolean {
  return scope.subjects.has(chapter.subject) || scope.chapters.has(chapter.id);
}

/** True when the profile has released anything at all. */
export function hasReleases(scope: ReleasedScope): boolean {
  return scope.subjects.size > 0 || scope.chapters.size > 0;
}
