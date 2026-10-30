import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { ApiError, createApiClient, newIdempotencyKey, unwrap, type Schemas } from "../src";
import { queryKeys } from "../src/react";

function json(status: number, body: unknown, type = "application/json") {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": type } });
}

function fakeFetch(respond: (req: Request) => Response) {
  const calls: Request[] = [];
  const fn = vi.fn(async (input: Request) => {
    calls.push(input);
    return respond(input);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

describe("createApiClient", () => {
  it("sends auth, variant, device and platform headers", async () => {
    const { fetch, calls } = fakeFetch(() => json(200, { server_time: "2026-10-30T09:00:00Z" }));
    const api = createApiClient({
      baseUrl: "http://api.test/",
      fetch,
      getAccessToken: async () => "tok-123",
      appVariant: "jee",
      deviceId: () => "device-1",
      platform: "web",
      appVersion: "1.2.3",
    });
    await unwrap(api.GET("/v1/time"), api);
    const req = calls[0]!;
    expect(req.url).toBe("http://api.test/v1/time");
    expect(req.headers.get("Authorization")).toBe("Bearer tok-123");
    expect(req.headers.get("X-App-Variant")).toBe("jee");
    expect(req.headers.get("X-Device-Id")).toBe("device-1");
    expect(req.headers.get("X-Platform")).toBe("web");
    expect(req.headers.get("X-App-Version")).toBe("1.2.3");
  });

  it("leaves Authorization out for a guest without a token", async () => {
    const { fetch, calls } = fakeFetch(() => json(200, {}));
    const api = createApiClient({ baseUrl: "http://api.test", fetch });
    await unwrap(api.GET("/v1/time"));
    expect(calls[0]!.headers.has("Authorization")).toBe(false);
  });

  it("returns typed data", async () => {
    const { fetch } = fakeFetch(() => json(200, { accepted: [], rejected: [], state_version: 4 }));
    const api = createApiClient({ baseUrl: "http://api.test", fetch });
    const result = await unwrap(
      api.POST("/v1/sync/events", {
        body: {
          device_id: "00000000-0000-4000-8000-000000000001",
          events: [
            {
              event_id: "00000000-0000-4000-8000-000000000002",
              type: "lesson_completed",
              occurred_at: "2026-10-30T09:00:00Z",
              tz: "Asia/Kolkata",
              payload: {
                topic_id: "t",
                mode: "deep_dive",
                cards_seen: 1,
                correct: 1,
                total: 1,
                ms_total: 1000,
              },
            },
          ],
        },
      }),
    );
    expectTypeOf(result).toEqualTypeOf<Schemas["SyncEventsResponse"]>();
    expect(result.state_version).toBe(4);
  });

  it("turns problem+json into ApiError with the code and extra fields", async () => {
    const problem = {
      type: "login_required",
      title: "Sign in first",
      status: 401,
      code: "login_required",
      reason: "link",
    };
    const { fetch } = fakeFetch(() => json(401, problem, "application/problem+json"));
    const onUnauthorized = vi.fn();
    const api = createApiClient({ baseUrl: "http://api.test", fetch, onUnauthorized });
    const err = await unwrap(api.POST("/v1/auth/linked", { body: {} }), api).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect([apiErr.status, apiErr.code, apiErr.problem["reason"]]).toEqual([
      401,
      "login_required",
      "link",
    ]);
    expect(onUnauthorized).toHaveBeenCalledWith(apiErr);
  });

  it("wraps a non-problem error body", async () => {
    const { fetch } = fakeFetch(
      () => new Response("bad gateway", { status: 502, statusText: "Bad Gateway" }),
    );
    const api = createApiClient({ baseUrl: "http://api.test", fetch });
    const err = (await unwrap(api.GET("/v1/me")).catch((e: unknown) => e)) as ApiError;
    expect([err.status, err.code]).toEqual([502, "http_502"]);
  });

  it("sends a per-call Idempotency-Key", async () => {
    const { fetch, calls } = fakeFetch(() => json(200, { item_id: "streak_freeze", gems: 50 }));
    const api = createApiClient({ baseUrl: "http://api.test", fetch });
    const key = newIdempotencyKey();
    await unwrap(
      api.POST("/v1/shop/purchase", {
        body: { item_id: "streak_freeze" },
        params: { header: { "Idempotency-Key": key } },
      }),
    );
    expect(calls[0]!.headers.get("Idempotency-Key")).toBe(key);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("generated schema", () => {
  it("covers the sync contract v1.1 and dev auth shape", () => {
    const doc = JSON.parse(readFileSync(join(__dirname, "..", "openapi.json"), "utf8")) as {
      paths: Record<string, unknown>;
      components: {
        schemas: Record<string, { required?: string[]; properties?: Record<string, unknown> }>;
      };
    };
    for (const path of [
      "/v1/sync/events",
      "/v1/sync/state",
      "/v1/config",
      "/v1/dev/auth/refresh",
    ]) {
      expect(doc.paths).toHaveProperty([path]);
    }
    expect(doc.components.schemas["SyncEventIn"]!.required).toContain("tz");
    expect(Object.keys(doc.components.schemas["DevSession"]!.properties ?? {}).sort()).toEqual(
      ["access_token", "expires_at", "expires_in", "refresh_token", "token_type", "user"].sort(),
    );
  });

  it("keys queries under one root so a sign-out can clear them all", () => {
    expect(queryKeys.pet()[0]).toBe(queryKeys.all[0]);
    expect(queryKeys.subjects("jee-main")).toEqual(["smriti", "catalog", "subjects", "jee-main"]);
  });
});
