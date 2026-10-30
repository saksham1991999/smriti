import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { checkRoot } from "@smriti/content-schema/check";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyPatch,
  buildSiteIndex,
  canonicalJson,
  diffBundles,
  hashed,
  MemoryStore,
  planProfile,
  publish,
  R2Store,
  r2ConfigFromEnv,
  resolveMedia,
  uuidv5,
  type S3Like,
  type SiteIndex,
} from "../src/index.js";
import { cleanup, editJson, fixtureCopy, fixtures, NOW, repoRoot, tempDir } from "./helpers.js";

afterEach(cleanup);

function loadSet(root = fixtures) {
  const { set, report } = checkRoot(root, repoRoot);
  expect(report.errors).toBe(0);
  return set;
}

function siteIndexFor(root = fixtures): SiteIndex {
  const set = loadSet(root);
  const plan = planProfile(set, "fx-exam-2027", null);
  expect(plan).not.toBeNull();
  return buildSiteIndex({ set, plans: [plan!], fixture: true, now: NOW })!;
}

describe("site index (site-index@1)", () => {
  it("lists exams, subjects, chapters and topics with URL-safe ids", () => {
    const idx = siteIndexFor();
    expect(idx.schema).toBe("site-index@1");
    expect(idx.fixture).toBe(true);
    expect(idx.generated_at).toBe(NOW.toISOString());
    const exam = idx.exams[0]!;
    expect(exam).toMatchObject({ id: "fx-exam", slug: "fx-exam", accent: "all", subjects: ["fx"], summary: null });
    const topics = idx.subjects[0]!.chapters[0]!.topics;
    expect(topics.map((t) => t.id)).toEqual([
      "fx.chapter-a.topic-a",
      "fx.chapter-a.topic-b",
      "fx.chapter-a.topic-c",
      "fx.chapter-a.topic-d",
    ]);
    for (const t of topics) {
      expect(t.id).toMatch(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
      expect(encodeURIComponent(t.id)).toBe(t.id);
      expect(t.exams).toEqual(["fx-exam"]);
    }
    expect(topics[0]!.modes.deep_dive?.minutes).toBeGreaterThan(0);
    expect(idx.subjects[0]!.chapters[0]!.deep_dive_free).toBe(true);
  });

  it("takes the try-lesson from plain single-answer lesson or practice questions", () => {
    const tl = siteIndexFor().exams[0]!.try_lesson!;
    expect(tl.topic_id).toBe("fx.chapter-a.topic-a");
    expect(tl.questions.length).toBeGreaterThan(0);
    for (const q of tl.questions) {
      expect(q.options.map((o) => o.id)).toContain(q.answer);
      expect(q.stem.en).not.toContain("$");
    }
  });

  it("shows the blueprint only with its citation and a reviewer", () => {
    expect(siteIndexFor().exams[0]!.blueprint).toBeNull();
    const root = fixtureCopy();
    editJson(root, "blueprints/fx-exam-2027/paper-1.v1.json", (d) => {
      d.reviewed_by = "fixture-reviewer";
    });
    const bp = siteIndexFor(root).exams[0]!.blueprint!;
    expect(bp).toMatchObject({ paper_code: "paper-1", version: 1, reviewed_by: "fixture-reviewer", total_questions: 6, max_marks: 24 });
    expect(bp.source.url).toBe("https://example.invalid/fixture-notification");
    expect(bp.sections[0]!.marking).toEqual({ correct: 4, wrong: -1, unattempted: 0 });
    // Section B mixes marking rules, so it shows none rather than a misleading one.
    expect(bp.sections[1]!.marking).toBeNull();
  });

  // The site owns the zod schema. When it is in this checkout (or SITE_INDEX_SCHEMA names it),
  // validate against it directly.
  const siteSchema = process.env.SITE_INDEX_SCHEMA ?? join(repoRoot, "apps", "site", "src", "content-index", "schema.ts");
  // With SITE_INDEX_SCHEMA set (CI), a missing schema fails instead of skipping.
  it.skipIf(!process.env.SITE_INDEX_SCHEMA && !existsSync(siteSchema))("passes the site's own zod schema", async () => {
    const local = join(__dirname, "..", ".site-schema.tmp.ts");
    writeFileSync(local, readFileSync(siteSchema, "utf8"));
    try {
      const mod = (await import(local)) as { SiteIndex: { safeParse(v: unknown): { success: boolean; error?: unknown } } };
      const res = mod.SiteIndex.safeParse(siteIndexFor());
      expect(res.error).toBeUndefined();
      expect(res.success).toBe(true);
    } finally {
      const { rmSync } = await import("node:fs");
      rmSync(local, { force: true });
    }
  });
});

describe("media", () => {
  it("ships unapproved media as unavailable in fixtures, and refuses it for real content", () => {
    const set = loadSet();
    const ctx = { set, repoRoot, fixture: true };
    expect(resolveMedia("img.chapter-a.fx-pending", "en", ctx).media).toMatchObject({ status: "unavailable", url: null });
    expect(() => resolveMedia("img.chapter-a.fx-pending", "en", { ...ctx, fixture: false })).toThrow(/media_not_approved/);
    const ready = resolveMedia("img.ui.pet-cat-base", "hi", ctx);
    expect(ready.media.status).toBe("ready");
    expect(ready.media.url).toMatch(/^assets\/[0-9a-f]{64}\.webp$/);
    expect(ready.asset?.sourcePath).toContain("design/mocks/assets");
  });
});

describe("patch format", () => {
  const v1 = {
    id: "t:deep_dive:en",
    schema: "bundle@1",
    old_field: 1,
    cards: [
      { id: "c1", body: "a" },
      { id: "c2", body: "b" },
    ],
    questions: { q1: { id: "q1" }, q2: { id: "q2" } },
    math: {},
  };
  const v2 = {
    id: "t:deep_dive:en",
    schema: "bundle@1",
    new_field: "x",
    cards: [
      { id: "c3", body: "c" },
      { id: "c1", body: "a2" },
    ],
    questions: { q1: { id: "q1" }, q3: { id: "q3" } },
    pyq_papers: { p: { exam: "e", exam_name: "E", year: 2025 } },
  };

  it("round-trips adds, removals, reorders and maps that appear or vanish", () => {
    const patch = diffBundles(v1, v2);
    expect(patch.unset).toEqual(["math", "old_field"]);
    expect(patch.cards).toEqual({ order: ["c3", "c1"], upsert: [v2.cards[0], v2.cards[1]], removed: ["c2"] });
    expect(patch.maps.questions).toEqual({ upsert: { q3: { id: "q3" } }, removed: ["q2"] });
    expect(canonicalJson(applyPatch(v1, patch))).toBe(canonicalJson(v2));
  });

  it("is empty between identical versions", () => {
    const p = diffBundles(v1, structuredClone(v1));
    expect(p.from_hash).toBe(p.to_hash);
    expect(p.cards.upsert).toEqual([]);
    expect(p.maps).toEqual({});
  });
});

describe("helpers and stores", () => {
  it("derives stable RFC 4122 v5 ids and canonical hashes", () => {
    expect(uuidv5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
    expect(hashed({ b: 1, a: [2, { d: 1, c: 2 }] }).hash).toBe(hashed({ a: [2, { c: 2, d: 1 }], b: 1 }).hash);
  });

  it("R2 store sends puts to the right bucket with cache headers", async () => {
    const sent: { name: string; input: Record<string, unknown> }[] = [];
    const fake: S3Like = {
      send: async (c) => {
        sent.push({ name: c.constructor.name, input: c.input as unknown as Record<string, unknown> });
        if (c instanceof GetObjectCommand) {
          const e = new Error("missing") as Error & { name: string };
          e.name = "NoSuchKey";
          throw e;
        }
        return {};
      },
    };
    const store = new R2Store(r2ConfigFromEnv({
      R2_ACCOUNT_ID: "acc",
      R2_ACCESS_KEY_ID: "k",
      R2_SECRET_ACCESS_KEY: "s",
      R2_BUCKET_CONTENT: "content-bucket",
      R2_BUCKET_ASSETS: "assets-bucket",
    }), fake);
    await store.put("assets", "assets/x.webp", new Uint8Array([1]), { contentType: "image/webp", immutable: true });
    await store.put("content", "manifests/p.en.json", new Uint8Array([1]), { contentType: "application/json", immutable: false });
    expect(await store.get("content", "nope.json")).toBeNull();
    expect(sent[0]).toMatchObject({ name: PutObjectCommand.name, input: { Bucket: "assets-bucket", Key: "assets/x.webp", CacheControl: "public, max-age=31536000, immutable" } });
    expect(sent[1]).toMatchObject({ input: { Bucket: "content-bucket", CacheControl: "public, max-age=60" } });
    expect(() => r2ConfigFromEnv({})).toThrow(/R2_ACCOUNT_ID/);
  });

  it("a memory target publishes the fixtures too (used by tests)", async () => {
    const store = new MemoryStore();
    const report = await publish({ repoRoot, contentRoot: fixtures, store, reportDir: tempDir(), now: NOW });
    expect(report.target).toBe("memory");
    expect(await store.exists("content", "site-index.json")).toBe(true);
  });
});
