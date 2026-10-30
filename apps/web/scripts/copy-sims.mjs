// Copies every built sim bundle (sims/<id>/dist, see skills/sim-builder) into public/sims/<id>/ and
// writes public/sims/index.json, the list Labs (LAB-01) reads. A sim without a dist is built first.
// Sims are served from the app's origin but always run in a sandboxed iframe (opaque origin) and
// talk to the app only through @smriti/sim-bridge.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const simsDir = join(here, "..", "..", "..", "sims");
const out = join(here, "..", "public", "sims");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const list = [];
for (const id of readdirSync(simsDir).sort()) {
  if (id.startsWith("_") || !existsSync(join(simsDir, id, "manifest.json"))) continue;
  const dir = join(simsDir, id);
  if (!existsSync(join(dir, "dist", "index.html"))) {
    const r = spawnSync("npx", ["vite", "build"], { cwd: dir, stdio: "inherit" });
    if (r.status !== 0) throw new Error(`sim ${id} failed to build`);
  }
  cpSync(join(dir, "dist"), join(out, id), { recursive: true });
  const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  if (!m.licence || /(^|-)nc(-|$)/i.test(m.licence)) throw new Error(`sim ${id}: licence ${m.licence} is not allowed`);
  list.push({
    id: m.id,
    version: m.version,
    title: m.title,
    subject: m.subject,
    concepts: m.concepts,
    aspect: m.aspect,
    entry: m.entry,
    params: m.params,
    tasks: m.tasks ?? [],
    licence: m.licence,
  });
}
writeFileSync(join(out, "index.json"), JSON.stringify({ sims: list }, null, 1) + "\n");
console.log(`copied ${list.length} sims`);
