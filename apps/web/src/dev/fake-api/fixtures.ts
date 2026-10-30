/**
 * DEV CONFIG for the fake API. Study content is never written here (AGENTS.md rule 1): lessons,
 * questions and the catalogue come from the published fixture bundles and manifests in
 * tools/content-publish/out (`pnpm --filter @smriti/content-publish publish:fixtures`), whose text
 * is labelled fixture test data. Exam names are catalogue labels only; exam dates and patterns are
 * deliberately absent (rule 3: they come from official notifications through exam-blueprint).
 */
import type { ConfigResponse } from "../../lib/contentTypes";

/** The only published exam profile today: every goal maps to it in dev and tests. */
export const FIXTURE_PROFILE = "fx-exam-2027";

export const FIXTURE_CONFIG: ConfigResponse = {
  exams: [
    { id: "jee-main", profileId: FIXTURE_PROFILE, short: { en: "JEE Main", hi: "जेईई मेन" }, category: "engineering", cycle: "2027" },
    { id: "jee-advanced", profileId: FIXTURE_PROFILE, short: { en: "JEE Advanced", hi: "जेईई एडवांस्ड" }, category: "engineering", cycle: "2027" },
    { id: "neet-ug", profileId: FIXTURE_PROFILE, short: { en: "NEET UG", hi: "नीट यूजी" }, category: "medical", cycle: "2027" },
    { id: "upsc-cse", profileId: FIXTURE_PROFILE, short: { en: "UPSC Prelims", hi: "यूपीएससी प्रीलिम्स" }, category: "civil_services", cycle: "2027" },
    { id: "school", profileId: FIXTURE_PROFILE, short: { en: "School", hi: "स्कूल" }, category: "school", cycle: "2027" },
    { id: "curious", profileId: FIXTURE_PROFILE, short: { en: "Just curious", hi: "बस जानने के लिए" }, category: "general", cycle: "2027" },
  ],
  classes: [9, 10, 11, 12],
  rotatingFreeChapters: [],
  // R38: ₹1 first month when eligible, then ₹99 a month, tax-inclusive.
  intro: { pricePaise: 100, monthlyPaise: 9900, currency: "INR" },
  // Proposed `xp.*` defaults from @smriti/config (learn §7, R51); the real API sends live flags.
  flags: {},
};
