/**
 * smriti content publisher.
 *
 *   tsx src/cli.ts [--root <content dir>] [--target local|r2] [--out <dir>] [--report <dir>]
 *                  [--now <ISO time>] [--keep-patches <n>] [--dry-run]
 *
 * --dry-run builds everything in memory and writes only metadata.sql and publish-report.json
 *   (to --report, or a temporary folder). CI uses it to prove a publish would succeed.
 * --target local (default) writes to --out (default tools/content-publish/out).
 * --target r2 writes to Cloudflare R2 using R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *   R2_BUCKET_CONTENT and R2_BUCKET_ASSETS. The fixture course is refused for it.
 * --now (or SOURCE_DATE_EPOCH) fixes the publish time for reproducible runs.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { findRepoRoot } from "@smriti/content-schema/check";

import { PublishError } from "./errors.js";
import { publish } from "./publish.js";
import { LocalDirStore, MemoryStore, type ObjectStore, R2Store, r2ConfigFromEnv } from "./store.js";

interface Args {
  root: string;
  target: "local" | "r2";
  out: string | null;
  report: string | null;
  now: string | null;
  keepPatches: number;
  dryRun: boolean;
}

function parse(argv: string[]): Args {
  const a: Args = { root: "content", target: "local", out: null, report: null, now: null, keepPatches: 3, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new PublishError("usage", `${flag} needs a value`);
      return v;
    };
    if (flag === "--root") a.root = next();
    else if (flag === "--target") {
      const t = next();
      if (t !== "local" && t !== "r2") throw new PublishError("usage", "--target is local or r2");
      a.target = t;
    } else if (flag === "--out") a.out = next();
    else if (flag === "--report") a.report = next();
    else if (flag === "--now") a.now = next();
    else if (flag === "--keep-patches") a.keepPatches = Number(next());
    else if (flag === "--dry-run") a.dryRun = true;
    else if (flag === "--help" || flag === "-h") {
      console.log("content-publish [--root dir] [--target local|r2] [--out dir] [--report dir] [--now ISO] [--keep-patches n] [--dry-run]");
      process.exit(0);
    } else throw new PublishError("usage", `unknown flag ${flag}`);
  }
  return a;
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  const repoRoot = findRepoRoot(process.cwd());
  const out = resolve(repoRoot, args.out ?? join("tools", "content-publish", "out"));
  const store: ObjectStore = args.dryRun
    ? new MemoryStore()
    : args.target === "r2"
      ? new R2Store(r2ConfigFromEnv())
      : new LocalDirStore(out);
  const epoch = process.env.SOURCE_DATE_EPOCH;
  const now = args.now ? new Date(args.now) : epoch ? new Date(Number(epoch) * 1000) : new Date();
  if (Number.isNaN(now.getTime())) throw new PublishError("usage", "--now is not a valid time");
  const report = await publish({
    repoRoot,
    contentRoot: resolve(repoRoot, args.root),
    store,
    reportDir: args.dryRun
      ? resolve(repoRoot, args.report ?? mkdtempSync(join(tmpdir(), "content-publish-dry-run-")))
      : resolve(repoRoot, args.report ?? (args.target === "local" ? out : join("tools", "content-publish", "out"))),
    now,
    keepPatches: args.keepPatches,
    log: (l) => console.log(l),
  });
  console.log(`report: ${report.sql.path.replace(/metadata\.sql$/, "publish-report.json")}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
