/**
 * Card narration through the host's audio port (lesson-core `cardNarration`, `autoNarrate`). With
 * no port or no ready audio, `src` is null and the player hides [Listen]: silent and fully usable.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioPort } from "@smriti/lesson-core";

export type NarrationStatus = "idle" | "playing" | "paused";

export function useNarration(opts: {
  audio: AudioPort | undefined;
  /** The ready narration url of the card on screen, or null. */
  src: string | null;
  /** Changes when the card on screen changes. */
  cardKey: string;
  /** Start by itself when the card opens (little learners, not muted). */
  auto: boolean;
  /** The app's mute setting: muting stops narration that is playing. */
  muted: boolean;
  onPlayed?: (auto: boolean) => void;
}): { status: NarrationStatus; toggle: (() => void) | null } {
  const { audio, src, cardKey, auto, muted } = opts;
  const [status, setStatus] = useState<NarrationStatus>("idle");
  const onPlayed = useRef(opts.onPlayed);
  onPlayed.current = opts.onPlayed;

  useEffect(() => {
    if (!audio) return;
    return audio.subscribe((e) => {
      if (e.type === "ended" || e.type === "error") setStatus("idle");
    });
  }, [audio]);

  // A new card stops the last one's narration and, for little learners, reads the new one.
  useEffect(() => {
    if (!audio) return;
    audio.stop();
    if (auto && src) {
      audio.play(src);
      setStatus("playing");
      onPlayed.current?.(true);
    } else {
      setStatus("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio, cardKey]);

  useEffect(() => {
    if (muted && audio) {
      audio.stop();
      setStatus("idle");
    }
  }, [muted, audio]);

  useEffect(() => () => audio?.stop(), [audio]);

  const toggle = useCallback(() => {
    if (!audio || !src) return;
    if (status === "playing") {
      audio.pause();
      setStatus("paused");
    } else if (status === "paused") {
      audio.resume();
      setStatus("playing");
    } else {
      audio.play(src);
      setStatus("playing");
      onPlayed.current?.(false);
    }
  }, [audio, src, status]);

  return { status, toggle: audio && src ? toggle : null };
}
