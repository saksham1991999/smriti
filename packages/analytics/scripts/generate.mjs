#!/usr/bin/env node
/**
 * Builds the typed event catalogue from the "Analytics events" sections of docs/flows/*.md.
 *
 *   node scripts/generate.mjs [--docs <dir>] [--check]
 *
 * Reads every events table (`| Event | Props | … |` and the learn doc's `| Area | Events |`),
 * the stream (learning, product, server), the minors marks (✓ or E = essential) and the props
 * with their values. Prop types are inferred: listed values → enum, `*_id` → id, `*_ms`, counts
 * and indexes → number, `is_`/`has_`/(bool) → boolean, `*_bucket` → bucket, `[]` → list; anything
 * else is a short token, so free text can never pass (AGENTS.md rule 6).
 *
 * Writes `src/catalogue.generated.ts`. `--check` exits 1 when it is out of date.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');
const args = process.argv.slice(2);
const argDocs = args.includes('--docs') ? args[args.indexOf('--docs') + 1] : undefined;
const docsRoot = resolve(argDocs ?? process.env.SMRITI_DOCS_DIR ?? join(pkg, '..', '..', 'docs'));
const flowsDir = existsSync(join(docsRoot, 'flows')) ? join(docsRoot, 'flows') : docsRoot;

const NAME_RE = /^[a-z][a-z0-9_]*$/;

/** Splits on `sep` outside parentheses, brackets and backticks. */
export function splitTop(text, sep = ',') {
  const out = [];
  let depth = 0;
  let code = false;
  let cur = '';
  for (const ch of text) {
    if (ch === '`') code = !code;
    if (!code && (ch === '(' || ch === '[')) depth++;
    if (!code && (ch === ')' || ch === ']')) depth = Math.max(0, depth - 1);
    if (!code && depth === 0 && ch === sep) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function splitRow(line) {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let cur = '';
  let code = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\' && body[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '`') {
      code = !code;
      cur += ch;
    } else if (ch === '|' && !code) {
      cells.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/**
 * Event names in a cell: "`a` / `b`", "`x_shown` / `_tapped`" (suffix shorthand), with an
 * optional "(server)" after a name.
 */
export function parseEventNames(cell) {
  const out = [];
  const re = /`([a-z_][a-z0-9_]*)`(\s*\(([^)]*)\))?/g;
  let m;
  let first = null;
  while ((m = re.exec(cell))) {
    let name = m[1];
    if (name.startsWith('_') && first) name = first.replace(/_[a-z0-9]+$/, '') + name;
    if (!NAME_RE.test(name)) continue;
    if (!first) first = name;
    const note = m[3] ?? '';
    out.push({ name, server: /\bserver\b/.test(note) });
  }
  return out;
}

const NUMBER_RE = /(^|_)(ms|s|count|index|pct|percent|days|day|total|correct|answered|attempts?|attempt_no|minutes|lapses|rounds|cards|position|score|xp|xp_estimate|streak|size|n|reviewed|fixed|left|wait_ms|ttft_ms|duration_ms|duration_s|time_ms|queue_size|plan_days|daily_chunk|day_index|step_index|step_total|card_count|concept_count|question_count|lesson_count|relearn_topics|count_\w+|\w+_count|number|level|tier_rank|from_version_code|reviews|stars|gems|amount_paise)$/;
const BOOL_RE = /^(is|has|had|was|can|did)_|^(cold|replay|stopped|edited|reported|qualified|found|on|timed|matched_device_locale|pre_onboarding|left_early|pet_kept|adopted_guest|stay_signed_in|unsynced_lost|action_resumed|reached_qualify|goal_met|streak_incremented|suggestion_used|offline|consented)$/;

/** One prop: "`mode` (`a`, `b`)", "`reasons[]`", "`flag` (bool)", "`n` (count)". */
export function parseProp(item) {
  const m = /`([a-z_][a-z0-9_.]*)(\[\])?`(?:\s*(?::|=)?\s*\(([^)]*)\)|\s*:\s*([^;]*))?/.exec(item);
  if (!m) return null;
  const name = m[1].replace(/\./g, '_');
  const list = Boolean(m[2]);
  const paren = (m[3] ?? m[4] ?? '').trim();
  let type;
  let values;
  if (/^bool(ean)?$/i.test(paren)) type = 'boolean';
  else if (/^(count|bucketed|number)$/i.test(paren)) type = 'number';
  else if (/list of/i.test(paren)) type = 'list';
  else if (paren) {
    const vals = paren
      .split(/[,;]|\bor\b/)
      .map((v) => v.trim().replace(/^`|`$/g, '').replace(/`/g, ''))
      .filter((v) => /^[a-z0-9][a-z0-9_:.-]*$/i.test(v) && v.length <= 40 && !/^(R|A|G|Q|X|C|D)\d+$/.test(v));
    const looksEnum = vals.length >= 2 && !/\bfrom\b|\bincludes\b|§|see /i.test(paren);
    if (looksEnum) {
      type = list ? 'enum_list' : 'enum';
      values = [...new Set(vals)];
    }
  }
  if (!type) {
    if (list) type = 'list';
    else if (/(_id|_ref)$/.test(name) || name === 'card_ref' || name === 'item_ref') type = 'id';
    else if (/_ids$/.test(name)) type = 'list';
    else if (/_bucket$/.test(name)) type = 'bucket';
    else if (BOOL_RE.test(name)) type = 'boolean';
    else if (NUMBER_RE.test(name)) type = 'number';
    else type = 'token';
  }
  return { name, type, ...(values ? { values } : {}) };
}

export function parseProps(cell) {
  if (/^none\b/i.test(cell.trim()) || !cell.includes('`')) return {};
  const props = {};
  // "`trigger`: `a` (PRC-01, PRC-03), `b` (MOCK-01)": values of one prop, each tagged with the
  // screens that send it, not separate props.
  let valueOf = null;
  const SCREENS_RE = /^\(\s*[A-Z]{2,}-\d+[^)]*\)$/;
  for (const item of splitTop(cell.replace(/;/g, ','), ',')) {
    const head = /`([a-z_][a-z0-9_]*)`\s*:\s*`([a-z0-9_]+)`\s*(\([^)]*\))?\s*$/.exec(item);
    if (head && head[3] && SCREENS_RE.test(head[3])) {
      valueOf = { name: head[1], type: 'enum', values: [head[2]] };
      props[head[1]] = valueOf;
      continue;
    }
    const more = /^\s*`([a-z0-9_]+)`\s*(\([^)]*\))\s*$/.exec(item);
    if (valueOf && more && SCREENS_RE.test(more[2])) {
      valueOf.values.push(more[1]);
      continue;
    }
    valueOf = null;
    const p = parseProp(item);
    if (p && !props[p.name]) props[p.name] = p;
  }
  return props;
}

/** The learn doc's "| Area | Events |" cells: "`a` (`p`, `q`), `b`, `c` (`kind`: x, y)". */
export function parseAreaCell(cell) {
  const out = [];
  for (const item of splitTop(cell, ',')) {
    for (const part of item.split(/;\s*(?=`[a-z_]+`)/)) {
      const m = /^`([a-z_][a-z0-9_]*)`\s*(?:\((.*)\))?/.exec(part.trim());
      if (!m) {
        // "PAY-19 sends `x`" and similar prose: pick up the names only.
        for (const n of parseEventNames(part)) out.push({ ...n, props: {} });
        continue;
      }
      const inner = (m[2] ?? '').replace(/(`[a-z_]+`)\s*:\s*([^;`]+?)(?=;|$)/g, (_, p, vals) => `${p} (${vals.trim()})`);
      out.push({ name: m[1], server: false, props: parseProps(inner) });
    }
  }
  return out;
}

function sectionRanges(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const h = /^(#{2,3}) .*Analytics events/.exec(lines[i]);
    if (!h) continue;
    const level = h[1].length;
    let j = i + 1;
    while (j < lines.length && !(new RegExp(`^#{1,${level}} `).test(lines[j]))) j++;
    out.push([i, j]);
  }
  return out;
}

export function extractEvents(text, area) {
  const lines = text.split('\n');
  const events = [];
  for (const [start, end] of sectionRanges(lines)) {
    let defaultStream = 'product';
    for (let i = start; i < end; i++) {
      const line = lines[i];
      if (/^\*\*Learning events/i.test(line)) defaultStream = 'learning';
      if (/^\*\*Product events/i.test(line)) defaultStream = 'product';
      if (/^Server-side events/i.test(line)) {
        for (const n of parseEventNames(line)) events.push({ name: n.name, area, stream: 'server', essential: false, props: {}, line: i + 1 });
        continue;
      }
      if (!/^\|\s*(Event|Area)\s*\|/.test(line)) continue;
      const header = splitRow(line).map((h) => h.toLowerCase());
      const col = (re) => header.findIndex((h) => re.test(h));
      const cEvent = col(/^event$/);
      const cProps = col(/props|properties/);
      const cKind = col(/^(kind|stream)$/);
      const cMinor = col(/minor|^e$/);
      const cArea = col(/^events$/);
      let j = i + 2;
      for (; j < end && lines[j].trim().startsWith('|'); j++) {
        const cells = splitRow(lines[j]);
        if (cArea >= 0) {
          for (const ev of parseAreaCell(cells[cArea] ?? '')) {
            events.push({ name: ev.name, area, stream: ev.server ? 'server' : defaultStream, essential: false, props: ev.props, line: j + 1 });
          }
          continue;
        }
        if (cEvent < 0) continue;
        const names = parseEventNames(cells[cEvent] ?? '');
        const props = cProps >= 0 ? parseProps(cells[cProps] ?? '') : {};
        const kindText = cKind >= 0 ? (cells[cKind] ?? '') : '';
        const minorText = cMinor >= 0 ? (cells[cMinor] ?? '') : '';
        const essential = /^(✓|E(?![A-Za-z]))/.test(minorText.trim());
        for (const n of names) {
          const stream = n.server || /server/.test(kindText) ? 'server' : /learning/.test(kindText) ? 'learning' : /product/.test(kindText) ? 'product' : defaultStream;
          events.push({ name: n.name, area, stream, essential, props, line: j + 1 });
        }
      }
      i = j - 1;
    }
  }
  return events;
}

/** Merges duplicates across docs: union of props, learning beats product, essential if any doc says so. */
export function mergeEvents(list) {
  const byName = new Map();
  const rank = { learning: 2, server: 1, product: 0 };
  for (const e of list) {
    const cur = byName.get(e.name);
    if (!cur) {
      byName.set(e.name, { name: e.name, stream: e.stream, essential: e.essential, areas: [e.area], props: { ...e.props } });
      continue;
    }
    if (rank[e.stream] > rank[cur.stream]) cur.stream = e.stream;
    cur.essential = cur.essential || e.essential;
    if (!cur.areas.includes(e.area)) cur.areas.push(e.area);
    for (const [k, p] of Object.entries(e.props)) {
      const prev = cur.props[k];
      if (!prev) cur.props[k] = p;
      else if (p.type === 'enum' && prev.type !== 'enum') cur.props[k] = { ...p };
      else if (prev.type === 'enum' && p.type === 'enum') prev.values = [...new Set([...(prev.values ?? []), ...(p.values ?? [])])];
    }
  }
  return [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
}

function render(events) {
  const lines = [
    '/* eslint-disable */',
    '// Generated by scripts/generate.mjs from docs/flows/*.md "Analytics events". Do not edit by hand:',
    '// fix the flow doc, then run `pnpm --filter @smriti/analytics generate`.',
    "import type { EventDef } from './types';",
    '',
    'export const CATALOGUE = {',
  ];
  for (const e of events) {
    const props = Object.values(e.props)
      .map((p) => `      ${p.name}: { type: '${p.type}'${p.values ? `, values: [${p.values.map((v) => `'${v}'`).join(', ')}]` : ''} },`)
      .join('\n');
    lines.push(`  ${e.name}: {`);
    lines.push(`    stream: '${e.stream}',`);
    lines.push(`    essential: ${e.essential},`);
    lines.push(`    areas: [${e.areas.map((a) => `'${a}'`).join(', ')}],`);
    lines.push(props ? `    props: {\n${props}\n    },` : '    props: {},');
    lines.push('  },');
  }
  lines.push('} as const satisfies Record<string, EventDef>;', '');
  return lines.join('\n');
}

function main() {
  if (!existsSync(flowsDir)) {
    console.error(`docs/flows not found at ${flowsDir}; pass --docs or set SMRITI_DOCS_DIR`);
    process.exit(2);
  }
  const all = [];
  for (const f of readdirSync(flowsDir).filter((x) => x.endsWith('.md')).sort()) {
    all.push(...extractEvents(readFileSync(join(flowsDir, f), 'utf8'), f.replace(/\.md$/, '').replace(/-/g, '_')));
  }
  const events = mergeEvents(all);
  const out = render(events);
  const target = join(pkg, 'src', 'catalogue.generated.ts');
  if (args.includes('--check')) {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== out) {
      console.error(`out of date: ${target}`);
      process.exit(1);
    }
    return;
  }
  writeFileSync(target, out);
  const by = (k) => events.filter((e) => e.stream === k).length;
  console.log(`${events.length} events (learning ${by('learning')}, product ${by('product')}, server ${by('server')}; essential ${events.filter((e) => e.essential).length})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
