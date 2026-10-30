import type { Fetch } from "@smriti/app-core";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

export interface Api {
  get<T>(path: string, query?: Record<string, string | string[] | number | undefined>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
}

/** JSON over `/v1` with the session's bearer token. Errors carry the server's `code`, never bodies. */
export function createApi(o: { baseUrl: string; fetch: Fetch; token: () => Promise<string | null>; variant: string }): Api {
  const headers = async () => {
    const token = await o.token();
    return {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-App-Variant": o.variant,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };
  const parse = async <T>(res: Awaited<ReturnType<Fetch>>): Promise<T> => {
    if (!res.ok) {
      let code = `http_${res.status}`;
      try {
        const j = (await res.json()) as { code?: string };
        if (typeof j.code === "string") code = j.code;
      } catch {
        /* not JSON */
      }
      throw new ApiError(res.status, code);
    }
    return (await res.json()) as T;
  };
  return {
    async get(path, query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query ?? {})) {
        if (v === undefined) continue;
        for (const item of Array.isArray(v) ? v : [v]) qs.append(k, String(item));
      }
      const q = qs.toString();
      return parse(await o.fetch(`${o.baseUrl}${path}${q ? `?${q}` : ""}`, { method: "GET", headers: await headers() }));
    },
    async post(path, body) {
      return parse(await o.fetch(`${o.baseUrl}${path}`, { method: "POST", headers: await headers(), body: JSON.stringify(body ?? {}) }));
    },
  };
}
