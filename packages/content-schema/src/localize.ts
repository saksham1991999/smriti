import type {
  Bundle,
  Card,
  CheatSheet,
  ChildQuestion,
  I18NStringList,
  I18NText,
  LocalizedRef,
  Mnemonic,
  Question,
} from "./generated/types.js";

/**
 * Locales content may carry: English and the scheduled languages of India. Phase 1 ships en and
 * hi. Localised values are recognised by their keys, so this list is closed on purpose: content
 * never uses id-keyed maps (answers are arrays of pairs), and no field name is one of these codes.
 */
export const KNOWN_LOCALES = [
  "en",
  "hi",
  "as",
  "bn",
  "brx",
  "doi",
  "gu",
  "kn",
  "ks",
  "kok",
  "mai",
  "ml",
  "mni",
  "mr",
  "ne",
  "or",
  "pa",
  "sa",
  "sat",
  "sd",
  "ta",
  "te",
  "ur",
] as const;

const LOCALE_SET: ReadonlySet<string> = new Set(KNOWN_LOCALES);

export function isKnownLocale(value: string): boolean {
  return LOCALE_SET.has(value);
}

/** True when T is an index-signature type such as I18NText (not an object with named fields). */
type IsRecord<T> = string extends keyof T ? true : false;

/**
 * Turns content types into their published, single-locale shape: every I18nText becomes a string,
 * every I18nStringList a string[], every LocalizedRef the one id for that locale.
 */
export type Localize<T> = T extends readonly (infer U)[]
  ? Localize<U>[]
  : T extends I18NText | LocalizedRef
    ? IsRecord<T> extends true
      ? string
      : { [K in keyof T]: Localize<T[K]> }
    : T extends I18NStringList
      ? IsRecord<T> extends true
        ? string[]
        : { [K in keyof T]: Localize<T[K]> }
      : T extends object
        ? { [K in keyof T]: Localize<T[K]> }
        : T;

export type BundleCard = Localize<Card>;
export type BundleQuestion = Localize<Question>;
export type BundleChildQuestion = Localize<ChildQuestion>;
export type BundleMnemonic = Omit<Mnemonic, "notes">;
export type BundleSheet = Localize<CheatSheet>;

/** A published bundle with its cards and maps typed. */
export type TypedBundle = Omit<Bundle, "cards" | "questions" | "mnemonics" | "sheets"> & {
  cards: BundleCard[];
  questions: Record<string, BundleQuestion>;
  mnemonics: Record<string, BundleMnemonic>;
  sheets: Record<string, BundleSheet>;
};

/** True for an object whose keys are all locale codes and whose values are all strings. */
export function isI18nText(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (entries.length === 0) return false;
  return entries.every(([k, v]) => LOCALE_SET.has(k) && typeof v === "string");
}

/** True for a localised list of strings, { "en": ["..."], "hi": ["..."] }. */
export function isI18nStringList(value: unknown): value is Record<string, string[]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (entries.length === 0) return false;
  return entries.every(
    ([k, v]) => LOCALE_SET.has(k) && Array.isArray(v) && v.every((s) => typeof s === "string"),
  );
}

export class MissingLocaleError extends Error {
  constructor(
    readonly path: string,
    readonly locale: string,
  ) {
    super(`missing locale "${locale}" at ${path || "/"}`);
  }
}

/**
 * Resolve every localised field in a content value to one locale. Throws MissingLocaleError when a
 * field lacks the locale (the content check reports these before publish).
 */
export function localize<T>(value: T, locale: string, path = ""): Localize<T> {
  return localizeAny(value, locale, path) as Localize<T>;
}

function localizeAny(value: unknown, locale: string, path: string): unknown {
  if (Array.isArray(value)) return value.map((v, i) => localizeAny(v, locale, `${path}/${i}`));
  if (isI18nText(value)) {
    const text = value[locale];
    if (text === undefined) throw new MissingLocaleError(path, locale);
    return text;
  }
  if (isI18nStringList(value)) {
    const list = value[locale];
    if (list === undefined) throw new MissingLocaleError(path, locale);
    return list;
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = localizeAny(v, locale, `${path}/${k}`);
    return out;
  }
  return value;
}

export interface MathSegment {
  kind: "text" | "math";
  /** For math: the TeX without delimiters. For text: the text. */
  value: string;
  display: boolean;
  /** For math: the source with its delimiters, the key into bundle.math. */
  key: string;
}

/**
 * Split text into plain and maths segments. `$...$` is inline and `$$...$$` display maths. A
 * backslash-escaped dollar (`\$`) stays text.
 */
export function splitMath(text: string): MathSegment[] {
  const out: MathSegment[] = [];
  let buf = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\" && text[i + 1] === "$") {
      buf += "$";
      i += 2;
      continue;
    }
    if (ch === "$") {
      const display = text[i + 1] === "$";
      const delim = display ? "$$" : "$";
      const start = i + delim.length;
      const end = findClosing(text, start, delim);
      if (end === -1) {
        buf += text.slice(i);
        break;
      }
      if (buf) out.push({ kind: "text", value: buf, display: false, key: buf });
      buf = "";
      const tex = text.slice(start, end);
      out.push({ kind: "math", value: tex, display, key: `${delim}${tex}${delim}` });
      i = end + delim.length;
      continue;
    }
    buf += ch;
    i += 1;
  }
  if (buf) out.push({ kind: "text", value: buf, display: false, key: buf });
  return out;
}

function findClosing(text: string, from: number, delim: string): number {
  let j = from;
  while (j < text.length) {
    if (text[j] === "\\") {
      j += 2;
      continue;
    }
    if (text.startsWith(delim, j)) return j === from ? -1 : j;
    j += 1;
  }
  return -1;
}

/** Keys used in bundle.math for latex fields (display) and formula symbols (inline). */
export const mathKey = {
  display: (tex: string): string => `$$${tex}$$`,
  inline: (tex: string): string => `$${tex}$`,
};

/** `{{blank:<id>}}` tokens in fill_blank stems. */
export const BLANK_TOKEN = /\{\{blank:([a-z0-9]+(?:-[a-z0-9]+)*)\}\}/g;

export function blankIds(text: string): string[] {
  return [...text.matchAll(BLANK_TOKEN)].map((m) => m[1] as string);
}
