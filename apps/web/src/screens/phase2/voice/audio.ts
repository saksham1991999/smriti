/**
 * Browser audio for the voice tutor: the mic as 16 kHz mono PCM16 chunks (Gemini Live's input),
 * and a player for the tutor's 24 kHz PCM16 that can stop at once on barge-in. Nothing is recorded
 * or kept; chunks go straight to the socket.
 */

/** Float32 samples at `fromRate` → Int16 little-endian at `toRate` (simple averaging decimation). */
export function downsampleToPcm16(input: Float32Array, fromRate: number, toRate = 16000): Int16Array {
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const out = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j] ?? 0;
    const v = Math.max(-1, Math.min(1, end > start ? sum / (end - start) : 0));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

export function pcm16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToPcm16(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
}

/** Peak level 0-1 of a block, for the mic ring. */
export function peakLevel(samples: Float32Array): number {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  return Math.min(1, peak * 2);
}

// The worklet posts raw Float32 blocks of about 100 ms; conversion happens on the main thread.
const WORKLET = `
class SmritiMicTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.size = 0; this.target = Math.round(sampleRate / 10); }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) { this.buf.push(new Float32Array(ch)); this.size += ch.length; }
    if (this.size >= this.target) {
      const out = new Float32Array(this.size); let o = 0;
      for (const b of this.buf) { out.set(b, o); o += b.length; }
      this.port.postMessage(out, [out.buffer]); this.buf = []; this.size = 0;
    }
    return true;
  }
}
registerProcessor("smriti-mic-tap", SmritiMicTap);
`;

/** Streams the mic as base64 PCM16 at 16 kHz. `muted` drops chunks without closing the mic. */
export class MicCapture {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  muted = false;

  constructor(
    private readonly stream: MediaStream,
    private readonly onChunk: (base64: string) => void,
    private readonly onLevel: (level: number) => void,
  ) {}

  async start(): Promise<void> {
    const ctx = new AudioContext();
    this.ctx = ctx;
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    this.source = ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(ctx, "smriti-mic-tap");
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      this.onLevel(this.muted ? 0 : peakLevel(e.data));
      if (this.muted) return;
      this.onChunk(pcm16ToBase64(downsampleToPcm16(e.data, ctx.sampleRate)));
    };
    this.source.connect(this.node);
  }

  stop(): void {
    this.node?.port.close();
    this.source?.disconnect();
    this.node?.disconnect();
    this.stream.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}

/** Plays the tutor's PCM16 chunks back to back; `flush()` stops everything queued (barge-in). */
export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private at = 0;
  private playing = new Set<AudioBufferSourceNode>();

  constructor(
    private readonly rate = 24000,
    private readonly onDrained?: () => void,
  ) {}

  private context(): AudioContext {
    this.ctx ??= new AudioContext({ sampleRate: this.rate });
    return this.ctx;
  }

  play(base64: string): void {
    const ctx = this.context();
    const pcm = base64ToPcm16(base64);
    if (!pcm.length) return;
    const buffer = ctx.createBuffer(1, pcm.length, this.rate);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = (pcm[i] ?? 0) / 0x8000;
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(ctx.destination);
    this.at = Math.max(this.at, ctx.currentTime + 0.02);
    node.start(this.at);
    this.at += buffer.duration;
    this.playing.add(node);
    node.onended = () => {
      this.playing.delete(node);
      if (!this.playing.size) this.onDrained?.();
    };
  }

  get active(): boolean {
    return this.playing.size > 0;
  }

  flush(): void {
    for (const n of this.playing) {
      n.onended = null;
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    }
    this.playing.clear();
    this.at = 0;
  }

  close(): void {
    this.flush();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
