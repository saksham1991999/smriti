import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { checkRoot, findRepoRoot } from "../src/check/index.js";
import { validateDocument } from "../src/index.js";

// palace_template@1 (memory-labs §5.6, gap G3). The documents here are test data with
// placeholder names, like the fixture course; real templates come from the content skills.

const repoRoot = findRepoRoot(__dirname);
const temps: string[] = [];

function copy(): string {
  const dir = mkdtempSync(join(tmpdir(), "smriti-palace-"));
  temps.push(dir);
  const root = join(dir, "fixtures");
  cpSync(join(repoRoot, "content", "fixtures"), root, { recursive: true });
  return root;
}

const codes = (root: string): string[] =>
  checkRoot(root, repoRoot).report.findings.filter((f) => f.severity === "error").map((f) => f.code);

afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

const spot = (id: string, order: number, x: number) => ({
  id,
  order,
  pos: { x, y: 0.5 } as { x: number; y: number } | { yaw: number; pitch: number },
  label: { en: `Spot ${id}`, hi: `स्थान ${id}` },
});

const template = () => ({
  schema: "palace_template@1",
  fixture: true,
  status: "review",
  authored_by: "fixture",
  updated: "2026-10-31",
  id: "pt.fx-home",
  kind: "home",
  name: { en: "Fixture palace", hi: "फ़िक्स्चर महल" },
  exam_profiles: ["fx-exam-2027"],
  rooms: [
    {
      id: "room-a",
      name: { en: "Room A", hi: "कमरा A" },
      image: "img.chapter-a.fx-scene-a" as string | undefined,
      spots: [spot("a", 0, 0.1), spot("b", 1, 0.3), spot("c", 2, 0.5), spot("d", 3, 0.7), spot("e", 4, 0.9)],
    },
  ],
});

const put = (root: string, doc: unknown) => writeFileSync(join(root, "palace-template.json"), JSON.stringify(doc, null, 2));

describe("palace_template@1 schema", () => {
  it("validates a template", () => {
    const r = validateDocument(template());
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it("needs 5 to 10 spots, one scene per room and a pt. id", () => {
    const few = template();
    few.rooms[0]!.spots.splice(4);
    expect(validateDocument(few).ok).toBe(false);
    const both = { ...template(), rooms: [{ ...template().rooms[0]!, pano: "pano.fx-room" }] };
    expect(validateDocument(both).ok).toBe(false);
    expect(validateDocument({ ...template(), id: "fx-home" }).ok).toBe(false);
    expect(validateDocument({ ...template(), kind: "custom" }).ok).toBe(false);
  });
});

describe("palace_template@1 content check", () => {
  it("passes on the fixture course", () => {
    const root = copy();
    put(root, template());
    expect(codes(root)).toEqual([]);
  });

  it("flags walk order gaps, wrong positions, presets and profiles", () => {
    const root = copy();
    const doc = template();
    const room = doc.rooms[0]!;
    room.spots[4]!.order = 7;
    room.spots[3]!.pos = { yaw: 10, pitch: 0 };
    room.image = "img.chapter-a.fx-diagram-a";
    doc.exam_profiles = ["nope"];
    put(root, doc);
    const c = codes(root);
    for (const code of ["palace_spot_order", "palace_spot_pos", "palace_room_preset", "ref_unknown_profile"]) expect(c).toContain(code);
  });

  it("puts 360° templates on pano scenes and catches unknown media", () => {
    const root = copy();
    put(root, { ...template(), kind: "pano360" });
    expect(codes(root)).toContain("palace_room_scene");
    const missing = template();
    missing.rooms[0]!.image = "img.chapter-a.nope";
    put(root, missing);
    expect(codes(root)).toContain("ref_unknown_media");
  });
});
