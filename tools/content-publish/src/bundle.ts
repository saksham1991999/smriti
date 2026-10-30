import type {
  Bundle,
  BundleCard,
  BundleMnemonic,
  BundleMode,
  BundleQuestion,
  Card,
  LessonFile,
  Question,
  ResolvedMedia,
} from "@smriti/content-schema";
import { SERVER_ONLY_USES, localize, validateWith } from "@smriti/content-schema";
import type { ContentSet } from "@smriti/content-schema/check";
import { mediaRefs } from "@smriti/content-schema/check";

import { hashed } from "./canonical.js";
import { PublishError } from "./errors.js";
import { buildMathMap } from "./math.js";
import { type AssetFile, type MediaContext, resolveMedia } from "./media.js";

export const DEFAULT_MIN_APP_VERSION = "1.0.0";
export const BUNDLE_MODES: readonly BundleMode[] = ["deep_dive", "quick_revision", "practice"];

/** Question uses that ship in a topic's practice bundle. */
const PRACTICE_USES = new Set(["practice", "lesson", "placement"]);

/** Authoring fields that never ship to devices. */
const AUTHORING_FIELDS = ["status", "sources", "authored_by", "reviewed_by", "updated", "notes", "fixture"] as const;

export interface BuiltBundle {
  bundle: Bundle;
  /** Canonical JSON bytes; the file content. */
  bytes: Buffer;
  hash: string;
  /** `bundles/{topic}.{mode}.{locale}.{hash}.json` */
  path: string;
  assets: AssetFile[];
  cardCount: number;
}

export function bundleId(topic: string, mode: BundleMode, locale: string): string {
  return `${topic}:${mode}:${locale}`;
}

export function bundlePath(topic: string, mode: BundleMode, locale: string, hash: string): string {
  return `bundles/${topic}.${mode}.${locale}.${hash}.json`;
}

export function findLesson(set: ContentSet, topic: string, mode: BundleMode): LessonFile | undefined {
  return set.lessons.find((l) => l.doc.topic === topic && l.doc.mode === mode)?.doc;
}

/** True when there is something to publish for this topic and mode. */
export function hasBundle(set: ContentSet, topic: string, mode: BundleMode): boolean {
  if (mode === "practice") return practiceQuestions(set, topic).length > 0;
  return findLesson(set, topic, mode) !== undefined;
}

function practiceQuestions(set: ContentSet, topic: string): Question[] {
  const out: Question[] = [];
  for (const q of set.questions.values()) {
    if (q.parent || q.topic !== topic) continue;
    if (q.question.use.some((u) => SERVER_ONLY_USES.includes(u))) continue;
    if (q.question.use.some((u) => PRACTICE_USES.has(u))) out.push(q.question);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function stripAuthoring<T extends object>(doc: T): T {
  const out = { ...doc } as Record<string, unknown>;
  for (const f of AUTHORING_FIELDS) delete out[f];
  return out as T;
}

/** Build one immutable bundle: one topic x mode x locale. */
export function buildBundle(
  set: ContentSet,
  topicId: string,
  mode: BundleMode,
  locale: string,
  ctx: MediaContext,
): BuiltBundle {
  const topicEntry = set.topics.get(topicId);
  if (!topicEntry) throw new PublishError("topic_unknown", `${topicId} is not in the graph`);
  const { topic, chapter } = topicEntry;
  const L = <T>(v: T, where: string) => {
    try {
      return localize(v, locale);
    } catch (e) {
      throw new PublishError("missing_locale", `${where}: ${(e as Error).message}`);
    }
  };

  const lesson = mode === "practice" ? undefined : findLesson(set, topicId, mode);
  if (mode !== "practice" && !lesson) throw new PublishError("lesson_missing", `${topicId} has no ${mode} lesson`);

  // Questions: the lesson's question cards, or the topic's practice set.
  const questionIds = new Set<string>();
  if (lesson) {
    for (const c of lesson.cards) if (c.type === "question") questionIds.add(c.question);
  } else {
    for (const q of practiceQuestions(set, topicId)) questionIds.add(q.id);
  }
  const questions: Record<string, BundleQuestion> = {};
  for (const id of [...questionIds].sort()) {
    const entry = set.questions.get(id);
    if (!entry) throw new PublishError("question_unknown", `${id} is not in questions/`);
    const q = entry.parent ?? entry.question;
    if (q.use.some((u) => SERVER_ONLY_USES.includes(u))) {
      throw new PublishError("server_only_question", `${q.id} has a server-only use and cannot ship`);
    }
    questions[q.id] = L(q, q.id) as BundleQuestion;
  }

  const cards = (lesson?.cards ?? []).map((c: Card) => L(c, c.id) as BundleCard);

  // Extras the cards point at: cheat sheets and revision sheets, role-play scripts.
  const sheetIds = new Set<string>();
  for (const c of cards) {
    if (c.type === "cheat_sheet_ref") sheetIds.add(c.sheet);
    if (c.type === "roleplay" && c.script) sheetIds.add(c.script);
  }
  const sheets: Record<string, Record<string, unknown>> = {};
  for (const id of [...sheetIds].sort()) {
    const extra = set.extrasById.get(id);
    if (!extra) throw new PublishError("extra_unknown", `${id} is not in extras/`);
    sheets[id] = L(stripAuthoring(extra.doc), id) as Record<string, unknown>;
  }

  // Mnemonics: one id per locale on memory_hook cards and cheat sheets.
  const mnemonicIds = new Set<string>();
  for (const c of cards) if (c.type === "memory_hook") mnemonicIds.add(c.mnemonic);
  for (const s of Object.values(sheets)) {
    const list = (s as { mnemonics?: unknown }).mnemonics;
    if (Array.isArray(list)) for (const m of list) if (typeof m === "string") mnemonicIds.add(m);
  }
  const mnemonics: Record<string, BundleMnemonic> = {};
  for (const id of [...mnemonicIds].sort()) {
    const m = set.mnemonics.get(id);
    if (!m) throw new PublishError("mnemonic_unknown", `${id} is not in mnemonics/`);
    if (m.mnemonic.locale !== locale) {
      throw new PublishError("mnemonic_locale", `${id} is written in ${m.mnemonic.locale}, not ${locale}`);
    }
    const { notes: _notes, ...rest } = m.mnemonic;
    mnemonics[id] = rest;
  }

  // Concepts the lesson covers (all of the topic's for practice).
  const conceptIds = lesson
    ? lesson.concepts
    : topic.subtopics.flatMap((s) => s.concepts.map((c) => c.id));
  const concepts = conceptIds.map((id) => {
    const e = set.concepts.get(set.aliases.get(id) ?? id);
    if (!e) throw new PublishError("concept_unknown", `${id} is not in the graph`);
    const c = e.concept;
    return {
      id: c.id,
      name: L(c.name, c.id),
      kind: c.kind,
      intrinsic_depth: c.intrinsic_depth,
      summary: L(c.summary, c.id),
      key_points: L(c.key_points, c.id),
    };
  });

  const bites = lesson ? buildBites(set, lesson, cards, locale) : [];

  // Papers behind PYQ questions, for the "Asked in {exam} {year}" chip.
  const pyqPapers: Record<string, { exam: string; exam_name: string; year: number; session_label: string | null }> =
    {};
  for (const q of Object.values(questions)) {
    if (!q.pyq) continue;
    const paper = set.pyqPapers.find((p) => p.doc.id === q.pyq?.paper)?.doc;
    if (!paper) throw new PublishError("pyq_paper_unknown", `${q.id} links to unknown paper ${q.pyq.paper}`);
    const exam = set.exams.find((e) => e.doc.id === paper.exam)?.doc;
    pyqPapers[paper.id] = {
      exam: paper.exam,
      exam_name: exam ? L(exam.name, exam.id) : paper.exam,
      year: paper.year,
      session_label: paper.session_label ?? null,
    };
  }

  // Media: every request id anywhere in the localised payload.
  const payload = { cards, questions, sheets, mnemonics };
  const media: Record<string, ResolvedMedia> = {};
  const assets = new Map<string, AssetFile>();
  for (const { ref } of mediaRefs(payload)) {
    if (media[ref]) continue;
    const r = resolveMedia(ref, locale, ctx);
    media[ref] = r.media;
    if (r.asset) assets.set(r.asset.key, r.asset);
  }

  const math = buildMathMap({ ...payload, concepts, bites, topic: L(topic.name, topic.id) });

  const bundle: Bundle = {
    schema: "bundle@1",
    id: bundleId(topicId, mode, locale),
    ...(ctx.fixture ? { fixture: true } : {}),
    topic: {
      id: topic.id,
      chapter: chapter.id,
      subject: chapter.subject,
      name: L(topic.name, topic.id),
      ...(topic.summary ? { summary: L(topic.summary, topic.id) } : {}),
    },
    mode,
    locale: locale as Bundle["locale"],
    min_app_version: lesson?.min_app_version ?? DEFAULT_MIN_APP_VERSION,
    ...(lesson
      ? {
          lesson_id: lesson.id,
          estimated_minutes: lesson.estimated_minutes,
          min_depth: lesson.min_depth,
          max_depth: lesson.max_depth,
        }
      : {}),
    concepts,
    bites,
    cards: cards as Bundle["cards"],
    questions: questions as Bundle["questions"],
    mnemonics,
    sheets,
    ...(Object.keys(pyqPapers).length ? { pyq_papers: pyqPapers } : {}),
    media,
    math,
  };
  const check = validateWith("bundle.schema.json", bundle);
  if (!check.ok) {
    throw new PublishError("bundle_invalid", `${bundle.id}: ${check.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
  }
  const { bytes, hash } = hashed(bundle);
  return {
    bundle,
    bytes,
    hash,
    path: bundlePath(topicId, mode, locale, hash),
    assets: [...assets.values()].sort((a, b) => a.key.localeCompare(b.key)),
    cardCount: mode === "practice" ? Object.keys(questions).length : cards.length,
  };
}

/** The lesson's bites, or bites derived by ending one after each summary card. */
function buildBites(set: ContentSet, lesson: LessonFile, cards: BundleCard[], locale: string): Bundle["bites"] {
  if (lesson.bites && lesson.bites.length > 0) {
    return lesson.bites.map((b) => ({
      id: b.id,
      title: localize(b.title, locale),
      ...(b.subtopic ? { subtopic: b.subtopic } : {}),
      card_ids: b.card_ids,
      estimated_minutes: b.estimated_minutes,
    }));
  }
  const groups: BundleCard[][] = [];
  let current: BundleCard[] = [];
  for (const c of cards) {
    current.push(c);
    if (c.type === "summary") {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);
  const total = cards.length || 1;
  return groups.map((g, i) => {
    const first = g[0] as BundleCard;
    const concept = set.concepts.get(first.concepts[0] as string);
    const title = concept ? localize(concept.subtopic.name, locale) : localize(set.topics.get(lesson.topic)!.topic.name, locale);
    return {
      id: `bite-${i + 1}`,
      title,
      ...(concept ? { subtopic: concept.subtopic.id } : {}),
      card_ids: g.map((c) => c.id),
      estimated_minutes: Math.max(0.5, Math.round(((lesson.estimated_minutes * g.length) / total) * 2) / 2),
      derived: true,
    };
  });
}
