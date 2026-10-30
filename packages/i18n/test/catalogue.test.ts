import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { describe, expect, it } from 'vitest';

import { GLOSSARY_HI, NAMESPACES, SCREENS, allMessages, createI18n, k, littleLearnerVariants, resources } from '../src';
import { uiStringsEn, uiStringsHi } from '../src/ui';
// @ts-expect-error: plain ESM script without types
import { brandToken, compositeParts, extractFile, slugify, splitCombined, splitRow } from '../scripts/extract.mjs';

const messages = allMessages();

/** Argument names used by an ICU message (plural/select/argument), excluding `#`. */
function argNames(msg: string): Set<string> {
  const out = new Set<string>();
  const walk = (els: MessageFormatElement[]) => {
    for (const el of els) {
      if (el.type === TYPE.argument || el.type === TYPE.number || el.type === TYPE.date || el.type === TYPE.time) out.add(el.value);
      if (el.type === TYPE.plural || el.type === TYPE.select) {
        out.add(el.value);
        for (const opt of Object.values(el.options)) walk(opt.value);
      }
      if (el.type === TYPE.tag) walk(el.children);
    }
  };
  walk(parse(msg, { ignoreTag: true }));
  return out;
}

describe('catalogue lint', () => {
  it('has both locales for every namespace with the same keys', () => {
    for (const ns of NAMESPACES) {
      expect(Object.keys(resources.hi[ns]).sort()).toEqual(Object.keys(resources.en[ns]).sort());
    }
    expect(messages.length).toBeGreaterThan(4000);
  });

  it('no missing or empty Hindi (rule 7)', () => {
    const missing = messages.filter(([, , en, hi]) => en && !hi.trim()).map(([ns, key]) => `${ns}:${key}`);
    expect(missing).toEqual([]);
  });

  it('तुम only in little-learner keys (R3)', () => {
    const bad = messages.filter(([, key, , hi]) => hi.includes('तुम') && !key.includes('little_learner')).map(([ns, key, , hi]) => `${ns}:${key} ${hi}`);
    expect(bad).toEqual([]);
  });

  it('every message parses as ICU in both locales', () => {
    const errors: string[] = [];
    for (const [ns, key, en, hi] of messages) {
      for (const [loc, msg] of [['en', en], ['hi', hi]] as const) {
        try {
          parse(msg, { ignoreTag: true });
        } catch (e) {
          errors.push(`${loc} ${ns}:${key}: ${(e as Error).message}`);
        }
      }
    }
    expect(errors).toEqual([]);
  });

  it('Hindi uses no placeholder that English lacks', () => {
    const bad: string[] = [];
    for (const [ns, key, en, hi] of messages) {
      const e = argNames(en);
      for (const a of argNames(hi)) if (!e.has(a)) bad.push(`${ns}:${key} {${a}}`);
    }
    expect(bad).toEqual([]);
  });

  it('Hindi keeps every English placeholder', () => {
    const dropped = messages
      .filter(([, , en, hi]) => [...argNames(en)].some((a) => !argNames(hi).has(a)))
      .map(([ns, key]) => `${ns}:${key}`);
    expect(dropped).toEqual([]);
  });

  it('no text that looks like a model id, secret or raw brand name', () => {
    for (const [ns, key, en, hi] of messages) {
      expect(/\bSmriti\b/.test(en) || /\bSmriti\b/.test(hi), `${ns}:${key}`).toBe(false);
    }
  });

  it('screens index covers every key prefix (the hand-kept ui namespace has no screens)', () => {
    for (const [ns, key] of messages) {
      if (ns === 'ui') continue;
      const screen = key.split('.')[0] ?? '';
      const sub = /^([A-Z]+-\d+[A-Za-z]?\.\d+)\./.exec(key)?.[1];
      expect(SCREENS[screen] ?? (sub ? SCREENS[sub] : undefined), key).toBeDefined();
    }
  });

  it('glossary: core loanwords are in use (mixed use with formal words is a known doc issue)', () => {
    const used = (w: string) => messages.some(([, , , hi]) => hi.includes(w));
    for (const term of ['लेसन', 'स्ट्रीक', 'प्रोग्रेस', 'फ़्रीज़']) {
      expect(GLOSSARY_HI.some((g) => g.preferred === term), term).toBe(true);
      expect(used(term), term).toBe(true);
    }
  });
});

describe('runtime', () => {
  it('translates with ICU plural and fills {brand}', () => {
    const en = createI18n({ locale: 'en', brand: 'Smriti JEE' });
    expect(en.t('learn:HOME-01.greeting_morning', { name: 'Asha' })).toBe('Good morning, Asha');
    expect(en.t(k('learn', 'HOME-06.little_learner_stars_a11y'), { n: 3 })).toBe('3 stars');
    const plural = 'learn:HOME-01.freeze_slots' as const;
    expect(en.t(plural, { n: 1 })).toContain('1 freeze ready');
    expect(en.t(plural, { n: 2 })).toContain('2 freezes ready');
    const brandKey = messages.find(([, , e]) => e.includes('{brand}'));
    if (brandKey) expect(en.t(`${brandKey[0]}:${brandKey[1]}` as never)).toContain('Smriti JEE');
  });

  it('switches to Hindi and falls back to the key when missing', async () => {
    const tr = createI18n({ locale: 'en', brand: 'Smriti' });
    await tr.setLocale('hi');
    expect(tr.locale).toBe('hi');
    expect(tr.t('auth:AUTH-01.later')).toBe('बाद में');
    expect(tr.t('auth:NOPE.missing' as never)).toBe('NOPE.missing');
  });

  it('serves the component strings as the ui namespace, also from the light ./ui entry', async () => {
    const tr = createI18n({ locale: 'en', brand: 'Smriti' });
    expect(tr.t('ui:streak.pill', { n: 4 })).toBe('4-day streak');
    expect(tr.t('ui:rating.a11y', { label: 'Good', interval: '3 days' })).toBe('Good, next review in 3 days');
    await tr.setLocale('hi');
    expect(tr.t('ui:common.back')).toBe(uiStringsHi['common.back']);
    expect(uiStringsEn['common.back']).toBe('Back');
    expect(Object.keys(uiStringsHi).sort()).toEqual(Object.keys(uiStringsEn).sort());
  });

  it('tr() picks the little-learner variant', () => {
    const tr = createI18n({ locale: 'hi', brand: 'Smriti', littleLearner: true });
    expect(tr.tr('learn:LRN-11.read_to_me')).toBe('मुझे पढ़कर सुनाओ');
    tr.setLittleLearner(false);
    expect(tr.tr('learn:LRN-11.read_to_me')).toBe('पढ़कर सुनाएँ');
    expect(littleLearnerVariants('learn:LES-08.title')).toEqual(['learn:LES-08.title_little_learner', 'learn:LES-08.little_learner_title']);
    const on = createI18n({ locale: 'hi', brand: 'Smriti', littleLearner: true });
    expect(on.tr('learn:LES-08.title' as never, { n: 2 })).toBe(on.t('learn:LES-08.little_learner_title', { n: 2 }));
  });
});

describe('extractor', () => {
  it('slugs, rows and splitting', () => {
    expect(slugify('Title, `lesson_3`')).toBe('title_lesson_3');
    expect(slugify("Today's {n} plan")).toBe('today_s_n_plan');
    expect(splitRow('| a | b \\| c | `x|y` |')).toEqual(['a', 'b | c', '`x|y`']);
    expect(splitCombined('again / hard / good / easy', 'Again / Hard / Good / Easy', 'फिर से / कठिन / ठीक / आसान')).toEqual([
      ['again', 'Again', 'फिर से'], ['hard', 'Hard', 'कठिन'], ['good', 'Good', 'ठीक'], ['easy', 'Easy', 'आसान'],
    ]);
    expect(splitCombined('Kid title (`10_12` / `u10`)', 'Ask a grown-up', 'पूछें / पूछो')).toEqual([
      ['Kid title `10_12`', 'Ask a grown-up', 'पूछें'], ['Kid title `u10`', 'Ask a grown-up', 'पूछो'],
    ]);
    expect(splitCombined('days_3 / 5 / 7', '3 days / 5 days / 7 days', '3 दिन / 5 दिन / 7 दिन').map((r: string[]) => r[0])).toEqual(['days_3', 'days_5', 'days_7']);
    expect(splitCombined('Title, `a` / `b`', 'Same', 'वही')).toHaveLength(1);
    expect(brandToken('Also try Smriti NEET · स्मृति महल · स्मृति आपको')).toBe('Also try {brand} NEET · स्मृति महल · {brand} आपको');
    expect(compositeParts('Start here · [Start]', 'यहाँ से · [शुरू]')).toEqual([['Start here', 'यहाँ से'], ['Start', 'शुरू']]);
  });

  it('extracts a block: screen ids, little-learner tables, inline variants, priorities', () => {
    const doc = [
      '| ID | Name | Priority |',
      '|---|---|---|',
      '| HOME-09 | Test | P0 |',
      '### HOME-09 · Test screen',
      '**Copy:**',
      '| Key | EN | HI |',
      '|---|---|---|',
      '| Title | Hello | नमस्ते |',
      '| Title | Again | फिर |',
      '| Read to me | Read to me | पढ़कर सुनाएँ (little learner, तुम: मुझे पढ़कर सुनाओ) |',
      '| Pull | (pet peeks) | |',
      '',
      '**Copy (little learner, तुम):**',
      '| Key | EN | HI |',
      '|---|---|---|',
      '| Play | Play | खेलो |',
    ].join('\n');
    const r = extractFile(doc, 'learn');
    expect(r.en).toEqual({
      'HOME-09.title': 'Hello',
      'HOME-09.title_2': 'Again',
      'HOME-09.read_to_me_little_learner': 'Read to me',
      'HOME-09.read_to_me': 'Read to me',
      'HOME-09.little_learner_play': 'Play',
    });
    expect(r.hi['HOME-09.read_to_me']).toBe('पढ़कर सुनाएँ');
    expect(r.hi['HOME-09.read_to_me_little_learner']).toBe('मुझे पढ़कर सुनाओ');
    expect(r.screens['HOME-09']).toMatchObject({ ns: 'learn', title: 'Test screen', priority: 'P0' });
    expect(r.issues).toEqual([{ kind: 'not_copy', line: 11 }]);
  });

  const docs = resolve(process.env['SMRITI_DOCS_DIR'] ?? join(__dirname, '..', '..', '..', 'docs'));
  it.skipIf(!existsSync(join(docs, 'ux')))('catalogues are up to date with docs/ux', () => {
    const script = join(__dirname, '..', 'scripts', 'extract.mjs');
    expect(() => execFileSync(process.execPath, [script, '--check', '--docs', docs], { stdio: 'pipe' })).not.toThrow();
  });
});
