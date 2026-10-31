/**
 * A short voice recording for dictation (AI-10 Speak). MediaRecorder in the browser's own format
 * (webm/opus or mp4), an input level for the bar meter, and a hard stop at `maxSeconds`. The blob
 * lives only in memory until it is sent to `/v1/speech/dictation`.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "recording";

export function useRecorder(maxSeconds: number, onAutoStop?: (blob: Blob | null) => void) {
  const [state, setState] = useState<RecorderState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const done = useRef<((b: Blob | null) => void) | null>(null);
  const autoStop = useRef(onAutoStop);
  autoStop.current = onAutoStop;

  const cleanup = useCallback(() => {
    if (timer.current !== null) window.clearInterval(timer.current);
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    timer.current = raf.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void ctx.current?.close().catch(() => undefined);
    ctx.current = null;
    setLevel(0);
  }, []);

  const stop = useCallback((): Promise<Blob | null> => {
    const r = rec.current;
    if (!r || r.state === "inactive") return Promise.resolve(null);
    return new Promise((resolve) => {
      done.current = resolve;
      r.stop();
    });
  }, []);

  const start = useCallback(
    (s: MediaStream) => {
      if (typeof MediaRecorder === "undefined") return false;
      stream.current = s;
      chunks.current = [];
      const r = new MediaRecorder(s);
      rec.current = r;
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = () => {
        const blob = chunks.current.length ? new Blob(chunks.current, { type: r.mimeType || "audio/webm" }) : null;
        cleanup();
        setState("idle");
        const cb = done.current;
        done.current = null;
        if (cb) cb(blob);
        else autoStop.current?.(blob);
      };
      r.start(250);
      setSeconds(0);
      setState("recording");
      const startedAt = Date.now();
      timer.current = window.setInterval(() => {
        const sec = Math.floor((Date.now() - startedAt) / 1000);
        setSeconds(sec);
        if (sec >= maxSeconds && r.state === "recording") r.stop();
      }, 250);
      try {
        const ac = new AudioContext();
        ctx.current = ac;
        const an = ac.createAnalyser();
        an.fftSize = 512;
        ac.createMediaStreamSource(s).connect(an);
        const buf = new Uint8Array(an.fftSize);
        const tick = () => {
          an.getByteTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
          setLevel(Math.min(1, peak / 64));
          raf.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        /* the meter is decoration; recording still works */
      }
      return true;
    },
    [cleanup, maxSeconds],
  );

  useEffect(
    () => () => {
      if (rec.current && rec.current.state !== "inactive") {
        rec.current.onstop = null;
        rec.current.stop();
      }
      cleanup();
    },
    [cleanup],
  );

  return { state, seconds, level, start, stop };
}

/** "1:05" with tabular figures in the UI. */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
