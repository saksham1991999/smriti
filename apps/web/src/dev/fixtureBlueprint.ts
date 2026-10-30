/**
 * Dev, e2e and test only: the fixture paper blueprint (content/fixtures, marked `fixture: true`)
 * for the mock runner shell. Real blueprints come from exam-blueprint through the content pipeline;
 * neither the published manifest nor the API serves them yet.
 */
import type { BlueprintFile } from "@smriti/content-schema";
import paper from "../../../../content/fixtures/blueprints/fx-exam-2027/paper-1.v1.json";

export const mockBlueprint: BlueprintFile | null = paper as unknown as BlueprintFile;
