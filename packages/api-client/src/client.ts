import createClient, { type Client, type Middleware } from "openapi-fetch";

import type { components, paths } from "./schema";

export type Schemas = components["schemas"];

/** RFC 7807 problem details, as every API error is returned (`application/problem+json`). */
export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string | null;
  instance?: string | null;
  /** Extra fields some errors carry, such as `reason` on `login_required`. */
  [key: string]: unknown;
}

/** An API error with the problem's stable `code` (for example `login_required`, `not_enough_gems`). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly problem: Problem;

  constructor(problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = "ApiError";
    this.status = problem.status;
    this.code = problem.code;
    this.problem = problem;
  }

  static from(response: Response, body: unknown): ApiError {
    if (isProblem(body)) return new ApiError(body);
    return new ApiError({
      type: "http_error",
      title: response.statusText || "Request failed",
      status: response.status,
      code: response.status === 0 ? "network_error" : `http_${response.status}`,
      detail: typeof body === "string" && body.length < 500 ? body : null,
    });
  }
}

function isProblem(value: unknown): value is Problem {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Problem).code === "string" &&
    typeof (value as Problem).status === "number"
  );
}

type MaybePromise<T> = T | Promise<T>;

export interface ApiClientOptions {
  /** API origin, for example `http://127.0.0.1:8000` locally. Paths already start with `/v1`. */
  baseUrl: string;
  /** The current Supabase (or dev auth) access token, if signed in. */
  getAccessToken?: () => MaybePromise<string | null | undefined>;
  /** `jee`, `neet`, `all`, …: sent as `X-App-Variant`. */
  appVariant?: string;
  /** A stable per-install id, sent as `X-Device-Id`. */
  deviceId?: string | (() => string | null | undefined);
  platform?: "ios" | "android" | "web";
  appVersion?: string;
  fetch?: typeof globalThis.fetch;
  /** Called on every 401, for example to refresh the session. */
  onUnauthorized?: (error: ApiError) => void;
}

export type ApiClient = Client<paths> & {
  /** The options the client was built with. */
  readonly options: ApiClientOptions;
};

/** A typed client for the Smriti API. Use with {@link unwrap}:
 *
 * ```ts
 * const api = createApiClient({ baseUrl, getAccessToken, appVariant: 'jee', deviceId });
 * const config = await unwrap(api.GET('/v1/config', { params: { query: { variant: 'jee' } } }));
 * ```
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const client = createClient<paths>({
    baseUrl: options.baseUrl.replace(/\/+$/, ""),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const headers: Middleware = {
    async onRequest({ request }) {
      const token = await options.getAccessToken?.();
      if (token && !request.headers.has("Authorization")) {
        request.headers.set("Authorization", `Bearer ${token}`);
      }
      const device = typeof options.deviceId === "function" ? options.deviceId() : options.deviceId;
      if (device) request.headers.set("X-Device-Id", device);
      if (options.appVariant) request.headers.set("X-App-Variant", options.appVariant);
      if (options.platform) request.headers.set("X-Platform", options.platform);
      if (options.appVersion) request.headers.set("X-App-Version", options.appVersion);
      return request;
    },
  };
  client.use(headers);
  return Object.assign(client, { options });
}

interface FetchResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/** Returns the response body, or throws an {@link ApiError} built from the problem details. */
export async function unwrap<T>(pending: Promise<FetchResult<T>>, client?: ApiClient): Promise<T> {
  const { data, error, response } = await pending;
  if (response.ok) return data as T;
  const err = ApiError.from(response, error);
  if (response.status === 401) client?.options.onUnauthorized?.(err);
  throw err;
}

/** A fresh `Idempotency-Key` for a mutation that touches progress or money (AGENTS.md "API"). */
export function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}
