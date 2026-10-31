/**
 * Finds every environment variable the code reads, and every name the `.env.example` files
 * document, so `pnpm env:check` can fail on a read that is not documented and on a documented
 * name nothing reads.
 *
 * What counts as a read:
 * - Python (apps/api, apps/worker): `os.environ.get("X")`, `os.environ["X"]`, `os.getenv("X")`,
 *   and every field of a pydantic-settings `BaseSettings` class (its upper-cased name, or the
 *   names in its `validation_alias`).
 * - JS/TS (apps, tools, infra scripts): `process.env.X`, `process.env["X"]`,
 *   `import.meta.env.X`, the site's `env("X")` helper, and `env.X` inside tools/.
 *   A template read such as `process.env[\`GOOGLE_IOS_CLIENT_ID_${v}\`]` becomes the wildcard
 *   `GOOGLE_IOS_CLIENT_ID_*`.
 * - The web app's `parseClientEnv(import.meta.env)` reads `VITE_` + every key of
 *   packages/config's `clientEnvSchema`.
 * Tests, e2e specs and test-runner configs are not scanned: they set variables, they don't
 * define what a deployment needs.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export interface Read {
  name: string;
  file: string;
}

/** Variables the platform or the toolchain sets; never documented by us. */
export const BUILTIN = new Set(["CI", "NODE_ENV", "INIT_CWD", "HOME", "PATH", "PWD", "TZ", "PORT"]);
/** Vite's own `import.meta.env` keys. */
const VITE_BUILTIN = new Set(["MODE", "PROD", "DEV", "SSR", "BASE_URL"]);

const SKIP_DIRS = new Set(["node_modules", "dist", ".venv", "__pycache__", ".mypy_cache", ".ruff_cache", "out", ".astro", "build", ".expo"]);
const TEST_PATH = /(^|\/)(tests?|e2e|__tests__|fixtures)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|(playwright|vitest|jest)\.config\.[cm]?[jt]s$|\.live\.test\./;

export function walk(root: string, dir: string, exts: readonly string[]): string[] {
  let entries: string[];
  try {
    entries = readdirSync(join(root, dir));
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries) {
    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
    const rel = dir ? `${dir}/${name}` : name;
    const st = statSync(join(root, rel));
    if (st.isDirectory()) out.push(...walk(root, rel, exts));
    else if (exts.some((e) => name.endsWith(e)) && !TEST_PATH.test(rel)) out.push(rel);
  }
  return out;
}

const PY_ENV = /(?:os\.environ\.get|os\.getenv|\benv\.get)\(\s*["']([A-Z][A-Z0-9_]*)["']|os\.environ\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g;
const PY_SETTINGS_CLASS = /^class\s+\w+\([^)]*BaseSettings[^)]*\):\s*$/;
const PY_FIELD = /^ {4}([a-z][a-z0-9_]*)\s*:\s*[^=]+?(?:=\s*(.*))?$/;
const PY_ALIAS_START = /validation_alias\s*=/;
const QUOTED = /["']([A-Z][A-Z0-9_]*)["']/g;

/** Names one Python file reads. */
export function scanPython(source: string): string[] {
  const names = new Set<string>();
  for (const m of source.matchAll(PY_ENV)) names.add((m[1] ?? m[2]) as string);
  const lines = source.split("\n");
  let inClass = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (PY_SETTINGS_CLASS.test(line)) {
      inClass = true;
      continue;
    }
    if (inClass && /^\S/.test(line)) inClass = false;
    if (!inClass) continue;
    const field = PY_FIELD.exec(line);
    if (!field || line.trimStart().startsWith("def ")) continue;
    // A Field(...) call can span lines; look ahead to its closing paren for a validation_alias.
    let call = field[2] ?? "";
    let j = i;
    let depth = (call.match(/\(/g) ?? []).length - (call.match(/\)/g) ?? []).length;
    while (depth > 0 && j + 1 < lines.length) {
      j++;
      const next = lines[j] as string;
      call += next;
      depth += (next.match(/\(/g) ?? []).length - (next.match(/\)/g) ?? []).length;
    }
    if (PY_ALIAS_START.test(call)) {
      // Any one of the aliases sets the field: one read, documented by any of its names.
      const alias = call.slice(call.search(PY_ALIAS_START));
      names.add([...alias.matchAll(QUOTED)].map((a) => a[1] as string).join("|"));
    } else {
      names.add((field[1] as string).toUpperCase());
    }
  }
  return [...names];
}

const JS_PATTERNS: RegExp[] = [
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  /process\.env\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g,
  /import\.meta\.env\.([A-Z][A-Z0-9_]*)/g,
  // The site's env("X") and numberEnv("X") helpers.
  /\b[a-z]*[Ee]nv\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
];
const JS_TEMPLATE = /process\.env\[\s*`([A-Z][A-Z0-9_]*)\$\{/g;
const TOOLS_ENV_DOT = /\benv\.([A-Z][A-Z0-9_]+)\b/g;
const TOOLS_ENV_LIST = /\b[A-Z0-9_]*ENV[A-Z0-9_]*\s*=\s*\[([^\]]*)\]/g;

/** Names one JS/TS file reads; `inTools` also counts `env.X` and `*_ENV = ["X", ...]` lists. */
export function scanJs(source: string, inTools = false): string[] {
  const names = new Set<string>();
  for (const re of JS_PATTERNS) {
    for (const m of source.matchAll(re)) {
      const n = m[1] as string;
      if (re.source.startsWith("import\\.meta") && VITE_BUILTIN.has(n)) continue;
      // `process.env.EXPO_PUBLIC_*` in a comment names a prefix, not a variable.
      if (n.endsWith("_")) continue;
      names.add(n);
    }
  }
  for (const m of source.matchAll(JS_TEMPLATE)) names.add(`${m[1] as string}*`);
  if (inTools) {
    for (const m of source.matchAll(TOOLS_ENV_DOT)) names.add(m[1] as string);
    for (const m of source.matchAll(TOOLS_ENV_LIST)) for (const q of (m[1] as string).matchAll(QUOTED)) names.add(q[1] as string);
  }
  return [...names];
}

/** The keys of packages/config's clientEnvSchema object (VITE_ and EXPO_PUBLIC_ strip to these). */
export function clientEnvKeys(envTs: string): string[] {
  const start = envTs.indexOf("clientEnvSchema = z");
  if (start < 0) return [];
  const body = envTs.slice(start, envTs.indexOf("})", start));
  return [...body.matchAll(/^\s{4}([A-Z][A-Z0-9_]*)\s*:/gm)].map((m) => m[1] as string);
}

export interface Catalog {
  /** name -> the example file that documents it */
  names: Map<string, string>;
  /** names documented under a section marked [platform] (set in a provider, not read by code) */
  platform: Set<string>;
}

const LINE = /^\s*([A-Z][A-Z0-9_]*)\s*=/;

/**
 * Names in a `.env.example`. A section starts at a comment line after a blank line (or at the
 * top); a section whose header line contains `[platform]` documents settings the providers read
 * (Supabase Auth, GitHub, EAS), which the dead-name check does not expect the code to read.
 */
export function parseExample(text: string, file: string, into: Catalog): void {
  let platform = false;
  let prevBlank = true;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") {
      prevBlank = true;
      continue;
    }
    if (line.startsWith("#")) {
      if (prevBlank) platform = line.includes("[platform]");
      prevBlank = false;
      continue;
    }
    prevBlank = false;
    const m = LINE.exec(line);
    if (!m) continue;
    const name = m[1] as string;
    if (!into.names.has(name)) into.names.set(name, file);
    if (platform) into.platform.add(name);
  }
}

export interface Report {
  undocumented: Read[];
  dead: { name: string; file: string }[];
}

export interface Sources {
  python: string[];
  js: string[];
  tools: string[];
  /** Deploy files (Dockerfiles, Railway and Cloudflare config, workflows) where `${X}` and `$X` count as reads. */
  deploy: string[];
  examples: string[];
  /** Tests and e2e specs: their reads keep a documented test-only name alive, nothing more. */
  tests: string[];
}

export const DEFAULT_SOURCES = (root: string): Sources => ({
  python: [...walk(root, "apps/api/smriti_api", [".py"]), ...walk(root, "apps/worker/smriti_worker", [".py"]), ...walk(root, "tools", [".py"])],
  js: [
    ...walk(root, "apps/web/src", [".ts", ".tsx"]),
    ...walk(root, "apps/web/scripts", [".mjs", ".js", ".ts"]),
    ...["apps/web/vite.config.ts", "apps/mobile/app.config.ts", "apps/site/astro.config.mjs"],
    ...walk(root, "apps/mobile/src", [".ts", ".tsx"]),
    ...walk(root, "apps/mobile/scripts", [".mjs", ".js", ".ts"]),
    ...walk(root, "apps/site/src", [".ts", ".tsx", ".astro", ".mjs"]),
    ...walk(root, "apps/site/scripts", [".mjs", ".js", ".ts"]),
    ...walk(root, "infra", [".mjs", ".js", ".ts"]),
  ],
  tools: walk(root, "tools", [".ts", ".mjs", ".js"]).filter((f) => !f.startsWith("tools/deploy/src/env-")),
  deploy: [
    "apps/api/Dockerfile",
    "apps/worker/Dockerfile",
    ...walk(root, "infra", [".json", ".toml", ".jsonc"]),
  ],
  examples: [".env.example", "apps/web/.env.example", "apps/mobile/.env.example", "apps/site/.env.example"],
  tests: ["apps/web", "apps/mobile", "apps/site"].flatMap((d) => walkTests(root, d)),
});

/** Test files only (the inverse of walk's filter). */
function walkTests(root: string, dir: string): string[] {
  const all: string[] = [];
  const visit = (rel: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(join(root, rel));
    } catch {
      return;
    }
    for (const name of entries) {
      if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
      const child = `${rel}/${name}`;
      if (statSync(join(root, child)).isDirectory()) visit(child);
      else if (/\.[cm]?[jt]sx?$/.test(name) && TEST_PATH.test(child)) all.push(child);
    }
  };
  visit(dir);
  return all;
}

const DEPLOY_REF = /\$\{([A-Z][A-Z0-9_]*)(?::?-[^}]*)?\}|\$([A-Z][A-Z0-9_]*)\b/g;

function read(root: string, file: string): string | null {
  try {
    return readFileSync(join(root, file), "utf8");
  } catch {
    return null;
  }
}

export function check(root: string, sources: Sources = DEFAULT_SOURCES(root)): Report {
  const reads: Read[] = [];
  for (const f of sources.python) {
    const s = read(root, f);
    if (s) for (const name of scanPython(s)) reads.push({ name, file: f });
  }
  for (const f of sources.js) {
    const s = read(root, f);
    if (s) for (const name of scanJs(s)) reads.push({ name, file: f });
  }
  for (const f of sources.tools) {
    const s = read(root, f);
    if (s) for (const name of scanJs(s, true)) reads.push({ name, file: f });
  }
  const web = read(root, "apps/web/src/boot/services.ts");
  const envTs = read(root, "packages/config/src/env.ts");
  if (web?.includes("parseClientEnv(") && envTs) {
    // The iOS client id and URL scheme are mobile-only keys of the shared schema.
    for (const key of clientEnvKeys(envTs)) {
      if (!key.startsWith("GOOGLE_IOS_")) reads.push({ name: `VITE_${key}`, file: "apps/web/src/boot/services.ts" });
    }
  }
  const deployRefs = new Set<string>();
  for (const f of sources.deploy) {
    const s = read(root, f);
    if (s) for (const m of s.matchAll(DEPLOY_REF)) deployRefs.add((m[1] ?? m[2]) as string);
  }

  const catalog: Catalog = { names: new Map(), platform: new Set() };
  for (const f of sources.examples) {
    const s = read(root, f);
    if (s !== null) parseExample(s, f, catalog);
  }
  const documented = [...catalog.names.keys()];
  const isDocumented = (name: string): boolean =>
    name.endsWith("*")
      ? documented.some((d) => d.startsWith(name.slice(0, -1)))
      : name.split("|").some((n) => catalog.names.has(n));

  const seen = new Set<string>();
  const undocumented: Read[] = [];
  for (const r of reads) {
    if (BUILTIN.has(r.name) || isDocumented(r.name) || seen.has(r.name)) continue;
    seen.add(r.name);
    undocumented.push(r);
  }

  const testReads: string[] = [];
  for (const f of sources.tests) {
    const s = read(root, f);
    if (s) testReads.push(...scanJs(s));
  }
  const readNames = new Set([...reads.flatMap((r) => r.name.split("|")), ...testReads]);
  const wildcards = [...readNames].filter((n) => n.endsWith("*")).map((n) => n.slice(0, -1));
  const dead: { name: string; file: string }[] = [];
  for (const [name, file] of catalog.names) {
    if (readNames.has(name) || deployRefs.has(name) || catalog.platform.has(name)) continue;
    if (wildcards.some((w) => name.startsWith(w))) continue;
    dead.push({ name, file });
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return { undocumented: undocumented.sort(byName), dead: dead.sort(byName) };
}

export function relativeTo(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}
