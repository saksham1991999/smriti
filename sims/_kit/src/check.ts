/**
 * Package checks every sim runs in its unit tests: the manifest is complete,
 * its tasks validate against the bridge schema, both string tables have the
 * same keys, and every task's conditions exist.
 */

import { quantitiesOf, validateTasks, type TaskCheck } from '@smriti/sim-bridge';
import { missingKeys, type Strings } from './i18n';
import type { SimManifest } from './params';

function rulesOf(check: TaskCheck): string[] {
  if (check.kind === 'all') return check.of.flatMap(rulesOf);
  return check.kind === 'condition' ? [check.rule] : [];
}

export function checkSimPackage(manifest: SimManifest, strings: Strings, conditionNames: string[]): string[] {
  const problems: string[] = [];
  if (!/^[a-z0-9-]+$/.test(manifest.id)) problems.push('id must be lowercase letters, digits and hyphens');
  if (!manifest.title.en || !manifest.title.hi) problems.push('title needs en and hi');
  if (strings.en.title !== manifest.title.en || strings.hi.title !== manifest.title.hi) problems.push('strings title differs from manifest title');
  const missing = missingKeys(strings);
  if (missing.en.length) problems.push(`missing in en: ${missing.en.join(', ')}`);
  if (missing.hi.length) problems.push(`missing in hi: ${missing.hi.join(', ')}`);
  for (const issue of validateTasks(manifest.tasks)) problems.push(`task ${issue.path}: ${issue.message}`);
  const readingNames = new Set(manifest.readings.map((r) => r.name));
  const ids = new Set<string>();
  for (const task of manifest.tasks) {
    if (ids.has(task.id)) problems.push(`duplicate task id ${task.id}`);
    ids.add(task.id);
    for (const rule of rulesOf(task.check)) {
      if (!conditionNames.includes(rule)) problems.push(`task ${task.id} uses unknown rule ${rule}`);
    }
    for (const q of quantitiesOf(task.check)) {
      if (!readingNames.has(q)) problems.push(`task ${task.id} reads ${q}, which is not a manifest reading`);
    }
  }
  for (const r of manifest.readings) {
    if (!r.label.en || !r.label.hi) problems.push(`reading ${r.name} needs en and hi labels`);
  }
  for (const c of manifest.conditions) {
    if (!conditionNames.includes(c.rule)) problems.push(`manifest lists unknown rule ${c.rule}`);
  }
  for (const [key, p] of Object.entries(manifest.params)) {
    if (p.type === 'number' && !(p.min <= p.default && p.default <= p.max)) problems.push(`param ${key} default out of range`);
    if (p.type === 'enum' && !p.values.includes(p.default)) problems.push(`param ${key} default not allowed`);
  }
  if (manifest.origin !== 'own' && !manifest.attribution) problems.push('third-party sims need an attribution');
  return problems;
}
