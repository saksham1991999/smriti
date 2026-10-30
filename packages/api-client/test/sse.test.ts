import { describe, expect, it, vi } from "vitest";

import {
  ApiError,
  createApiClient,
  createSseParser,
  readSse,
  streamTutorMessage,
  toTutorEvent,
  tutorAnswerText,
  type SseEvent,
  type TutorStreamEvent,
} from "../src";
import { collectTutorReply, queryKeys } from "../src/react";

const enc = new TextEncoder();

/** A streamed body that delivers each chunk as a separate read. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

function sseResponse(chunks: string[], status = 200) {
  return new Response(streamOf(chunks), {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/** A response whose body is not a stream (like React Native's built-in fetch). */
function textOnlyResponse(text: string): Response {
  return { ok: true, status: 200, body: null, text: async () => text } as unknown as Response;
}

async function all<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
}

describe("createSseParser", () => {
  it("joins events split across chunk boundaries, CRLF and multi-line data", () => {
    const seen: SseEvent[] = [];
    const p = createSseParser((e) => seen.push(e));
    p.push("event: del");
    p.push('ta\r\ndata: {"text":"Hel');
    p.push('lo"}\r\n\r\n: keep-alive\n\ndata: a\ndata: b\nid: 7\n');
    p.push("\n");
    expect(seen).toEqual([
      { event: "delta", data: '{"text":"Hello"}' },
      { event: "message", data: "a\nb", id: "7" },
    ]);
  });

  it("delivers a last event that has no trailing blank line", () => {
    const seen: SseEvent[] = [];
    const p = createSseParser((e) => seen.push(e));
    p.push('event: done\ndata: {"message_id":"m1"}');
    expect(seen).toEqual([]);
    p.end();
    expect(seen).toEqual([{ event: "done", data: '{"message_id":"m1"}' }]);
  });

  it("ignores events without data", () => {
    const seen: SseEvent[] = [];
    const p = createSseParser((e) => seen.push(e));
    p.push("event: ping\n\n");
    p.end();
    expect(seen).toEqual([]);
  });
});

describe("readSse", () => {
  const wire = ['event: delta\ndata: {"text":"A"}\n\nevent: de', 'lta\ndata: {"text":"B"}\n\n'];

  it("streams from a body reader", async () => {
    const events = await all(readSse(sseResponse(wire)));
    expect(events.map((e) => e.data)).toEqual(['{"text":"A"}', '{"text":"B"}']);
  });

  it("falls back to text() when the body is not a stream", async () => {
    const events = await all(readSse(textOnlyResponse(wire.join(""))));
    expect(events.map((e) => e.event)).toEqual(["delta", "delta"]);
  });

  it("stops when the signal aborts", async () => {
    const ctrl = new AbortController();
    ctrl.abort(new Error("stop"));
    await expect(all(readSse(sseResponse(wire), ctrl.signal))).rejects.toThrow("stop");
  });
});

describe("tutor events", () => {
  it("maps the server events and skips unknown or malformed ones", () => {
    expect(toTutorEvent({ event: "delta", data: '{"text":"x"}' })).toEqual({
      type: "delta",
      text: "x",
    });
    expect(toTutorEvent({ event: "error", data: '{"code":"timeout","retry":true}' })).toEqual({
      type: "error",
      code: "timeout",
      retry: true,
    });
    expect(toTutorEvent({ event: "chips", data: '{"items":[{"id":"c1"}]}' })).toEqual({
      type: "chips",
      items: [{ id: "c1" }],
    });
    expect(toTutorEvent({ event: "mystery", data: "{}" })).toBeNull();
    expect(toTutorEvent({ event: "delta", data: "{not json" })).toBeNull();
  });

  it("builds the answer text, with replace starting over", () => {
    const events: TutorStreamEvent[] = [
      { type: "delta", text: "Hel" },
      { type: "delta", text: "lo" },
      { type: "replace", text: "Safe" },
      { type: "delta", text: " answer" },
    ];
    expect(tutorAnswerText(events)).toBe("Safe answer");
  });
});

describe("streamTutorMessage", () => {
  const body = {
    client_message_id: "00000000-0000-4000-8000-000000000001",
    input: "typed" as const,
    text: "Why?",
  };

  it("posts the message and yields typed events as they stream", async () => {
    const calls: Request[] = [];
    const fetch = vi.fn(async (req: Request) => {
      calls.push(req);
      return sseResponse([
        'event: delta\ndata: {"text":"Because"}\n\n',
        'event: quota\ndata: {"used":1,"limit":5}\n\nevent: done\ndata: {"message_id":"m1"}\n\n',
      ]);
    }) as unknown as typeof globalThis.fetch;
    const api = createApiClient({ baseUrl: "http://api.test", fetch });
    const seen: string[] = [];
    const reply = await collectTutorReply(streamTutorMessage(api, "s1", body), (e, text) =>
      seen.push(`${e.type}:${text}`),
    );
    expect(calls[0]!.url).toBe("http://api.test/v1/tutor/sessions/s1/messages");
    expect(calls[0]!.method).toBe("POST");
    expect(await calls[0]!.json()).toMatchObject({ text: "Why?" });
    expect(reply.text).toBe("Because");
    expect(reply.events.map((e) => e.type)).toEqual(["delta", "quota", "done"]);
    expect(seen).toEqual(["delta:Because", "quota:Because", "done:Because"]);
  });

  it("throws ApiError on an error status and reports a 401", async () => {
    const onUnauthorized = vi.fn();
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: "login_required", title: "Sign in", status: 401 }), {
          status: 401,
          headers: { "Content-Type": "application/problem+json" },
        }),
    ) as unknown as typeof globalThis.fetch;
    const api = createApiClient({ baseUrl: "http://api.test", fetch, onUnauthorized });
    const err = await all(streamTutorMessage(api, "s1", body)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});

describe("queryKeys", () => {
  it("nests per-exam practice, mock and daily keys under their prefixes", () => {
    const starts = (key: readonly unknown[], prefix: readonly unknown[]) =>
      prefix.every((p, i) => key[i] === p);
    expect(starts(queryKeys.practiceHub("jee"), queryKeys.practiceAll())).toBe(true);
    expect(starts(queryKeys.weakSpots(), queryKeys.practiceAll())).toBe(true);
    expect(starts(queryKeys.mocks("neet"), queryKeys.mocksAll())).toBe(true);
    expect(starts(queryKeys.mock("m1"), queryKeys.mocksAll())).toBe(true);
    expect(starts(queryKeys.dailyChallenge("jee"), queryKeys.dailyChallengeAll())).toBe(true);
    expect(starts(queryKeys.report("a1"), queryKeys.attempt("a1"))).toBe(true);
  });
});
