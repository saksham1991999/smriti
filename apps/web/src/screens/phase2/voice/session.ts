/**
 * The live voice connection behind one interface, so the screen doesn't care what's on the other
 * end: `GeminiLiveSession` (the real WebSocket with the server-minted ephemeral token) or
 * `FakeVoiceSession` (local development and e2e, where the API's fake provider mints a fake token).
 * The model name comes from the server's response, never from code (AGENTS.md rule 4).
 */
import { MicCapture, PcmPlayer } from "./audio";
import { modelPath, type CaptionEvent, type PetState } from "./logic";

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface VoiceSessionHandlers {
  onOpen(): void;
  onState(state: PetState): void;
  onCaption(e: CaptionEvent): void;
  onLevel(level: number): void;
  /** Runs the call through the API and returns the result for the model. */
  onToolCall(call: ToolCall): Promise<Record<string, unknown>>;
  /** The socket closed: `goaway` and `dropped` can reconnect, `failed` happened before it opened. */
  onClose(reason: "normal" | "goaway" | "dropped" | "failed"): void;
}

export interface VoiceSession {
  connect(): Promise<void>;
  setMuted(muted: boolean): void;
  /** Ends the socket and releases the mic and speakers. */
  close(): void;
}

export interface VoiceSessionConfig {
  token: string;
  model: string;
  provider: string;
  stream: MediaStream;
  /** ms since the session started, for transcript timestamps. */
  clock: () => number;
}

const LIVE_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

interface ServerMessage {
  setupComplete?: unknown;
  serverContent?: {
    modelTurn?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    interrupted?: boolean;
    turnComplete?: boolean;
  };
  toolCall?: { functionCalls?: { id?: string; name?: string; args?: Record<string, unknown> }[] };
  goAway?: unknown;
}

/** Gemini Live over a WebSocket. The token is locked to the server's setup (model, instructions, tools). */
export class GeminiLiveSession implements VoiceSession {
  private ws: WebSocket | null = null;
  private mic: MicCapture | null = null;
  private player: PcmPlayer;
  private opened = false;
  private ending = false;
  private goingAway = false;
  private lastInputAt = 0;
  private thinkTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly cfg: VoiceSessionConfig,
    private readonly h: VoiceSessionHandlers,
  ) {
    this.player = new PcmPlayer(24000, () => this.h.onState("listening"));
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${LIVE_URL}?access_token=${encodeURIComponent(this.cfg.token)}`);
      this.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify({ setup: { model: modelPath(this.cfg.model) } }));
      ws.onmessage = async (ev) => {
        const raw = typeof ev.data === "string" ? ev.data : await (ev.data as Blob).text();
        let msg: ServerMessage;
        try {
          msg = JSON.parse(raw) as ServerMessage;
        } catch {
          return;
        }
        if (msg.setupComplete !== undefined && !this.opened) {
          this.opened = true;
          try {
            this.mic = new MicCapture(this.cfg.stream, (b64) => this.send({ realtimeInput: { audio: { data: b64, mimeType: "audio/pcm;rate=16000" } } }), (l) => this.h.onLevel(l));
            await this.mic.start();
          } catch (e) {
            reject(e);
            return;
          }
          this.h.onOpen();
          this.h.onState("listening");
          resolve();
          return;
        }
        this.handle(msg);
      };
      ws.onerror = () => undefined;
      ws.onclose = (ev) => {
        this.release();
        if (!this.opened) {
          reject(new Error(`voice_socket_${ev.code}`));
          this.h.onClose("failed");
        } else if (this.goingAway) this.h.onClose("goaway");
        else if (!this.ending) this.h.onClose("dropped");
        else this.h.onClose("normal");
      };
    });
  }

  private send(m: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private handle(msg: ServerMessage) {
    const sc = msg.serverContent;
    if (sc) {
      if (sc.interrupted) {
        this.player.flush();
        this.h.onCaption({ type: "interrupted" });
        this.h.onState("interrupted");
        setTimeout(() => this.h.onState("listening"), 400);
      }
      if (sc.inputTranscription?.text) {
        this.lastInputAt = Date.now();
        this.h.onCaption({ type: "input", text: sc.inputTranscription.text, at_ms: this.cfg.clock() });
        this.h.onState("listening");
        if (this.thinkTimer) clearTimeout(this.thinkTimer);
        // A pause after the student spoke, with no answer yet: the tutor is thinking.
        this.thinkTimer = setTimeout(() => {
          if (!this.player.active && Date.now() - this.lastInputAt >= 700) this.h.onState("thinking");
        }, 800);
      }
      for (const p of sc.modelTurn?.parts ?? []) {
        if (p.inlineData?.data && p.inlineData.mimeType?.startsWith("audio/pcm")) {
          this.player.play(p.inlineData.data);
          this.h.onState("speaking");
        }
      }
      if (sc.outputTranscription?.text) this.h.onCaption({ type: "output", text: sc.outputTranscription.text, at_ms: this.cfg.clock() });
      if (sc.turnComplete) this.h.onCaption({ type: "turn_complete" });
    }
    if (msg.toolCall?.functionCalls?.length) {
      void Promise.all(
        msg.toolCall.functionCalls.map(async (c) => {
          const call = { id: c.id ?? "", name: c.name ?? "", args: c.args ?? {} };
          let response: Record<string, unknown>;
          try {
            response = await this.h.onToolCall(call);
          } catch {
            response = { error: "unavailable" };
          }
          return { id: call.id, name: call.name, response };
        }),
      ).then((functionResponses) => this.send({ toolResponse: { functionResponses } }));
    }
    if (msg.goAway !== undefined) {
      // The server will close soon: reconnect now with a fresh token.
      this.goingAway = true;
      this.ws?.close(1000);
    }
  }

  setMuted(muted: boolean) {
    if (this.mic) this.mic.muted = muted;
  }

  private release() {
    if (this.thinkTimer) clearTimeout(this.thinkTimer);
    this.mic?.stop();
    this.mic = null;
    this.player.close();
  }

  close() {
    this.ending = true;
    this.release();
    this.ws?.close(1000);
    this.ws = null;
  }
}

/**
 * The fake provider (`provider: "fake"`): no audio leaves the browser. It plays a short scripted
 * exchange of labelled fixture captions so the live screen, captions, timer and end flow can be
 * built and tested without a model. The mic still drives the level ring.
 */
export class FakeVoiceSession implements VoiceSession {
  private timers: ReturnType<typeof setTimeout>[] = [];
  private mic: MicCapture | null = null;
  private muted = false;
  private closed = false;

  constructor(
    private readonly cfg: Pick<VoiceSessionConfig, "stream" | "clock">,
    private readonly h: VoiceSessionHandlers,
    private readonly script = FAKE_SCRIPT,
  ) {}

  async connect(): Promise<void> {
    await new Promise((r) => setTimeout(r, 300));
    try {
      this.mic = new MicCapture(this.cfg.stream, () => undefined, (l) => this.h.onLevel(this.muted ? 0 : l));
      await this.mic.start();
    } catch {
      this.mic = null; // no worklet (old browser or test): captions still play
    }
    this.h.onOpen();
    this.h.onState("listening");
    let at = 0;
    for (const step of this.script) {
      at += step.afterMs;
      this.timers.push(
        setTimeout(() => {
          if (this.closed) return;
          if (step.state) this.h.onState(step.state);
          if (step.caption) this.h.onCaption({ ...step.caption, at_ms: this.cfg.clock() } as CaptionEvent);
          if (step.turnComplete) this.h.onCaption({ type: "turn_complete" });
        }, at),
      );
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
  }

  close() {
    this.closed = true;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.mic?.stop();
    this.mic = null;
    this.h.onClose("normal");
  }

  /** Test hook: the socket dropped. */
  drop() {
    this.closed = true;
    this.timers.forEach(clearTimeout);
    this.mic?.stop();
    this.h.onClose("dropped");
  }
}

interface ScriptStep {
  afterMs: number;
  state?: PetState;
  caption?: { type: "input" | "output"; text: string };
  turnComplete?: boolean;
}

const FAKE_SCRIPT: ScriptStep[] = [
  { afterMs: 600, state: "speaking", caption: { type: "output", text: "Fixture tutor greeting." } },
  { afterMs: 1400, state: "listening", turnComplete: true },
  { afterMs: 1200, caption: { type: "input", text: "Fixture student question." } },
  { afterMs: 900, state: "thinking", turnComplete: true },
  { afterMs: 900, state: "speaking", caption: { type: "output", text: "Fixture tutor answer, part one." } },
  { afterMs: 1200, caption: { type: "output", text: "Part two." } },
  { afterMs: 1000, state: "listening", turnComplete: true },
];
