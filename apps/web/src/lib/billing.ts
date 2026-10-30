/**
 * Web billing behind one interface (TRD §11, me-money §5).
 *
 * - `RazorpayBilling` talks to apps/api's `/v1/billing/*` through @smriti/api-client: it creates
 *   the subscription, opens Razorpay Checkout (UPI Autopay, card, netbanking) in Razorpay's own
 *   frame, sends the handler's signature to `/verify`, then waits for the webhook to turn Pro on
 *   (PAY-08 polls `/v1/billing/entitlement`). In local mode the API runs FakeRazorpay: its key id
 *   is `rzp_test_fake`, so instead of loading Checkout the app shows a test approve step and
 *   waits for the webhook, which the e2e (or `scripts/fake-razorpay.mjs`) sends as Razorpay would.
 * - `FakeBilling` drives the in-process fake API's checkout, for unit tests and the hermetic e2e.
 *
 * Neither ever sees card or UPI details, and prices always come from the server.
 */
import { newIdempotencyKey, unwrap, type ApiClient } from "@smriti/api-client";
import type { EntitlementSection } from "@smriti/app-core";
import type { Api } from "./api";

export interface Eligibility {
  /** null for a guest: only the hint is known until sign-in. */
  eligible: boolean | null;
  eligibleHint: boolean;
  introPricePaise: number | null;
  pricePaise: number | null;
}

export interface CheckoutSession {
  id: string;
  keyId: string;
  intro: boolean;
  amountTodayPaise: number;
  thenPaise: number;
  productId: string;
  /** The local FakeRazorpay: show the test approve step instead of Razorpay Checkout. */
  testMode: boolean;
}

export type CheckoutOutcome = { status: "active"; entitlement: EntitlementSection } | { status: "failed"; code: string } | { status: "cancelled" } | { status: "pending" };

export interface PayOptions {
  /** Test mode only: what the test approve step chose. */
  simulate?: "success" | "failure";
  /** How long PAY-08 waits for the webhook before showing "check again". */
  waitMs?: number;
}

export interface BillingProvider {
  readonly id: "fake" | "razorpay";
  eligibility(): Promise<Eligibility>;
  start(payer?: "self" | "guardian_declared"): Promise<CheckoutSession>;
  pay(session: CheckoutSession, opts?: PayOptions): Promise<CheckoutOutcome>;
  /** PAY-08 "I've approved it, check again". */
  checkAgain(): Promise<CheckoutOutcome>;
  cancel(): Promise<EntitlementSection>;
}

const idem = () => ({ header: { "Idempotency-Key": newIdempotencyKey() } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toEntitlement(e: { plan: "free" | "pro"; pro_until: string | null; status?: string | null; grace_until?: string | null; cancel_at_period_end?: boolean; is_intro?: boolean; source?: string | null }): EntitlementSection {
  return {
    plan: e.plan,
    pro_until: e.pro_until,
    status: (e.status ?? undefined) as EntitlementSection["status"],
    grace_until: e.grace_until ?? null,
    cancel_at_period_end: e.cancel_at_period_end ?? false,
    is_intro: e.is_intro ?? false,
    source: (e.source ?? null) as EntitlementSection["source"],
  };
}

interface RazorpayHandlerResponse {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
}
interface RazorpayCheckout {
  open(): void;
}
type RazorpayCtor = new (opts: Record<string, unknown>) => RazorpayCheckout;

/** Razorpay's script, loaded only when a real checkout opens. */
function loadCheckout(): Promise<RazorpayCtor> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => (w.Razorpay ? resolve(w.Razorpay) : reject(new Error("razorpay_unavailable")));
    s.onerror = () => reject(new Error("razorpay_unavailable"));
    document.head.appendChild(s);
  });
}

export class RazorpayBilling implements BillingProvider {
  readonly id = "razorpay" as const;
  constructor(private readonly client: ApiClient) {}

  async eligibility(): Promise<Eligibility> {
    const r = await unwrap(this.client.GET("/v1/billing/intro-eligibility", {}), this.client);
    return { eligible: r.eligible, eligibleHint: r.eligible_hint, introPricePaise: r.intro_price_paise ?? null, pricePaise: r.price_paise ?? null };
  }

  async start(payer: "self" | "guardian_declared" = "self", plan: "monthly" | "yearly" = "monthly"): Promise<CheckoutSession> {
    const r = await unwrap(this.client.POST("/v1/billing/razorpay/subscription", { body: { payer, plan }, params: idem() }), this.client);
    return {
      id: r.subscription_id,
      keyId: r.key_id,
      intro: r.intro,
      amountTodayPaise: r.amount_today_paise,
      thenPaise: r.then_paise,
      productId: r.product_id,
      testMode: r.key_id === "rzp_test_fake",
    };
  }

  async pay(session: CheckoutSession, opts: PayOptions = {}): Promise<CheckoutOutcome> {
    if (session.testMode) {
      if (opts.simulate === "failure") return { status: "failed", code: "declined" };
      return this.waitForPro(opts.waitMs ?? 60_000);
    }
    const Razorpay = await loadCheckout();
    const handled = await new Promise<RazorpayHandlerResponse | null>((resolve) => {
      new Razorpay({
        key: session.keyId,
        subscription_id: session.id,
        name: "Pro",
        handler: (resp: RazorpayHandlerResponse) => resolve(resp),
        modal: { ondismiss: () => resolve(null) },
      }).open();
    });
    if (!handled) return { status: "cancelled" };
    await unwrap(this.client.POST("/v1/billing/razorpay/verify", { body: handled, params: idem() }), this.client);
    return this.waitForPro(opts.waitMs ?? 60_000);
  }

  checkAgain(): Promise<CheckoutOutcome> {
    return this.waitForPro(10_000);
  }

  /** Pro follows Razorpay's webhook; the app polls the entitlement meanwhile (PAY-08). */
  private async waitForPro(waitMs: number): Promise<CheckoutOutcome> {
    const until = Date.now() + waitMs;
    for (;;) {
      const e = await unwrap(this.client.GET("/v1/billing/entitlement", {}), this.client).catch(() => null);
      if (e && e.plan === "pro") return { status: "active", entitlement: toEntitlement(e) };
      if (Date.now() > until) return { status: "pending" };
      await sleep(1500);
    }
  }

  async cancel(): Promise<EntitlementSection> {
    return toEntitlement(await unwrap(this.client.POST("/v1/billing/razorpay/cancel", { body: {}, params: idem() }), this.client));
  }
}

/** The in-process fake API's checkout (src/dev/fake-api): unit tests and the hermetic e2e only. */
export class FakeBilling implements BillingProvider {
  readonly id = "fake" as const;
  constructor(private readonly api: Api) {}
  async eligibility(): Promise<Eligibility> {
    const r = await this.api.get<{ eligible: boolean; intro_price_paise: number; price_paise: number }>("/v1/billing/intro-eligibility");
    return { eligible: r.eligible, eligibleHint: r.eligible, introPricePaise: r.intro_price_paise, pricePaise: r.price_paise };
  }
  async start(): Promise<CheckoutSession> {
    const r = await this.api.post<{ checkout_id: string; amount_paise: number; intro: boolean }>("/v1/billing/checkout", { plan: "pro_monthly" });
    return { id: r.checkout_id, keyId: "fake", intro: r.intro, amountTodayPaise: r.amount_paise, thenPaise: r.amount_paise, productId: "pro_monthly_web", testMode: true };
  }
  async pay(session: CheckoutSession, opts: PayOptions = {}): Promise<CheckoutOutcome> {
    const r = await this.api.post<{ status: string; entitlement?: EntitlementSection }>("/v1/billing/fake/complete", {
      checkout_id: session.id,
      outcome: opts.simulate ?? "success",
    });
    return r.status === "active" && r.entitlement ? { status: "active", entitlement: r.entitlement } : { status: "failed", code: "declined" };
  }
  async checkAgain(): Promise<CheckoutOutcome> {
    return { status: "pending" };
  }
  async cancel() {
    return (await this.api.post<{ entitlement: EntitlementSection }>("/v1/billing/cancel")).entitlement;
  }
}

/** The in-process fake API gets FakeBilling; every real API (local, staging, production) gets Razorpay. */
export function createBillingProvider(opts: { fakeApi: boolean; api: Api; client: ApiClient }): BillingProvider {
  return opts.fakeApi ? new FakeBilling(opts.api) : new RazorpayBilling(opts.client);
}
