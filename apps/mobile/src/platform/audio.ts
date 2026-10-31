/**
 * Audio out (read-aloud) and in (dictation). The web build uses the browser's own audio element
 * and MediaRecorder. The native player and recorder need `expo-audio`, which is not linked in
 * this build yet: native reports `available: false` and the screens hide the speaker and mic
 * buttons instead of failing (to turn it on: add expo-audio and implement `NativeAudio`).
 */
export interface AudioOut {
  readonly available: boolean;
  play(url: string): Promise<void>;
  stop(): void;
}

export interface Recording {
  stop(): Promise<{ data: Blob; mime: string } | null>;
  cancel(): void;
}

export interface AudioIn {
  readonly available: boolean;
  /** null when the permission is refused (AI-12). */
  start(): Promise<Recording | null>;
}

interface BrowserAudio {
  play(): Promise<void>;
  pause(): void;
}

type G = typeof globalThis & {
  Audio?: new (src: string) => BrowserAudio;
  MediaRecorder?: new (stream: unknown) => { start(): void; stop(): void; ondataavailable: ((e: { data: Blob }) => void) | null; onstop: (() => void) | null; mimeType: string };
  navigator?: { mediaDevices?: { getUserMedia(c: { audio: boolean }): Promise<{ getTracks(): { stop(): void }[] }> } };
};

export class WebAudioOut implements AudioOut {
  private current: BrowserAudio | null = null;
  get available() {
    return typeof (globalThis as G).Audio === 'function';
  }
  async play(url: string) {
    this.stop();
    const A = (globalThis as G).Audio;
    if (!A) return;
    this.current = new A(url);
    await this.current.play().catch(() => undefined);
  }
  stop() {
    this.current?.pause();
    this.current = null;
  }
}

export class WebAudioIn implements AudioIn {
  get available() {
    const g = globalThis as G;
    return typeof g.MediaRecorder === 'function' && !!g.navigator?.mediaDevices;
  }
  async start(): Promise<Recording | null> {
    const g = globalThis as G;
    if (!g.MediaRecorder || !g.navigator?.mediaDevices) return null;
    const stream = await g.navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
    if (!stream) return null;
    const rec = new g.MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.start();
    const done = () => stream.getTracks().forEach((t) => t.stop());
    return {
      stop: () =>
        new Promise((resolve) => {
          rec.onstop = () => {
            done();
            resolve(chunks.length ? { data: new Blob(chunks, { type: rec.mimeType }), mime: rec.mimeType || 'audio/webm' } : null);
          };
          rec.stop();
        }),
      cancel: () => {
        rec.onstop = done;
        rec.stop();
      },
    };
  }
}

/** Native until expo-audio is linked. */
export const noAudioOut: AudioOut = { available: false, play: async () => undefined, stop: () => undefined };
export const noAudioIn: AudioIn = { available: false, start: async () => null };
