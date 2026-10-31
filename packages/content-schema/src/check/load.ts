import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import type {
  BlueprintFile,
  ChapterFile,
  Concept,
  ExamFile,
  ExamMapFile,
  ExamProfile,
  ExtrasFile,
  Inventory,
  LessonFile,
  MediaRequest,
  MediaRequestsFile,
  Mnemonic,
  MnemonicsFile,
  PalaceTemplateFile,
  PyqPaperFile,
  Question,
  QuestionsFile,
  SeedPackSpecFile,
  SimManifest,
  SubjectFile,
  Syllabus,
  Topic,
  Subtopic,
} from "../generated/types.js";
import { validateDocument } from "../validate.js";
import type { Findings } from "./findings.js";

/** A parsed content file. */
export interface Loaded<T> {
  file: string;
  doc: T;
}

export interface ConceptEntry {
  concept: Concept;
  subtopic: Subtopic;
  topic: Topic;
  chapter: ChapterFile;
  file: string;
  /** Position of the concept inside its subtopic. */
  sort: number;
}

export interface TopicEntry {
  topic: Topic;
  chapter: ChapterFile;
  file: string;
  sort: number;
}

export interface QuestionEntry {
  question: Question;
  /** The paragraph question this one belongs to, for children. */
  parent?: Question;
  topic: string;
  file: string;
  path: string;
}

export interface ContentSet {
  /** Absolute path of the content root. */
  root: string;
  /** Absolute repo root (for design assets, tokens and sims). */
  repoRoot: string;
  /** True when the root is the fixture course. */
  isFixtureRoot: boolean;
  files: Loaded<Record<string, unknown>>[];
  exams: Loaded<ExamFile>[];
  profiles: Map<string, { exam: ExamFile; profile: ExamProfile; file: string }>;
  blueprints: Loaded<BlueprintFile>[];
  subjects: Loaded<SubjectFile>[];
  chapters: Loaded<ChapterFile>[];
  examMaps: Loaded<ExamMapFile>[];
  lessons: Loaded<LessonFile>[];
  questionFiles: Loaded<QuestionsFile>[];
  pyqPapers: Loaded<PyqPaperFile>[];
  mnemonicFiles: Loaded<MnemonicsFile>[];
  mediaFiles: Loaded<MediaRequestsFile>[];
  extras: Loaded<ExtrasFile>[];
  syllabi: Loaded<Syllabus>[];
  inventories: Loaded<Inventory>[];
  seedSpecs: Loaded<SeedPackSpecFile>[];
  sims: Loaded<SimManifest>[];
  /** Memory palace templates (palace_template@1, memory-labs §5.6). */
  palaceTemplates: Loaded<PalaceTemplateFile>[];
  /** Indexes. */
  concepts: Map<string, ConceptEntry>;
  aliases: Map<string, string>;
  topics: Map<string, TopicEntry>;
  questions: Map<string, QuestionEntry>;
  mnemonics: Map<string, { mnemonic: Mnemonic; file: string }>;
  media: Map<string, { request: MediaRequest; file: string }>;
  extrasById: Map<string, Loaded<ExtrasFile>>;
  simsById: Map<string, Loaded<SimManifest>>;
}

export interface LoadOptions {
  /** Skip these top-level directories of the root (the real content root skips fixtures/). */
  skipDirs?: string[];
  repoRoot: string;
  /** Extra sim manifests (repo-level sims/{id}/sim.json). */
  simRoots?: string[];
}

function walk(dir: string, skip: Set<string>, base: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const rel = relative(base, full);
    if (statSync(full).isDirectory()) {
      if (skip.has(rel.split(sep).join("/"))) continue;
      if (name === "node_modules" || name.startsWith(".")) continue;
      walk(full, skip, base, out);
    } else if (name.endsWith(".json")) {
      out.push(full);
    }
  }
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/** Reads, parses and schema-validates every JSON file under the root, then builds the indexes. */
export function loadContentSet(root: string, findings: Findings, options: LoadOptions): ContentSet {
  const set: ContentSet = {
    root,
    repoRoot: options.repoRoot,
    isFixtureRoot: false,
    files: [],
    exams: [],
    profiles: new Map(),
    blueprints: [],
    subjects: [],
    chapters: [],
    examMaps: [],
    lessons: [],
    questionFiles: [],
    pyqPapers: [],
    mnemonicFiles: [],
    mediaFiles: [],
    extras: [],
    syllabi: [],
    inventories: [],
    seedSpecs: [],
    sims: [],
    palaceTemplates: [],
    concepts: new Map(),
    aliases: new Map(),
    topics: new Map(),
    questions: new Map(),
    mnemonics: new Map(),
    media: new Map(),
    extrasById: new Map(),
    simsById: new Map(),
  };

  const paths: string[] = [];
  walk(root, new Set(options.skipDirs ?? []), root, paths);
  const simPaths: string[] = [];
  for (const simRoot of options.simRoots ?? []) {
    if (!existsSync(simRoot)) continue;
    for (const id of readdirSync(simRoot).sort()) {
      const manifest = join(simRoot, id, "sim.json");
      if (existsSync(manifest)) simPaths.push(manifest);
    }
  }

  for (const abs of [...paths, ...simPaths]) {
    const file = toPosix(relative(root, abs));
    // Generated coverage reports are outputs, not inputs.
    if (/^coverage\/[^/]+\.json$/.test(file)) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(readFileSync(abs, "utf8"));
    } catch (err) {
      findings.error("parse_error", file, `is not valid JSON: ${(err as Error).message}`);
      continue;
    }
    const result = validateDocument(doc);
    if (!result.ok) {
      for (const e of result.errors) {
        findings.error(
          result.schema ? "schema_error" : "unknown_schema",
          file,
          `${e.path || "/"} ${e.message}`,
          { path: e.path },
        );
      }
      continue;
    }
    const loaded = { file, doc: doc as Record<string, unknown> };
    set.files.push(loaded);
    classify(set, loaded, findings);
  }
  buildIndexes(set, findings);
  return set;
}

function classify(set: ContentSet, loaded: Loaded<Record<string, unknown>>, findings: Findings): void {
  const tag = loaded.doc.schema as string;
  const as = <T>() => loaded as unknown as Loaded<T>;
  switch (tag) {
    case "exam@1":
      set.exams.push(as<ExamFile>());
      break;
    case "blueprint@1":
      set.blueprints.push(as<BlueprintFile>());
      break;
    case "subject@1":
      set.subjects.push(as<SubjectFile>());
      break;
    case "chapter@1":
      set.chapters.push(as<ChapterFile>());
      break;
    case "exam-map@1":
      set.examMaps.push(as<ExamMapFile>());
      break;
    case "lesson@1":
      set.lessons.push(as<LessonFile>());
      break;
    case "questions@1":
      set.questionFiles.push(as<QuestionsFile>());
      break;
    case "pyq-paper@1":
      set.pyqPapers.push(as<PyqPaperFile>());
      break;
    case "mnemonics@1":
      set.mnemonicFiles.push(as<MnemonicsFile>());
      break;
    case "media-requests@1":
      set.mediaFiles.push(as<MediaRequestsFile>());
      break;
    case "syllabus@1":
      set.syllabi.push(as<Syllabus>());
      break;
    case "inventory@1":
      set.inventories.push(as<Inventory>());
      break;
    case "seed-pack-spec@1":
      set.seedSpecs.push(as<SeedPackSpecFile>());
      break;
    case "sim@1":
      set.sims.push(as<SimManifest>());
      break;
    case "cheat_sheet@1":
    case "revision_sheet@1":
    case "storybook@1":
    case "song@1":
    case "play@1":
    case "experiment@1":
    case "roleplay@1":
    case "mind_map_template@1":
      set.extras.push(as<ExtrasFile>());
      break;
    case "palace_template@1":
      set.palaceTemplates.push(as<PalaceTemplateFile>());
      break;
    default:
      findings.error(
        "unexpected_schema",
        loaded.file,
        `${tag} is a published artefact, not a source file; it does not belong in content/`,
      );
  }
}

function buildIndexes(set: ContentSet, findings: Findings): void {
  const dup = (kind: string, id: string, file: string, other: string): void =>
    findings.error("duplicate_id", file, `${kind} ${id} is also defined in ${other}`, { id });

  for (const { file, doc } of set.exams) {
    for (const profile of doc.profiles) {
      const existing = set.profiles.get(profile.id);
      if (existing) dup("exam profile", profile.id, file, existing.file);
      else set.profiles.set(profile.id, { exam: doc, profile, file });
    }
  }

  for (const { file, doc: chapter } of set.chapters) {
    chapter.topics.forEach((topic, topicSort) => {
      const existingTopic = set.topics.get(topic.id);
      if (existingTopic) dup("topic", topic.id, file, existingTopic.file);
      else set.topics.set(topic.id, { topic, chapter, file, sort: topicSort });
      for (const subtopic of topic.subtopics) {
        subtopic.concepts.forEach((concept, sort) => {
          const existing = set.concepts.get(concept.id);
          if (existing) dup("concept", concept.id, file, existing.file);
          else set.concepts.set(concept.id, { concept, subtopic, topic, chapter, file, sort });
          for (const alias of concept.aliases ?? []) set.aliases.set(alias, concept.id);
        });
      }
    });
  }

  for (const { file, doc } of set.questionFiles) {
    doc.questions.forEach((question, i) => {
      const add = (q: Question, path: string, parent?: Question): void => {
        const existing = set.questions.get(q.id);
        if (existing) dup("question", q.id, file, existing.file);
        else set.questions.set(q.id, { question: q, parent, topic: doc.topic, file, path });
      };
      add(question, `/questions/${i}`);
      if (question.type === "paragraph") {
        question.children.forEach((child, j) =>
          add(child as Question, `/questions/${i}/children/${j}`, question),
        );
      }
    });
  }

  for (const { file, doc } of set.mnemonicFiles) {
    for (const mnemonic of doc.items) {
      const existing = set.mnemonics.get(mnemonic.id);
      if (existing) dup("mnemonic", mnemonic.id, file, existing.file);
      else set.mnemonics.set(mnemonic.id, { mnemonic, file });
    }
  }

  for (const { file, doc } of set.mediaFiles) {
    for (const request of doc.requests) {
      const existing = set.media.get(request.id);
      if (existing) dup("media request", request.id, file, existing.file);
      else set.media.set(request.id, { request, file });
    }
  }

  for (const loaded of set.extras) {
    const existing = set.extrasById.get(loaded.doc.id);
    if (existing) dup("extra", loaded.doc.id, loaded.file, existing.file);
    else set.extrasById.set(loaded.doc.id, loaded);
  }

  for (const loaded of set.sims) {
    const existing = set.simsById.get(loaded.doc.id);
    if (existing) dup("sim", loaded.doc.id, loaded.file, existing.file);
    else set.simsById.set(loaded.doc.id, loaded);
  }
}
