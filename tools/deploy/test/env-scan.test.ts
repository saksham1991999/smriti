import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { check, clientEnvKeys, parseExample, scanJs, scanPython, type Catalog } from "../src/env-scan.ts";

test("python: os.environ reads and pydantic-settings fields with aliases", () => {
  const src = [
    "import os",
    'x = os.environ.get("ALPHA")',
    'y = os.getenv("BETA", "1")',
    'z = os.environ["GAMMA"]',
    'w = env.get("DELTA")',
    "class S(BaseSettings):",
    '    model_config = SettingsConfigDict(env_file=".env")',
    "    redis_url: str = 'redis://x'",
    "    secret: str = Field(",
    '        default="",',
    '        validation_alias=AliasChoices("NEW_NAME", "OLD_NAME"),',
    "    )",
    "    @property",
    "    def is_dev(self) -> bool:",
    "        return True",
    "",
    "class Other:",
    "    not_env: int = 1",
  ].join("\n");
  assert.deepEqual(scanPython(src).sort(), ["ALPHA", "BETA", "DELTA", "GAMMA", "NEW_NAME|OLD_NAME", "REDIS_URL"]);
});

test("js: process.env, import.meta.env, env helpers and templates", () => {
  const src = [
    "process.env.ONE; process.env['TWO']; import.meta.env.VITE_THREE; import.meta.env.MODE;",
    'env("FOUR"); numberEnv("FIVE", 1); process.env[`PREFIX_${v}`];',
    "// process.env.EXPO_PUBLIC_* is inlined",
  ].join("\n");
  assert.deepEqual(scanJs(src).sort(), ["FIVE", "FOUR", "ONE", "PREFIX_*", "TWO", "VITE_THREE"]);
  assert.deepEqual(scanJs('const R2_ENV = ["A_KEY", "B_KEY"]; env.C_KEY', true).sort(), ["A_KEY", "B_KEY", "C_KEY"]);
});

test("client env schema keys", () => {
  const ts = "export const clientEnvSchema = z\n  .object({\n    APP_ENV: z.x,\n    /** doc */\n    API_BASE_URL: z.url(),\n  })\n";
  assert.deepEqual(clientEnvKeys(ts), ["APP_ENV", "API_BASE_URL"]);
});

test("example parsing marks [platform] sections", () => {
  const c: Catalog = { names: new Map(), platform: new Set() };
  parseExample("# App\nA=\nB=1 # note\n\n# Provider settings [platform]\nP=\n# still the same section\nQ=\n\n# Next\nR=\n", ".env.example", c);
  assert.deepEqual([...c.names.keys()], ["A", "B", "P", "Q", "R"]);
  assert.deepEqual([...c.platform], ["P", "Q"]);
});

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "env-check-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

test("check reports undocumented reads and unused names", () => {
  const root = repo({
    "apps/api/smriti_api/x.py": 'import os\nos.environ.get("READ_AND_LISTED")\nos.environ.get("READ_NOT_LISTED")\n',
    "apps/web/src/a.ts": "import.meta.env.VITE_X;",
    "apps/web/test/a.test.ts": "process.env.ONLY_IN_TESTS;",
    "apps/api/Dockerfile": 'CMD ["sh", "-c", "exec x --workers ${WEB_CONCURRENCY}"]',
    ".env.example": "READ_AND_LISTED=\nLISTED_NOT_READ=\nWEB_CONCURRENCY=\nONLY_IN_TESTS=\n\n# Supabase dashboard [platform]\nPROVIDER_ONLY=\n",
    "apps/web/.env.example": "VITE_X=\n",
  });
  const r = check(root);
  assert.deepEqual(r.undocumented.map((u) => u.name), ["READ_NOT_LISTED"]);
  assert.deepEqual(r.dead.map((d) => d.name), ["LISTED_NOT_READ"]);
});

test("the repository passes", () => {
  const root = join(dirname(new URL(import.meta.url).pathname), "..", "..", "..");
  const r = check(root);
  assert.deepEqual(r.undocumented, []);
  assert.deepEqual(r.dead, []);
});
