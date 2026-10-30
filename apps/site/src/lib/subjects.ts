// Subject id → colour family, from `subjectMap` in packages/tokens (AGENTS: "Subject colours
// come from subjectMap").
import tokens from "../../../../packages/tokens/tokens.json";

const map = tokens.subjectMap as Record<string, string>;
const families = new Set(Object.keys(tokens.subject));

export function subjectFamily(subjectId: string): string {
  const f = map[subjectId];
  return f && families.has(f) ? f : "physics";
}

export function subjectClass(subjectId: string): string {
  return `s-${subjectFamily(subjectId)}`;
}
