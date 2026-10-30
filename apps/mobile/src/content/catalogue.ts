/**
 * The goal catalogue for ONB-02 (R7). The live list comes from `GET /v1/config` (`exams`); this
 * build-time snapshot is the fallback for an offline first launch (onboarding §4 rule 2: "the build
 * ships a copy of the variant config"). It holds only ids, the exams' common short names and the
 * category used for the pet's reaction line; never dates, patterns or numbers. The release build
 * should regenerate it from /v1/config (see the report: "Root changes needed").
 */
export type ExamCategory = 'engineering' | 'medical' | 'civil_services' | 'government_jobs' | 'school';

export interface CatalogueExam {
  exam_profile_id: string;
  exam_id: string;
  short_name: string;
  category: ExamCategory;
  /** Release phase (PRD §4.1): Phase 1 shows only phase 1 (R7, no "Coming soon"). */
  phase: number;
}

export const CATALOGUE_SNAPSHOT: CatalogueExam[] = [
  { exam_profile_id: 'jee-main-2027', exam_id: 'jee-main', short_name: 'JEE Main', category: 'engineering', phase: 1 },
  { exam_profile_id: 'jee-advanced-2027', exam_id: 'jee-advanced', short_name: 'JEE Advanced', category: 'engineering', phase: 1 },
  { exam_profile_id: 'neet-ug-2027', exam_id: 'neet-ug', short_name: 'NEET', category: 'medical', phase: 1 },
  { exam_profile_id: 'upsc-cse-2027', exam_id: 'upsc-cse', short_name: 'UPSC', category: 'civil_services', phase: 1 },
  { exam_profile_id: 'ssc-cgl-2027', exam_id: 'ssc-cgl', short_name: 'SSC', category: 'government_jobs', phase: 2 },
];

/** Goals on ONB-02 for a variant: its exam profiles in the catalogue, plus School and Just curious in the all-exams app. */
export function goalsFor(variant: { id: string; examIds: string[] }, catalogue: CatalogueExam[], phase = 1): { exams: CatalogueExam[]; school: boolean; curious: boolean } {
  const all = variant.id === 'all';
  const exams = catalogue.filter((e) => e.phase <= phase && (all || variant.examIds.includes(e.exam_id)));
  return { exams, school: all, curious: all };
}
