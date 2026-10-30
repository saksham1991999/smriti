import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CARD_MODE_CODE, MEDIA_PREFIX_KINDS, SERVER_ONLY_USES } from "../constants.js";
import type {
  BlueprintFile,
  Card,
  ChildQuestion,
  LessonFile,
  MarkingRule,
  Question,
} from "../generated/types.js";
import { blankIds, splitMath } from "../localize.js";
import { isKnownUnit } from "../units.js";
import type { Findings } from "./findings.js";
import type { ContentSet } from "./load.js";
import { mediaRefs, walkContent } from "./walk.js";

export interface Tokens {
  subjectMap: Record<string, string>;
  mockPalette: Set<string>;
}

export function loadTokens(repoRoot: string): Tokens {
  const path = join(repoRoot, "packages", "tokens", "tokens.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    subjectMap?: Record<string, string>;
    mockPalette?: Record<string, unknown>;
  };
  const subjectMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw.subjectMap ?? {})) {
    if (!k.startsWith("$") && typeof v === "string") subjectMap[k] = v;
  }
  const mockPalette = new Set(Object.keys(raw.mockPalette ?? {}).filter((k) => !k.startsWith("$")));
  return { subjectMap, mockPalette };
}

/** Locales every localised field must carry: the union of the exam profiles' locales. */
export function requiredLocales(set: ContentSet): string[] {
  const out = new Set<string>();
  for (const { profile } of set.profiles.values()) for (const l of profile.locales) out.add(l);
  if (out.size === 0) {
    out.add("en");
    out.add("hi");
  }
  return [...out].sort();
}

export function runRules(set: ContentSet, findings: Findings, tokens: Tokens): void {
  checkFixtureFlags(set, findings);
  checkGraph(set, findings, tokens);
  checkExamMaps(set, findings);
  checkBlueprints(set, findings, tokens);
  checkLessons(set, findings);
  checkQuestions(set, findings);
  checkMnemonics(set, findings);
  checkPyq(set, findings);
  checkExtras(set, findings);
  checkMedia(set, findings);
  checkSeedSpecs(set, findings);
  checkCoverageInputs(set, findings);
  checkBilingual(set, findings);
  checkInventedStats(set, findings);
}

// ---------------------------------------------------------------------------------------------

function checkFixtureFlags(set: ContentSet, findings: Findings): void {
  for (const { file, doc } of set.files) {
    const flagged = doc.fixture === true;
    if (set.isFixtureRoot && !flagged) {
      findings.error("fixture_flag_missing", file, 'every fixture file must carry "fixture": true');
    }
    if (!set.isFixtureRoot && flagged) {
      findings.error(
        "fixture_outside_fixtures",
        file,
        '"fixture": true is only allowed under content/fixtures/ (fixtures are test data)',
      );
    }
  }
}

function conceptRef(set: ContentSet, findings: Findings, id: string, file: string, path: string): boolean {
  if (set.concepts.has(id)) return true;
  const target = set.aliases.get(id);
  if (target) {
    findings.warn("ref_alias", file, `${id} is an old alias; use ${target}`, { path, id });
    return true;
  }
  findings.error("ref_unknown_concept", file, `unknown concept ${id}`, { path, id });
  return false;
}

function checkGraph(set: ContentSet, findings: Findings, tokens: Tokens): void {
  const subjects = new Map(set.subjects.map((s) => [s.doc.id, s]));
  const chapterFiles = new Map(set.chapters.map((c) => [c.doc.id, c]));

  for (const { file, doc } of set.subjects) {
    const family = tokens.subjectMap[doc.id];
    if (family === undefined) {
      const msg = `subject ${doc.id} has no entry in packages/tokens/tokens.json subjectMap`;
      if (set.isFixtureRoot) findings.warn("subject_not_in_tokens", file, msg, { id: doc.id });
      else findings.error("subject_not_in_tokens", file, msg, { id: doc.id });
    } else if (family !== doc.color_family) {
      findings.error(
        "subject_color_mismatch",
        file,
        `color_family ${doc.color_family} does not match subjectMap (${family})`,
        { id: doc.id },
      );
    }
    doc.chapters.forEach((ch, i) => {
      if (!chapterFiles.has(ch)) {
        findings.error("ref_unknown_chapter", file, `chapter ${ch} has no graph file`, {
          path: `/chapters/${i}`,
          id: ch,
        });
      }
    });
  }

  for (const { file, doc } of set.chapters) {
    const subject = subjects.get(doc.subject);
    if (!subject) {
      findings.error("ref_unknown_subject", file, `unknown subject ${doc.subject}`, { id: doc.subject });
    } else {
      if (!subject.doc.chapters.includes(doc.id)) {
        findings.error("chapter_not_listed", file, `chapter ${doc.id} is not listed in ${subject.file}`, {
          id: doc.id,
        });
      }
      if (!subject.doc.units.some((u) => u.id === doc.unit)) {
        findings.error("ref_unknown_unit", file, `unit ${doc.unit} is not a unit of ${doc.subject}`, {
          id: doc.unit,
        });
      }
    }
    if (!doc.id.startsWith(`${doc.subject}.`)) {
      findings.error("id_hierarchy", file, `chapter id ${doc.id} must start with "${doc.subject}."`);
    }
    doc.topics.forEach((topic, ti) => {
      if (!topic.id.startsWith(`${doc.id}.`)) {
        findings.error("id_hierarchy", file, `topic ${topic.id} must start with "${doc.id}."`, {
          path: `/topics/${ti}`,
        });
      }
      topic.subtopics.forEach((sub, si) => {
        if (!sub.id.startsWith(`${topic.id}.`)) {
          findings.error("id_hierarchy", file, `subtopic ${sub.id} must start with "${topic.id}."`, {
            path: `/topics/${ti}/subtopics/${si}`,
          });
        }
        sub.concepts.forEach((c, ci) => {
          const path = `/topics/${ti}/subtopics/${si}/concepts/${ci}`;
          if (!c.id.startsWith(`${sub.id}.`)) {
            findings.error("id_hierarchy", file, `concept ${c.id} must start with "${sub.id}."`, { path });
          }
          const edges: [string, string[] | undefined][] = [
            ["prerequisites", c.prerequisites],
            ["related", c.related],
            ["contrasts", c.contrasts],
            ["applies_in", c.applies_in],
          ];
          for (const [field, ids] of edges) {
            (ids ?? []).forEach((id, k) => {
              if (id === c.id) {
                findings.error("edge_self", file, `${c.id} lists itself in ${field}`, {
                  path: `${path}/${field}/${k}`,
                });
              } else conceptRef(set, findings, id, file, `${path}/${field}/${k}`);
            });
          }
          for (const ref of c.syllabus_refs) {
            const profile = ref.split(":")[0] as string;
            if (!set.profiles.has(profile)) {
              findings.warn("syllabus_ref_profile", file, `syllabus ref ${ref} names an unknown profile`, {
                path,
              });
            }
          }
        });
      });
    });
  }

  // Prerequisite edges must form no cycle.
  const graph = new Map<string, string[]>();
  for (const [id, entry] of set.concepts) {
    graph.set(
      id,
      entry.concept.prerequisites.map((p) => set.aliases.get(p) ?? p).filter((p) => set.concepts.has(p)),
    );
  }
  for (const cycle of findCycles(graph)) {
    const first = set.concepts.get(cycle[0] as string);
    findings.error("prereq_cycle", first?.file ?? "graph", `prerequisite cycle: ${cycle.join(" -> ")}`, {
      id: cycle[0],
    });
  }

  for (const { file, doc } of set.exams) {
    for (const p of doc.profiles) {
      if (!p.id.startsWith(`${doc.id}-`)) {
        findings.warn("id_hierarchy", file, `profile ${p.id} should start with "${doc.id}-"`);
      }
    }
  }
}

/** Tarjan-free DFS cycle finder; returns each cycle once (rotated to start at its smallest id). */
export function findCycles(graph: Map<string, string[]>): string[][] {
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const seen = new Set<string>();
  const cycles: string[][] = [];
  const visit = (node: string): void => {
    state.set(node, 1);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      const s = state.get(next) ?? 0;
      if (s === 0) visit(next);
      else if (s === 1) {
        const cycle = stack.slice(stack.indexOf(next));
        const min = cycle.reduce((a, b) => (a < b ? a : b));
        const rotated = [...cycle.slice(cycle.indexOf(min)), ...cycle.slice(0, cycle.indexOf(min))];
        const key = rotated.join(">");
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push([...rotated, rotated[0] as string]);
        }
      }
    }
    stack.pop();
    state.set(node, 2);
  };
  for (const node of [...graph.keys()].sort()) if ((state.get(node) ?? 0) === 0) visit(node);
  return cycles;
}

function checkExamMaps(set: ContentSet, findings: Findings): void {
  const seenProfiles = new Map<string, string>();
  const subjectIds = new Set(set.subjects.map((s) => s.doc.id));
  for (const { file, doc } of set.examMaps) {
    if (!set.profiles.has(doc.exam_profile)) {
      findings.error("ref_unknown_profile", file, `unknown exam profile ${doc.exam_profile}`);
    }
    const other = seenProfiles.get(doc.exam_profile);
    if (other) findings.error("duplicate_id", file, `exam map for ${doc.exam_profile} also in ${other}`);
    seenProfiles.set(doc.exam_profile, file);
    const ids = new Set<string>();
    doc.concepts.forEach((c, i) => {
      const path = `/concepts/${i}`;
      if (ids.has(c.id)) findings.error("duplicate_id", file, `concept ${c.id} listed twice`, { path });
      ids.add(c.id);
      if (conceptRef(set, findings, c.id, file, path)) {
        const entry = set.concepts.get(set.aliases.get(c.id) ?? c.id);
        if (entry && c.depth < entry.concept.intrinsic_depth) {
          findings.warn(
            "depth_below_intrinsic",
            file,
            `${c.id}: exam depth ${c.depth} is below its intrinsic depth ${entry.concept.intrinsic_depth}`,
            { path },
          );
        }
      }
      if (c.priority === "high_yield" && c.weightage === null) {
        findings.error(
          "invented_stat",
          file,
          `${c.id} is marked high_yield without computed weightage (pyq-ingest must compute it)`,
          { path },
        );
      }
      if ((c.weightage !== null || c.pyq_count !== null) && !doc.stats_basis) {
        findings.error(
          "stats_without_basis",
          file,
          `${c.id} has weightage or pyq_count but the map has no stats_basis`,
          { path },
        );
      }
    });
    for (const s of doc.released_subjects ?? []) {
      if (!subjectIds.has(s)) findings.error("ref_unknown_subject", file, `released subject ${s} is unknown`);
    }
  }
}

function markingFor(section: BlueprintFile["sections"][number], type: string): MarkingRule | undefined {
  return (section.marking as Record<string, MarkingRule | undefined>)[type];
}

function checkBlueprints(set: ContentSet, findings: Findings, tokens: Tokens): void {
  const versions = new Map<string, { version: number; from: string; file: string }[]>();
  for (const { file, doc } of set.blueprints) {
    const entry = set.profiles.get(doc.exam_profile);
    if (!entry) {
      findings.error("ref_unknown_profile", file, `unknown exam profile ${doc.exam_profile}`);
    } else if (!entry.profile.papers.includes(doc.paper_code)) {
      findings.error("ref_unknown_paper", file, `paper ${doc.paper_code} is not a paper of ${doc.exam_profile}`);
    }
    const expected = `blueprints/${doc.exam_profile}/${doc.paper_code}.v${doc.version}.json`;
    if (!file.endsWith(expected)) {
      findings.error("path_mismatch", file, `a blueprint must live at ${expected} (versions are new files)`);
    }
    const key = `${doc.exam_profile}/${doc.paper_code}`;
    const list = versions.get(key) ?? [];
    list.push({ version: doc.version, from: doc.effective_from, file });
    versions.set(key, list);

    let counted = 0;
    let marks = 0;
    let marksKnown = true;
    doc.sections.forEach((section, i) => {
      const path = `/sections/${i}`;
      const n = section.attempt_rule?.attempt_any ?? section.question_count;
      if (section.attempt_rule?.attempt_any && section.attempt_rule.attempt_any > section.question_count) {
        findings.error("blueprint_attempt_rule", file, `${section.code}: attempt_any exceeds question_count`, {
          path,
        });
      }
      counted += n;
      for (const t of section.question_types) {
        if (!markingFor(section, t)) {
          findings.error("blueprint_marking_missing", file, `${section.code}: no marking rule for ${t}`, {
            path,
          });
        }
      }
      for (const t of Object.keys(section.marking)) {
        if (!section.question_types.includes(t as never)) {
          findings.warn("blueprint_marking_unused", file, `${section.code}: marking for unused type ${t}`, {
            path,
          });
        }
      }
      const typeCounts = section.type_counts as Record<string, number> | undefined;
      if (typeCounts) {
        const sum = Object.values(typeCounts).reduce((a, b) => a + b, 0);
        if (sum !== section.question_count) {
          findings.error(
            "blueprint_count_mismatch",
            file,
            `${section.code}: type_counts add up to ${sum}, not ${section.question_count}`,
            { path },
          );
        }
        if (section.attempt_rule?.attempt_any) marksKnown = false;
        for (const [t, c] of Object.entries(typeCounts)) marks += c * (markingFor(section, t)?.correct ?? 0);
      } else if (section.question_types.length === 1) {
        marks += n * (markingFor(section, section.question_types[0] as string)?.correct ?? 0);
      } else {
        marksKnown = false;
      }
    });
    if (counted !== doc.question_count) {
      findings.error(
        "blueprint_count_mismatch",
        file,
        `sections count ${counted} questions, the paper says ${doc.question_count}`,
      );
    }
    if (marksKnown && Math.abs(marks - doc.max_marks) > 1e-9) {
      findings.error("blueprint_marks_mismatch", file, `sections add up to ${marks} marks, the paper says ${doc.max_marks}`);
    } else if (!marksKnown) {
      findings.warn(
        "blueprint_marks_unverifiable",
        file,
        "a section mixes question types without type_counts, so max_marks cannot be checked",
      );
    }
    const ids = new Set<string>();
    doc.interface_profile?.palette_states.forEach((state, i) => {
      const path = `/interface_profile/palette_states/${i}`;
      if (ids.has(state.id)) findings.error("duplicate_id", file, `palette state ${state.id} listed twice`, { path });
      ids.add(state.id);
      const token = state.colour_token.slice("mockPalette.".length);
      if (!tokens.mockPalette.has(token)) {
        findings.error("unknown_token", file, `${state.colour_token} is not in tokens.json mockPalette`, { path });
      }
    });
    if (entry) {
      for (const l of doc.languages) {
        if (!entry.profile.locales.includes(l)) {
          findings.warn("blueprint_language", file, `language ${l} is not a locale of ${doc.exam_profile}`);
        }
      }
    }
  }
  for (const [key, list] of versions) {
    const sorted = [...list].sort((a, b) => a.version - b.version);
    sorted.forEach((v, i) => {
      if (i > 0 && v.version === sorted[i - 1]?.version) {
        findings.error("duplicate_id", v.file, `${key} v${v.version} exists twice`);
      }
      if (i > 0 && v.from < (sorted[i - 1]?.from ?? "")) {
        findings.warn("blueprint_effective_order", v.file, `${key} v${v.version} takes effect before v${v.version - 1}`);
      }
    });
  }
}

// ---------------------------------------------------------------------------------------------

function cardMediaAnchors(set: ContentSet, ref: string): Set<string> | undefined {
  const req = set.media.get(ref)?.request;
  return req ? new Set((req.label_anchors ?? []).map((a) => a.id)) : undefined;
}

function checkLessons(set: ContentSet, findings: Findings): void {
  const seen = new Map<string, string>();
  for (const { file, doc } of set.lessons) {
    const lessonId = `${doc.topic}:${doc.mode}`;
    if (doc.id !== lessonId) findings.error("lesson_id", file, `lesson id must be ${lessonId}`);
    const other = seen.get(doc.id);
    if (other) findings.error("duplicate_id", file, `lesson ${doc.id} also in ${other}`);
    seen.set(doc.id, file);
    const topic = set.topics.get(doc.topic);
    if (!topic) findings.error("ref_unknown_topic", file, `unknown topic ${doc.topic}`);
    else {
      const subjectSlug = topic.chapter.subject;
      const chapterSlug = topic.chapter.id.slice(subjectSlug.length + 1);
      const topicSlug = doc.topic.slice(topic.chapter.id.length + 1);
      const expected = `lessons/${subjectSlug}/${chapterSlug}/${topicSlug}.${doc.mode}.json`;
      if (!file.endsWith(expected)) findings.warn("path_mismatch", file, `expected the file at ${expected}`);
    }
    if (doc.min_depth > doc.max_depth) findings.error("lesson_depth", file, "min_depth is above max_depth");
    const topicConcepts = new Set<string>();
    if (topic) for (const s of topic.topic.subtopics) for (const c of s.concepts) topicConcepts.add(c.id);
    doc.concepts.forEach((c, i) => {
      if (conceptRef(set, findings, c, file, `/concepts/${i}`) && topic && !topicConcepts.has(c)) {
        findings.warn("lesson_concept_topic", file, `${c} is not a concept of ${doc.topic}`, { path: `/concepts/${i}` });
      }
    });
    const lessonConcepts = new Set(doc.concepts);
    const code = CARD_MODE_CODE[doc.mode];
    const cardIds = new Set<string>();
    doc.cards.forEach((card, i) => {
      const path = `/cards/${i}`;
      if (cardIds.has(card.id)) findings.error("duplicate_id", file, `card ${card.id} appears twice`, { path });
      cardIds.add(card.id);
      if (!card.id.startsWith(`${doc.topic}:${code}:`)) {
        findings.error("card_id_prefix", file, `card ${card.id} must start with ${doc.topic}:${code}:`, { path });
      }
      if (card.depth < doc.min_depth || card.depth > doc.max_depth) {
        findings.error("card_depth_range", file, `card ${card.id} depth ${card.depth} is outside min/max_depth`, { path });
      }
      card.concepts.forEach((c, k) => {
        if (conceptRef(set, findings, c, file, `${path}/concepts/${k}`) && !lessonConcepts.has(c)) {
          findings.warn("card_concept_lesson", file, `card ${card.id} uses ${c}, which the lesson does not list`, {
            path,
          });
        }
      });
      checkCard(set, findings, file, path, card, doc);
    });
    if (doc.mode === "quick_revision") {
      const traps = doc.cards.findIndex((c) => c.type === "common_traps");
      if (traps === -1) findings.warn("qr_traps_missing", file, "a Quick Revision should end with a common_traps card");
      else if (traps !== doc.cards.length - 1) {
        findings.warn("qr_traps_last", file, "the common_traps card should be the last card", { path: `/cards/${traps}` });
      }
      if (!doc.cards.some((c) => c.type === "cheat_sheet_ref")) {
        findings.warn("qr_sheet_missing", file, "a Quick Revision should have a cheat_sheet_ref card");
      }
    }
    if (doc.bites) {
      const flat = doc.bites.flatMap((b) => b.card_ids);
      const order = doc.cards.map((c) => c.id);
      if (flat.length !== order.length || flat.some((id, i) => id !== order[i])) {
        findings.error(
          "bites_invalid",
          file,
          "bites must list every card exactly once, in card order",
          { path: "/bites" },
        );
      }
      const biteIds = new Set<string>();
      for (const b of doc.bites) {
        if (biteIds.has(b.id)) findings.error("duplicate_id", file, `bite ${b.id} appears twice`, { path: "/bites" });
        biteIds.add(b.id);
      }
    }
  }
}

function checkCard(
  set: ContentSet,
  findings: Findings,
  file: string,
  path: string,
  card: Card,
  lesson: LessonFile,
): void {
  const err = (code: string, msg: string): void => findings.error(code, file, `${card.id}: ${msg}`, { path, id: card.id });
  const warn = (code: string, msg: string): void => findings.warn(code, file, `${card.id}: ${msg}`, { path, id: card.id });
  switch (card.type) {
    case "question": {
      const entry = set.questions.get(card.question);
      if (!entry) {
        err("ref_unknown_question", `unknown question ${card.question}`);
        break;
      }
      const q = entry.question;
      const uses = [...q.use, ...(entry.parent?.use ?? [])];
      if (uses.some((u) => SERVER_ONLY_USES.includes(u))) {
        err("server_only_question", `${q.id} is a mock or daily question; its key never ships, so lessons cannot use it`);
      }
      if (!q.use.includes("lesson")) warn("question_use", `${q.id} is not tagged use "lesson"`);
      if (entry.parent) warn("paragraph_child", `${q.id} is a paragraph child; reference the paragraph ${entry.parent.id}`);
      if (!q.concepts.some((c) => card.concepts.includes(c.id))) {
        warn("question_concepts", `${q.id} shares no concept with the card`);
      }
      if (q.depth > card.depth) warn("question_depth", `${q.id} depth ${q.depth} is above the card depth ${card.depth}`);
      break;
    }
    case "memory_hook": {
      for (const [locale, id] of Object.entries(card.mnemonic)) {
        const m = set.mnemonics.get(id as string);
        if (!m) err("ref_unknown_mnemonic", `unknown mnemonic ${id as string}`);
        else {
          if (m.mnemonic.locale !== locale) {
            err("mnemonic_locale", `${id as string} is written in ${m.mnemonic.locale}, not ${locale}`);
          }
          if (!card.concepts.includes(m.mnemonic.concept)) {
            warn("mnemonic_concept", `${id as string} is for ${m.mnemonic.concept}, not a concept of the card`);
          }
        }
      }
      break;
    }
    case "cheat_sheet_ref": {
      const sheet = set.extrasById.get(card.sheet);
      if (!sheet) err("ref_unknown_extra", `unknown cheat sheet ${card.sheet}`);
      else if (sheet.doc.schema !== "cheat_sheet@1") err("ref_wrong_extra", `${card.sheet} is not a cheat sheet`);
      break;
    }
    case "roleplay": {
      if (card.script) {
        const script = set.extrasById.get(card.script);
        if (!script) err("ref_unknown_extra", `unknown role-play script ${card.script}`);
        else if (script.doc.schema !== "roleplay@1") err("ref_wrong_extra", `${card.script} is not a role play`);
      }
      break;
    }
    case "interactive": {
      if (card.widget === "drag_sort") {
        const items = new Set(card.config.items.map((x) => x.id));
        const bins = new Set(card.config.bins.map((x) => x.id));
        const placed = new Set<string>();
        for (const p of card.config.answer) {
          if (!items.has(p.item)) err("interactive_answer", `drag_sort answer names unknown item ${p.item}`);
          if (!bins.has(p.bin)) err("interactive_answer", `drag_sort answer names unknown bin ${p.bin}`);
          if (placed.has(p.item)) err("interactive_answer", `item ${p.item} is placed twice`);
          placed.add(p.item);
        }
        for (const i of items) if (!placed.has(i)) err("interactive_answer", `item ${i} has no bin in the answer`);
      } else if (card.widget === "label_diagram") {
        const anchors = cardMediaAnchors(set, card.config.media);
        const spots = new Set(card.config.spots.map((s) => s.id));
        const labels = new Set(card.config.labels.map((l) => l.id));
        for (const s of card.config.spots) {
          if (anchors && !anchors.has(s.anchor)) {
            err("interactive_anchor", `spot ${s.id} uses anchor ${s.anchor}, which ${card.config.media} does not define`);
          }
        }
        const answered = new Set<string>();
        for (const p of card.config.answer) {
          if (!spots.has(p.spot)) err("interactive_answer", `answer names unknown spot ${p.spot}`);
          if (!labels.has(p.label)) err("interactive_answer", `answer names unknown label ${p.label}`);
          answered.add(p.spot);
        }
        for (const s of spots) if (!answered.has(s)) err("interactive_answer", `spot ${s} has no label in the answer`);
      } else if (card.widget === "slider") {
        const c = card.config;
        if (c.min >= c.max) err("interactive_range", "slider min must be below max");
        if (c.target && (c.target.value < c.min || c.target.value > c.max)) err("interactive_range", "slider target is outside the range");
        if (c.initial !== undefined && (c.initial < c.min || c.initial > c.max)) err("interactive_range", "slider initial is outside the range");
        if (c.unit && !isKnownUnit(c.unit)) warn("unknown_unit", `unit ${c.unit} is not in the unit table`);
      } else if (card.widget === "graph") {
        const c = card.config;
        if (c.x.min >= c.x.max || c.y.min >= c.y.max) err("interactive_range", "graph axis min must be below max");
        if (c.target && (c.target.x < c.x.min || c.target.x > c.x.max || c.target.y < c.y.min || c.target.y > c.y.max)) {
          err("interactive_range", "graph target is outside the axes");
        }
      } else if (card.widget === "order_steps") {
        const ids = card.config.steps.map((s) => s.id);
        if (new Set(ids).size !== ids.length) err("interactive_answer", "order_steps ids must be unique");
      } else if (card.widget === "tap_reveal") {
        const ids = card.config.tiles.map((s) => s.id);
        if (new Set(ids).size !== ids.length) err("interactive_answer", "tap_reveal tile ids must be unique");
      }
      break;
    }
    case "sim": {
      const ids = card.tasks.map((t) => t.id);
      if (new Set(ids).size !== ids.length) err("duplicate_id", "sim task ids must be unique");
      const req = set.media.get(card.sim)?.request;
      const simId = req?.status === "approved" ? req.result?.sim_id : undefined;
      if (simId) {
        const sim = set.simsById.get(simId);
        if (!sim) err("ref_unknown_sim", `${card.sim} names sim ${simId}, which has no sims/${simId}/sim.json`);
        else {
          for (const task of card.tasks) {
            const m = sim.doc.measurements.find((x) => x.name === task.measurement);
            if (!m) err("sim_measurement", `task ${task.id} checks ${task.measurement}, which ${simId} does not report`);
            else if (m.unit !== task.expected.unit) {
              warn("sim_unit", `task ${task.id} expects ${task.expected.unit ?? "no unit"}, ${simId} reports ${m.unit ?? "no unit"}`);
            }
          }
        }
      }
      for (const task of card.tasks) {
        if (task.expected.unit && !isKnownUnit(task.expected.unit)) {
          warn("unknown_unit", `unit ${task.expected.unit} is not in the unit table`);
        }
      }
      break;
    }
    case "video": {
      if (card.end_s <= card.start_s) err("video_range", "end_s must be after start_s");
      for (const ts of card.concept_timestamps ?? []) {
        if (ts.t_s < card.start_s || ts.t_s > card.end_s) warn("video_range", `timestamp ${ts.t_s}s is outside the segment`);
        conceptRef(set, findings, ts.concept, file, path);
      }
      break;
    }
    case "formula": {
      for (const s of card.symbols) {
        if (s.unit && !isKnownUnit(s.unit)) warn("unknown_unit", `unit ${s.unit} is not in the unit table`);
      }
      break;
    }
    case "worked_example": {
      const unit = card.answer_value?.unit;
      if (unit && !isKnownUnit(unit)) warn("unknown_unit", `unit ${unit} is not in the unit table`);
      break;
    }
    default:
      break;
  }
  if (lesson.mode === "deep_dive" && card.type === "common_traps") {
    warn("dd_traps", "common_traps cards belong in Quick Revision");
  }
}

// ---------------------------------------------------------------------------------------------

function checkQuestions(set: ContentSet, findings: Findings): void {
  for (const { file, doc } of set.questionFiles) {
    if (!set.topics.has(doc.topic)) findings.error("ref_unknown_topic", file, `unknown topic ${doc.topic}`);
    doc.questions.forEach((q, i) => {
      checkQuestion(set, findings, file, `/questions/${i}`, q as Question, doc.topic);
      if (q.type === "paragraph") {
        q.children.forEach((child, j) => {
          const path = `/questions/${i}/children/${j}`;
          checkQuestion(set, findings, file, path, child as Question, doc.topic);
          for (const u of child.use) {
            if (!q.use.includes(u)) {
              findings.warn("paragraph_use", file, `${child.id} has use ${u} that the paragraph lacks`, { path });
            }
          }
        });
      }
    });
  }
}

function checkQuestion(
  set: ContentSet,
  findings: Findings,
  file: string,
  path: string,
  q: Question | ChildQuestion,
  topic: string,
): void {
  const err = (code: string, msg: string): void => findings.error(code, file, `${q.id}: ${msg}`, { path, id: q.id });
  const warn = (code: string, msg: string): void => findings.warn(code, file, `${q.id}: ${msg}`, { path, id: q.id });
  if (!q.id.startsWith(`q.${topic}.`)) err("question_id_prefix", `must start with q.${topic}.`);
  q.concepts.forEach((c, k) => conceptRef(set, findings, c.id, file, `${path}/concepts/${k}`));
  const weight = q.concepts.reduce((a, c) => a + c.weight, 0);
  if (Math.abs(weight - 1) > 0.01) warn("concept_weights", `concept weights add up to ${weight}, not 1`);
  const serverOnly = q.use.filter((u) => SERVER_ONLY_USES.includes(u));
  if (serverOnly.length && serverOnly.length !== q.use.length) {
    err(
      "question_use_conflict",
      `use ${q.use.join(", ")} mixes server-only (${serverOnly.join(", ")}) with uses whose answers ship to devices`,
    );
  }
  if (q.source === "pyq") {
    if (!q.pyq) err("pyq_link", 'source "pyq" needs a pyq back-link to its paper');
    else {
      const paper = set.pyqPapers.find((p) => p.doc.id === q.pyq?.paper);
      if (!paper) err("ref_unknown_paper", `unknown PYQ paper ${q.pyq.paper}`);
      else if (!paper.doc.items.some((it) => it.number === q.pyq?.number && it.question === q.id)) {
        err("pyq_link", `${q.pyq.paper} item ${q.pyq.number} does not point back to this question`);
      }
    }
  } else if (q.pyq) {
    warn("pyq_link", 'has a pyq link but source is not "pyq"');
  }
  const options = "options" in q && q.options ? q.options.map((o) => o.id) : [];
  if (new Set(options).size !== options.length) err("question_options", "option ids must be unique");
  for (const trap of q.solution?.common_traps ?? []) {
    if (trap.option_id && !options.includes(trap.option_id)) {
      err("question_traps", `common trap names unknown option ${trap.option_id}`);
    }
  }
  const optionAnswer = (ids: string[]): void => {
    for (const id of ids) if (!options.includes(id)) err("question_answer", `answer names unknown option ${id}`);
  };
  switch (q.type) {
    case "mcq_single":
    case "mcq_multi":
    case "statement_based":
      optionAnswer(q.answer.option_ids);
      break;
    case "assertion_reason":
      optionAnswer(q.answer.option_ids);
      if (q.options.length !== 4) warn("assertion_reason_options", "assertion-reason questions use the standard four options");
      break;
    case "numerical":
      if (!q.answer.tolerance) warn("numerical_tolerance", "no tolerance: only an exact value will be accepted");
      if (q.answer.unit && !isKnownUnit(q.answer.unit)) warn("unknown_unit", `unit ${q.answer.unit} is not in the unit table`);
      break;
    case "integer":
      break;
    case "matrix_match": {
      const rows = new Set(q.rows.map((r) => r.id));
      const cols = new Set(q.columns.map((c) => c.id));
      const seen = new Set<string>();
      for (const p of q.answer.pairs) {
        if (!rows.has(p.row)) err("question_answer", `answer names unknown row ${p.row}`);
        if (seen.has(p.row)) err("question_answer", `row ${p.row} appears twice`);
        seen.add(p.row);
        for (const c of p.columns) if (!cols.has(c)) err("question_answer", `answer names unknown column ${c}`);
      }
      for (const r of rows) if (!seen.has(r)) err("question_answer", `row ${r} has no entry in the answer`);
      break;
    }
    case "match_list": {
      if ("option_ids" in q.answer) {
        if (!q.options) err("question_answer", "an option answer needs options");
        optionAnswer(q.answer.option_ids);
      } else {
        if (q.options) warn("question_answer", "options are ignored when the answer is pairs");
        const left = new Set(q.list_i.map((x) => x.id));
        const right = new Set(q.list_ii.map((x) => x.id));
        const seen = new Set<string>();
        for (const p of q.answer.pairs) {
          if (!left.has(p.left)) err("question_answer", `answer names unknown list_i item ${p.left}`);
          if (!right.has(p.right)) err("question_answer", `answer names unknown list_ii item ${p.right}`);
          if (seen.has(p.left)) err("question_answer", `${p.left} is paired twice`);
          seen.add(p.left);
        }
        for (const l of left) if (!seen.has(l)) err("question_answer", `${l} has no pair in the answer`);
      }
      break;
    }
    case "fill_blank": {
      const declared = q.blanks.map((b) => b.id);
      for (const [locale, text] of Object.entries(q.stem)) {
        const inStem = blankIds(text as string);
        if (inStem.join(",") !== declared.join(",")) {
          err("fill_blank_tokens", `the ${locale} stem has blanks [${inStem.join(", ")}], expected [${declared.join(", ")}]`);
        }
      }
      const answered = new Set<string>();
      for (const a of q.answer.blanks) {
        const blank = q.blanks.find((b) => b.id === a.blank);
        if (!blank) {
          err("question_answer", `answer names unknown blank ${a.blank}`);
          continue;
        }
        if (answered.has(a.blank)) err("question_answer", `blank ${a.blank} is answered twice`);
        answered.add(a.blank);
        if ("choice_id" in a) {
          if (!blank.choices) err("question_answer", `blank ${a.blank} has no choices but the answer is a choice`);
          else if (!blank.choices.some((c) => c.id === a.choice_id)) err("question_answer", `unknown choice ${a.choice_id}`);
        } else if (blank.choices) {
          err("question_answer", `blank ${a.blank} has choices, so its answer must be a choice_id`);
        }
      }
      for (const b of declared) if (!answered.has(b)) err("question_answer", `blank ${b} has no answer`);
      break;
    }
    case "order_steps": {
      const steps = q.steps.map((s) => s.id);
      const order = q.answer.order;
      if (order.length !== steps.length || !steps.every((s) => order.includes(s))) {
        err("question_answer", "answer.order must be a permutation of the step ids");
      }
      break;
    }
    case "paragraph":
      break;
  }
}

function checkMnemonics(set: ContentSet, findings: Findings): void {
  for (const { file, doc } of set.mnemonicFiles) {
    doc.items.forEach((m, i) => {
      const path = `/items/${i}`;
      conceptRef(set, findings, m.concept, file, path);
      if (!m.id.startsWith(`m.${m.concept}.`)) {
        findings.error("mnemonic_id_prefix", file, `${m.id} must start with m.${m.concept}.`, { path });
      }
      if (m.origin === "traditional" && !m.taught_in) {
        findings.error("mnemonic_citation", file, `${m.id} is traditional; say where it is commonly taught (taught_in)`, { path });
      }
    });
  }
  // Every concept with a hook has one in each required locale (hooks are written per language).
  const locales = requiredLocales(set);
  const byConcept = new Map<string, Set<string>>();
  for (const { mnemonic } of set.mnemonics.values()) {
    const s = byConcept.get(mnemonic.concept) ?? new Set<string>();
    s.add(mnemonic.locale);
    byConcept.set(mnemonic.concept, s);
  }
  for (const [concept, have] of byConcept) {
    for (const l of locales) {
      if (!have.has(l)) {
        const file = [...set.mnemonics.values()].find((m) => m.mnemonic.concept === concept)?.file ?? "mnemonics";
        findings.error("missing_locale", file, `${concept} has mnemonics but none in ${l}`, { id: concept });
      }
    }
  }
}

function checkPyq(set: ContentSet, findings: Findings): void {
  const examIds = new Set(set.exams.map((e) => e.doc.id));
  for (const { file, doc } of set.pyqPapers) {
    if (!examIds.has(doc.exam)) findings.error("ref_unknown_exam", file, `unknown exam ${doc.exam}`);
    const numbers = new Set<number>();
    doc.items.forEach((item, i) => {
      const path = `/items/${i}`;
      if (numbers.has(item.number)) findings.error("duplicate_id", file, `question number ${item.number} twice`, { path });
      numbers.add(item.number);
      const q = set.questions.get(item.question)?.question;
      if (!q) findings.error("ref_unknown_question", file, `unknown question ${item.question}`, { path });
      else if (q.source !== "pyq" || q.pyq?.paper !== doc.id || q.pyq.number !== item.number) {
        findings.error("pyq_link", file, `${item.question} must have source "pyq" and link back to ${doc.id} #${item.number}`, { path });
      }
    });
    if (doc.blueprint) {
      const bp = set.blueprints.find(
        (b) =>
          b.doc.exam_profile === doc.blueprint?.exam_profile &&
          b.doc.paper_code === doc.blueprint.paper_code &&
          b.doc.version === doc.blueprint.version,
      );
      if (!bp) findings.error("ref_unknown_blueprint", file, "the blueprint this paper names does not exist");
    }
  }
}

function checkExtras(set: ContentSet, findings: Findings): void {
  for (const { file, doc } of set.extras) {
    doc.concepts.forEach((c, i) => conceptRef(set, findings, c, file, `/concepts/${i}`));
    if (doc.scope === "topic") {
      if (!doc.topic) findings.error("extra_scope", file, "scope topic needs a topic");
      else if (!set.topics.has(doc.topic)) findings.error("ref_unknown_topic", file, `unknown topic ${doc.topic}`);
    } else if (!doc.chapter) findings.error("extra_scope", file, "scope chapter needs a chapter");
    else if (!set.chapters.some((c) => c.doc.id === doc.chapter)) {
      findings.error("ref_unknown_chapter", file, `unknown chapter ${doc.chapter}`);
    }
    if (doc.schema === "cheat_sheet@1") {
      doc.mnemonics.forEach((ref, i) => {
        for (const [locale, id] of Object.entries(ref)) {
          const m = set.mnemonics.get(id as string);
          if (!m) findings.error("ref_unknown_mnemonic", file, `unknown mnemonic ${id as string}`, { path: `/mnemonics/${i}` });
          else if (m.mnemonic.locale !== locale) {
            findings.error("mnemonic_locale", file, `${id as string} is not written in ${locale}`, { path: `/mnemonics/${i}` });
          }
        }
      });
    }
    if (doc.schema === "cheat_sheet@1" || doc.schema === "revision_sheet@1") {
      (doc.formulas ?? []).forEach((f, i) => {
        if (f.concept) conceptRef(set, findings, f.concept, file, `/formulas/${i}`);
      });
    }
    if (doc.schema === "mind_map_template@1") {
      const nodes = new Set(doc.nodes.map((n) => n.id));
      for (const e of doc.edges) {
        if (!nodes.has(e.from) || !nodes.has(e.to)) findings.error("mind_map_edge", file, `edge ${e.from} -> ${e.to} names an unknown node`);
      }
    }
  }
}

function checkMedia(set: ContentSet, findings: Findings): void {
  const used = new Set<string>();
  const sources = [
    ...set.lessons,
    ...set.questionFiles,
    ...set.mnemonicFiles,
    ...set.extras,
    ...set.seedSpecs,
    ...set.sims,
  ] as { file: string; doc: unknown }[];
  for (const { file, doc } of sources) {
    for (const { ref, path } of mediaRefs(doc)) {
      used.add(ref);
      const entry = set.media.get(ref);
      if (!entry) {
        findings.error("ref_unknown_media", file, `unknown media request ${ref}`, { path, id: ref });
        continue;
      }
      const prefix = ref.split(".")[0] as keyof typeof MEDIA_PREFIX_KINDS;
      const kinds = MEDIA_PREFIX_KINDS[prefix] as readonly string[];
      if (!kinds.includes(entry.request.kind)) {
        findings.error("media_kind", file, `${ref} is a ${entry.request.kind} request; ${prefix}. refs need ${kinds.join(" or ")}`, {
          path,
          id: ref,
        });
      }
    }
  }
  for (const { request: r, file } of set.media.values()) {
    const visual = ["image", "diagram", "comic", "pano360"].includes(r.kind);
    if (visual && !r.decorative && !r.alt) {
      findings.error("media_alt_missing", file, `${r.id} needs alt text in every locale (or decorative: true)`, { id: r.id });
    }
    if (["audio_tts", "audio_song", "animation_lottie", "animation_rive"].includes(r.kind) && !r.transcript) {
      findings.warn("media_transcript_missing", file, `${r.id} needs a transcript`, { id: r.id });
    }
    if (r.status !== "approved") {
      findings.warn("media_not_approved", file, `${r.id} is ${r.status}; it must be approved before publish`, { id: r.id });
    } else if (!r.result) {
      findings.error("media_result_missing", file, `${r.id} is approved but has no result`, { id: r.id });
    }
    if (r.status === "rejected" && !r.rejected_reason) {
      findings.warn("media_rejected_reason", file, `${r.id} is rejected without a reason`, { id: r.id });
    }
    if (r.kind === "sim" && r.status === "approved" && !r.result?.sim_id) {
      findings.error("media_result_missing", file, `${r.id} is an approved sim without result.sim_id`, { id: r.id });
    }
    if (!used.has(r.id)) findings.warn("media_unused", file, `${r.id} is not referenced by any content`, { id: r.id });
    const src = r.result?.source_path;
    if (src) {
      if (!set.isFixtureRoot) {
        findings.error("media_source_path", file, `${r.id}: result.source_path is only for fixtures`, { id: r.id });
      } else {
        const abs = join(set.repoRoot, src);
        if (!existsSync(abs)) findings.error("media_source_missing", file, `${r.id}: ${src} does not exist`, { id: r.id });
        else {
          const sha = createHash("sha256").update(readFileSync(abs)).digest("hex");
          if (sha !== r.result?.sha256) {
            findings.error("media_sha_mismatch", file, `${r.id}: sha256 of ${src} is ${sha}`, { id: r.id });
          }
        }
      }
    }
  }
}

function checkSeedSpecs(set: ContentSet, findings: Findings): void {
  const chapterIds = new Set(set.chapters.map((c) => c.doc.id));
  for (const { file, doc } of set.seedSpecs) {
    for (const p of doc.exam_profiles) {
      if (!set.profiles.has(p)) findings.error("ref_unknown_profile", file, `unknown exam profile ${p}`);
    }
    if (Array.isArray(doc.chapters)) {
      for (const c of doc.chapters) if (!chapterIds.has(c)) findings.error("ref_unknown_chapter", file, `unknown chapter ${c}`);
    }
  }
}

function checkCoverageInputs(set: ContentSet, findings: Findings): void {
  for (const { file, doc } of set.syllabi) {
    if (!set.profiles.has(doc.exam_profile)) findings.error("ref_unknown_profile", file, `unknown exam profile ${doc.exam_profile}`);
    const refs = new Set<string>();
    doc.lines.forEach((line, i) => {
      const path = `/lines/${i}`;
      if (refs.has(line.ref)) findings.error("duplicate_id", file, `syllabus line ${line.ref} twice`, { path });
      refs.add(line.ref);
      if (!line.ref.startsWith(`${doc.exam_profile}:`)) {
        findings.error("syllabus_ref_profile", file, `${line.ref} must start with ${doc.exam_profile}:`, { path });
      }
      line.concepts.forEach((c, k) => conceptRef(set, findings, c, file, `${path}/concepts/${k}`));
    });
  }
  for (const { file, doc } of set.inventories) {
    if (!set.chapters.some((c) => c.doc.id === doc.chapter)) findings.error("ref_unknown_chapter", file, `unknown chapter ${doc.chapter}`);
    doc.items.forEach((item, i) => {
      const path = `/items/${i}`;
      item.concepts.forEach((c, k) => conceptRef(set, findings, c, file, `${path}/concepts/${k}`));
      if (item.concepts.length > 0 && item.out_of_syllabus) {
        findings.warn("inventory_item", file, `${item.id} has concepts and an exclusion reason`, { path });
      }
    });
  }
}

// ---------------------------------------------------------------------------------------------

const DIGITS = /\d+(?:[.,]\d+)?/g;

function mathOf(text: string): string[] {
  return splitMath(text)
    .filter((s) => s.kind === "math")
    .map((s) => s.key);
}

function numbersOf(text: string): string[] {
  const plain = splitMath(text)
    .filter((s) => s.kind === "text")
    .map((s) => s.value)
    .join(" ")
    .replace(/\{\{blank:[^}]+\}\}/g, "");
  return (plain.match(DIGITS) ?? []).sort();
}

function checkBilingual(set: ContentSet, findings: Findings): void {
  const locales = requiredLocales(set);
  for (const { file, doc } of set.files) {
    if (doc.schema === "mnemonics@1") continue; // single-locale by design; checked per concept
    const mediaLocale = new Map<string, string>();
    if (doc.schema === "media-requests@1") {
      for (const r of (doc as unknown as { requests: { id: string; locale?: string }[] }).requests) {
        if (r.locale) mediaLocale.set(r.id, r.locale);
      }
    }
    walkContent(doc, (kind, value, path) => {
      if (kind === "string") return;
      const map = value as Record<string, unknown>;
      let need = locales;
      if (doc.schema === "media-requests@1") {
        const idx = /^\/requests\/(\d+)/.exec(path)?.[1];
        const req = idx !== undefined ? (doc as unknown as { requests: { id: string }[] }).requests[Number(idx)] : undefined;
        const only = req ? mediaLocale.get(req.id) : undefined;
        if (only) need = [only];
      }
      for (const l of need) {
        if (map[l] === undefined) findings.error("missing_locale", file, `${path} has no ${l} text`, { path });
      }
      if (kind !== "i18n") return;
      const texts = map as Record<string, string>;
      // Localised references (mnemonic or audio ids per locale) are ids, not prose.
      if (Object.values(texts).every((v) => /^[a-z0-9]+(?:[.:-][a-z0-9]+)*$/.test(v))) return;
      const base = texts.en;
      if (base === undefined) return;
      for (const [l, text] of Object.entries(texts)) {
        if (l === "en") continue;
        const a = mathOf(base);
        const b = mathOf(text);
        if (a.join("\u0000") !== b.join("\u0000")) {
          findings.error("math_mismatch", file, `${path}: maths in ${l} differs from en (${b.join(" ")} vs ${a.join(" ")})`, { path });
        }
        if (numbersOf(base).join(",") !== numbersOf(text).join(",")) {
          findings.warn("number_mismatch", file, `${path}: numbers in ${l} differ from en`, { path });
        }
      }
    });
  }
}

const INVENTED = [
  /\basked\s+(?:in\s+)?\d+\s+(?:times|years|papers)\b/i,
  /\bhigh[- ]yield\b/i,
  /\b\d+\s*%\s+of\s+(?:students|toppers|aspirants|questions)\b/i,
  /\b(?:all[- ]india\s+)?rank\s+\d+\b/i,
];

function checkInventedStats(set: ContentSet, findings: Findings): void {
  for (const { file, doc } of set.files) {
    if (!["lesson@1", "questions@1", "cheat_sheet@1", "revision_sheet@1", "storybook@1"].includes(doc.schema as string)) {
      continue;
    }
    walkContent(doc, (kind, value, path) => {
      const texts = kind === "i18n" ? Object.values(value as Record<string, string>) : [];
      for (const t of texts) {
        const hit = INVENTED.find((re) => re.test(t));
        if (hit) {
          findings.error(
            "invented_stat",
            file,
            `${path}: statistics like "${t.match(hit)?.[0] ?? ""}" come only from computed data, never from content`,
            { path },
          );
        }
      }
    });
  }
}

