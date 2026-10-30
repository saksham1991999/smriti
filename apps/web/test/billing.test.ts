import { describe, expect, it } from "vitest";
import { createApiClient } from "@smriti/api-client";
import { RazorpayBilling } from "../src/lib/billing";

type Handler = (url: URL, init: RequestInit | undefined) => { status?: number; body: unknown };

function client(handler: Handler) {
  const calls: string[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(req.url);
    calls.push(`${req.method} ${url.pathname}`);
    const r = handler(url, init);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { api: createApiClient({ baseUrl: "http://api.test", fetch }), calls };
}

const pro = { plan: "pro", pro_until: "2026-11-30T00:00:00Z", status: "active", grace_until: null, cancel_at_period_end: false, is_intro: true, source: "razorpay" };

describe("RazorpayBilling (the API's /v1/billing routes)", () => {
  it("passes a guest's eligibility hint through and never invents a price", async () => {
    const { api } = client(() => ({ body: { eligible: null, eligible_hint: true, reason: "guest", intro_price_paise: 100, price_paise: 9900 } }));
    expect(await new RazorpayBilling(api).eligibility()).toEqual({ eligible: null, eligibleHint: true, introPricePaise: 100, pricePaise: 9900 });
  });

  it("recognises the local FakeRazorpay and waits for the webhook's Pro", async () => {
    let polls = 0;
    const { api, calls } = client((url) => {
      if (url.pathname === "/v1/billing/razorpay/subscription")
        return { body: { subscription_id: "sub_fake1", key_id: "rzp_test_fake", product_id: "pro_monthly_intro_web", intro: true, amount_today_paise: 100, then_paise: 9900 } };
      if (url.pathname === "/v1/billing/entitlement") {
        polls += 1;
        return { body: polls < 2 ? { ...pro, plan: "free", pro_until: null, status: "pending" } : pro };
      }
      return { status: 404, body: { code: "not_found" } };
    });
    const billing = new RazorpayBilling(api);
    const session = await billing.start();
    expect(session).toMatchObject({ id: "sub_fake1", testMode: true, intro: true, amountTodayPaise: 100 });
    const outcome = await billing.pay(session, { waitMs: 5_000 });
    expect(outcome.status).toBe("active");
    expect(calls.filter((c) => c === "GET /v1/billing/entitlement").length).toBe(2);
  }, 10_000);

  it("reports a declined test payment as failed without polling", async () => {
    const { api, calls } = client(() => ({ body: {} }));
    const out = await new RazorpayBilling(api).pay({ id: "s", keyId: "rzp_test_fake", intro: false, amountTodayPaise: 9900, thenPaise: 9900, productId: "p", testMode: true }, { simulate: "failure" });
    expect(out).toEqual({ status: "failed", code: "declined" });
    expect(calls).toEqual([]);
  });

  it("returns pending when the webhook has not arrived in time", async () => {
    const { api } = client(() => ({ body: { ...pro, plan: "free", pro_until: null } }));
    const out = await new RazorpayBilling(api).pay({ id: "s", keyId: "rzp_test_fake", intro: true, amountTodayPaise: 100, thenPaise: 9900, productId: "p", testMode: true }, { waitMs: 0 });
    expect(out.status).toBe("pending");
  });
});
