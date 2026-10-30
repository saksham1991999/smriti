/**
 * DEV FIXTURES for the fake API. Every chapter, topic, lesson card and question here is
 * placeholder text, labelled "(fixture)", so nobody mistakes it for study content (AGENTS.md
 * rule 1). Real content comes from content/ through the publish job and lesson-core. Exam and
 * subject names are catalogue labels, not content; exam dates are deliberately absent (rule 3:
 * dates come from official notifications through exam-blueprint).
 */
import type { CatalogResponse, ConfigResponse, PracticeQuestion, Subject } from "../../lib/contentTypes";
import type { Lesson, LessonCard } from "@smriti/lesson-player-web";

type L = { en: string; hi: string };

export const FIXTURE_CONFIG: ConfigResponse = {
  exams: [
    { id: "jee-main", profileId: "jee-main-2027", short: { en: "JEE Main", hi: "जेईई मेन" }, category: "engineering", cycle: "2027" },
    { id: "jee-advanced", profileId: "jee-advanced-2027", short: { en: "JEE Advanced", hi: "जेईई एडवांस्ड" }, category: "engineering", cycle: "2027" },
    { id: "neet-ug", profileId: "neet-ug-2027", short: { en: "NEET UG", hi: "नीट यूजी" }, category: "medical", cycle: "2027" },
    { id: "upsc-cse", profileId: "upsc-cse-2027", short: { en: "UPSC Prelims", hi: "यूपीएससी प्रीलिम्स" }, category: "civil_services", cycle: "2027" },
  ],
  classes: [9, 10, 11, 12],
  rotatingFreeChapters: [],
  intro: { pricePaise: 100, monthlyPaise: 9900, currency: "INR" },
};

const SUBJECT_NAMES: Record<string, { family: string; name: L; illustration: string }> = {
  phy: { family: "physics", name: { en: "Physics", hi: "भौतिकी" }, illustration: "subject-physics" },
  chem: { family: "chemistry", name: { en: "Chemistry", hi: "रसायन विज्ञान" }, illustration: "subject-chemistry" },
  math: { family: "maths", name: { en: "Mathematics", hi: "गणित" }, illustration: "subject-maths" },
  bio: { family: "biology", name: { en: "Biology", hi: "जीव विज्ञान" }, illustration: "subject-biology" },
  polity: { family: "polity", name: { en: "Polity", hi: "राजव्यवस्था" }, illustration: "subject-polity" },
  history: { family: "history", name: { en: "History", hi: "इतिहास" }, illustration: "subject-history" },
};

const SUBJECTS_FOR: Record<string, string[]> = {
  "jee-main-2027": ["phy", "chem", "math"],
  "jee-advanced-2027": ["phy", "chem", "math"],
  "neet-ug-2027": ["phy", "chem", "bio"],
  "upsc-cse-2027": ["polity", "history"],
  school: ["phy", "chem", "math", "bio"],
  curious: ["phy", "bio", "history"],
};

const CHAPTERS_PER_SUBJECT = 4;
const TOPICS_PER_CHAPTER = 4;

function subject(id: string): Subject {
  const meta = SUBJECT_NAMES[id] ?? { family: "physics", name: { en: id, hi: id }, illustration: "subject-physics" };
  return {
    id,
    family: meta.family,
    name: meta.name,
    illustration: meta.illustration,
    chapters: Array.from({ length: CHAPTERS_PER_SUBJECT }, (_, c) => ({
      id: `${id}.ch${c + 1}`,
      index: c,
      title: { en: `Chapter ${c + 1} (fixture)`, hi: `अध्याय ${c + 1} (फ़िक्स्चर)` },
      topics: Array.from({ length: TOPICS_PER_CHAPTER }, (_, t) => ({
        id: `${id}.ch${c + 1}.t${t + 1}`,
        title: { en: `Topic ${c + 1}.${t + 1} (fixture)`, hi: `टॉपिक ${c + 1}.${t + 1} (फ़िक्स्चर)` },
        minutes: 2 + (t % 3),
      })),
    })),
  };
}

export function fixtureCatalog(profileIds: readonly string[]): CatalogResponse {
  const ids = new Set<string>();
  for (const p of profileIds.length ? profileIds : ["jee-main-2027"]) for (const s of SUBJECTS_FOR[p] ?? SUBJECTS_FOR["jee-main-2027"] ?? []) ids.add(s);
  return { fixture: true, subjects: [...ids].map(subject) };
}

const pick = (l: L, locale: "en" | "hi") => l[locale];

/** A placeholder lesson for any fixture topic. Physics chapter 1 topic 2 carries a sim card. */
export function fixtureLesson(topicId: string, locale: "en" | "hi"): Lesson | null {
  const m = /^([a-z]+)\.ch(\d+)\.t(\d+)$/.exec(topicId);
  if (!m) return null;
  const [, subj = "phy", ch = "1", tp = "1"] = m;
  const meta = SUBJECT_NAMES[subj];
  if (!meta) return null;
  const hi = locale === "hi";
  const tag = hi ? "(फ़िक्स्चर)" : "(fixture)";
  const cards: LessonCard[] = [
    {
      type: "concept",
      id: `${topicId}.c1`,
      title: hi ? `पहला विचार ${tag}` : `First idea ${tag}`,
      body: hi ? "यह जगह असली पाठ के लिए है। यहाँ विचार दो-तीन पंक्तियों में आएगा।" : "Placeholder text. The real lesson explains the idea here in two or three lines.",
      illustration: meta.illustration,
      illustrationAlt: pick(meta.name, locale),
    },
    {
      type: "worked_example",
      id: `${topicId}.c2`,
      title: hi ? `हल किया उदाहरण ${tag}` : `Worked example ${tag}`,
      steps: hi ? ["पहला कदम (फ़िक्स्चर)।", "दूसरा कदम (फ़िक्स्चर)।"] : ["Placeholder step one.", "Placeholder step two."],
    },
    {
      type: "mcq",
      id: `${topicId}.c3`,
      prompt: hi ? `फ़िक्स्चर प्रश्न: कौन-सा विकल्प सही चिह्नित है?` : `Fixture question: which option is marked correct?`,
      options: [
        { id: "a", label: hi ? "विकल्प A" : "Option A" },
        { id: "b", label: hi ? "विकल्प B (सही)" : "Option B (correct)" },
        { id: "c", label: hi ? "विकल्प C" : "Option C" },
      ],
      correctId: "b",
      hint: hi ? "संकेत: सही विकल्प पर '(सही)' लिखा है।" : "Hint: the right option says '(correct)'.",
      explanation: hi ? "फ़िक्स्चर व्याख्या।" : "Placeholder explanation.",
    },
  ];
  if (subj === "phy" && ch === "1" && tp === "2") {
    cards.push({
      type: "sim",
      id: `${topicId}.c4`,
      title: hi ? `सिम आज़माएँ ${tag}` : `Try the sim ${tag}`,
      simId: "simple-pendulum",
      caption: hi ? "लंबाई बदलें और देखें।" : "Change the length and watch.",
    });
  }
  cards.push(
    {
      type: "numeric",
      id: `${topicId}.c5`,
      prompt: hi ? "फ़िक्स्चर: संख्या 4 लिखें।" : "Fixture: type the number 4.",
      answer: 4,
      tolerance: 0.01,
      hint: hi ? "संकेत: 4 लिखें।" : "Hint: type 4.",
      explanation: hi ? "फ़िक्स्चर व्याख्या।" : "Placeholder explanation.",
    },
    {
      type: "concept",
      id: `${topicId}.c6`,
      title: hi ? `दूसरा विचार ${tag}` : `Second idea ${tag}`,
      body: hi ? "फ़िक्स्चर पाठ।" : "More placeholder text.",
    },
    {
      type: "recap",
      id: `${topicId}.c7`,
      title: hi ? `सार ${tag}` : `Recap ${tag}`,
      points: hi ? ["पहला बिंदु (फ़िक्स्चर)।", "दूसरा बिंदु (फ़िक्स्चर)।"] : ["Placeholder point one.", "Placeholder point two."],
    },
  );
  return {
    topicId,
    title: hi ? `टॉपिक ${ch}.${tp} (फ़िक्स्चर)` : `Topic ${ch}.${tp} (fixture)`,
    subject: subj,
    bundleVersion: "fixture-1",
    minutes: 2,
    fixture: true,
    cards,
  };
}

export function fixtureQuestions(subjectId: string, count: number): PracticeQuestion[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `q.${subjectId}.${i + 1}`,
    subjectId,
    prompt: { en: `Fixture practice question ${i + 1}: pick the option marked correct.`, hi: `फ़िक्स्चर अभ्यास प्रश्न ${i + 1}: सही चिह्नित विकल्प चुनें।` },
    options: ["a", "b", "c", "d"].map((id, j) => ({
      id,
      label: { en: `Option ${id.toUpperCase()}${j === i % 4 ? " (correct)" : ""}`, hi: `विकल्प ${id.toUpperCase()}${j === i % 4 ? " (सही)" : ""}` },
    })),
    correctId: ["a", "b", "c", "d"][i % 4] ?? "a",
    solution: { en: "Placeholder solution.", hi: "फ़िक्स्चर हल।" },
  }));
}
