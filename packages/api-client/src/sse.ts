/**
 * Server-sent events from the tutor endpoints (`text/event-stream`, apps/api routes/tutor.py).
 *
 * Works on any fetch: when the response body is a stream (browsers, Node, `expo/fetch`) events
 * arrive as the server writes them; when it isn't (React Native's built-in fetch), the body is
 * read once it closes and the same events are delivered in order.
 */
import { ApiError, type ApiClient, type Schemas } from "./client";

export interface SseEvent {
  /** `event:` field, `message` when absent. */
  event: string;
  /** `data:` lines joined with "\n". */
  data: string;
  id?: string;
}

/** An incremental SSE parser: feed text chunks, get whole events. */
export function createSseParser(onEvent: (e: SseEvent) => void) {
  let buffer = "";
  let event = "message";
  let data: string[] = [];
  let id: string | undefined;
  const dispatch = () => {
    if (data.length) onEvent({ event, data: data.join("\n"), ...(id !== undefined ? { id } : {}) });
    event = "message";
    data = [];
    id = undefined;
  };
  const line = (l: string) => {
    if (l === "") return dispatch();
    if (l.startsWith(":")) return; // comment / keep-alive
    const colon = l.indexOf(":");
    const field = colon === -1 ? l : l.slice(0, colon);
    let value = colon === -1 ? "" : l.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value || "message";
    else if (field === "data") data.push(value);
    else if (field === "id") id = value;
  };
  return {
    push(chunk: string) {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.search(/\r\n|\r|\n/)) !== -1) {
        const crlf = buffer[nl] === "\r" && buffer[nl + 1] === "\n";
        line(buffer.slice(0, nl));
        buffer = buffer.slice(nl + (crlf ? 2 : 1));
      }
    },
    /** End of stream: a last event without its blank line is still delivered. */
    end() {
      if (buffer) line(buffer);
      buffer = "";
      dispatch();
    },
  };
}

/** Reads a `text/event-stream` response as events, streaming when the body is a stream. */
export async function* readSse(response: Response, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  const queue: SseEvent[] = [];
  const parser = createSseParser((e) => queue.push(e));
  const body = response.body as ReadableStream<Uint8Array> | null;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        if (signal?.aborted) throw signal.reason ?? new Error("aborted");
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
        while (queue.length) yield queue.shift() as SseEvent;
      }
      parser.push(decoder.decode());
    } finally {
      reader.releaseLock?.();
    }
  } else {
    parser.push(await response.text());
  }
  parser.end();
  while (queue.length) yield queue.shift() as SseEvent;
}

/**
 * A helpline the server sends with a crisis `safety` event (AI-08). It comes from owner config
 * (`safety.helplines`), never from app code; `name` and `number` are always present.
 */
export interface TutorHelpline {
  name: string;
  number: string;
  [field: string]: string;
}

/** One tutor stream event (AI-02), typed. Unknown events are skipped. */
export type TutorStreamEvent =
  | { type: "delta"; text: string }
  | { type: "replace"; text: string }
  | {
      type: "safety";
      /** crisis, refusal, redirect, pii_removed, ... */
      kind: string;
      /** Only on `crisis`: the helplines to show, in the learner's language. */
      helplines: TutorHelpline[];
      /** Back-to-study chips on a refusal. */
      chips: string[];
      category?: string;
    }
  | { type: "citations"; items: unknown[] }
  | { type: "chips"; items: unknown[] }
  | { type: "quota"; quota: Schemas["QuotaOut"] }
  | { type: "quota_exhausted"; data: Record<string, unknown> }
  | { type: "error"; code: string; retry: boolean }
  | { type: "done"; data: Record<string, unknown> };

export function toTutorEvent(e: SseEvent): TutorStreamEvent | null {
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = e.data ? JSON.parse(e.data) : {};
    payload =
      typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return null;
  }
  const str = (k: string) => (typeof payload[k] === "string" ? (payload[k] as string) : "");
  const list = (k: string) => (Array.isArray(payload[k]) ? (payload[k] as unknown[]) : []);
  switch (e.event) {
    case "delta":
    case "replace":
      return { type: e.event, text: str("text") };
    case "safety": {
      const helplines = list("helplines").filter(
        (h): h is TutorHelpline =>
          typeof h === "object" &&
          h !== null &&
          typeof (h as Record<string, unknown>).name === "string" &&
          typeof (h as Record<string, unknown>).number === "string",
      );
      const chips = list("chips").filter((c): c is string => typeof c === "string");
      const category = str("category");
      return {
        type: "safety",
        kind: str("kind"),
        helplines,
        chips,
        ...(category ? { category } : {}),
      };
    }
    case "citations":
    case "chips":
      return { type: e.event, items: list("items") };
    case "quota":
      return { type: "quota", quota: payload as unknown as Schemas["QuotaOut"] };
    case "quota_exhausted":
      return { type: "quota_exhausted", data: payload };
    case "error":
      return { type: "error", code: str("code") || "error", retry: payload.retry === true };
    case "done":
      return { type: "done", data: payload };
    default:
      return null;
  }
}

/** The answer so far: `delta` appends, `replace` starts over (a safety rewrite). */
export function tutorAnswerText(events: readonly TutorStreamEvent[]): string {
  let text = "";
  for (const e of events) {
    if (e.type === "delta") text += e.text;
    else if (e.type === "replace") text = e.text;
  }
  return text;
}

interface StreamResult {
  error?: unknown;
  response: Response;
}

/** Per-call options for the tutor streams. */
export interface TutorCallOptions {
  signal?: AbortSignal;
  /**
   * A fetch for this call only, such as `expo/fetch`, whose response body streams on React
   * Native. The client's own middleware (auth, device headers) still runs.
   */
  fetch?: (input: Request) => Promise<Response>;
}

/** Older callers pass a bare AbortSignal. */
function callOptions(options?: AbortSignal | TutorCallOptions): TutorCallOptions {
  if (!options) return {};
  if (typeof (options as AbortSignal).aborted === "boolean" && !("fetch" in options)) {
    return { signal: options as AbortSignal };
  }
  return options as TutorCallOptions;
}

function requestInit(o: TutorCallOptions) {
  return { ...(o.signal ? { signal: o.signal } : {}), ...(o.fetch ? { fetch: o.fetch } : {}) };
}

/** Turns a pending `parseAs: "stream"` call into typed tutor events (throws ApiError on 4xx/5xx). */
export async function* tutorEvents(
  pending: Promise<StreamResult>,
  client?: ApiClient,
  signal?: AbortSignal,
): AsyncGenerator<TutorStreamEvent> {
  const { error, response } = await pending;
  if (!response.ok) {
    const err = ApiError.from(response, error);
    if (response.status === 401) client?.options.onUnauthorized?.(err);
    throw err;
  }
  for await (const e of readSse(response, signal)) {
    const t = toTutorEvent(e);
    if (t) yield t;
  }
}

/** `POST /v1/tutor/sessions/{id}/messages` as a stream of events. */
export function streamTutorMessage(
  api: ApiClient,
  sessionId: string,
  body: Schemas["MessageIn"],
  options?: AbortSignal | TutorCallOptions,
) {
  const o = callOptions(options);
  return tutorEvents(
    api.POST("/v1/tutor/sessions/{session_id}/messages", {
      params: { path: { session_id: sessionId } },
      body,
      parseAs: "stream",
      ...requestInit(o),
    }),
    api,
    o.signal,
  );
}

/** `POST /v1/tutor/ask/card` ("Ask about this card") as a stream of events. */
export function streamTutorAskCard(
  api: ApiClient,
  body: Schemas["AskCard"],
  options?: AbortSignal | TutorCallOptions,
) {
  const o = callOptions(options);
  return tutorEvents(
    api.POST("/v1/tutor/ask/card", { body, parseAs: "stream", ...requestInit(o) }),
    api,
    o.signal,
  );
}

/** `POST /v1/tutor/ask/question` ("Ask about this question") as a stream of events. */
export function streamTutorAskQuestion(
  api: ApiClient,
  body: Schemas["AskQuestion"],
  options?: AbortSignal | TutorCallOptions,
) {
  const o = callOptions(options);
  return tutorEvents(
    api.POST("/v1/tutor/ask/question", { body, parseAs: "stream", ...requestInit(o) }),
    api,
    o.signal,
  );
}
