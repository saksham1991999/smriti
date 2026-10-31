import { describe, expect, it } from "vitest";
import { parseFrame, readEvents, type TutorEvent } from "../src/lib/tutor";

const stream = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const x of chunks) c.enqueue(enc.encode(x));
      c.close();
    },
  });

describe("tutor stream", () => {
  it("parses the server's SSE frames", () => {
    expect(parseFrame('event: delta\ndata: {"text": "Hi"}')).toEqual({ type: "delta", text: "Hi" });
    expect(parseFrame('event: quota\ndata: {"unlimited": false, "limit": 5, "used": 1, "remaining": 4}')).toEqual({
      type: "quota",
      quota: { unlimited: false, limit: 5, used: 1, remaining: 4 },
    });
    expect(parseFrame('event: quota_exhausted\ndata: {"limit": 5, "remaining": 0, "used": 5, "unlimited": false, "tier": "free", "paywall_trigger": null}')).toMatchObject({
      type: "quota_exhausted",
      tier: "free",
      paywall_trigger: null,
      quota: { remaining: 0 },
    });
    expect(parseFrame('event: safety\ndata: {"kind": "crisis", "helplines": []}')).toEqual({ type: "safety", kind: "crisis", helplines: [] });
    expect(parseFrame("event: ping\ndata: {}")).toBeNull();
    expect(parseFrame("event: delta\ndata: not json")).toBeNull();
  });

  it("joins frames split across chunks", async () => {
    const seen: TutorEvent[] = [];
    await readEvents(stream(['event: delta\ndata: {"te', 'xt": "a"}\n\nevent: delta\r\ndata: {"text": "b"}\r\n\r\nevent: done\ndata: {"user_message_id": "u"}']), (e) => seen.push(e));
    expect(seen).toEqual([
      { type: "delta", text: "a" },
      { type: "delta", text: "b" },
      { type: "done", user_message_id: "u" },
    ]);
  });
});
