#!/usr/bin/env node
// Writes src/content-index/fixture/site-index.fixture.json: a FIXTURE content index so the
// site builds before the content engine publishes the real one (CONTENT_INDEX_PATH).
//
// Every chapter, topic and question in it is a placeholder ("Sample chapter 1"), never study
// content (AGENTS rule 1). It has no blueprints, so no exam pattern numbers appear (rule 3),
// and no minutes or counts. Exam and subject names are labels only.
//
//   node scripts/make-fixture.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "src", "content-index", "fixture", "site-index.fixture.json");

const L = (en, hi) => ({ en, hi });

const subjects = [
  ["phy", "physics", L("Physics", "भौतिकी"), ["jee-main", "neet-ug"]],
  ["chem", "chemistry", L("Chemistry", "रसायन विज्ञान"), ["jee-main", "neet-ug"]],
  ["math", "maths", L("Mathematics", "गणित"), ["jee-main"]],
  ["bio", "biology", L("Biology", "जीव विज्ञान"), ["neet-ug"]],
  ["history", "history", L("History", "इतिहास"), ["upsc-cse"]],
  ["polity", "polity", L("Polity", "राजव्यवस्था"), ["upsc-cse"]],
  ["economy", "economy", L("Economy", "अर्थव्यवस्था"), ["upsc-cse"]],
  ["geography", "geography", L("Geography", "भूगोल"), ["upsc-cse"]],
  ["reasoning", "reasoning", L("Reasoning", "तर्कशक्ति"), ["ssc-cgl"]],
  ["quant", "quantitative-aptitude", L("Quantitative aptitude", "संख्यात्मक अभियोग्यता"), ["ssc-cgl"]],
  ["english", "english", L("English", "अंग्रेज़ी"), ["ssc-cgl"]],
  ["gk", "general-awareness", L("General awareness", "सामान्य जागरूकता"), ["ssc-cgl"]],
];

const CHAPTERS = 3;
const TOPICS = 2;

function questions(prefix) {
  const answers = ["b", "a", "c"];
  return answers.map((answer, i) => ({
    id: `${prefix}.q${i + 1}`,
    stem: L(
      `Sample question ${i + 1}. The real question comes from the content index.`,
      `नमूना प्रश्न ${i + 1}। असली प्रश्न कंटेंट इंडेक्स से आएगा।`,
    ),
    options: ["a", "b", "c", "d"].map((o) => ({
      id: o,
      text: L(`Option ${o.toUpperCase()}`, `विकल्प ${o.toUpperCase()}`),
    })),
    answer,
    explanation: L(
      `Placeholder feedback: option ${answer.toUpperCase()} is marked correct in this sample. Real explanations come from the lesson skills, after review.`,
      `नमूना फ़ीडबैक: इस नमूने में विकल्प ${answer.toUpperCase()} सही माना गया है। असली व्याख्या लेसन स्किल से, समीक्षा के बाद आएगी।`,
    ),
  }));
}

const tryLesson = (topicId) => ({
  topic_id: topicId,
  title: L("Sample lesson", "नमूना पाठ"),
  questions: questions(`fixture.${topicId}`),
});

const subjectDocs = subjects.map(([id, slug, name, exams]) => ({
  id,
  slug,
  name,
  summary: null,
  chapters: Array.from({ length: CHAPTERS }, (_, c) => {
    const n = c + 1;
    const chId = `${id}.sample-chapter-${n}`;
    return {
      id: chId,
      slug: `sample-chapter-${n}`,
      name: L(`Sample chapter ${n}`, `नमूना अध्याय ${n}`),
      summary: null,
      exams,
      deep_dive_free: n <= 2,
      topics: Array.from({ length: TOPICS }, (_, t) => {
        const m = t + 1;
        return {
          id: `${chId}.sample-topic-${m}`,
          slug: `sample-topic-${n}-${m}`,
          name: L(`Sample topic ${n}.${m}`, `नमूना टॉपिक ${n}.${m}`),
          summary: null,
          exams,
          modes: { deep_dive: { minutes: null }, quick_revision: { minutes: null } },
        };
      }),
    };
  }),
}));

const firstTopic = (subjectId) => subjectDocs.find((s) => s.id === subjectId).chapters[0].topics[0].id;

const exam = (id, slug, accent, name, short, category, body, subjectIds) => ({
  id,
  slug,
  accent,
  name,
  short_name: short,
  category,
  conducting_body: body,
  official_url: null,
  summary: null,
  subjects: subjectIds,
  blueprint: null,
  try_lesson: tryLesson(firstTopic(subjectIds[0])),
});

const index = {
  schema: "site-index@1",
  fixture: true,
  fixture_note:
    "FIXTURE. Placeholder names and questions so the site builds before the content engine publishes the real index. No exam pattern data. Never ship this to production (SITE_REQUIRE_CONTENT_INDEX=1 fails the build).",
  generated_at: "fixture",
  exams: [
    exam("jee-main", "jee-main", "jee", L("JEE Main", "जेईई मेन"), L("JEE Main", "जेईई मेन"), "engineering", "NTA", ["phy", "chem", "math"]),
    exam("neet-ug", "neet", "neet", L("NEET UG", "नीट यूजी"), L("NEET", "नीट"), "medical", "NTA", ["phy", "chem", "bio"]),
    exam(
      "upsc-cse",
      "upsc",
      "upsc",
      L("UPSC Civil Services Prelims", "यूपीएससी सिविल सेवा प्रारंभिक परीक्षा"),
      L("UPSC", "यूपीएससी"),
      "civil-services",
      "UPSC",
      ["history", "polity", "economy", "geography"],
    ),
    exam("ssc-cgl", "ssc", "ssc", L("SSC CGL", "एसएससी सीजीएल"), L("SSC", "एसएससी"), "staff-selection", "SSC", ["reasoning", "quant", "english", "gk"]),
  ],
  subjects: subjectDocs,
  home_try_lesson: tryLesson(firstTopic("phy")),
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(index, null, 2) + "\n");
console.log("wrote", out);
