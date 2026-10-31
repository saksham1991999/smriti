import type { TypedBundle } from "@smriti/content-schema/runtime";
import type { MessageKey, MessageValues } from "@smriti/i18n";
import { createContext, useContext } from "react";
import type { ImageSourcePropType } from "react-native";

/** Translates an i18n catalogue key (the host passes its translator's `t`). */
export type Translate = (key: MessageKey, values?: MessageValues) => string;

export interface PlayerContextValue {
  t: Translate;
  bundle: TypedBundle;
  /**
   * Resolves a bundle-relative media url (`assets/<sha>.webp`) to an image source: the bundled
   * seed pack, a downloaded file, or the CDN. Undefined means "not on this device".
   */
  resolveMedia: (url: string) => ImageSourcePropType | undefined;
  online: boolean;
  /** Subject colour family for tints. */
  subject?: string;
}

const Ctx = createContext<PlayerContextValue | null>(null);
export const PlayerProvider = Ctx.Provider;

export function usePlayer(): PlayerContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("lesson-player-native components need <LessonPlayer>");
  return v;
}

/**
 * Strings the native and web players share. They are named after the web player's WEB-02 keys so
 * both read one catalogue entry; until that catalogue lands on this branch a missing key returns
 * the key (see the mobile report, "Root changes needed").
 */
export const sharedKey = (slug: string): MessageKey => `learn:WEB-02.${slug}` as MessageKey;
