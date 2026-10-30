/**
 * SQL upserts for the content.* catalogue (DB_SCHEMA §4, migration 20261029000002_content.sql).
 * Postgres holds a projection of content/: the graph, metadata, bundle and manifest pointers,
 * questions and server-only answer keys. Lesson cards stay in the R2 bundles.
 *
 * Link tables (edges, concept links, PYQ items) are replaced for the parents being published, so
 * a removed link disappears. Columns computed from student data (questions.difficulty and
 * discrimination, mnemonic votes) are never written here.
 */
import type { BlueprintFile, ExtrasFile, PublishHistory, Question } from "@smriti/content-schema";
import { SERVER_ONLY_USES } from "@smriti/content-schema";
import type { ContentSet } from "@smriti/content-schema/check";
import { relative } from "node:path";

import { canonicalJson, uuidv5 } from "./canonical.js";
import { freeInSubjectOrder } from "./plan.js";

type Value = string | number | boolean | null | Raw;
class Raw {
  constructor(readonly sql: string) {}
}

const raw = (sql: string) => new Raw(sql);
export const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
const jsonb = (v: unknown) => raw(`${lit(canonicalJson(v))}::jsonb`);
const textArr = (v: string[]) => raw(v.length ? `ARRAY[${v.map(lit).join(",")}]::text[]` : `'{}'::text[]`);
const ts = (iso: string) => raw(`${lit(iso)}::timestamptz`);
const assetIdBySha = (sha: string | null) =>
  sha ? raw(`(select id from content.media_assets where sha256 = ${lit(sha)})`) : null;

function fmt(v: Value): string {
  if (v === null) return "null";
  if (v instanceof Raw) return v.sql;
  if (typeof v === "string") return lit(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

export interface SqlInputs {
  set: ContentSet;
  history: PublishHistory;
  now: string;
  fixture: boolean;
  /** Topics, concepts etc. limited to these subjects (null: all). */
  subjects: Set<string> | null;
  bundles: {
    id: string;
    topic: string;
    mode: string;
    locale: string;
    hash: string;
    size: number;
    cardCount: number;
    minApp: string;
  }[];
  patches: { bundleId: string; from: string; to: string; size: number }[];
  manifests: { profile: string; locale: string }[];
  seedPacks: { variant: string; locale: string; bundleIds: string[]; hash: string }[];
  /** content item id -> current version */
  itemVersions: Map<string, number>;
  /** question id -> current version */
  questionVersions: Map<string, number>;
}

export interface SqlOutput {
  sql: string;
  /** Every table written and the columns written to it, for the publish report. */
  tables: Record<string, string[]>;
  rowCounts: Record<string, number>;
}

const EXTRA_KIND: Record<string, string | null> = {
  "cheat_sheet@1": "cheat_sheet",
  "revision_sheet@1": "revision_sheet",
  "storybook@1": "storybook",
  "experiment@1": "experiment",
  "mind_map_template@1": "mind_map_template",
  // content.content_items has no role-play kind yet (reported as a gap); role plays ship in bundles.
  "roleplay@1": null,
};

const EXTRA_ROLE: Record<string, string> = {
  cheat_sheet: "revises",
  revision_sheet: "revises",
  storybook: "teaches",
  experiment: "teaches",
  mind_map_template: "mentions",
};

const MEDIA_KIND: Record<string, string | null> = {
  image: "image",
  diagram: "image",
  comic: "image",
  pano360: "pano360",
  animation_rive: "rive",
  animation_lottie: "lottie",
  model3d: "model3d",
  audio_tts: "audio",
  audio_song: "audio",
  sim: null,
};

export function blueprintUuid(profile: string, paper: string, version: number): string {
  return uuidv5(`blueprint:${profile}:${paper}:${version}`);
}

export function generateSql(inp: SqlInputs): SqlOutput {
  const { set } = inp;
  const out: string[] = [];
  const tables: Record<string, string[]> = {};
  const rowCounts: Record<string, number> = {};

  const upsert = (table: string, cols: string[], rows: Value[][], conflict: string[], update?: string[]) => {
    tables[`content.${table}`] = cols;
    rowCounts[`content.${table}`] = (rowCounts[`content.${table}`] ?? 0) + rows.length;
    if (rows.length === 0) return;
    const upd = (update ?? cols.filter((c) => !conflict.includes(c))).filter((c) => cols.includes(c));
    const action = upd.length ? `do update set ${upd.map((c) => `${c} = excluded.${c}`).join(", ")}` : "do nothing";
    out.push(
      `insert into content.${table} (${cols.join(", ")}) values\n  ${rows
        .map((r) => `(${r.map(fmt).join(", ")})`)
        .join(",\n  ")}\non conflict (${conflict.join(", ")}) ${action};`,
    );
  };
  const del = (table: string, col: string, ids: string[]) => {
    if (ids.length) out.push(`delete from content.${table} where ${col} in (${ids.map(lit).join(", ")});`);
  };

  const inSubject = (subject: string) => !inp.subjects || inp.subjects.has(subject);
  const subjects = set.subjects.map((s) => s.doc).filter((s) => inSubject(s.id));
  const chapters = set.chapters.map((c) => c.doc).filter((c) => inSubject(c.subject));
  const conceptIds = new Set<string>();
  for (const ch of chapters) for (const t of ch.topics) for (const st of t.subtopics) for (const c of st.concepts) conceptIds.add(c.id);
  const topicIds = new Set(chapters.flatMap((c) => c.topics.map((t) => t.id)));

  // 4.1 Exams, profiles and blueprints
  upsert(
    "exams",
    ["id", "name", "category", "conducting_body", "official_url", "is_active"],
    set.exams.map(({ doc: e }) => [e.id, jsonb(e.name), e.category, e.conducting_body ?? null, e.official_url ?? null, e.is_active ?? true]),
    ["id"],
  );
  upsert(
    "exam_profiles",
    ["id", "exam_id", "cycle", "name", "locales", "schedule", "is_active", "published_at"],
    [...set.profiles.values()].map(({ exam, profile: p }) => {
      const name = p.name ?? Object.fromEntries(Object.entries(exam.name).map(([l, v]) => [l, `${v} ${p.cycle}`]));
      return [p.id, exam.id, p.cycle, jsonb(name), textArr(p.locales), p.schedule ? jsonb(p.schedule) : null, p.is_active ?? true, ts(inp.now)];
    }),
    ["id"],
    ["exam_id", "cycle", "name", "locales", "schedule", "is_active"],
  );
  const latestBlueprint = new Map<string, number>();
  for (const { doc: b } of set.blueprints) {
    const k = `${b.exam_profile}:${b.paper_code}`;
    latestBlueprint.set(k, Math.max(latestBlueprint.get(k) ?? 0, b.version));
  }
  const blueprintStatus = (b: BlueprintFile) =>
    !b.reviewed_by ? "draft" : latestBlueprint.get(`${b.exam_profile}:${b.paper_code}`) === b.version ? "active" : "retired";
  upsert(
    "exam_blueprints",
    ["id", "exam_profile_id", "paper_code", "version", "spec", "source_url", "verified_at", "effective_from", "status"],
    set.blueprints.map(({ doc: b }) => {
      const { status: _s, sources: _src, authored_by: _a, reviewed_by: _r, updated: _u, notes: _n, fixture: _f, ...spec } =
        b as BlueprintFile & Record<string, unknown>;
      return [
        blueprintUuid(b.exam_profile, b.paper_code, b.version),
        b.exam_profile,
        b.paper_code,
        b.version,
        jsonb(spec),
        b.source.url,
        b.verified_at,
        b.effective_from,
        blueprintStatus(b),
      ];
    }),
    ["id"],
  );

  // 4.2 The concept graph
  upsert(
    "subjects",
    ["id", "name", "color_token", "sort"],
    subjects.map((s) => [s.id, jsonb(s.name), `subject.${s.color_family}`, s.sort]),
    ["id"],
  );
  upsert(
    "units",
    ["id", "subject_id", "name", "sort"],
    subjects.flatMap((s) => s.units.map((u, i) => [u.id, s.id, jsonb(u.name), i + 1])),
    ["id"],
  );
  const chapterSort = (c: { id: string; subject: string }) =>
    (subjects.find((s) => s.id === c.subject)?.chapters.indexOf(c.id) ?? -1) + 1;
  upsert(
    "chapters",
    ["id", "unit_id", "subject_id", "name", "ncert_ref", "sort"],
    chapters.map((c) => [c.id, c.unit, c.subject, jsonb(c.name), c.ncert_ref ?? null, chapterSort(c)]),
    ["id"],
  );
  upsert(
    "topics",
    ["id", "chapter_id", "name", "summary", "sort"],
    chapters.flatMap((c) => c.topics.map((t, i) => [t.id, c.id, jsonb(t.name), t.summary ? jsonb(t.summary) : null, i + 1])),
    ["id"],
  );
  upsert(
    "subtopics",
    ["id", "topic_id", "name", "sort"],
    chapters.flatMap((c) => c.topics.flatMap((t) => t.subtopics.map((s, i) => [s.id, t.id, jsonb(s.name), i + 1]))),
    ["id"],
  );
  upsert(
    "concepts",
    ["id", "subtopic_id", "name", "summary", "key_points", "kind", "intrinsic_depth", "sort"],
    chapters.flatMap((c) =>
      c.topics.flatMap((t) =>
        t.subtopics.flatMap((s) =>
          s.concepts.map((k, i) => [k.id, s.id, jsonb(k.name), jsonb(k.summary), jsonb(k.key_points), k.kind, k.intrinsic_depth, i + 1]),
        ),
      ),
    ),
    ["id"],
  );
  const edges: Value[][] = [];
  const edgeKinds = [
    ["prerequisites", "prerequisite"],
    ["related", "related"],
    ["contrasts", "contrast"],
    ["applies_in", "applies_in"],
  ] as const;
  for (const id of [...conceptIds].sort()) {
    const c = set.concepts.get(id)?.concept;
    if (!c) continue;
    for (const [field, kind] of edgeKinds) {
      for (const to of c[field] ?? []) {
        const target = set.aliases.get(to) ?? to;
        if (set.concepts.has(target)) edges.push([c.id, target, kind]);
      }
    }
  }
  del("concept_edges", "from_id", [...conceptIds].sort());
  upsert("concept_edges", ["from_id", "to_id", "kind"], edges, ["from_id", "to_id", "kind"]);

  const examConcepts: Value[][] = [];
  for (const { doc: m } of set.examMaps) {
    for (const c of m.concepts) {
      const id = set.aliases.get(c.id) ?? c.id;
      if (conceptIds.has(id)) examConcepts.push([m.exam_profile, id, c.depth, c.weightage, c.priority]);
    }
  }
  del("exam_concepts", "exam_profile_id", set.examMaps.map((m) => m.doc.exam_profile).sort());
  upsert("exam_concepts", ["exam_profile_id", "concept_id", "depth", "weightage", "priority"], examConcepts, [
    "exam_profile_id",
    "concept_id",
  ]);

  // 4.5 Media (before anything that points at it) and sims
  const mediaRows: Value[][] = [];
  const seenSha = new Set<string>();
  for (const { request: r } of [...set.media.values()].sort((a, b) => a.request.id.localeCompare(b.request.id))) {
    const kind = MEDIA_KIND[r.kind];
    const res = r.result;
    if (!kind || r.status !== "approved" || !res || seenSha.has(res.sha256)) continue;
    if (!res.mime || res.bytes === undefined) continue;
    seenSha.add(res.sha256);
    const source = res.licence && !/^(own|original)/i.test(res.licence)
      ? "open_licence"
      : r.kind.startsWith("audio_tts")
        ? "deepgram_tts"
        : kind === "image"
          ? "agnes"
          : "original";
    mediaRows.push([
      uuidv5(`media:${res.sha256}`),
      res.sha256,
      kind,
      res.mime,
      res.bytes,
      res.width ?? null,
      res.height ?? null,
      res.duration_ms ?? null,
      source,
      res.licence ?? null,
      res.attribution ?? null,
      r.brief,
      r.preset ?? null,
      r.alt ? jsonb(r.alt) : null,
      textArr([r.id]),
      "public",
      "approved",
    ]);
  }
  upsert(
    "media_assets",
    ["id", "sha256", "kind", "mime", "bytes", "width", "height", "duration_ms", "source", "licence", "attribution", "prompt", "style_preset", "alt", "tags", "visibility", "status"],
    mediaRows,
    ["sha256"],
    ["mime", "bytes", "width", "height", "duration_ms", "licence", "attribution", "alt", "tags", "status"],
  );
  upsert(
    "sims",
    ["id", "version", "r2_prefix", "origin", "licence", "attribution", "params_schema", "size_bytes", "status"],
    set.sims.map(({ doc: s }) => [
      s.id,
      s.version,
      `sims/${s.id}/${s.version}/`,
      s.origin,
      s.licence,
      s.attribution ?? null,
      jsonb(s.params_schema),
      s.size_bytes,
      "published",
    ]),
    ["id"],
  );

  // 4.3 Content items, versions, bundles and manifests
  const items: { id: string; kind: string; topic: string | null; mode: string | null; isFree: boolean; path: string; concepts: string[]; role: string; schema: string }[] = [];
  for (const { doc: l, file } of set.lessons) {
    if (!topicIds.has(l.topic)) continue;
    const chapter = set.topics.get(l.topic)?.chapter.id ?? "";
    items.push({
      id: l.id,
      kind: "lesson",
      topic: l.topic,
      mode: l.mode,
      isFree: l.mode === "quick_revision" || freeInSubjectOrder(set, chapter),
      path: file,
      concepts: l.concepts,
      role: l.mode === "deep_dive" ? "teaches" : "revises",
      schema: l.schema,
    });
  }
  for (const { doc, file } of set.extras) {
    const e = doc as ExtrasFile & { id: string; scope: string; topic?: string; chapter?: string; concepts: string[]; schema: string };
    const kind = EXTRA_KIND[e.schema];
    if (!kind) continue;
    const chapterId = e.topic ? set.topics.get(e.topic)?.chapter.id : e.chapter;
    if (!chapterId || !chapters.some((c) => c.id === chapterId)) continue;
    items.push({
      id: e.id,
      kind,
      topic: e.topic ?? null,
      mode: null,
      isFree: true,
      path: file,
      concepts: e.concepts,
      role: EXTRA_ROLE[kind] ?? "mentions",
      schema: e.schema,
    });
  }
  items.sort((a, b) => a.id.localeCompare(b.id));
  const rel = (file: string) => relative(set.repoRoot, file).split("\\").join("/");
  upsert(
    "content_items",
    ["id", "kind", "topic_id", "mode", "status", "current_version", "is_free", "source_path"],
    items.map((i) => [i.id, i.kind, i.topic, i.mode, "published", inp.itemVersions.get(i.id) ?? 1, i.isFree, rel(i.path)]),
    ["id"],
  );
  del("content_item_concepts", "item_id", items.map((i) => i.id));
  upsert(
    "content_item_concepts",
    ["item_id", "concept_id", "role"],
    items.flatMap((i) => [...new Set(i.concepts)].filter((c) => conceptIds.has(c)).map((c) => [i.id, c, i.role])),
    ["item_id", "concept_id", "role"],
  );
  const versions: Value[][] = [];
  for (const i of items) {
    for (const v of inp.history.items[i.id] ?? []) {
      for (const [locale, hash] of Object.entries(v.hashes)) {
        if (hash) versions.push([i.id, v.version, locale, hash, Number(i.schema.split("@")[1] ?? 1), null, ts(v.published_at)]);
      }
    }
  }
  upsert(
    "content_versions",
    ["item_id", "version", "locale", "content_hash", "schema_version", "changelog", "published_at"],
    versions,
    ["item_id", "version", "locale"],
    [],
  );

  const bundlePublished = (id: string, hash: string) =>
    inp.history.bundles[id]?.find((e) => e.hash === hash)?.published_at ?? inp.now;
  upsert(
    "bundles",
    ["id", "topic_id", "mode", "locale", "hash", "size_bytes", "card_count", "min_app_version", "published_at"],
    inp.bundles.map((b) => [b.id, b.topic, b.mode, b.locale, b.hash, b.size, b.cardCount, b.minApp, ts(bundlePublished(b.id, b.hash))]),
    ["id"],
  );
  upsert(
    "bundle_history",
    ["bundle_id", "hash", "published_at"],
    inp.bundles.flatMap((b) => (inp.history.bundles[b.id] ?? []).map((e) => [b.id, e.hash, ts(e.published_at)])),
    ["bundle_id", "hash"],
    [],
  );
  upsert(
    "bundle_patches",
    ["bundle_id", "from_hash", "to_hash", "size_bytes"],
    inp.patches.map((p) => [p.bundleId, p.from, p.to, p.size]),
    ["bundle_id", "from_hash", "to_hash"],
  );
  const manifestRows: Value[][] = [];
  for (const m of inp.manifests) {
    const list = inp.history.manifests[`${m.profile}.${m.locale}`] ?? [];
    out.push(
      `update content.manifests set is_current = false where exam_profile_id = ${lit(m.profile)} and locale = ${lit(m.locale)};`,
    );
    list.forEach((e, i) => manifestRows.push([m.profile, m.locale, e.version, e.hash, i === list.length - 1, ts(e.published_at)]));
  }
  upsert(
    "manifests",
    ["exam_profile_id", "locale", "version", "hash", "is_current", "published_at"],
    manifestRows,
    ["exam_profile_id", "locale", "version"],
    ["hash", "is_current"],
  );
  upsert(
    "seed_packs",
    ["variant_id", "locale", "bundle_ids", "hash", "built_at"],
    inp.seedPacks.map((s) => [s.variant, s.locale, textArr(s.bundleIds), s.hash, ts(inp.now)]),
    ["variant_id", "locale"],
  );

  // 4.4 Questions, keys and PYQs (paragraph children are rows of their own)
  const questions: { q: Question | Record<string, unknown>; topic: string; parentUse: string[] }[] = [];
  for (const e of [...set.questions.values()].sort((a, b) => a.question.id.localeCompare(b.question.id))) {
    if (!topicIds.has(e.topic)) continue;
    questions.push({ q: e.question, topic: e.topic, parentUse: (e.parent ?? e.question).use });
  }
  const qRows: Value[][] = [];
  const keyRows: Value[][] = [];
  const qcRows: Value[][] = [];
  for (const { q, topic, parentUse } of questions) {
    const question = q as Question;
    const serverOnly = parentUse.some((u) => SERVER_ONLY_USES.includes(u as (typeof SERVER_ONLY_USES)[number]));
    const stem = question.stem as Record<string, string>;
    qRows.push([
      question.id,
      question.type,
      textArr(Object.keys(stem).sort()),
      question.difficulty_estimate ?? null,
      question.ideal_time_s ?? null,
      question.source ?? "original",
      "published",
      inp.questionVersions.get(question.id) ?? 1,
      serverOnly ? null : `${topic}:practice`,
      raw(`to_tsvector('simple', ${lit(Object.values(stem).join(" "))})`),
    ]);
    if ("answer" in question && question.answer) keyRows.push([question.id, jsonb(question.answer), null]);
    for (const c of question.concepts ?? []) {
      const id = set.aliases.get(c.id) ?? c.id;
      if (conceptIds.has(id)) qcRows.push([question.id, id, c.weight]);
    }
  }
  upsert(
    "questions",
    ["id", "type", "locales", "difficulty_label", "ideal_time_s", "source", "status", "version", "bundle_ref", "search"],
    qRows,
    ["id"],
  );
  upsert("question_keys", ["question_id", "answer", "partial_rule"], keyRows, ["question_id"]);
  del("question_concepts", "question_id", qRows.map((r) => r[0] as string));
  upsert("question_concepts", ["question_id", "concept_id", "weight"], qcRows, ["question_id", "concept_id"]);

  const papers = set.pyqPapers.map((p) => p.doc).sort((a, b) => a.id.localeCompare(b.id));
  const blueprintIds = new Set(set.blueprints.map((b) => `${b.doc.exam_profile}:${b.doc.paper_code}:${b.doc.version}`));
  upsert(
    "pyq_papers",
    ["id", "exam_id", "year", "session_label", "held_on", "paper_code", "blueprint_id", "source_url", "notes"],
    papers.map((p) => {
      const bp = p.blueprint;
      const bpId = bp && blueprintIds.has(`${bp.exam_profile}:${bp.paper_code}:${bp.version}`)
        ? blueprintUuid(bp.exam_profile, bp.paper_code, bp.version)
        : null;
      return [p.id, p.exam, p.year, p.session_label ?? null, p.held_on ?? null, p.paper_code ?? null, bpId, p.source.url, p.rights_note];
    }),
    ["id"],
  );
  const publishedQuestions = new Set(qRows.map((r) => r[0] as string));
  del("pyq_questions", "paper_id", papers.map((p) => p.id));
  upsert(
    "pyq_questions",
    ["paper_id", "number", "question_id"],
    papers.flatMap((p) => p.items.filter((i) => publishedQuestions.has(i.question)).map((i) => [p.id, i.number, i.question])),
    ["paper_id", "number"],
  );

  // 4.6 Mnemonics (system and traditional; community ones are written by the API)
  const approvedSha = (ref: string | null | undefined) => {
    if (!ref) return null;
    const r = set.media.get(ref)?.request;
    return r && r.status === "approved" && r.result && seenSha.has(r.result.sha256) ? r.result.sha256 : null;
  };
  upsert(
    "mnemonics",
    ["id", "concept_id", "technique", "locale", "body", "audio_asset_id", "image_asset_id", "exam_style", "origin", "status"],
    [...set.mnemonics.values()]
      .map((m) => m.mnemonic)
      .filter((m) => conceptIds.has(set.aliases.get(m.concept) ?? m.concept))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((m) => [
        uuidv5(`mnemonic:${m.id}`),
        set.aliases.get(m.concept) ?? m.concept,
        m.technique,
        m.locale,
        m.text,
        assetIdBySha(approvedSha(m.audio)),
        assetIdBySha(approvedSha(m.media)),
        m.exam_style ?? null,
        m.origin,
        "published",
      ]),
    ["id"],
  );

  // Videos referenced by lesson cards
  const videos = new Map<string, Value[]>();
  for (const { doc: l } of set.lessons) {
    if (!topicIds.has(l.topic)) continue;
    for (const c of l.cards) {
      if (c.type !== "video" || videos.has(c.youtube_id)) continue;
      const title = c.title ?? set.topics.get(l.topic)?.topic.name;
      if (title) videos.set(c.youtube_id, [c.youtube_id, jsonb(title), l.topic]);
    }
  }
  upsert("videos", ["youtube_id", "title", "topic_id"], [...videos.values()], ["youtube_id"]);

  const header = [
    "-- Generated by tools/content-publish. Do not edit: re-run the publisher.",
    `-- Content root: ${relative(set.repoRoot, set.root) || "."}`,
    inp.fixture ? "-- FIXTURE COURSE: test data for a local database only." : "-- Published content.",
  ];
  return { sql: `${header.join("\n")}\nbegin;\n\n${out.join("\n\n")}\n\ncommit;\n`, tables, rowCounts };
}
