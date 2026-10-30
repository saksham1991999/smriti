import { createContext, useContext } from "react";
import type { TypedBundle } from "@smriti/content-schema";
import type { MessageKey, MessageValues } from "@smriti/i18n";

/** Translates an i18n catalogue key (the host passes its translator's `t`). */
export type Translate = (key: MessageKey, values?: MessageValues) => string;

export interface PlayerContextValue {
  t: Translate;
  bundle: TypedBundle;
  /** Base URL that bundle-relative media urls (`assets/<sha>.webp`) resolve against. */
  contentBaseUrl: string;
  online: boolean;
}

const Ctx = createContext<PlayerContextValue | null>(null);
export const PlayerProvider = Ctx.Provider;

export function usePlayer(): PlayerContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("lesson-player-web components need <LessonPlayer>");
  return v;
}

/** Joins the content base and a bundle-relative path without doubling slashes. */
export function contentUrl(base: string, path: string): string {
  if (/^(https?:)?\/\//.test(path) || path.startsWith("/")) return path;
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
