// schema.org JSON-LD builders (TRD §4.1: Course, FAQPage). Pure functions, unit tested.

import type { Locale } from "../config/site";

export type JsonLd = Record<string, unknown>;

export interface Crumb {
  name: string;
  url: string;
}

export function organization(name: string, siteUrl: string, logoUrl: string): JsonLd {
  return { "@context": "https://schema.org", "@type": "Organization", name, url: `${siteUrl}/`, logo: logoUrl };
}

export function website(name: string, siteUrl: string, lang: Locale): JsonLd {
  return { "@context": "https://schema.org", "@type": "WebSite", name, url: `${siteUrl}/`, inLanguage: lang };
}

export function faqPage(items: { q: string; a: string }[], lang: Locale): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: lang,
    mainEntity: items.map((i) => ({
      "@type": "Question",
      name: i.q,
      acceptedAnswer: { "@type": "Answer", text: i.a },
    })),
  };
}

export function breadcrumbs(crumbs: Crumb[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.url })),
  };
}

export interface CourseInput {
  name: string;
  description: string;
  url: string;
  lang: Locale;
  providerName: string;
  siteUrl: string;
  /** Exam or subject the course prepares for, e.g. "JEE Main". */
  about?: string | undefined;
  /** Total minutes, only when the content index knows it. Never estimated. */
  minutes?: number | null | undefined;
  /** Child courses or topics, as names, for chapter/subject pages. */
  parts?: string[] | undefined;
}

/** A free Course (the free tier needs no login; Pro is an upgrade inside the app). */
export function course(c: CourseInput): JsonLd {
  const instance: JsonLd = { "@type": "CourseInstance", courseMode: "Online", inLanguage: c.lang };
  if (c.minutes && c.minutes > 0) instance.courseWorkload = `PT${Math.round(c.minutes)}M`;
  const out: JsonLd = {
    "@context": "https://schema.org",
    "@type": "Course",
    name: c.name,
    description: c.description,
    url: c.url,
    inLanguage: c.lang,
    isAccessibleForFree: true,
    provider: { "@type": "Organization", name: c.providerName, sameAs: `${c.siteUrl}/` },
    offers: { "@type": "Offer", category: "Free", price: 0, priceCurrency: "INR" },
    hasCourseInstance: [instance],
  };
  if (c.about) out.about = { "@type": "Thing", name: c.about };
  if (c.parts && c.parts.length > 0) out.syllabusSections = c.parts.map((name) => ({ "@type": "Syllabus", name }));
  return out;
}

/** Escapes a JSON-LD payload for an inline <script> tag. */
export function jsonLdScript(data: JsonLd | JsonLd[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}
