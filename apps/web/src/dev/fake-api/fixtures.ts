/**
 * DEV CONFIG for the fake API, shaped like apps/api's responses (`/v1/config`, `/v1/catalog/exams`).
 * Study content is never written here (AGENTS.md rule 1): lessons, questions and the catalogue
 * come from the published fixture manifests and bundles in tools/content-publish/out, whose text is
 * labelled fixture test data. Exam names mirror supabase/seed.sql; dates, schedules and patterns
 * are deliberately absent (rule 3: they come from official notifications through exam-blueprint).
 */
import type { Schemas } from "@smriti/api-client";

/** The only published exam profile today (tools/content-publish fixtures). */
export const FIXTURE_PROFILE = "fx-exam-2027";

type Exam = Schemas["ExamOut"];
const exam = (id: string, en: string, hi: string, category: string, profileEn: string, profileHi: string, active = true): Exam => ({
  id,
  name: { en, hi },
  category,
  conducting_body: null,
  official_url: null,
  is_active: active,
  profiles: [{ id: `${id}-2027`, cycle: "2027", name: { en: profileEn, hi: profileHi }, locales: ["en", "hi"], schedule: null, is_active: active }],
});

export const FIXTURE_EXAMS: Exam[] = [
  exam("jee-main", "JEE Main", "जेईई मेन", "engineering", "JEE Main 2027", "जेईई मेन 2027"),
  exam("jee-advanced", "JEE Advanced", "जेईई एडवांस्ड", "engineering", "JEE Advanced 2027", "जेईई एडवांस्ड 2027"),
  exam("neet-ug", "NEET UG", "नीट यूजी", "medical", "NEET UG 2027", "नीट यूजी 2027"),
  exam("upsc-cse", "UPSC Civil Services", "यूपीएससी सिविल सेवा", "civil_services", "UPSC Civil Services 2027", "यूपीएससी सिविल सेवा 2027"),
  exam("cbse-9", "CBSE Class 9", "सीबीएसई कक्षा 9", "school", "CBSE Class 9 (2027)", "सीबीएसई कक्षा 9 (2027)"),
  exam("cbse-10", "CBSE Class 10", "सीबीएसई कक्षा 10", "school", "CBSE Class 10 (2027)", "सीबीएसई कक्षा 10 (2027)"),
  exam("cbse-11", "CBSE Class 11", "सीबीएसई कक्षा 11", "school", "CBSE Class 11 (2027)", "सीबीएसई कक्षा 11 (2027)"),
  exam("cbse-12", "CBSE Class 12", "सीबीएसई कक्षा 12", "school", "CBSE Class 12 (2027)", "सीबीएसई कक्षा 12 (2027)"),
  exam("fx-exam", "Fixture exam", "फ़िक्स्चर परीक्षा", "school", "Fixture exam 2027", "फ़िक्स्चर परीक्षा 2027"),
];

export function fixtureConfig(contentBaseUrl: string, now: number): Schemas["ConfigResponse"] {
  return {
    variant: {
      id: "all",
      app_name: { en: "Smriti", hi: "Smriti" },
      exam_ids: FIXTURE_EXAMS.map((e) => e.id),
      exam_profile_ids: FIXTURE_EXAMS.flatMap((e) => e.profiles.map((p) => p.id)),
      show_exam_switcher: true,
      accent_color: "examAccent.all",
      deep_link_prefix: null,
      products: { proMonthlyIntro: "pro_monthly_intro_web", proMonthly: "pro_monthly_web" },
      revenuecat_offering_id: null,
      source: "packages/config",
    },
    variants: ["all"],
    app_version: { min_version: "0.1.0", latest_version: "0.1.0", update_required: null },
    // Empty: the client falls back to @smriti/config defaults (the real API sends live flags).
    flags: {},
    free_limits: {},
    // R38 and supabase/seed.sql: ₹99 a month, ₹1 first month, tax-inclusive.
    pricing: [
      { product_id: "pro_monthly_web", platform: "web", variant_id: null, store_product_id: "fake", price_paise: 9900, intro_price_paise: null, period: "month", entitlement: "pro" },
      { product_id: "pro_monthly_intro_web", platform: "web", variant_id: null, store_product_id: "fake", price_paise: 9900, intro_price_paise: 100, period: "month", entitlement: "pro" },
    ],
    content_base_url: contentBaseUrl.replace(/\/+$/, ""),
    server_time: new Date(now).toISOString(),
  } as Schemas["ConfigResponse"];
}
