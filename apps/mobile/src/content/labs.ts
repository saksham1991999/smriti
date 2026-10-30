import labs from './labs.generated.json';

/** One sim from sims/<id>/manifest.json (scripts/sim-catalogue.mjs). */
export interface LabEntry {
  id: string;
  version: string;
  title: { en: string; hi: string };
  subject: string;
  concepts: string[];
  tasks: number;
  sizeBytes: number | null;
  licence: string;
  attribution: string | null;
  aspect: string;
}

export const LABS: LabEntry[] = labs as LabEntry[];

/** The Agnes lab art in the seed pack, by sim; others use their subject's art. */
const ART: Record<string, string> = {
  'ohms-law-circuit': 'lab-circuit',
  'convex-lens-bench': 'lab-optics',
  'acid-base-titration': 'lab-titration',
};
const SUBJECT_ART: Record<string, string> = { phy: 'subject-physics', chem: 'subject-chemistry', bio: 'subject-biology', math: 'subject-maths' };

export function labIllustration(lab: Pick<LabEntry, 'id' | 'subject'>): string {
  return ART[lab.id] ?? SUBJECT_ART[lab.subject] ?? 'scene-student-laptop';
}
