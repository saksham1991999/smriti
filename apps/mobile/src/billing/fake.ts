import type { Fetch } from '@smriti/app-core';

import type { BillingProvider, Offer, PurchaseResult } from './types';

/**
 * Dev and test billing: no store, no money. A purchase asks the dev API to record a store
 * purchase for this account (`POST /v1/dev/billing/purchase`, APP_ENV local or test only), which
 * plays the part of RevenueCat's webhook; the app then sees Pro arrive through `/v1/sync/state`
 * exactly as it will in production. Prices come from the variant's products in config (R38:
 * tax-inclusive, ₹1 intro then ₹99), passed in by the caller.
 */
export class FakeBilling implements BillingProvider {
  readonly kind = 'fake' as const;
  private userId: string | null = null;
  /** Tests flip this to simulate a cancelled store sheet. */
  nextResult: 'purchase' | 'cancel' | 'pending' | 'fail' = 'purchase';

  constructor(
    private readonly o: {
      fetch: Fetch;
      baseUrl: string;
      getAccessToken: () => Promise<string | null>;
      products: { proMonthlyIntro: string; proMonthly: string };
      prices: { introPaise: number; monthlyPaise: number };
      introEligible: () => boolean;
    },
  ) {}

  async identify(userId: string) {
    this.userId = userId;
  }

  async offers(): Promise<Offer[]> {
    const eligible = this.o.introEligible();
    return [
      {
        productId: eligible ? this.o.products.proMonthlyIntro : this.o.products.proMonthly,
        introPricePaise: eligible ? this.o.prices.introPaise : null,
        pricePaise: this.o.prices.monthlyPaise,
        period: 'month',
        introEligible: eligible,
      },
    ];
  }

  async purchase(productId: string): Promise<PurchaseResult> {
    if (this.nextResult === 'cancel') return { status: 'cancelled' };
    if (this.nextResult === 'pending') return { status: 'pending' };
    if (this.nextResult === 'fail') return { status: 'failed', code: 'store_error' };
    const token = await this.o.getAccessToken();
    if (!token || !this.userId) return { status: 'failed', code: 'not_allowed' };
    let res;
    try {
      res = await this.o.fetch(`${this.o.baseUrl}/v1/dev/billing/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ product_id: productId, store: 'fake' }),
      });
    } catch {
      return { status: 'failed', code: 'network' };
    }
    if (!res.ok) return { status: 'failed', code: 'store_error' };
    const body = (await res.json()) as { transaction_id?: string };
    return { status: 'purchased', productId, transactionId: body.transaction_id ?? 'fake' };
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
