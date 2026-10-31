import { describe, expect, it } from "vitest";
import { scrubBreadcrumb, scrubEvent, scrubUrl, tracesSampleRate } from "../src/lib/sentry";

describe("Sentry scrubbing", () => {
  it("drops queries and masks guardian codes and emails in URLs", () => {
    expect(scrubUrl("https://app.example/learn?x=1#y")).toBe("https://app.example/learn");
    expect(scrubUrl("https://app.example/guardian/AB12CD")).toBe("https://app.example/guardian/[code]");
    expect(scrubUrl("https://app.example/guardian/ask")).toBe("https://app.example/guardian/ask");
    expect(scrubUrl("/u/kid@example.com")).toBe("/u/[email]");
  });

  it("keeps only the page URL and the internal user id", () => {
    const out = scrubEvent({
      request: {
        url: "https://app.example/guardian/AB12CD?ref=mail",
        headers: { Authorization: "Bearer t" },
        cookies: "sb=1",
        data: { email: "kid@example.com" },
        query_string: "ref=mail",
      },
      user: { id: "u-1", email: "kid@example.com", ip_address: "{{auto}}" },
    });
    expect(out).toEqual({ request: { url: "https://app.example/guardian/[code]" }, user: { id: "u-1" } });
    expect(scrubEvent({ user: { email: "kid@example.com" } }).user).toEqual({});
  });

  it("drops console and input breadcrumbs and strips network data", () => {
    expect(scrubBreadcrumb({ category: "console", message: "kid@example.com" })).toBeNull();
    expect(scrubBreadcrumb({ category: "ui.input" })).toBeNull();
    expect(
      scrubBreadcrumb({
        category: "fetch",
        data: { url: "https://api.example/v1/me?token=x", method: "GET", status_code: 200, request_body_size: 9 },
      }),
    ).toEqual({ category: "fetch", data: { url: "https://api.example/v1/me", method: "GET", status_code: 200 } });
    expect(
      scrubBreadcrumb({ category: "navigation", data: { from: "/guardian/AB12CD", to: "/learn?q=1" } }),
    ).toEqual({ category: "navigation", data: { from: "/guardian/[code]", to: "/learn" } });
  });

  it("samples traces lightly only in production", () => {
    expect(tracesSampleRate("production")).toBe(0.1);
    expect(tracesSampleRate("staging")).toBe(1);
  });
});
