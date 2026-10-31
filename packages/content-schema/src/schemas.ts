import blueprint from "../schemas/blueprint.schema.json";
import bundle from "../schemas/bundle.schema.json";
import card from "../schemas/card.schema.json";
import chapter from "../schemas/chapter.schema.json";
import common from "../schemas/common.schema.json";
import coverageInputs from "../schemas/coverage-inputs.schema.json";
import coverage from "../schemas/coverage.schema.json";
import exam from "../schemas/exam.schema.json";
import examMap from "../schemas/exam-map.schema.json";
import extras from "../schemas/extras.schema.json";
import forgeDraft from "../schemas/forge-draft.schema.json";
import lesson from "../schemas/lesson.schema.json";
import manifest from "../schemas/manifest.schema.json";
import mediaRequests from "../schemas/media-requests.schema.json";
import mnemonics from "../schemas/mnemonics.schema.json";
import palaceTemplate from "../schemas/palace-template.schema.json";
import patch from "../schemas/patch.schema.json";
import publishHistory from "../schemas/publish-history.schema.json";
import pyqPaper from "../schemas/pyq-paper.schema.json";
import questions from "../schemas/questions.schema.json";
import releases from "../schemas/releases.schema.json";
import seedPack from "../schemas/seed-pack.schema.json";
import seedPackSpec from "../schemas/seed-pack-spec.schema.json";
import sim from "../schemas/sim.schema.json";
import subject from "../schemas/subject.schema.json";

export const SCHEMA_BASE = "https://schemas.smriti.app/content/";

/** Every JSON Schema in this package, keyed by file name. */
export const schemaFiles = {
  "common.schema.json": common,
  "exam.schema.json": exam,
  "blueprint.schema.json": blueprint,
  "subject.schema.json": subject,
  "chapter.schema.json": chapter,
  "exam-map.schema.json": examMap,
  "card.schema.json": card,
  "lesson.schema.json": lesson,
  "questions.schema.json": questions,
  "pyq-paper.schema.json": pyqPaper,
  "mnemonics.schema.json": mnemonics,
  "media-requests.schema.json": mediaRequests,
  "sim.schema.json": sim,
  "extras.schema.json": extras,
  "coverage-inputs.schema.json": coverageInputs,
  "coverage.schema.json": coverage,
  "seed-pack-spec.schema.json": seedPackSpec,
  "releases.schema.json": releases,
  "seed-pack.schema.json": seedPack,
  "bundle.schema.json": bundle,
  "manifest.schema.json": manifest,
  "patch.schema.json": patch,
  "publish-history.schema.json": publishHistory,
  "forge-draft.schema.json": forgeDraft,
  "palace-template.schema.json": palaceTemplate,
} as const;

export type SchemaFile = keyof typeof schemaFiles;

/**
 * The `schema` value each content document carries ("lesson@1") and the schema file that validates it.
 */
export const DOC_SCHEMAS = {
  "exam@1": "exam.schema.json",
  "blueprint@1": "blueprint.schema.json",
  "subject@1": "subject.schema.json",
  "chapter@1": "chapter.schema.json",
  "exam-map@1": "exam-map.schema.json",
  "lesson@1": "lesson.schema.json",
  "questions@1": "questions.schema.json",
  "pyq-paper@1": "pyq-paper.schema.json",
  "mnemonics@1": "mnemonics.schema.json",
  "media-requests@1": "media-requests.schema.json",
  "sim@1": "sim.schema.json",
  "cheat_sheet@1": "extras.schema.json",
  "revision_sheet@1": "extras.schema.json",
  "storybook@1": "extras.schema.json",
  "song@1": "extras.schema.json",
  "play@1": "extras.schema.json",
  "experiment@1": "extras.schema.json",
  "roleplay@1": "extras.schema.json",
  "mind_map_template@1": "extras.schema.json",
  "palace_template@1": "palace-template.schema.json",
  "syllabus@1": "coverage-inputs.schema.json",
  "inventory@1": "coverage-inputs.schema.json",
  "coverage@1": "coverage.schema.json",
  "seed-pack-spec@1": "seed-pack-spec.schema.json",
  "releases@1": "releases.schema.json",
  "seed-pack@1": "seed-pack.schema.json",
  "bundle@1": "bundle.schema.json",
  "manifest@1": "manifest.schema.json",
  "patch@1": "patch.schema.json",
  "publish-history@1": "publish-history.schema.json",
} as const satisfies Record<string, SchemaFile>;

export type DocSchemaId = keyof typeof DOC_SCHEMAS;

export function isDocSchemaId(value: unknown): value is DocSchemaId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DOC_SCHEMAS, value);
}
