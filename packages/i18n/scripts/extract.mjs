#!/usr/bin/env node
/**
 * Extracts the EN/HI copy tables from docs/ux/*.md into namespaced i18next catalogues.
 *
 *   node scripts/extract.mjs [--docs <dir>] [--check]
 *
 * - Namespace: the UX doc's area (`me-money.md` → `me_money`).
 * - Key: `<SCREEN-ID>.<slug of the row name>` (e.g. `AUTH-01.title_lesson_3`). Screen ids come from
 *   the `### PREFIX-NN · Title` headings (and `#### LES-01.2 · …` sub-blocks).
 * - Little-learner rows (class 1–5; the only place तुम is allowed, R3) always carry
 *   `little_learner` in the key, so the lint can check the register.
 * - An inline variant "पढ़कर सुनाएँ (little learner, तुम: मुझे पढ़कर सुनाओ)" becomes two keys.
 *
 * Writes `src/locales/{en,hi}/<ns>.json`, `src/locales/screens.json` (screen titles and mock
 * priority) and prints a report. `--check` writes nothing and exits 1 when the files differ.
 * Docs dir: `--docs`, else `SMRITI_DOCS_DIR` (the folder holding `ux/`), else `../../docs`.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');
const args = process.argv.slice(2);
const argDocs = args.includes('--docs') ? args[args.indexOf('--docs') + 1] : undefined;
const docsRoot = resolve(argDocs ?? process.env.SMRITI_DOCS_DIR ?? join(pkg, '..', '..', 'docs'));
const uxDir = existsSync(join(docsRoot, 'ux')) ? join(docsRoot, 'ux') : docsRoot;
const check = args.includes('--check');

const SCREEN_RE = /^#{2,4}\s+([A-Z]{2,6}-\d{1,3}[A-Za-z]?(?:\.\d+)?)\b\s*(?:[·:\-–—/]\s*(.*))?$/;
const HEADER_RE = /^\|\s*Key(?:\s*\(([^)]*)\))?\s*\|\s*EN\s*\|\s*HI\s*\|\s*$/;
const LL_KEY_RE = /little[ -]learner|\(तुम\)|\bunder-10\b|\bu10\b|\(child\)|(?:^|[_\s])ll$|`?_ll`?/i;
const INLINE_LL_RE = /\s*\((?:little learner|little-learner)[^:)]*:\s*([^)]+)\)\s*$/i;

export function slugify(text) {
  return text
    .normalize('NFKD')
    .replace(/[`*"“”‘’]/g, '')
    .replace(/\{([^}]*)\}/g, '$1')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
    .replace(/_+$/g, '') || 'text';
}

/** Splits a markdown table row on unescaped pipes outside code spans. */
export function splitRow(line) {
  const cells = [];
  let cur = '';
  let inCode = false;
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\' && body[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '`') {
      inCode = !inCode;
      cur += ch;
    } else if (ch === '|' && !inCode) {
      cells.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

export function cleanValue(v) {
  return v
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+\n/g, '\n')
    .trim();
}

function splitValue(v, n) {
  for (const sep of [' / ', ' · ']) {
    const parts = v.split(sep);
    if (parts.length === n) return parts.map((x) => x.trim());
  }
  return null;
}

/**
 * Rows that pack several strings ("Again / Hard / Good / Easy", "Kid title (`10_12` / `u10`)")
 * become one entry per part when EN and HI split into the same number of parts.
 */
export function splitCombined(rawKey, en, hi) {
  let base = '';
  let suffix = '';
  let parts;
  const paren = /^(.*?)\s*\(([^()]*\/[^()]*)\)\s*(.*)$/.exec(rawKey);
  if (paren) {
    base = paren[1];
    parts = paren[2].split('/').map((x) => x.trim());
    suffix = paren[3];
  } else if (rawKey.includes(' / ') && !rawKey.includes(',')) {
    const m = /^(.*?)(\s*\([^()]*\))?$/.exec(rawKey);
    parts = (m?.[1] ?? rawKey).split(' / ').map((x) => x.trim());
    suffix = m?.[2] ?? '';
  } else return [[rawKey, en, hi]];
  if (parts.length < 2) return [[rawKey, en, hi]];
  // One side may hold a single string shared by every part ("Ask a grown-up" for both age bands).
  const enParts = splitValue(en, parts.length) ?? (paren && splitValue(hi, parts.length) ? parts.map(() => en) : null);
  const hiParts = splitValue(hi, parts.length) ?? (paren && enParts && splitValue(en, parts.length) ? parts.map(() => hi) : null);
  if (!enParts || !hiParts) return [[rawKey, en, hi]];
  const stem = /^(.*_)\d+$/.exec(parts[0] ?? '')?.[1];
  return parts.map((p, i) => {
    const name = stem && /^\d+$/.test(p) ? `${stem}${p}` : p;
    return [`${base} ${name} ${suffix}`.trim(), enParts[i], hiParts[i]];
  });
}

/** Brand strings live in config (AGENTS.md): the working name becomes `{brand}`. */
export function brandToken(v) {
  return v.replace(/\bSmriti\b/g, '{brand}').replace(/स्मृति(?! महल)/g, '{brand}');
}

/**
 * Prices come from the server (`/v1/config`, `/v1/billing/intro-eligibility`), never from copy:
 * the docs' illustrative `₹1` (the intro month) and `₹99` (the monthly price) become
 * `{intro_price}` and `{price}`, which the apps fill with the formatted amount. Any other rupee
 * amount is returned in `unknown` so the report flags it.
 */
export const PRICE_TOKENS = { 1: 'intro_price', 99: 'price' };
export function priceToken(v) {
  const unknown = [];
  const value = v.replace(/₹\s?(\d[\d,]*)(?![\d])/g, (m, amount) => {
    const name = PRICE_TOKENS[amount.replace(/,/g, '')];
    if (!name) {
      unknown.push(m);
      return m;
    }
    return `{${name}}`;
  });
  return { value, unknown };
}

/**
 * Countable nouns after a number placeholder get ICU plurals: "{n} lessons" becomes
 * "{n, plural, one {# lesson} other {# lessons}}" (and "{n} more cards" keeps "more" inside).
 * Hindi gets the same structure for the matching noun; most Hindi loanwords don't change, the
 * table lists the ones that do.
 */
export const EN_PLURALS = {
  answers: 'answer', cards: 'card', chapters: 'chapter', concepts: 'concept', days: 'day', Duos: 'Duo',
  gems: 'gem', items: 'item', learners: 'learner', lessons: 'lesson', marks: 'mark', members: 'member',
  mocks: 'mock', pages: 'page', papers: 'paper', parts: 'part', players: 'player', PYQs: 'PYQ',
  questions: 'question', reviews: 'review', rooms: 'room', stars: 'star', students: 'student',
  things: 'thing', times: 'time', topics: 'topic', words: 'word',
};
/** Hindi plural → singular where the word changes (direct case). Others are invariant. */
export const HI_SINGULAR = { 'जेम्स': 'जेम', 'चीज़ें': 'चीज़', 'बातें': 'बात', 'कमरे': 'कमरा' };
const HI_NOUNS = new Set([
  'उत्तर', 'जवाब', 'कार्ड', 'अध्याय', 'कॉन्सेप्ट', 'दिन', 'Duo', 'जेम्स', 'चीज़ें', 'आइटम', 'लेसन', 'पाठ', 'अंक', 'मार्क',
  'सदस्य', 'मॉक', 'पेज', 'पेपर', 'भाग', 'खिलाड़ी', 'PYQ', 'सवाल', 'प्रश्न', 'रिव्यू', 'कमरे', 'स्टार', 'छात्र', 'बार',
  'टॉपिक', 'शब्द', 'लर्नर', 'कमरे',
]);

export function pluralizeCounts(en, hi) {
  const counted = new Set();
  const enOut = en.replace(/\{([a-z_][a-z0-9_]*)\}( more)? ([A-Za-z]+)\b/g, (m, name, more, word) => {
    const one = EN_PLURALS[word];
    if (!one) return m;
    counted.add(name);
    const pre = more ? ' more' : '';
    return `{${name}, plural, one {#${pre} ${one}} other {#${pre} ${word}}}`;
  });
  if (!counted.size) return { en, hi };
  const hiOut = hi.replace(/\{([a-z_][a-z0-9_]*)\}( और)? ([^\s{}।,.·?!:()]+)/g, (m, name, more, word) => {
    if (!counted.has(name) || !HI_NOUNS.has(word)) return m;
    const pre = more ? ' और' : '';
    return `{${name}, plural, one {#${pre} ${HI_SINGULAR[word] ?? word}} other {#${pre} ${word}}}`;
  });
  return { en: enOut, hi: hiOut };
}

/** Splits " · " outside ICU braces. */
function splitDots(v) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < v.length; i++) {
    const ch = v[i];
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (depth === 0 && v.startsWith(' · ', i)) {
      out.push(cur);
      cur = '';
      i += 2;
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * "Start here · [Start]": the parts of a composite row (labels, buttons in brackets). A part with
 * alternative buttons, "[Start deep dive] / [Start quick revision]", gives one part per button.
 */
export function compositeParts(en, hi) {
  if (!en.includes(' · ') || !hi.includes(' · ')) return null;
  const expand = (parts) =>
    parts.flatMap((x) => (/^\s*\[[^\]]+\](\s*\/\s*\[[^\]]+\])+\s*$/.test(x) ? x.split(/\s*\/\s*/) : [x]));
  const e = expand(splitDots(en));
  const h = expand(splitDots(hi));
  if (e.length !== h.length) return null;
  const strip = (x) => x.trim().replace(/^\[(.*)\]$/, '$1');
  return e.map((x, i) => [strip(x), strip(h[i] ?? '')]);
}

/**
 * The docs write durations as `{m:ss}` / `{hh:mm}` and nested values as `{marking.correct}`,
 * which are not ICU argument names. They become `{time}`, `{time_2}` … and `{marking_correct}`;
 * the time format each one expects is returned so the app formats the value before passing it.
 */
export function normalizeArgs(v) {
  const formats = {};
  let n = 0;
  const out = v
    .replace(/\{((?:h{1,2}|m{1,2}):(?:mm|ss)(?::ss)?)\}/g, (_, fmt) => {
      n += 1;
      const name = n === 1 ? 'time' : `time_${n}`;
      formats[name] = fmt;
      return `{${name}}`;
    })
    .replace(/\{([a-z_][a-z0-9_]*(?:\.[a-z0-9_]+)+)\}/gi, (_, name) => `{${name.replace(/\./g, '_')}}`);
  return { value: out, formats };
}

function ns(file) {
  return file.replace(/\.md$/, '').replace(/-/g, '_');
}

export function extractFile(text, namespace) {
  const lines = text.split('\n');
  const en = {};
  const hi = {};
  const screens = {};
  const issues = [];
  let screen = null;
  let llBlock = false;
  const indexPriority = {};
  const timeFormats = {};
  /** Prices to placeholders, then plurals for counted nouns. */
  const finish = (e, h, key) => {
    const pe = priceToken(e);
    const ph = priceToken(h);
    for (const amount of [...pe.unknown, ...ph.unknown]) issues.push({ kind: 'unknown_price', key, amount });
    return pluralizeCounts(pe.value, ph.value);
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const sm = SCREEN_RE.exec(line);
    if (sm) {
      screen = sm[1];
      const title = (sm[2] ?? '').trim();
      if (!screens[screen]) screens[screen] = { ns: namespace, title, priority: null, line: i + 1 };
      llBlock = false;
      continue;
    }
    if (/^#{1,2}\s/.test(line) && !sm) {
      // An area heading (## Sign-in): no screen until the next block.
      if (/^##\s/.test(line)) screen = null;
      continue;
    }
    const pm = /^\*\*Mock priority:\*\*\s*\**(P\d)\b/.exec(line);
    if (pm && screen && screens[screen] && !screens[screen].priority) screens[screen].priority = pm[1];
    // Screen index tables: | ME-01 | Me | P0 | 1 |
    const im = /^\|\s*([A-Z]{2,6}-\d{1,3}[A-Za-z]?)\s*\|/.exec(line);
    if (im && !HEADER_RE.test(line)) {
      const prio = splitRow(line).find((c) => /^P\d$/.test(c));
      if (prio && im[1] && !indexPriority[im[1]]) indexPriority[im[1]] = prio;
    }
    if (/^\*\*Copy\b/.test(line)) llBlock = /little[ -]learner|तुम/i.test(line.split(':**')[0] ?? line);
    const hm = HEADER_RE.exec(line);
    if (!hm) continue;
    const variant = hm[1] ? slugify(hm[1]) : null;
    if (!screen) {
      issues.push({ kind: 'table_without_screen', line: i + 1 });
      continue;
    }
    let j = i + 2; // skip the separator row
    for (; j < lines.length && lines[j].trim().startsWith('|'); j++) {
      const cells = splitRow(lines[j]);
      if (cells.length !== 3) {
        issues.push({ kind: 'bad_row', line: j + 1, cells: cells.length });
        continue;
      }
      const [rowKey, rowEn, rowHi] = cells;
      if (/^\([^)]*\)$/.test(cleanValue(rowEn)) && !cleanValue(rowHi)) {
        issues.push({ kind: 'not_copy', line: j + 1 });
        continue; // a stage direction such as "(pet peeks, no text)"
      }
      for (const [rawKey, rawEn, rawHi] of splitCombined(rowKey, cleanValue(rowEn), cleanValue(rowHi))) {
      const isLL = llBlock || LL_KEY_RE.test(rawKey);
      let slug = slugify(rawKey);
      if (variant) slug = `${variant}_${slug}`;
      if (isLL && !slug.includes('little_learner')) slug = `little_learner_${slug.replace(/(^|_)(ll|child|u10)(_|$)/g, '$1$3').replace(/__+/g, '_').replace(/^_|_$/g, '') || 'text'}`;
      let key = `${screen}.${slug}`;
      for (let n = 2; key in en; n++) key = `${screen}.${slug}_${n}`;
      const enNorm = normalizeArgs(brandToken(cleanValue(rawEn)));
      const hiNorm = normalizeArgs(brandToken(cleanValue(rawHi)));
      let enVal = enNorm.value;
      let hiVal = hiNorm.value;
      const inlineEn = INLINE_LL_RE.exec(enVal);
      const inlineHi = INLINE_LL_RE.exec(hiVal);
      if (inlineEn || inlineHi) {
        const llKey = `${key}_little_learner`;
        if (inlineEn) enVal = enVal.replace(INLINE_LL_RE, '');
        if (inlineHi) hiVal = hiVal.replace(INLINE_LL_RE, '');
        const ll = finish(inlineEn ? inlineEn[1].trim() : enVal, inlineHi ? inlineHi[1].trim() : hiVal, llKey);
        en[llKey] = ll.en;
        hi[llKey] = ll.hi;
      }
      if (!enVal) issues.push({ kind: 'empty_en', line: j + 1, key });
      if (!hiVal || /^(—|-|n\/a|same|\(same\))$/i.test(hiVal)) issues.push({ kind: 'missing_hi', line: j + 1, key });
      ({ en: enVal, hi: hiVal } = finish(enVal, hiVal, key));
      en[key] = enVal;
      hi[key] = hiVal;
      if (Object.keys(enNorm.formats).length) timeFormats[`${namespace}:${key}`] = enNorm.formats;
      const parts = compositeParts(enVal, hiVal);
      if (parts) {
        parts.forEach(([pe, ph], n) => {
          en[`${key}.${n + 1}`] = pe;
          hi[`${key}.${n + 1}`] = ph;
        });
      }
      }
    }
    i = j - 1;
  }
  for (const [id, prio] of Object.entries(indexPriority)) if (screens[id] && !screens[id].priority) screens[id].priority = prio;
  return { en, hi, screens, issues, timeFormats };
}

function stable(obj) {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

function main() {
  if (!existsSync(uxDir)) {
    console.error(`docs/ux not found at ${uxDir}; pass --docs or set SMRITI_DOCS_DIR`);
    process.exit(2);
  }
  const files = readdirSync(uxDir).filter((f) => f.endsWith('.md')).sort();
  const outDir = join(pkg, 'src', 'locales');
  const allScreens = {};
  const allFormats = {};
  const report = [];
  let drift = false;
  const write = (path, content) => {
    if (check) {
      if (!existsSync(path) || readFileSync(path, 'utf8') !== content) {
        drift = true;
        console.error(`out of date: ${path}`);
      }
      return;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  for (const f of files) {
    const namespace = ns(f);
    const { en, hi, screens, issues, timeFormats } = extractFile(readFileSync(join(uxDir, f), 'utf8'), namespace);
    Object.assign(allScreens, screens);
    Object.assign(allFormats, timeFormats);
    write(join(outDir, 'en', `${namespace}.json`), stable(en));
    write(join(outDir, 'hi', `${namespace}.json`), stable(hi));
    const ll = Object.keys(en).filter((k) => k.includes('little_learner')).length;
    report.push({ ns: namespace, keys: Object.keys(en).length, little_learner: ll, screens: Object.keys(screens).length, issues: issues.length });
    for (const issue of issues) console.warn(`${f}:${issue.line} ${issue.kind}${issue.key ? ` ${issue.key}` : ''}${issue.cells ? ` (${issue.cells} cells)` : ''}`);
  }
  write(join(outDir, 'screens.json'), stable(allScreens));
  write(join(outDir, 'time-formats.json'), stable(allFormats));
  console.table(report);
  if (check && drift) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
