/**
 * The goal catalogue for ONB-02 (R7). The live list comes from `GET /v1/catalog/exams`; this
 * build-time snapshot of that response is the fallback for an offline first launch (onboarding §4
 * rule 2: "the build ships a copy of the variant config"). It holds only ids, names and the
 * category used for the pet's reaction line; never dates, patterns or numbers. The release build
 * should regenerate it from the API (see the report: "Root changes needed").
 */
export type ExamCategory = 'engineering' | 'medical' | 'civil_services' | 'government_jobs' | 'school' | string;

export interface CatalogueExam {
  exam_profile_id: string;
  exam_id: string;
  name: { en: string; hi: string };
  category: ExamCategory;
}

/** Snapshot of the local API's `/v1/catalog/exams` (active exam profiles, school boards left out). */
export const CATALOGUE_SNAPSHOT: CatalogueExam[] = [
  { exam_profile_id: 'jee-main-2027', exam_id: 'jee-main', name: { en: 'JEE Main', hi: 'जेईई मेन' }, category: 'engineering' },
  { exam_profile_id: 'jee-advanced-2027', exam_id: 'jee-advanced', name: { en: 'JEE Advanced', hi: 'जेईई एडवांस्ड' }, category: 'engineering' },
  { exam_profile_id: 'neet-ug-2027', exam_id: 'neet-ug', name: { en: 'NEET UG', hi: 'नीट यूजी' }, category: 'medical' },
  { exam_profile_id: 'upsc-cse-2027', exam_id: 'upsc-cse', name: { en: 'UPSC Civil Services', hi: 'यूपीएससी सिविल सेवा' }, category: 'civil_services' },
];

/** `ExamOut[]` from the API, flattened to active exam profiles (school boards are the School goal). */
export function catalogueFromApi(
  exams: { id: string; category: string; is_active: boolean; name: Record<string, string>; profiles: { id: string; is_active: boolean; name: Record<string, string> }[] }[],
): CatalogueExam[] {
  return exams
    .filter((e) => e.is_active && e.category !== 'school')
    .flatMap((e) =>
      e.profiles
        .filter((p) => p.is_active)
        .map((p) => ({
          exam_profile_id: p.id,
          exam_id: e.id,
          name: { en: e.name.en ?? e.id, hi: e.name.hi ?? e.name.en ?? e.id },
          category: e.category,
        })),
    );
}

/** Goals on ONB-02 for a variant: its exams in the catalogue, plus School and Just curious in the all-exams app. */
export function goalsFor(variant: { id: string; examIds: string[] }, catalogue: CatalogueExam[]): { exams: CatalogueExam[]; school: boolean; curious: boolean } {
  const all = variant.id === 'all';
  const exams = catalogue.filter((e) => all || variant.examIds.includes(e.exam_id));
  return { exams, school: all, curious: all };
}
