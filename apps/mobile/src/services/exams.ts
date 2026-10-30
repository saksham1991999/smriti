import type { SmritiApp } from './app';

/** The exam's name in the UI locale, from the live catalogue (R7), or null. */
export function examName(app: SmritiApp, examProfileId: string | null): string | null {
  if (!examProfileId) return null;
  const e = app.ui.getState().config.exams.find((x) => x.exam_profile_id === examProfileId);
  return e ? e.name[app.ui.getState().locale] : null;
}

/** Illustration per exam category for the goal tiles (Agnes art in the seed pack). */
export function categoryIllustration(category: string): string {
  switch (category) {
    case 'engineering':
      return 'subject-physics';
    case 'medical':
      return 'subject-biology';
    case 'civil_services':
      return 'subject-polity';
    case 'government_jobs':
      return 'subject-history';
    default:
      return 'scene-exam-goal';
  }
}
