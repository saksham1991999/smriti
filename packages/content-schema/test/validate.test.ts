import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { schemaFiles, validateDocument, validateWith, type SchemaFile } from "../src/index.js";

const fixtures = join(__dirname, "..", "..", "..", "content", "fixtures");
const load = (rel: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(fixtures, rel), "utf8")) as Record<string, unknown>;
const clone = <T>(v: T): T => structuredClone(v);

describe("schemas", () => {
  it("compile", () => {
    for (const file of Object.keys(schemaFiles) as SchemaFile[]) {
      expect(() => validateWith(file, {})).not.toThrow();
    }
  });
});

describe("good samples", () => {
  const files = [
    "exams/fx-exam.json",
    "blueprints/fx-exam-2027/paper-1.v1.json",
    "graph/fx/subject.json",
    "graph/fx/chapter-a.json",
    "exam-maps/fx-exam-2027.json",
    "lessons/fx/chapter-a/topic-a.deep_dive.json",
    "lessons/fx/chapter-a/topic-b.deep_dive.json",
    "lessons/fx/chapter-a/topic-c.deep_dive.json",
    "lessons/fx/chapter-a/topic-d.quick_revision.json",
    "questions/fx/chapter-a/topic-d.json",
    "pyq/fx-exam/fx-exam-2025-s1.json",
    "mnemonics/fx/chapter-a.json",
    "media/requests/fx/chapter-a.json",
    "extras/fx/chapter-a/topic-a.cheat-sheet.json",
    "extras/fx/chapter-a/storybook.json",
    "extras/fx/chapter-a/topic-c.roleplay.json",
    "extras/fx/chapter-a/mind-map.json",
    "coverage/syllabus/fx-exam-2027.json",
    "coverage/inventory/fx/chapter-a.json",
    "seed-packs/fx.json",
    "sims/fx-sim/sim.json",
  ];
  it.each(files)("%s validates", (rel) => {
    const r = validateDocument(load(rel));
    expect(r.ok ? [] : r.errors).toEqual([]);
  });
});

function errorsOf(doc: unknown): string[] {
  const r = validateDocument(doc);
  return r.ok ? [] : r.errors.map((e) => `${e.path} ${e.message}`);
}

describe("bad samples", () => {
  it("rejects a file without a schema field", () => {
    expect(errorsOf({ id: "x" })[0]).toMatch(/schema is missing/);
  });

  it("rejects an unknown schema", () => {
    expect(errorsOf({ schema: "lesson@9" })[0]).toMatch(/unknown schema/);
  });

  it("rejects an unknown card type with a focused error", () => {
    const doc = clone(load("lessons/fx/chapter-a/topic-a.deep_dive.json"));
    (doc.cards as Record<string, unknown>[])[0]!.type = "poster";
    const errs = errorsOf(doc);
    expect(errs.some((e) => e.startsWith("/cards/0") && /unknown type "poster"/.test(e))).toBe(true);
  });

  it("rejects an unknown property on a card", () => {
    const doc = clone(load("lessons/fx/chapter-a/topic-a.deep_dive.json"));
    (doc.cards as Record<string, unknown>[])[0]!.colour = "red";
    expect(errorsOf(doc)).toContain('/cards/0 has unknown property "colour"');
  });

  it("rejects a missing required card field", () => {
    const doc = clone(load("lessons/fx/chapter-a/topic-a.deep_dive.json"));
    delete (doc.cards as Record<string, unknown>[])[1]!.media;
    expect(errorsOf(doc).some((e) => e.includes("/cards/1") && e.includes("media"))).toBe(true);
  });

  it("rejects a depth outside 1-5", () => {
    const doc = clone(load("lessons/fx/chapter-a/topic-a.deep_dive.json"));
    (doc.cards as Record<string, unknown>[])[0]!.depth = 6;
    expect(errorsOf(doc).some((e) => e.startsWith("/cards/0/depth"))).toBe(true);
  });

  it("rejects a URL where a media request id belongs", () => {
    const doc = clone(load("lessons/fx/chapter-a/topic-a.deep_dive.json"));
    (doc.cards as Record<string, unknown>[])[0]!.media = "https://cdn.example/x.webp";
    expect(errorsOf(doc).some((e) => e.startsWith("/cards/0/media"))).toBe(true);
  });

  it("rejects the wrong interactive config for its widget", () => {
    const doc = clone(load("lessons/fx/chapter-a/topic-b.deep_dive.json"));
    const card = (doc.cards as Record<string, unknown>[])[1]!; // slider
    card.config = { steps: [] };
    expect(errorsOf(doc).some((e) => e.startsWith("/cards/1/config"))).toBe(true);
  });

  it("rejects an mcq_single with two answers", () => {
    const doc = clone(load("questions/fx/chapter-a/topic-a.json"));
    ((doc.questions as Record<string, unknown>[])[0]!.answer as { option_ids: string[] }).option_ids = ["a", "b"];
    expect(errorsOf(doc).some((e) => e.startsWith("/questions/0/answer/option_ids"))).toBe(true);
  });

  it("rejects a numerical answer without a value", () => {
    const doc = clone(load("questions/fx/chapter-a/topic-a.json"));
    delete ((doc.questions as Record<string, unknown>[])[1]!.answer as Record<string, unknown>).value;
    expect(errorsOf(doc).some((e) => e.startsWith("/questions/1/answer"))).toBe(true);
  });

  it("rejects a paragraph nested in a paragraph", () => {
    const doc = clone(load("questions/fx/chapter-a/topic-d.json"));
    const para = (doc.questions as Record<string, unknown>[])[0]!;
    (para.children as unknown[]).push(clone(para));
    expect(errorsOf(doc).some((e) => e.startsWith("/questions/0/children/2"))).toBe(true);
  });

  it("rejects an unknown locale key in localised text", () => {
    const doc = clone(load("graph/fx/subject.json"));
    doc.name = { en: "Fixture subject", xx: "?" };
    expect(errorsOf(doc).some((e) => e.startsWith("/name"))).toBe(true);
  });

  it("rejects empty localised text", () => {
    const doc = clone(load("graph/fx/subject.json"));
    doc.name = { en: "" };
    expect(errorsOf(doc).some((e) => e.startsWith("/name/en"))).toBe(true);
  });

  it("rejects a blueprint palette state without a shape", () => {
    const doc = clone(load("blueprints/fx-exam-2027/paper-1.v1.json"));
    const profile = doc.interface_profile as { palette_states: Record<string, unknown>[] };
    delete profile.palette_states[0]!.shape;
    expect(errorsOf(doc).some((e) => e.startsWith("/interface_profile/palette_states/0"))).toBe(true);
  });

  it("rejects a blueprint with an unknown language switch", () => {
    const doc = clone(load("blueprints/fx-exam-2027/paper-1.v1.json"));
    doc.language_switch = "sometimes";
    expect(errorsOf(doc).some((e) => e.startsWith("/language_switch"))).toBe(true);
  });

  it("rejects a media request with an unknown preset", () => {
    const doc = clone(load("media/requests/fx/chapter-a.json"));
    (doc.requests as Record<string, unknown>[])[0]!.preset = "photo";
    expect(errorsOf(doc).some((e) => e.startsWith("/requests/0/preset"))).toBe(true);
  });

  it("rejects a sim manifest above the 2 MB budget", () => {
    const doc = clone(load("sims/fx-sim/sim.json"));
    doc.size_bytes = 3 * 1024 * 1024;
    expect(errorsOf(doc).some((e) => e.startsWith("/size_bytes"))).toBe(true);
  });

  it("rejects a seed pack spec above 8 MB", () => {
    const doc = clone(load("seed-packs/fx.json"));
    doc.max_bytes = 9 * 1024 * 1024;
    expect(errorsOf(doc).some((e) => e.startsWith("/max_bytes"))).toBe(true);
  });

  it("rejects an extras file with the wrong shape for its schema", () => {
    const doc = clone(load("extras/fx/chapter-a/storybook.json"));
    doc.pages = (doc.pages as unknown[]).slice(0, 2);
    expect(errorsOf(doc).some((e) => e.startsWith("/pages"))).toBe(true);
  });
});

describe("facts the notice does not state", () => {
  type Profile = Record<string, unknown>;
  const profileOf = (doc: Record<string, unknown>): Profile => (doc.profiles as Profile[])[0]!;

  it("accepts exam sessions, shift times, paper names and the new schedule kinds", () => {
    const doc = clone(load("exams/fx-exam.json"));
    Object.assign(profileOf(doc), {
      paper_names: { "paper-1": { en: "Paper 1", hi: "प्रश्नपत्र 1" } },
      exam_languages: ["en", "hi"],
      schedule: [
        { kind: "correction_window", date: "2027-01-01", end_date: "2027-01-03", session: "s1", source_url: "https://example.invalid/n" },
        { kind: "re_exam", date: "2027-02-01", source_url: "https://example.invalid/n" },
      ],
      sessions: [
        {
          id: "s1",
          label: { en: "Session 1", hi: "सत्र 1" },
          application_window: { from: "2026-12-01", to: "2026-12-20" },
          exam_dates: ["2027-01-20"],
          source_ref: "fixture p.1",
        },
      ],
      shifts: [{ id: "shift-1", tz: "Asia/Kolkata", times: [{ start: "09:00", end: "12:00", duration_min: 180 }] }],
    });
    expect(errorsOf(doc)).toEqual([]);
    // Unknown shift times stay null rather than a guess.
    profileOf(doc).shifts = null;
    expect(errorsOf(doc)).toEqual([]);
    profileOf(doc).shifts = [{ id: "shift-1", tz: "Asia/Kolkata", times: [{ start: "9am", end: "12:00" }] }];
    expect(errorsOf(doc).some((e) => e.includes("/shifts/0/times/0/start"))).toBe(true);
  });

  it("accepts null paper facts, a fraction penalty, a skill test and per-category cut-offs", () => {
    const doc = clone(load("blueprints/fx-exam-2027/paper-1.v1.json"));
    Object.assign(doc, {
      mode: "mixed",
      interface: "nta_omr",
      calculator: null,
      section_navigation: null,
      numeric_input: null,
      question_count: null,
      qualifying: { rule: { kind: "percentile", by_category: [{ category: "general", value: 50 }] }, source_ref: "fixture" },
      hi_source: "translation",
      open_questions: [{ field: "calculator", question: "Not stated in the fixture notice." }],
    });
    const sections = doc.sections as Record<string, unknown>[];
    Object.assign(sections[0]!, {
      mode: "cbt",
      question_count: null,
      max_marks: null,
      marking: { mcq_single: { correct: null, wrong: { fraction_of_question_marks: 1 / 3 }, unattempted: 0 } },
      cutoff: { kind: "set_by_conducting_body", basis: "Set by the fixture body." },
    });
    sections.push({
      code: "typing",
      title: { en: "Typing test", hi: "टाइपिंग परीक्षा" },
      mode: "cbt",
      question_count: null,
      question_types: ["skill_test"],
      cutoff: { kind: "max_error_percent", value: 5 },
    });
    expect(errorsOf(doc)).toEqual([]);
    (sections[0]!.marking as Record<string, Record<string, unknown>>).mcq_single!.wrong = { fraction_of_question_marks: 1.5 };
    expect(errorsOf(doc).some((e) => e.includes("fraction_of_question_marks"))).toBe(true);
  });

  it("accepts an inventory with Hindi titles, and one that only lists excluded chapters", () => {
    const doc = clone(load("coverage/inventory/fx/chapter-a.json"));
    const item = (doc.items as Record<string, unknown>[])[0]!;
    item.title = { en: "Section one", hi: "खंड एक" };
    delete item.kind;
    expect(errorsOf(doc)).toEqual([]);
    const excluded = {
      schema: "inventory@1",
      subject: "fx",
      excluded_chapters: [
        { ref: "book:1:5", title: { en: "Chapter five", hi: "अध्याय पाँच" }, reason: "Not in the fixture syllabus", source_ref: "fixture" },
      ],
      status: "draft",
      sources: [{ kind: "other", ref: "Fixture source", url: null }],
      authored_by: "fixture",
      reviewed_by: null,
      updated: "2026-10-30",
      hi_source: "ncert",
    };
    expect(errorsOf(excluded)).toEqual([]);
    expect(errorsOf({ ...excluded, excluded_chapters: undefined }).length).toBeGreaterThan(0);
    expect(errorsOf({ ...excluded, hi_source: "machine" }).some((e) => e.startsWith("/hi_source"))).toBe(true);
  });
});
