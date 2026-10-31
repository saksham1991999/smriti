import { describe, expect, it, vi } from "vitest";
import { base64ToPcm16, downsampleToPcm16, pcm16ToBase64, peakLevel } from "../src/screens/phase2/voice/audio";
import { canReconnect, capCause, captionsReduce, endKind, endReasons, minutesLeft, modelPath, timer, transcriptTurns, visibleCaptions, type CaptionLine } from "../src/screens/phase2/voice/logic";
import { FakeVoiceSession, type VoiceSessionHandlers } from "../src/screens/phase2/voice/session";

describe("voice captions (AI-14)", () => {
  it("joins fragments of one speaker and starts a new line on a new speaker", () => {
    let lines: CaptionLine[] = [];
    lines = captionsReduce(lines, { type: "input", text: "What is", at_ms: 10 });
    lines = captionsReduce(lines, { type: "input", text: " force?", at_ms: 20 });
    lines = captionsReduce(lines, { type: "output", text: "Force is a push", at_ms: 30 });
    expect(lines.map((l) => [l.role, l.text, l.open])).toEqual([
      ["student", "What is force?", false],
      ["tutor", "Force is a push", true],
    ]);
  });

  it("ends an interrupted tutor line with an ellipsis and keeps it in the transcript", () => {
    let lines: CaptionLine[] = [];
    lines = captionsReduce(lines, { type: "output", text: "Let me explain the", at_ms: 0 });
    lines = captionsReduce(lines, { type: "interrupted" });
    expect(visibleCaptions(lines)).toEqual([{ role: "tutor", text: "Let me explain the…" }]);
    expect(transcriptTurns(lines)[0]).toMatchObject({ role: "tutor", text: "Let me explain the…" });
  });

  it("shows only the last four lines", () => {
    let lines: CaptionLine[] = [];
    for (let i = 0; i < 6; i++) lines = captionsReduce(lines, { type: i % 2 ? "output" : "input", text: `line ${i}`, at_ms: i });
    expect(visibleCaptions(lines).map((l) => l.text)).toEqual(["line 2", "line 3", "line 4", "line 5"]);
  });
});

describe("voice time and ends", () => {
  it("rounds the time left down to whole minutes", () => {
    expect(minutesLeft(599)).toBe(9);
    expect(minutesLeft(-5)).toBe(0);
    expect(minutesLeft(null)).toBeNull();
    expect(timer(65)).toBe("1:05");
  });

  it("maps causes to the API's end reasons and the analytics values", () => {
    expect(endReasons("phone_call")).toEqual({ api: "phone_call", analytics: "call" });
    expect(endReasons("daily_cap")).toEqual({ api: "daily_cap", analytics: "cap" });
    expect(endReasons("error")).toEqual({ api: "network", analytics: "error" });
    expect(endKind("network")).toBe("dropped");
    expect(endKind("session_cap")).toBe("time_cap");
    expect(endKind("user")).toBe("normal");
  });

  it("ends at the session cap, or the daily cap when that is what's left", () => {
    const quota = { remaining_seconds: 1800 } as never;
    expect(capCause(599, { max_seconds: 600, quota })).toBeNull();
    expect(capCause(600, { max_seconds: 600, quota })).toBe("session_cap");
    expect(capCause(300, { max_seconds: 300, quota: { remaining_seconds: 300 } as never })).toBe("daily_cap");
  });

  it("reconnects only inside the window", () => {
    expect(canReconnect(1000, 30_999, 30)).toBe(true);
    expect(canReconnect(1000, 31_000, 30)).toBe(false);
  });

  it("prefixes the server's model name for the socket", () => {
    expect(modelPath("some-live-model")).toBe("models/some-live-model");
    expect(modelPath("models/x")).toBe("models/x");
  });
});

describe("voice audio", () => {
  it("downsamples 48 kHz floats to 16 kHz PCM16 and round-trips base64", () => {
    const input = new Float32Array(480).fill(0.5);
    const pcm = downsampleToPcm16(input, 48000, 16000);
    expect(pcm.length).toBe(160);
    expect(pcm[0]).toBe(16383);
    expect(Array.from(base64ToPcm16(pcm16ToBase64(pcm)))).toEqual(Array.from(pcm));
    expect(peakLevel(new Float32Array([0, -0.25, 0.1]))).toBe(0.5);
  });
});

describe("FakeVoiceSession", () => {
  it("opens, plays its fixture captions and closes normally", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const h: VoiceSessionHandlers = {
      onOpen: () => events.push("open"),
      onState: (s) => events.push(`state:${s}`),
      onCaption: (e) => events.push(`caption:${e.type}`),
      onLevel: () => undefined,
      onToolCall: async () => ({}),
      onClose: (r) => events.push(`close:${r}`),
    };
    const session = new FakeVoiceSession({ stream: { getTracks: () => [] } as unknown as MediaStream, clock: () => 0 }, h, [{ afterMs: 100, state: "speaking", caption: { type: "output", text: "Fixture line" } }]);
    const connecting = session.connect();
    await vi.advanceTimersByTimeAsync(400);
    await connecting;
    await vi.advanceTimersByTimeAsync(200);
    session.close();
    vi.useRealTimers();
    expect(events).toEqual(["open", "state:listening", "state:speaking", "caption:output", "close:normal"]);
  });
});
