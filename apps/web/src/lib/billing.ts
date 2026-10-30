/**
 * Web billing behind one interface (TRD §11). `FakeBilling` drives the API's fake checkout so the
 * whole paywall → Pro path runs locally; `RazorpayBilling` is the real one, enabled by
 * VITE_BILLING_PROVIDER=razorpay once the Razorpay account and keys exist. Neither ever sees card
 * or UPI details: Razorpay Checkout collects them in its own frame.
 */
import type { ClientEnv } from "@smriti/config";
import type { EntitlementSection } from "@smriti/app-core";
import type { Api } from "./api";
import type { CheckoutSession, IntroEligibility } from "./contentTypes";

export type CheckoutOutcome = { status: "active"; entitlement: EntitlementSection } | { status: "failed" } | { status: "cancelled" } | { status: "pending" };

export interface BillingProvider {
  readonly id: "fake" | "razorpay";
  eligibility(): Promise<IntroEligibility>;
  /** Creates the order or subscription on the server. */
  start(): Promise<CheckoutSession>;
  /** Hands over to the payment UI and resolves when the server has the result. */
  pay(session: CheckoutSession, opts?: { simulate?: "success" | "failure" }): Promise<CheckoutOutcome>;
  cancel(): Promise<EntitlementSection>;
}

export class FakeBilling implements BillingProvider {
  readonly id = "fake" as const;
  constructor(private readonly api: Api) {}
  eligibility() {
    return this.api.get<IntroEligibility>("/v1/billing/intro-eligibility");
  }
  start() {
    return this.api.post<CheckoutSession>("/v1/billing/checkout", { plan: "pro_monthly" });
  }
  async pay(session: CheckoutSession, opts?: { simulate?: "success" | "failure" }): Promise<CheckoutOutcome> {
    const r = await this.api.post<{ status: string; entitlement?: EntitlementSection }>("/v1/billing/fake/complete", {
      checkout_id: session.checkout_id,
      outcome: opts?.simulate ?? "success",
    });
    return r.status === "active" && r.entitlement ? { status: "active", entitlement: r.entitlement } : { status: "failed" };
  }
  async cancel() {
    return (await this.api.post<{ entitlement: EntitlementSection }>("/v1/billing/cancel")).entitlement;
  }
}

/** Razorpay Checkout with UPI Autopay. Not wired yet: needs VITE_RAZORPAY_KEY_ID and the API's /v1/billing routes. */
export class RazorpayBilling implements BillingProvider {
  readonly id = "razorpay" as const;
  constructor(private readonly api: Api) {}
  eligibility() {
    return this.api.get<IntroEligibility>("/v1/billing/intro-eligibility");
  }
  start() {
    return this.api.post<CheckoutSession>("/v1/billing/checkout", { plan: "pro_monthly" });
  }
  async pay(): Promise<CheckoutOutcome> {
    // Loads https://checkout.razorpay.com/v1/checkout.js and opens it with the subscription id;
    // the API's webhook grants Pro, and the app polls /v1/sync/state (PAY-08).
    throw new Error("razorpay_not_configured");
  }
  async cancel() {
    return (await this.api.post<{ entitlement: EntitlementSection }>("/v1/billing/cancel")).entitlement;
  }
}

export function createBillingProvider(env: ClientEnv, api: Api): BillingProvider {
  const wanted = (import.meta.env.VITE_BILLING_PROVIDER as string | undefined) ?? "fake";
  if (wanted === "razorpay" && env.APP_ENV !== "local" && env.APP_ENV !== "test") return new RazorpayBilling(api);
  return new FakeBilling(api);
}
