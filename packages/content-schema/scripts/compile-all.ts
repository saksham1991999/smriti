// Compiles every schema once; fails loudly on a schema error. Used by CI and while editing schemas.
import { schemaFiles, type SchemaFile } from "../src/schemas.js";
import { getValidator } from "../src/validate.js";

let failed = false;
for (const file of Object.keys(schemaFiles) as SchemaFile[]) {
  try {
    getValidator(file);
    console.log(`ok   ${file}`);
  } catch (err) {
    failed = true;
    console.error(`FAIL ${file}: ${(err as Error).message}`);
  }
}
process.exit(failed ? 1 : 0);
