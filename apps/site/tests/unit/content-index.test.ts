import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import fixture from "../../src/content-index/fixture/site-index.fixture.json";
import {
  allTopicRefs,
  conductingBodies,
  emptyIndex,
  findPublisherIndex,
  isUnreleased,
  loadIndex,
  loadIndexFrom,
  readPublishReport,
  resolveIndexSource,
  parseIndex,
  paths,
  PUBLISHER_INDEX,
  resolveIndexPath,
  subjectsForExam,
  visibleBlueprint,
} from "../../src/content-index";
import type { Blueprint, Exam } from "../../src/content-index/schema";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// Test-only blueprint. Obviously synthetic values; never rendered on the site.
const syntheticBlueprint: Blueprint = {
  paper_code: "paper-x",
  version: 1,
  effective_from: "2030-01-01",
  title: { en: "Test paper", hi: "टेस्ट पेपर" },
  source: { url: "https://example.org/notice.pdf", title: "Test notice", published: "2029-12-01", retrieved: "2029-12-02", pages: null },
  reviewed_by: "reviewer",
  mode: "cbt",
  duration_min: 10,
  languages: ["en", "hi"],
  total_questions: 2,
  max_marks: 8,
  sections: [{ code: "a", title: { en: "A", hi: "ए" }, subject: "phy", question_count: 2, marking: { correct: 4, wrong: -1, unattempted: 0 } }],
};

describe("site content index", () => {
  it("parses the fixture and marks it as fixture", () => {
    const idx = parseIndex(fixture, "fixture");
    expect(idx.fixture).toBe(true);
    expect(idx.exams.map((e) => e.slug)).toEqual(["jee-main", "neet", "upsc", "ssc"]);
  });

  it("the fixture holds no exam pattern data and no minutes", () => {
    const idx = parseIndex(fixture, "fixture");
    for (const e of idx.exams) expect(e.blueprint).toBeNull();
    for (const s of idx.subjects)
      for (const c of s.chapters)
        for (const t of c.topics) {
          expect(t.modes.deep_dive?.minutes ?? null).toBeNull();
          expect(t.modes.quick_revision?.minutes ?? null).toBeNull();
        }
  });

  it("rejects a blueprint without an official source", () => {
    const bad = clone(fixture) as { exams: { blueprint: unknown }[] };
    const bp = clone(syntheticBlueprint) as Partial<Blueprint>;
    delete bp.source;
    bad.exams[0]!.blueprint = bp;
    expect(() => parseIndex(bad, "bad")).toThrow(/source/);
  });

  it("rejects a blueprint without a reviewer", () => {
    const bad = clone(fixture) as { exams: { blueprint: unknown }[] };
    bad.exams[0]!.blueprint = { ...syntheticBlueprint, reviewed_by: "" };
    expect(() => parseIndex(bad, "bad")).toThrow(/reviewed_by/);
  });

  it("accepts facts the notice does not state as null, a fraction penalty and a skill test", () => {
    const idx = clone(fixture) as { exams: { blueprint: unknown }[] };
    idx.exams[0]!.blueprint = {
      ...syntheticBlueprint,
      mode: "mixed",
      total_questions: null,
      sections: [
        { code: "a", title: { en: "A", hi: "ए" }, subject: null, question_count: null, marking: { correct: null, wrong: null, wrong_fraction: 1 / 3, unattempted: 0 } },
        { code: "t", title: { en: "T", hi: "टी" }, subject: null, question_count: null, skill_test: true, marking: null },
      ],
    };
    const bp = parseIndex(idx, "test").exams[0]!.blueprint!;
    expect(bp.sections[0]!.marking?.wrong_fraction).toBeCloseTo(1 / 3);
    expect(bp.sections[1]!.skill_test).toBe(true);
    const bad = clone(idx) as { exams: { blueprint: { sections: { marking: { wrong_fraction: number } }[] } }[] };
    bad.exams[0]!.blueprint.sections[0]!.marking.wrong_fraction = 2;
    expect(() => parseIndex(bad, "bad")).toThrow(/wrong_fraction/);
  });

  it("rejects text missing its Hindi side", () => {
    const bad = clone(fixture) as { subjects: { name: Record<string, string> }[] };
    delete bad.subjects[0]!.name.hi;
    expect(() => parseIndex(bad, "bad")).toThrow(/hi/);
  });

  it("rejects a quiz answer that is not one of the options", () => {
    const bad = clone(fixture) as { home_try_lesson: { questions: { answer: string }[] } };
    bad.home_try_lesson.questions[0]!.answer = "z";
    expect(() => parseIndex(bad, "bad")).toThrow(/answer/);
  });

  it("rejects an exam that lists an unknown subject", () => {
    const bad = clone(fixture) as { exams: { subjects: string[] }[] };
    bad.exams[0]!.subjects.push("nope");
    expect(() => parseIndex(bad, "bad")).toThrow(/unknown subject/);
  });

  it("filters chapters and topics to the exam they are tagged for", () => {
    const idx = parseIndex(fixture, "fixture");
    const neet = idx.exams.find((e) => e.id === "neet-ug")!;
    const subjects = subjectsForExam(idx, neet).map((s) => s.subject.id);
    expect(subjects).toEqual(["phy", "chem", "bio"]);
    const ssc = idx.exams.find((e) => e.id === "ssc-cgl")!;
    expect(subjectsForExam(idx, ssc).some((s) => s.subject.id === "phy")).toBe(false);
  });

  it("builds one topic ref per exam × topic and stable paths", () => {
    const idx = parseIndex(fixture, "fixture");
    const refs = allTopicRefs(idx);
    expect(refs.length).toBe(14 * 3 * 2); // 14 exam-subject pairs × 3 chapters × 2 topics
    const r = refs[0]!;
    expect(paths.topic(r.exam, r.subject, r.chapter, r.topic)).toBe("/exams/jee-main/physics/sample-chapter-1/sample-topic-1-1/");
  });

  it("shows a blueprint only when it is reviewed, sourced over https and has numbers", () => {
    const idx = parseIndex(fixture, "fixture");
    const exam = clone(idx.exams[0]!) as Exam;
    expect(visibleBlueprint(exam)).toBeNull();
    exam.blueprint = syntheticBlueprint;
    expect(visibleBlueprint(exam)).not.toBeNull();
    exam.blueprint = { ...syntheticBlueprint, source: { ...syntheticBlueprint.source, url: "http://example.org/x" } };
    expect(visibleBlueprint(exam)).toBeNull();
    exam.blueprint = {
      ...syntheticBlueprint,
      duration_min: null,
      total_questions: null,
      max_marks: null,
      sections: [{ ...syntheticBlueprint.sections[0]!, question_count: null, marking: null }],
    };
    expect(visibleBlueprint(exam)).toBeNull();
  });

  it("lists conducting bodies once each", () => {
    expect(conductingBodies(parseIndex(fixture, "fixture"))).toEqual(["NTA", "UPSC", "SSC"]);
  });

  it("refuses the fixture when a real index is required", () => {
    expect(() => loadIndexFrom({ requireReal: true })).toThrow(/CONTENT_INDEX_PATH/);
  });

  it("loads an index from CONTENT_INDEX_PATH", () => {
    const dir = mkdtempSync(join(tmpdir(), "site-index-"));
    const real = { ...clone(fixture), fixture: false };
    const file = join(dir, "index.json");
    writeFileSync(file, JSON.stringify(real));
    const idx = loadIndexFrom({ path: file, requireReal: true });
    expect(idx.fixture).toBe(false);
  });

  it("defaults to the publisher's local output, found from anywhere in the workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "site-ws-"));
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
    const site = join(root, "apps", "site");
    mkdirSync(site, { recursive: true });
    expect(findPublisherIndex(site)).toBeUndefined();
    expect(resolveIndexPath(undefined, site)).toBeUndefined();

    const published = join(root, PUBLISHER_INDEX);
    mkdirSync(join(published, ".."), { recursive: true });
    writeFileSync(published, JSON.stringify(fixture));
    expect(findPublisherIndex(site)).toBe(published);
    expect(resolveIndexPath(undefined, site)).toBe(published);
    // An explicit path wins, and `fixture` forces the local fixture.
    expect(resolveIndexPath("/elsewhere/index.json", site)).toBe("/elsewhere/index.json");
    expect(resolveIndexPath("fixture", site)).toBeUndefined();
    expect(loadIndexFrom({ path: resolveIndexPath(undefined, site) }).exams.length).toBeGreaterThan(0);
  });

  it("explains an unreadable index path", () => {
    expect(() => loadIndexFrom({ path: "/nope/missing.json" })).toThrow(/Could not read the content index/);
  });
});

describe("nothing released yet", () => {
  const report = (siteIndex: string | null) =>
    JSON.stringify({ schema: "publish-report@1", site_index: siteIndex, published_at: "2030-01-01T00:00:00.000Z" });

  const workspace = () => {
    const root = mkdtempSync(join(tmpdir(), "site-ws-"));
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
    const site = join(root, "apps", "site");
    mkdirSync(site, { recursive: true });
    const out = join(root, "tools", "content-publish", "out");
    mkdirSync(out, { recursive: true });
    return { site, out };
  };

  it("accepts an index with no exams", () => {
    const idx = parseIndex(emptyIndex(), "empty");
    expect(idx.exams).toEqual([]);
    expect(isUnreleased(idx)).toBe(true);
    expect(isUnreleased(parseIndex(fixture, "fixture"))).toBe(false);
  });

  it("builds empty, not from a leftover index, when the publish report says site_index null", () => {
    const { site, out } = workspace();
    writeFileSync(join(out, "publish-report.json"), report(null));
    writeFileSync(join(out, "site-index.json"), JSON.stringify(fixture)); // stale, from an earlier run
    const source = resolveIndexSource(undefined, site);
    expect(source.kind).toBe("unreleased");
    const idx = loadIndex(source, true); // allowed in production: it is real, just empty
    expect(idx.exams).toEqual([]);
    expect(idx.fixture).toBeUndefined();
    expect(idx.generated_at).toBe("2030-01-01T00:00:00.000Z");
  });

  it("honours the report next to CONTENT_INDEX_PATH, even when the file is missing", () => {
    const { site, out } = workspace();
    writeFileSync(join(out, "publish-report.json"), report(null));
    const source = resolveIndexSource(join(out, "site-index.json"), site);
    expect(source.kind).toBe("unreleased");
    expect(loadIndex(source).exams).toEqual([]);
  });

  it("loads the published file when the report names it", () => {
    const { site, out } = workspace();
    writeFileSync(join(out, "publish-report.json"), report("site-index.json"));
    writeFileSync(join(out, "site-index.json"), JSON.stringify({ ...clone(fixture), fixture: false }));
    const source = resolveIndexSource(undefined, site);
    expect(source).toEqual({ kind: "file", path: join(out, "site-index.json") });
    expect(loadIndex(source, true).exams.length).toBe(4);
  });

  it("still fails when CONTENT_INDEX_PATH is missing and no report explains why", () => {
    const { site, out } = workspace();
    const source = resolveIndexSource(join(out, "site-index.json"), site);
    expect(source.kind).toBe("file");
    expect(() => loadIndex(source, true)).toThrow(/Could not read the content index/);
  });

  it("falls back to the fixture only when nothing was published, and production refuses it", () => {
    const root = mkdtempSync(join(tmpdir(), "site-ws-"));
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
    expect(resolveIndexSource(undefined, root)).toEqual({ kind: "fixture" });
    expect(resolveIndexSource("fixture", root)).toEqual({ kind: "fixture" });
    expect(() => loadIndex({ kind: "fixture" }, true)).toThrow(/fixture/);
  });

  it("ignores a file that is not a publish report and rejects a broken one", () => {
    const { out } = workspace();
    writeFileSync(join(out, "publish-report.json"), JSON.stringify({ site_index: null }));
    expect(readPublishReport(out)).toBeUndefined();
    writeFileSync(join(out, "publish-report.json"), "{");
    expect(() => readPublishReport(out)).toThrow(/publish report/);
  });
});
