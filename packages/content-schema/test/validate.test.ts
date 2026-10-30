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
