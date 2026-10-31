import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { validateWith } from "@smriti/content-schema";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyPatch,
  LocalDirStore,
  MemoryStore,
  publish,
  PublishError,
  R2Store,
  type PublishReport,
  type S3Like,
} from "../src/index.js";
import { approveAll, cleanup, editJson, fixtureCopy, fixtures, NOW, realCourse, release, repoRoot, tempDir } from "./helpers.js";

afterEach(cleanup);

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;

async function publishLocal(root: string, out: string, now = NOW): Promise<PublishReport> {
  return publish({ repoRoot, contentRoot: root, store: new LocalDirStore(out), environment: "local", reportDir: out, now });
}

describe("publishing the fixture course to a local folder", () => {
  it("writes bundles, manifests, seed packs, the site index, history and SQL", async () => {
    const out = tempDir();
    const report = await publishLocal(fixtures, out);

    // 4 topics x 3 modes x 2 locales, plus story, song and play on topic-a in 2 locales
    expect(report.bundles).toHaveLength(30);
    for (const b of report.bundles) {
      const bytes = readFileSync(join(out, b.path));
      const doc = JSON.parse(bytes.toString("utf8"));
      expect(validateWith("bundle.schema.json", doc).ok).toBe(true);
      expect(b.path).toMatch(/^bundles\/fx\.chapter-a\.topic-[a-d]\.(deep_dive|quick_revision|practice|story|song|play)\.(en|hi)\.[0-9a-f]{64}\.json$/);
      expect(doc.fixture).toBe(true);
    }

    // Manifests: current pointer and hash-named archive, valid, with depths and free flags.
    for (const locale of ["en", "hi"]) {
      const m = readJson(join(out, "manifests", `fx-exam-2027.${locale}.json`));
      expect(validateWith("manifest.schema.json", m).ok).toBe(true);
      expect(m.version).toBe(1);
      expect(m.free.deep_dive_chapters).toEqual(["fx.chapter-a"]);
      const topic = m.topics["fx.chapter-a.topic-d"];
      expect(topic.depth["fx.chapter-a.topic-d.sub-1.concept-2"]).toBe(4);
      expect(Object.keys(topic.bundles).sort()).toEqual(["deep_dive", "practice", "quick_revision"]);
      expect(topic.bundles.deep_dive.is_free).toBe(true);
      expect(topic.activities).toBeUndefined();

      // Little learner path nodes: the chapter's storybook sits on its first topic.
      const a = m.topics["fx.chapter-a.topic-a"];
      expect(Object.keys(a.bundles).sort()).toEqual(["deep_dive", "play", "practice", "quick_revision", "song", "story"]);
      expect(a.activities.map((x: { kind: string; id: string }) => `${x.kind}:${x.id}`)).toEqual([
        "story:sb.fx.chapter-a",
        "song:sg.fx.topic-a",
        "play:pl.fx.topic-a",
      ]);
      const song = a.activities[1];
      expect(song).toMatchObject({ minutes: 1, cover: "img.chapter-a.fx-hook" });
      expect(typeof song.title).toBe("string");
      expect(a.activities[0].cover).not.toBeNull();
    }

    // An activity bundle carries its items localised; a song carries only this locale's version.
    for (const locale of ["en", "hi"]) {
      const b = report.bundles.find((x) => x.id === `fx.chapter-a.topic-a:song:${locale}`)!;
      const doc = JSON.parse(readFileSync(join(out, b.path), "utf8"));
      const song = doc.activities["sg.fx.topic-a"];
      expect(song.versions).toBeUndefined();
      expect(song.version.locale).toBe(locale);
      expect(song.version.audio).toBe(`audio.chapter-a.fx-song-${locale}`);
      expect(doc.media[song.version.audio]).toBeDefined();
      expect(typeof song.title).toBe("string");
      expect(doc.cards).toEqual([]);
      const play = report.bundles.find((x) => x.id === `fx.chapter-a.topic-a:play:${locale}`)!;
      const pdoc = JSON.parse(readFileSync(join(out, play.path), "utf8"));
      expect(pdoc.activities["pl.fx.topic-a"].rounds.map((r: { kind: string }) => r.kind)).toEqual(["tap", "match", "sort", "drag", "trace"]);
      expect(typeof pdoc.activities["pl.fx.topic-a"].feedback.success).toBe("string");
    }

    // Seed packs under 8 MB, valid, with their files beside them.
    expect(report.seed_packs).toHaveLength(2);
    for (const s of report.seed_packs) {
      expect(s.total_bytes).toBeLessThan(8 * 1024 * 1024);
      const pack = readJson(join(out, "seed", s.variant_id, s.locale, "seed-pack.json"));
      expect(validateWith("seed-pack.schema.json", pack).ok).toBe(true);
      for (const f of [...pack.bundles, ...pack.assets, ...pack.manifests]) {
        expect(existsSync(join(out, "seed", s.variant_id, s.locale, f.path))).toBe(true);
      }
      expect(pack.assets.map((a: { ref: string }) => a.ref)).toContain("img.ui.pet-cat-base");
      expect(pack.bundles.some((b: { path: string }) => b.path.includes(".song."))).toBe(true);
    }

    // Assets copied from design/mocks/assets under their sha256.
    expect(readdirSync(join(out, "assets")).every((f) => /^[0-9a-f]{64}\.webp$/.test(f))).toBe(true);

    // History, SQL and the report.
    expect(validateWith("publish-history.schema.json", readJson(join(out, "publish-history.json"))).ok).toBe(true);
    const sql = readFileSync(join(out, "metadata.sql"), "utf8");
    expect(sql).toContain("-- FIXTURE COURSE");
    for (const [table, rows] of Object.entries(report.sql.rows)) if (rows > 0) expect(sql).toContain(`insert into ${table} `);
    expect(Object.keys(report.sql.tables)).toHaveLength(30);
    // Search documents for the tutor: topics and concepts in both locales, published text only.
    expect(report.sql.rows["content.search_docs"]).toBeGreaterThan(0);
    expect(sql).toMatch(/\('topic:fx\.chapter-a\.topic-a:hi', 'topic', 'fx\.chapter-a\.topic-a', 'hi', ARRAY\['fx-exam-2027'\]/);
    // The only warnings are the fixture media that is not approved yet (listed item by item).
    expect(report.warnings.filter((w) => !w.endsWith("shipped as unavailable (local build)"))).toEqual([]);
    expect(existsSync(join(out, "site-index.json"))).toBe(true);
  });

  it("refuses to publish when the content check fails", async () => {
    const root = fixtureCopy();
    editJson(root, "graph/fx/subject.json", (d) => {
      d.chapters.push("fx.chapter-z");
    });
    await expect(publishLocal(root, tempDir())).rejects.toMatchObject({ code: "content_check" });
  });

  it("refuses a seed pack over its size limit", async () => {
    const root = fixtureCopy();
    editJson(root, "seed-packs/fx.json", (d) => {
      d.max_bytes = 1000;
    });
    await expect(publishLocal(root, tempDir())).rejects.toMatchObject({ code: "seed_too_large" });
  });
});

describe("determinism", () => {
  it("gives the same hashes for the same input, and changes nothing on a re-run", async () => {
    const a = await publish({ repoRoot, contentRoot: fixtures, store: new MemoryStore(), environment: "local", reportDir: tempDir(), now: NOW });
    const b = await publish({
      repoRoot,
      contentRoot: fixtures,
      store: new MemoryStore(),
      environment: "local",
      reportDir: tempDir(),
      now: new Date("2027-01-01T00:00:00Z"),
    });
    expect(b.bundles.map((x) => x.hash)).toEqual(a.bundles.map((x) => x.hash));
    expect(b.manifests.map((x) => x.hash)).toEqual(a.manifests.map((x) => x.hash));
    expect(b.seed_packs.map((x) => x.hash)).toEqual(a.seed_packs.map((x) => x.hash));

    const out = tempDir();
    await publishLocal(fixtures, out);
    const again = await publishLocal(fixtures, out, new Date("2026-11-01T00:00:00Z"));
    expect(again.bundles.every((x) => !x.changed && x.version === 1)).toBe(true);
    expect(again.manifests.every((m) => m.version === 1)).toBe(true);
    expect(again.patches).toEqual([]);
  });
});

describe("patches", () => {
  it("builds a patch from v1 to v2 that turns v1 into exactly v2", async () => {
    const root = fixtureCopy();
    const out = tempDir();
    const v1 = await publishLocal(root, out);
    editJson(root, "lessons/fx/chapter-a/topic-a.deep_dive.json", (d) => {
      d.cards[0].body.en = "Fixture body, edited for v2";
      d.cards.splice(2, 0, {
        id: "fx.chapter-a.topic-a:dd:20",
        type: "summary",
        concepts: ["fx.chapter-a.topic-a.sub-1.concept-1"],
        depth: 1,
        points: [{ en: "Fixture point $z$", hi: "फ़िक्स्चर बिंदु $z$" }],
      });
      d.bites[0].card_ids.splice(2, 0, "fx.chapter-a.topic-a:dd:20");
    });
    const v2 = await publishLocal(root, out, new Date("2026-11-01T00:00:00Z"));

    const id = "fx.chapter-a.topic-a:deep_dive:en";
    const before = v1.bundles.find((b) => b.id === id)!;
    const after = v2.bundles.find((b) => b.id === id)!;
    expect(after.changed).toBe(true);
    expect(after.version).toBe(2);
    expect(v2.bundles.filter((b) => b.changed).map((b) => b.id).sort()).toEqual([
      "fx.chapter-a.topic-a:deep_dive:en",
      "fx.chapter-a.topic-a:deep_dive:hi",
    ]);

    const patchRef = v2.patches.find((p) => p.bundle_id === id)!;
    const patch = readJson(join(out, patchRef.path));
    expect(validateWith("patch.schema.json", patch).ok).toBe(true);
    expect(patch.cards.upsert.map((c: { id: string }) => c.id).sort()).toEqual([
      "fx.chapter-a.topic-a:dd:01",
      "fx.chapter-a.topic-a:dd:20",
    ]);
    expect(Object.keys(patch.maps.math.upsert)).toEqual(["$z$"]);

    const oldBundle = readJson(join(out, before.path));
    const patched = applyPatch(oldBundle, patch as never);
    expect(patched).toEqual(readJson(join(out, after.path)));
    expect(() => applyPatch(readJson(join(out, after.path)), patch as never)).toThrow(PublishError);

    const manifest = readJson(join(out, "manifests", "fx-exam-2027.en.json"));
    expect(manifest.version).toBe(2);
    expect(manifest.topics["fx.chapter-a.topic-a"].bundles.deep_dive.patches).toEqual([
      { from_hash: before.hash, path: patchRef.path, size_bytes: patchRef.size_bytes },
    ]);
  });
});

describe("the release gate (content/releases.json)", () => {
  const run = (c: { root: string; repo: string }, environment: "production" | "staging", store: ConstructorParameters<typeof R2Store> | null = null) =>
    publish({
      repoRoot: c.repo,
      contentRoot: c.root,
      store: store ? new R2Store(...store) : new MemoryStore(),
      environment,
      reportDir: tempDir(),
      now: NOW,
    });

  it("skips unreleased content in production, unapproved media and all, and lists it", async () => {
    const c = realCourse();
    const report = await run(c, "production");
    expect(report.fixture).toBe(false);
    expect(report.bundles).toEqual([]);
    expect(report.unreleased).toEqual([{ exam_profile: "fx-exam-2027", chapters: ["fx.chapter-a"] }]);
    expect(report.unapproved_media).toEqual([]);
    expect(report.warnings).toContain("nothing is released for production (content/releases.json), so nothing was built");
    expect(report.warnings).toContain("fx-exam-2027: 1 chapter(s) not released, skipped (production build): fx.chapter-a");
  });

  it("refuses a real production publish of nothing", async () => {
    const c = realCourse();
    const sent: unknown[] = [];
    const config = { accountId: "acc", accessKeyId: "k", secretAccessKey: "s", contentBucket: "c", assetsBucket: "a" };
    await expect(run(c, "production", [config, { send: async (cmd) => void sent.push(cmd) }])).rejects.toMatchObject({ code: "nothing_released" });
  });

  it("holds released content to approved media in production", async () => {
    const c = realCourse();
    release(c.root, { chapters: ["fx.chapter-a"] });
    await expect(run(c, "production")).rejects.toMatchObject({ code: "media_not_approved" });

    approveAll(c.root);
    const report = await run(c, "production");
    expect(report.bundles.length).toBeGreaterThan(0);
    expect(report.subjects).toEqual(["fx"]);
    expect(report.unreleased).toEqual([]);
    expect(report.unapproved_media).toEqual([]);
  });

  it("builds everything in staging, released or not, with unapproved media listed", async () => {
    const c = realCourse();
    const report = await run(c, "staging");
    expect(report.bundles.length).toBeGreaterThan(0);
    expect(report.unreleased).toEqual([]);
    expect(report.unapproved_media.map((m) => m.ref)).toContain("img.chapter-a.fx-pending");
  });
});

describe("targets", () => {
  it("never publishes the fixture course to R2", async () => {
    const sent: unknown[] = [];
    const fake: S3Like = { send: async (c) => void sent.push(c) };
    const store = new R2Store(
      { accountId: "acc", accessKeyId: "k", secretAccessKey: "s", contentBucket: "c", assetsBucket: "a" },
      fake,
    );
    await expect(
      publish({ repoRoot, contentRoot: fixtures, store, environment: "staging", reportDir: tempDir(), now: NOW }),
    ).rejects.toMatchObject({ code: "fixture_remote" });
    expect(sent).toEqual([]);
  });

  it("needs an explicit environment, keeps R2 off local builds and the fixture course off production", async () => {
    const out = tempDir();
    await expect(
      publish({ repoRoot, contentRoot: fixtures, store: new LocalDirStore(out), environment: undefined as never, reportDir: out, now: NOW }),
    ).rejects.toMatchObject({ code: "environment_required" });
    expect(readdirSync(out)).toEqual([]);

    const sent: unknown[] = [];
    const store = new R2Store(
      { accountId: "acc", accessKeyId: "k", secretAccessKey: "s", contentBucket: "c", assetsBucket: "a" },
      { send: async (c) => void sent.push(c) },
    );
    await expect(
      publish({ repoRoot, contentRoot: fixtures, store, environment: "local", reportDir: tempDir(), now: NOW }),
    ).rejects.toMatchObject({ code: "environment_remote" });
    expect(sent).toEqual([]);

    await expect(
      publish({ repoRoot, contentRoot: fixtures, store: new MemoryStore(), environment: "production", reportDir: tempDir(), now: NOW }),
    ).rejects.toMatchObject({ code: "fixture_production" });
  });

  it("lists each unapproved media item that shipped as unavailable", async () => {
    const report = await publishLocal(fixtures, tempDir());
    expect(report.environment).toBe("local");
    expect(report.unapproved_media.map((m) => m.ref)).toContain("img.chapter-a.fx-pending");
    for (const m of report.unapproved_media) {
      expect(m.status).not.toBe("approved");
      expect(report.warnings).toContain(`${m.ref} is ${m.status}, not approved: shipped as unavailable (local build)`);
    }
  });

  it("refuses to mix the fixture course into a target that holds real content", async () => {
    const out = tempDir();
    writeFileSync(join(out, "publish-history.json"), JSON.stringify({ schema: "publish-history@1", bundles: {}, manifests: {}, items: {} }));
    await expect(publishLocal(fixtures, out)).rejects.toMatchObject({ code: "history_mixed" });
  });
});
