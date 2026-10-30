/** Wire shapes of the content and config routes the web app reads (`/v1/config`, `/v1/content/*`). */
export interface Localised {
  en: string;
  hi: string;
}

export interface ExamOption {
  id: string;
  profileId: string;
  short: Localised;
  /** Drives the pet's reaction line on ONB-02 (D15). */
  category: "engineering" | "medical" | "civil_services" | "government_jobs";
  cycle: string;
}

export interface ConfigResponse {
  exams: ExamOption[];
  classes: number[];
  rotatingFreeChapters: string[];
  intro: { pricePaise: number; monthlyPaise: number; currency: "INR" };
}

export interface TopicRow {
  id: string;
  title: Localised;
  minutes: number;
}

export interface Chapter {
  id: string;
  /** Position in the subject, in the exam profile's chapter order. */
  index: number;
  title: Localised;
  topics: TopicRow[];
}

export interface Subject {
  id: string;
  family: string;
  name: Localised;
  illustration: string;
  chapters: Chapter[];
}

export interface CatalogResponse {
  fixture?: boolean;
  subjects: Subject[];
}

export interface PracticeQuestion {
  id: string;
  subjectId: string;
  prompt: Localised;
  options: { id: string; label: Localised }[];
  correctId: string;
  solution: Localised;
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
