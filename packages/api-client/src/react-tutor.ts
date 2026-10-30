/**
 * The AI tutor (docs/flows/tutor-social.md AI-02, AI-09). Answers stream as server-sent events;
 * `onEvent` sees each one as it arrives (with `expo/fetch` or a browser fetch) or all at once at
 * the end (React Native's built-in fetch). The mutation resolves with every event and the text.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap, type ApiClient, type Schemas } from "./client";
import { invalidate, queryKeys, useApiClient } from "./react-core";
import {
  streamTutorAskCard,
  streamTutorAskQuestion,
  streamTutorMessage,
  tutorAnswerText,
  type TutorStreamEvent,
} from "./sse";

export interface TutorReply {
  events: TutorStreamEvent[];
  /** The answer after every `delta` and `replace`. */
  text: string;
}

export interface TutorStreamOptions {
  onEvent?: (event: TutorStreamEvent, textSoFar: string) => void;
  signal?: AbortSignal;
}

/** Drains a tutor stream, reporting each event. */
export async function collectTutorReply(
  stream: AsyncGenerator<TutorStreamEvent>,
  onEvent?: TutorStreamOptions["onEvent"],
): Promise<TutorReply> {
  const events: TutorStreamEvent[] = [];
  for await (const e of stream) {
    events.push(e);
    onEvent?.(e, tutorAnswerText(events));
  }
  return { events, text: tutorAnswerText(events) };
}

export function useTutorSessions(limit = 20) {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.tutorSessions(),
    queryFn: () => unwrap(api.GET("/v1/tutor/sessions", { params: { query: { limit } } }), api),
  });
}

export function useTutorSession(sessionId: string | undefined) {
  const api = useApiClient();
  return useQuery({
    queryKey: queryKeys.tutorSession(sessionId ?? ""),
    queryFn: () =>
      unwrap(
        api.GET("/v1/tutor/sessions/{session_id}", {
          params: { path: { session_id: sessionId ?? "" } },
        }),
        api,
      ),
    enabled: Boolean(sessionId),
  });
}

/** Opens a chat; a chat on the same context from the last 30 minutes reopens. */
export function useOpenTutorSession() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["smriti_api__schemas__tutor__SessionCreate"]) =>
      unwrap(api.POST("/v1/tutor/sessions", { body }), api),
    onSuccess: (session) => {
      qc.setQueryData(queryKeys.tutorSession(session.id), session);
      return invalidate(qc, queryKeys.tutorSessions());
    },
  });
}

export function useDeleteTutorSession() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      unwrap(
        api.DELETE("/v1/tutor/sessions/{session_id}", {
          params: { path: { session_id: sessionId } },
        }),
        api,
      ),
    onSuccess: (_data, sessionId) => {
      qc.removeQueries({ queryKey: queryKeys.tutorSession(sessionId) });
      return invalidate(qc, queryKeys.tutorSessions());
    },
  });
}

function useTutorStream<B>(
  start: (api: ApiClient, body: B, signal?: AbortSignal) => AsyncGenerator<TutorStreamEvent>,
  options: TutorStreamOptions,
  afterKeys: (body: B) => ReadonlyArray<readonly unknown[]>,
) {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: B) => collectTutorReply(start(api, body, options.signal), options.onEvent),
    onSuccess: (_reply, body) =>
      invalidate(qc, queryKeys.practiceLimits(), queryKeys.tutorSessions(), ...afterKeys(body)),
  });
}

/** Sends a chat message; `client_message_id` makes a retry safe. */
export function useSendTutorMessage(sessionId: string, options: TutorStreamOptions = {}) {
  return useTutorStream<Schemas["MessageIn"]>(
    (api, body, signal) => streamTutorMessage(api, sessionId, body, signal),
    options,
    () => [queryKeys.tutorSession(sessionId)],
  );
}

/** "Ask about this card" from a lesson card. */
export function useAskTutorAboutCard(options: TutorStreamOptions = {}) {
  return useTutorStream<Schemas["AskCard"]>(streamTutorAskCard, options, () => []);
}

/** "Ask about this question" from practice or a mock solution. */
export function useAskTutorAboutQuestion(options: TutorStreamOptions = {}) {
  return useTutorStream<Schemas["AskQuestion"]>(streamTutorAskQuestion, options, () => []);
}

export function useTutorFeedback() {
  const api = useApiClient();
  return useMutation({
    mutationFn: (input: { messageId: string; body: Schemas["FeedbackIn"] }) =>
      unwrap(
        api.POST("/v1/tutor/messages/{message_id}/feedback", {
          body: input.body,
          params: { path: { message_id: input.messageId } },
        }),
        api,
      ),
  });
}
