import type { Capability, LocalizedText, Orientation, TaskSpec } from '@smriti/sim-bridge';

import labs from './labs.generated.json';

/** A reading the sim declares in its manifest (LAB-04 chips, LAB-06 columns). */
export interface LabReading {
  name: string;
  unit: string;
  label: LocalizedText;
}

/** One sim from sims/<id>/manifest.json (scripts/sim-catalogue.mjs). */
export interface LabEntry {
  id: string;
  version: string;
  title: { en: string; hi: string };
  subject: string;
  concepts: string[];
  tasks: number;
  /** The manifest's tasks, sent to the sim in `init` and listed on LAB-03/04. */
  taskSpecs: TaskSpec[];
  readings: LabReading[];
  capabilities: Capability[];
  preferredOrientation: Orientation;
  /** The entry page inside the sim's folder, usually `index.html`. */
  entry: string;
  sizeBytes: number | null;
  licence: string;
  attribution: string | null;
  aspect: string;
}

export const LABS: LabEntry[] = labs as unknown as LabEntry[];

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

/** `"4:3"` → 4/3, for the viewport. */
export function labAspect(lab: Pick<LabEntry, 'aspect'>): number {
  const [w, h] = lab.aspect.split(':').map(Number);
  return w && h ? w / h : 4 / 3;
}
