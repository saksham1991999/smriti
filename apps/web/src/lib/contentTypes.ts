/** Wire shapes of the config and billing routes the web app reads. Content shapes come from @smriti/content-schema. */
export interface Localised {
  en: string;
  hi: string;
}

export interface ExamOption {
  id: string;
  profileId: string;
  short: Localised;
  /** Drives the pet's reaction line on ONB-02 (D15). */
  category: "engineering" | "medical" | "civil_services" | "government_jobs" | "school" | "general";
  cycle: string;
}

export interface ConfigResponse {
  exams: ExamOption[];
  classes: number[];
  rotatingFreeChapters: string[];
  intro: { pricePaise: number; monthlyPaise: number; currency: "INR" };
  /** Owner flags (`GET /v1/config` flags map); missing keys use @smriti/config defaults. */
  flags?: Record<string, unknown>;
}

export interface IntroEligibility {
  eligible: boolean;
  intro_price_paise: number;
  price_paise: number;
  currency: "INR";
}

export interface CheckoutSession {
  checkout_id: string;
  amount_paise: number;
  intro: boolean;
  provider: string;
}
