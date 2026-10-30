import { isI18nStringList, isI18nText } from "../localize.js";

export type Visit = (
  kind: "i18n" | "i18n_list" | "string",
  value: unknown,
  path: string,
  key: string | undefined,
) => void;

/** Walk a document, calling visit for localised values and for plain strings outside them. */
export function walkContent(value: unknown, visit: Visit, path = "", key?: string): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkContent(v, visit, `${path}/${i}`, key));
    return;
  }
  if (isI18nText(value)) {
    visit("i18n", value, path, key);
    return;
  }
  if (isI18nStringList(value)) {
    visit("i18n_list", value, path, key);
    return;
  }
  if (typeof value === "string") {
    visit("string", value, path, key);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) walkContent(v, visit, `${path}/${k}`, k);
  }
}

export const MEDIA_REF = /^(img|anim|sim|m3d|pano|audio)\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

/** Every media request id a document points at, with its JSON pointer. */
export function mediaRefs(doc: unknown): { ref: string; path: string }[] {
  const out: { ref: string; path: string }[] = [];
  walkContent(doc, (kind, value, path, key) => {
    if (key === "id" || key === "schema") return;
    if (kind === "string" && MEDIA_REF.test(value as string)) out.push({ ref: value as string, path });
    if (kind === "i18n") {
      // LocalizedAudioRef: { "en": "audio.x", "hi": "audio.y" }
      for (const [loc, v] of Object.entries(value as Record<string, string>)) {
        if (MEDIA_REF.test(v) && v.startsWith("audio.")) out.push({ ref: v, path: `${path}/${loc}` });
      }
    }
  });
  return out;
}
