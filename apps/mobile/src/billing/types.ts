/**
 * Store billing behind one interface (TRD §11). RevenueCat (`react-native-purchases`) is the real
 * provider on Android and iOS; `FakeBilling` stands in locally and in tests. The server stays the
 * source of truth: after a purchase the app waits for `/v1/sync/state` to show `plan: pro`
 * (PAY-08 "Confirming"), it never unlocks Pro from the store receipt alone.
 */
export interface Offer {
  productId: string;
  /** Tax-inclusive prices in paise (R38). */
  introPricePaise: number | null;
  pricePaise: number;
  period: 'month';
  /** The store's own intro eligibility; the server's `/v1/billing/intro-eligibility` also decides. */
  introEligible: boolean;
}

export type PurchaseResult =
  | { status: 'purchased'; productId: string; transactionId: string }
  | { status: 'cancelled' }
  | { status: 'pending' }
  | { status: 'failed'; code: 'network' | 'store_error' | 'not_allowed' | 'already_owned' };

export interface BillingProvider {
  readonly kind: 'fake' | 'revenuecat';
  /** Ties purchases to the account (RevenueCat `logIn(app_user_id)`). Called after sign-in. */
  identify(userId: string): Promise<void>;
  offers(): Promise<Offer[]>;
  purchase(productId: string): Promise<PurchaseResult>;
  restore(): Promise<{ restored: boolean }>;
  /** Opens the store's own subscription page (cancel is reachable in 2 taps, R33). */
  manageUrl(): string;
  logOut(): Promise<void>;
}
