/**
 * Sim params from the manifest's `params` schema (content.sims.params_schema):
 * defaults, ranges and allowed values. Content and hosts may override them in
 * `init.params`; anything invalid falls back to the default.
 */

import type { ParamValue, ParamValues, Reading, TaskSpec } from '@smriti/sim-bridge';

export type ParamSchema =
  | { type: 'number'; default: number; min: number; max: number; step: number; unit?: string }
  | { type: 'enum'; default: string; values: string[] }
  | { type: 'boolean'; default: boolean };

export type ParamsSchema = Record<string, ParamSchema>;

/** The shape of `sims/{id}/manifest.json`. */
export interface SimManifest {
  id: string;
  version: string;
  protocolVersion: string;
  title: { en: string; hi: string };
  subject: string;
  concepts: string[];
  origin: 'own' | 'phet' | 'other_open';
  licence: string;
  attribution: string | null;
  aspect: string;
  preferredOrientation: 'portrait' | 'landscape' | 'any';
  entry: string;
  capabilities: string[];
  params: ParamsSchema;
  readings: Array<{ name: string; unit: string; label: { en: string; hi: string } }>;
  conditions: Array<{ rule: string; args?: Record<string, string> }>;
  tasks: TaskSpec[];
  third_party: Array<{ name: string; licence: string; source: string }>;
  size_bytes: number;
}

export function defaultParams(schema: ParamsSchema): ParamValues {
  const out: ParamValues = {};
  for (const [k, s] of Object.entries(schema)) out[k] = s.default;
  return out;
}

function snapToStep(v: number, s: Extract<ParamSchema, { type: 'number' }>): number {
  const clamped = Math.min(s.max, Math.max(s.min, v));
  const n = Math.round((clamped - s.min) / s.step);
  return Number((s.min + n * s.step).toFixed(6));
}

export function resolveParams(schema: ParamsSchema, given: ParamValues): ParamValues {
  const out: ParamValues = {};
  for (const [k, s] of Object.entries(schema)) {
    const v: ParamValue | undefined = given[k];
    switch (s.type) {
      case 'number':
        out[k] = typeof v === 'number' && Number.isFinite(v) ? snapToStep(v, s) : s.default;
        break;
      case 'enum':
        out[k] = typeof v === 'string' && s.values.includes(v) ? v : s.default;
        break;
      case 'boolean':
        out[k] = typeof v === 'boolean' ? v : s.default;
        break;
    }
  }
  return out;
}

export function numberParam(p: ParamValues, key: string): number {
  const v = p[key];
  if (typeof v !== 'number') throw new Error(`param ${key} is not a number`);
  return v;
}

export function stringParam(p: ParamValues, key: string): string {
  const v = p[key];
  if (typeof v !== 'string') throw new Error(`param ${key} is not a string`);
  return v;
}

export function booleanParam(p: ParamValues, key: string): boolean {
  const v = p[key];
  if (typeof v !== 'boolean') throw new Error(`param ${key} is not a boolean`);
  return v;
}

/** Builds readings with the manifest's label and unit, so both stay in one place. */
export function readingMaker(manifest: Pick<SimManifest, 'readings'>): (name: string, value: number, precision: number) => Reading {
  const byName = new Map(manifest.readings.map((r) => [r.name, r]));
  return (name, value, precision) => {
    const def = byName.get(name);
    if (!def) throw new Error(`reading ${name} is not in the manifest`);
    return { name, value, unit: def.unit, label: def.label, precision };
  };
}

export function rangeOf(schema: ParamsSchema, key: string): Extract<ParamSchema, { type: 'number' }> {
  const s = schema[key];
  if (!s || s.type !== 'number') throw new Error(`param ${key} is not a number param`);
  return s;
}
