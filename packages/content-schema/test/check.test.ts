import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { checkRoot, findRepoRoot, runContentCheck } from "../src/check/index.js";

const repoRoot = findRepoRoot(__dirname);
const fixtures = join(repoRoot, "content", "fixtures");
const temps: string[] = [];

/** A writable copy of the fixture course (the folder name keeps it a fixture root). */
function copy(): string {
  const dir = mkdtempSync(join(tmpdir(), "smriti-check-"));
  temps.push(dir);
  const root = join(dir, "fixtures");
  cpSync(fixtures, root, { recursive: true });
  return root;
}

function edit(root: string, rel: string, fn: (doc: Record<string, any>) => void): void {
  const path = join(root, rel);
  const doc = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
  fn(doc);
  writeFileSync(path, JSON.stringify(doc, null, 2));
}

function codes(root: string): string[] {
  return checkRoot(root, repoRoot).report.findings.filter((f) => f.severity === "error").map((f) => f.code);
}

afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

describe("content check on the fixture course", () => {
  it("passes with full coverage", () => {
    const { report } = checkRoot(fixtures, repoRoot);
    expect(report.findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(report.fixture).toBe(true);
    expect(report.files).toBeGreaterThan(30);
    const cov = report.coverage[0]!;
    expect(cov.exam_profile).toBe("fx-exam-2027");
    expect(cov.totals).toEqual({ concepts: 8, covered: 8, percent: 100 });
    expect(cov.syllabus.percent).toBe(100);
    expect(cov.inventory).toMatchObject({ items: 6, excluded: 1, percent: 100 });
    expect(cov.subjects[0]).toMatchObject({ id: "fx", released: true, ready: true });
  });

  it("checks both the real content root and the fixtures by default", () => {
    const report = runContentCheck({ repoRoot });
    expect(report.ok).toBe(true);
    expect(report.roots.map((r) => r.root)).toEqual(["content", "content/fixtures"]);
  });
});

describe("content check fails on a broken copy", () => {
  it("unknown concept, question and media references", () => {
    const root = copy();
    edit(root, "lessons/fx/chapter-a/topic-a.deep_dive.json", (d) => {
      d.cards[0].concepts = ["fx.chapter-a.topic-a.sub-1.nope"];
      d.cards[3].question = "q.fx.chapter-a.topic-a.9999";
      d.cards[1].media = "img.chapter-a.missing";
    });
    const c = codes(root);
    expect(c).toContain("ref_unknown_concept");
    expect(c).toContain("ref_unknown_question");
    expect(c).toContain("ref_unknown_media");
  });

  it("a prerequisite cycle", () => {
    const root = copy();
    edit(root, "graph/fx/chapter-a.json", (d) => {
      d.topics[0].subtopics[0].concepts[0].prerequisites = ["fx.chapter-a.topic-b.sub-1.concept-1"];
    });
    const { report } = checkRoot(root, repoRoot);
    const cycle = report.findings.find((f) => f.code === "prereq_cycle");
    expect(cycle?.message).toContain("fx.chapter-a.topic-a.sub-1.concept-1 -> fx.chapter-a.topic-b.sub-1.concept-1");
  });

  it("missing Hindi text and mismatched maths", () => {
    const root = copy();
    edit(root, "lessons/fx/chapter-a/topic-a.deep_dive.json", (d) => {
      delete d.cards[0].title.hi;
      d.cards[1].body.hi = "फ़िक्स्चर पाठ $x_1 - x_2$";
    });
    const c = codes(root);
    expect(c).toContain("missing_locale");
    expect(c).toContain("math_mismatch");
  });

  it("a concept with a hook in one language only", () => {
    const root = copy();
    edit(root, "mnemonics/fx/chapter-a.json", (d) => {
      d.items = d.items.filter((m: { locale: string }) => m.locale === "en");
    });
    edit(root, "lessons/fx/chapter-a/topic-b.deep_dive.json", (d) => {
      delete d.cards[5].mnemonic.hi;
    });
    edit(root, "lessons/fx/chapter-a/topic-c.deep_dive.json", (d) => {
      delete d.cards[6].mnemonic.hi;
    });
    edit(root, "extras/fx/chapter-a/topic-b.cheat-sheet.json", (d) => {
      d.mnemonics = [];
    });
    const c = codes(root);
    expect(c).toContain("missing_locale");
    expect(c).toContain("coverage_incomplete");
  });

  it("a released subject below 100% coverage", () => {
    const root = copy();
    edit(root, "questions/fx/chapter-a/topic-a.json", (d) => {
      for (const q of d.questions) q.use = q.use.filter((u: string) => u !== "practice").concat(["lesson"]);
      d.questions = d.questions.map((q: { use: string[] }) => ({ ...q, use: [...new Set(q.use)] }));
      d.questions = d.questions.filter((q: { source?: string }) => q.source !== "pyq");
    });
    edit(root, "pyq/fx-exam/fx-exam-2025-s1.json", (d) => {
      d.items[0].question = "q.fx.chapter-a.topic-a.0001";
    });
    const { report } = checkRoot(root, repoRoot);
    const cov = report.coverage[0]!;
    expect(cov.totals.percent).toBeLessThan(100);
    const gap = cov.subjects[0]!.chapters[0]!.concepts.find((x) => x.id.endsWith("topic-a.sub-1.concept-1"));
    expect(gap?.missing).toContain("practice_question");
    expect(report.findings.some((f) => f.code === "coverage_incomplete" && f.severity === "error")).toBe(true);
  });

  it("a mock question used in a lesson and a mixed use", () => {
    const root = copy();
    edit(root, "lessons/fx/chapter-a/topic-c.deep_dive.json", (d) => {
      d.cards[4].question = "q.fx.chapter-a.topic-c.0004";
    });
    edit(root, "questions/fx/chapter-a/topic-b.json", (d) => {
      d.questions[4].use = ["daily", "practice"];
    });
    const c = codes(root);
    expect(c).toContain("server_only_question");
    expect(c).toContain("question_use_conflict");
  });

  it("answers that name unknown options, steps or blanks", () => {
    const root = copy();
    edit(root, "questions/fx/chapter-a/topic-b.json", (d) => {
      d.questions[0].answer.option_ids = ["a", "z"];
      d.questions[2].answer.order = ["s1", "s2"];
    });
    edit(root, "questions/fx/chapter-a/topic-d.json", (d) => {
      d.questions[2].stem.hi = "फ़िक्स्चर भरें: {{blank:b1}}";
    });
    const c = codes(root);
    expect(c).toContain("question_answer");
    expect(c).toContain("fill_blank_tokens");
  });

  it("blueprint totals that do not add up and unknown palette tokens", () => {
    const root = copy();
    edit(root, "blueprints/fx-exam-2027/paper-1.v1.json", (d) => {
      d.max_marks = 300;
      d.question_count = 7;
      d.interface_profile.palette_states[0].colour_token = "mockPalette.purple";
    });
    expect(codes(root)).toEqual(expect.arrayContaining(["blueprint_marks_mismatch", "blueprint_count_mismatch", "unknown_token"]));

    const missing = copy();
    edit(missing, "blueprints/fx-exam-2027/paper-1.v1.json", (d) => {
      delete d.sections[1].marking.mcq_multi;
    });
    expect(codes(missing)).toContain("blueprint_marking_missing");
  });

  it("a fact left null needs an open question naming it", () => {
    const root = copy();
    const file = "blueprints/fx-exam-2027/paper-1.v1.json";
    edit(root, file, (d) => {
      d.calculator = null;
      d.question_count = null;
      d.sections[0].question_count = null;
      d.sections[0].marking.mcq_single = { correct: null, wrong: { fraction_of_question_marks: 1 / 3 }, unattempted: 0 };
      d.interface_profile.clear_keeps_mark = null;
    });
    const errors = () => checkRoot(root, repoRoot).report.findings.filter((f) => f.code === "open_question_missing").map((f) => f.message);
    const before = errors();
    expect(before).toHaveLength(5);
    for (const field of ["calculator", "question_count", "sections.section-a.question_count", "sections.section-a.marking.mcq_single.correct", "interface_profile.clear_keeps_mark"]) {
      expect(before.some((m) => m.startsWith(`${field} is null`))).toBe(true);
    }
    edit(root, file, (d) => {
      d.open_questions = [
        { field: "calculator", question: "The notice does not say whether a calculator is allowed." },
        { field: "question_count", question: "The notice does not state the number of questions." },
        { field: "sections.section-a.question_count", question: "Not stated." },
        { field: "sections.section-a.marking.mcq_single.correct", question: "Marks per question are not stated." },
        { field: "interface_profile.clear_keeps_mark", question: "Not stated." },
      ];
    });
    expect(errors()).toEqual([]);
    // With counts and marks unknown, the totals are not checked (a warning says so).
    const c = codes(root);
    expect(c).not.toContain("blueprint_count_mismatch");
    expect(c).not.toContain("blueprint_marks_mismatch");
    expect(c).not.toContain("schema_error");
  });

  it("skill test sections, mixed papers and qualifying rules", () => {
    const root = copy();
    edit(root, "blueprints/fx-exam-2027/paper-1.v1.json", (d) => {
      d.mode = "mixed";
      d.sections[0].mode = "cbt";
      d.sections.push({
        code: "typing",
        title: { en: "Fixture typing test", hi: "फ़िक्स्चर टाइपिंग परीक्षा" },
        subject: null,
        timer_min: 15,
        question_count: null,
        question_types: ["skill_test"],
        mode: "cbt",
        cutoff: { kind: "max_error_percent", by_category: [{ category: "UR", value: 20 }, { category: "SC", value: 30 }] },
      });
      d.qualifying = { rule: { kind: "set_by_conducting_body", basis: "Fixture basis" }, source_ref: "Fixture p.1" };
    });
    const findings = checkRoot(root, repoRoot).report.findings;
    // Section B has no mode in a mixed paper; the skill test needs no marking and counts nothing.
    expect(findings.filter((f) => f.severity === "error").map((f) => f.code)).toEqual(["blueprint_section_mode"]);
  });

  it("bites that skip a card and a card outside the lesson's depth range", () => {
    const root = copy();
    edit(root, "lessons/fx/chapter-a/topic-a.deep_dive.json", (d) => {
      d.bites[0].card_ids.pop();
      d.max_depth = 4;
    });
    const c = codes(root);
    expect(c).toContain("bites_invalid");
    expect(c).toContain("card_depth_range");
  });

  it("a fixture file without the fixture flag, and an invented statistic", () => {
    const root = copy();
    edit(root, "graph/fx/subject.json", (d) => {
      delete d.fixture;
    });
    edit(root, "lessons/fx/chapter-a/topic-a.deep_dive.json", (d) => {
      d.cards[0].body.en = "Fixture body, asked in 7 years of papers";
    });
    const c = codes(root);
    expect(c).toContain("fixture_flag_missing");
    expect(c).toContain("invented_stat");
  });

  it("invalid JSON and schema errors", () => {
    const root = copy();
    writeFileSync(join(root, "lessons/fx/chapter-a/topic-a.deep_dive.json"), "{ not json");
    edit(root, "graph/fx/subject.json", (d) => {
      d.sort = -1;
    });
    const c = codes(root);
    expect(c).toContain("parse_error");
    expect(c).toContain("schema_error");
  });

  it("a fixture media file whose hash does not match", () => {
    const root = copy();
    edit(root, "media/requests/fx/chapter-a.json", (d) => {
      d.requests[0].result.sha256 = "0".repeat(64);
    });
    expect(codes(root)).toContain("media_sha_mismatch");
  });

  it("a song without a version, transcript or forward timings, and play rounds that name unknown ids", () => {
    const root = copy();
    edit(root, "extras/fx/chapter-a/topic-a.song.json", (d) => {
      d.versions = d.versions.filter((v: { locale: string }) => v.locale === "en");
      d.versions[0].lines[2].start_ms = 100;
      d.versions[0].lines[3].action = "jump";
      delete d.versions[0].lines[0].end_ms;
    });
    edit(root, "media/requests/fx/chapter-a.json", (d) => {
      const r = d.requests.find((x: { id: string }) => x.id === "audio.chapter-a.fx-song-en");
      delete r.transcript;
      r.kind = "audio_tts";
    });
    edit(root, "extras/fx/chapter-a/topic-a.play.json", (d) => {
      d.feedback.try_again.en = "Wrong! Try harder";
      d.rounds[0].answer = ["tile-9"];
      d.rounds[2].items[0].bucket = "bucket-z";
      d.rounds[3].targets[1].accepts = "tile-1";
    });
    const c = codes(root);
    for (const code of ["missing_locale", "song_timing", "song_action_unknown", "song_transcript_missing", "song_audio_kind", "little_negative_word", "play_ref", "duplicate_id"]) {
      expect(c).toContain(code);
    }
  });

  it("little learner coverage: a story, song or lesson teaches and a play activity practises", () => {
    const root = copy();
    edit(root, "exams/fx-exam.json", (d) => {
      d.profiles[0].audience = "little_learner";
    });
    const { report } = checkRoot(root, repoRoot);
    const concepts = report.coverage[0]!.subjects[0]!.chapters[0]!.concepts;
    const a = concepts.find((x) => x.id === "fx.chapter-a.topic-a.sub-1.concept-1")!;
    expect(a).toMatchObject({ covered: true, met: ["teaching_card", "play_activity"], missing: [] });
    const b = concepts.find((x) => x.id === "fx.chapter-a.topic-b.sub-1.concept-1")!;
    expect(b.missing).toEqual(["play_activity"]);
    expect(b.met).not.toContain("revision_card");
    // Songs count as memory hooks in every locale they are sung in.
    edit(root, "mnemonics/fx/chapter-a.json", (d) => {
      d.items = [];
    });
    edit(root, "extras/fx/chapter-a/topic-a.song.json", (d) => {
      d.concepts.push("fx.chapter-a.topic-b.sub-1.concept-1");
    });
    edit(root, "exams/fx-exam.json", (d) => {
      delete d.profiles[0].audience;
    });
    const after = checkRoot(root, repoRoot).report.coverage[0]!.subjects[0]!.chapters[0]!.concepts;
    const byId = (id: string) => after.find((x) => x.id === id)!;
    expect(byId("fx.chapter-a.topic-b.sub-1.concept-1").met).toContain("memory_hook");
    expect(byId("fx.chapter-a.topic-c.sub-1.concept-1").missing).toContain("memory_hook");
  });

  it("the CLI exits non-zero on a broken copy", async () => {
    const root = copy();
    edit(root, "graph/fx/subject.json", (d) => {
      d.chapters.push("fx.chapter-z");
    });
    const { spawnSync } = await import("node:child_process");
    const out = join(root, "..", "report.json");
    const res = spawnSync("npx", ["tsx", "src/check/cli.ts", "--root", root, "--out", out, "--quiet"], {
      cwd: join(__dirname, ".."),
      encoding: "utf8",
    });
    expect(res.status).toBe(1);
    const report = JSON.parse(readFileSync(out, "utf8")) as { ok: boolean; roots: { findings: { code: string }[] }[] };
    expect(report.ok).toBe(false);
    expect(report.roots[0]!.findings.map((f) => f.code)).toContain("ref_unknown_chapter");
  });
});
