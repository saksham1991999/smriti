import type { Fetch } from '@smriti/app-core';

import type { BillingProvider, Offer, PurchaseResult } from './types';

/** What `/v1/billing/intro-eligibility` says (R38: ₹1 is shown only when the server says so). */
export interface IntroEligibility {
  eligible: boolean | null;
  eligibleHint: boolean;
  introPricePaise: number | null;
  pricePaise: number;
}

/**
 * Dev and test billing: no store, no money. It plays the part of the store and of RevenueCat: a
 * purchase posts a RevenueCat-shaped `INITIAL_PURCHASE` webhook to `/v1/webhooks/revenuecat`
 * with the API's local-only webhook header (`EXPO_PUBLIC_DEV_REVENUECAT_WEBHOOK_AUTH`; the API
 * accepts it only when APP_ENV is local or test). The app then sees Pro arrive through
 * `/v1/sync/state` exactly as it will in production. Prices and the ₹1 intro come from the
 * server (`/v1/billing/intro-eligibility`), never from the app.
 */
export class FakeBilling implements BillingProvider {
  readonly kind = 'fake' as const;
  private userId: string | null = null;
  private lastEligibility: IntroEligibility | null = null;
  /** Tests and the dev "test payment" dialog flip this to simulate the store sheet. */
  nextResult: 'purchase' | 'cancel' | 'pending' | 'fail' = 'purchase';

  constructor(
    private readonly o: {
      fetch: Fetch;
      baseUrl: string;
      platform: 'ios' | 'android' | 'web';
      products: { proMonthlyIntro: string; proMonthly: string };
      introEligibility: () => Promise<IntroEligibility>;
      /** The API's local-only RevenueCat webhook header; without it a purchase fails. */
      devWebhookAuth?: string;
      clock: () => number;
    },
  ) {}

  async identify(userId: string) {
    this.userId = userId;
  }

  async offers(): Promise<Offer[]> {
    const e = await this.o.introEligibility();
    this.lastEligibility = e;
    const intro = (e.eligible ?? e.eligibleHint) && e.introPricePaise !== null;
    return [
      {
        productId: intro ? this.o.products.proMonthlyIntro : this.o.products.proMonthly,
        introPricePaise: intro ? e.introPricePaise : null,
        pricePaise: e.pricePaise,
        period: 'month',
        introEligible: intro,
      },
    ];
  }

  async purchase(productId: string): Promise<PurchaseResult> {
    if (this.nextResult === 'cancel') return { status: 'cancelled' };
    if (this.nextResult === 'pending') return { status: 'pending' };
    if (this.nextResult === 'fail') return { status: 'failed', code: 'store_error' };
    if (!this.userId || !this.o.devWebhookAuth) return { status: 'failed', code: 'not_allowed' };
    const now = this.o.clock();
    const intro = productId === this.o.products.proMonthlyIntro && this.lastEligibility?.eligible === true;
    const txn = `FAKE.${this.userId.replace(/-/g, '').slice(0, 20)}.${now}`;
    const body = {
      api_version: '1.0',
      event: {
        id: `fake-${txn}`,
        type: 'INITIAL_PURCHASE',
        event_timestamp_ms: now,
        app_user_id: this.userId,
        original_app_user_id: this.userId,
        product_id: productId,
        entitlement_ids: ['pro'],
        period_type: intro ? 'INTRO' : 'NORMAL',
        purchased_at_ms: now,
        expiration_at_ms: now + 30 * 86_400_000,
        environment: 'SANDBOX',
        store: this.o.platform === 'ios' ? 'APP_STORE' : 'PLAY_STORE',
        transaction_id: `${txn}..0`,
        original_transaction_id: txn,
        currency: 'INR',
      },
    };
    let res;
    try {
      res = await this.o.fetch(`${this.o.baseUrl}/v1/webhooks/revenuecat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: this.o.devWebhookAuth },
        body: JSON.stringify(body),
      });
    } catch {
      return { status: 'failed', code: 'network' };
    }
    if (!res.ok) return { status: 'failed', code: 'store_error' };
    return { status: 'purchased', productId, transactionId: txn };
  }

  async restore() {
    return { restored: false };
  }

  manageUrl() {
    return 'https://play.google.com/store/account/subscriptions';
  }

  async logOut() {
    this.userId = null;
  }
}

/**
 * RevenueCat (`react-native-purchases`). Not linked in this environment: there is no RevenueCat
 * project or store products yet. To turn it on: add the package, set EXPO_PUBLIC_BILLING=revenuecat
 * and EXPO_PUBLIC_REVENUECAT_APPLE_KEY / EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY (public SDK keys), and
 * implement with `Purchases.configure`, `Purchases.logIn(userId)`, `Purchases.getOfferings()` (the
 * variant's `revenuecatOfferingId`), `Purchases.purchaseStoreProduct` and `restorePurchases`.
 */
export class RevenueCatBilling implements BillingProvider {
  readonly kind = 'revenuecat' as const;
  constructor(private readonly o: { apiKey?: string; offeringId: string }) {}
  private fail(): never {
    throw new Error(this.o.apiKey ? 'revenuecat_module_not_linked' : 'revenuecat_not_configured');
  }
  async identify() {
    this.fail();
  }
  async offers(): Promise<Offer[]> {
    this.fail();
  }
  async purchase(): Promise<PurchaseResult> {
    this.fail();
  }
  async restore(): Promise<{ restored: boolean }> {
    this.fail();
  }
  manageUrl() {
    return 'https://apps.apple.com/account/subscriptions';
  }
  async logOut() {}
}
