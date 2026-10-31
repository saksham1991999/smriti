import type { AudioEvent, AudioPort, GlyphMask } from '@smriti/lesson-core';
import { Platform } from 'react-native';

/**
 * Host pieces the little learner players need (lesson-core `AudioPort`, `GlyphMask`).
 *
 * Audio: on the web an HTMLAudioElement plays song tracks, narration and prompts. The phone
 * needs a native audio module (expo-audio), which this build doesn't have yet, so there the
 * players stay silent and show their words (they never fake a sound).
 *
 * Trace: the glyph's ink is rasterised from the app's own font (never drawn paths). On the web a
 * 2D canvas does it; the phone needs Skia or pre-rendered masks, so there the player accepts any
 * trace (its documented fallback).
 */
export function webAudioPort(): AudioPort | undefined {
  if (Platform.OS !== 'web' || typeof Audio === 'undefined') return undefined;
  let el: HTMLAudioElement | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<(e: AudioEvent) => void>();
  const emit = (e: AudioEvent) => listeners.forEach((l) => l(e));
  const stopTimer = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  const startTimer = () => {
    stopTimer();
    timer = setInterval(() => el && emit({ type: 'position', ms: Math.round(el.currentTime * 1000) }), 250);
  };
  return {
    play(src) {
      el?.pause();
      el = new Audio(src);
      el.onended = () => {
        stopTimer();
        emit({ type: 'ended' });
      };
      el.onerror = () => {
        stopTimer();
        emit({ type: 'error' });
      };
      el.play().then(startTimer, () => emit({ type: 'error' }));
    },
    pause() {
      el?.pause();
      stopTimer();
    },
    resume() {
      el?.play().then(startTimer, () => emit({ type: 'error' }));
    },
    stop() {
      el?.pause();
      el = null;
      stopTimer();
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

/** Font families as the app registers them (ui-native `fonts.ts`). */
export interface GlyphFonts {
  latin: string;
  devanagari: string;
}

export function glyphMaskFor(fonts: GlyphFonts): ((glyph: string, script: 'latin' | 'devanagari' | 'digits') => GlyphMask | null) | undefined {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
  return (glyph, script, grid = 48) => {
    const c = document.createElement('canvas');
    c.width = grid;
    c.height = grid;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = c.getContext('2d');
    } catch {
      ctx = null;
    }
    if (!ctx) return null;
    // The player draws the glyph centred at 80% of the pad; the mask matches it. Only alpha is read.
    ctx.font = `700 ${Math.round(grid * 0.8)}px ${script === 'devanagari' ? fonts.devanagari : fonts.latin}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'black';
    ctx.fillText(glyph, grid / 2, grid / 2);
    const data = ctx.getImageData(0, 0, grid, grid).data;
    const ink = new Uint8Array(grid * grid);
    for (let i = 0; i < ink.length; i++) ink[i] = (data[i * 4 + 3] ?? 0) > 96 ? 1 : 0;
    return { width: grid, height: grid, ink };
  };
}
