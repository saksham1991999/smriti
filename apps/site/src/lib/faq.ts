// FAQ items with their placeholders filled from config and the content index.
import { upcomingApps } from "../config/apps";
import { site, type Locale } from "../config/site";
import { conductingBodies, getIndex } from "../content-index";
import { fmt, formatNumber, list, listOr, messages } from "../i18n";

export function faqItems(lang: Locale): { q: string; a: string }[] {
  const m = messages(lang);
  const idx = getIndex();
  const brand = site.brand.name[lang];
  const released = idx.exams.length > 0;
  const vars = {
    brand,
    price: formatNumber(lang, site.pricing.monthlyInr),
    intro: formatNumber(lang, site.pricing.introInr),
    // With nothing released, the exam apps being prepared, by name only (never invented exams).
    exams: released
      ? list(lang, idx.exams.map((e) => e.name[lang]))
      : list(lang, upcomingApps(site.apps, []).filter((a) => a.phase === 1).map((a) => m.apps.names[a.id])),
    bodies: listOr(lang, conductingBodies(idx)),
  };
  const items = Object.entries(m.faq.items)
    .filter(([key]) => key !== "affiliation" || conductingBodies(idx).length > 0)
    .map(([key, i]) => {
      const answer = key === "exams" && !released ? m.faq.items.exams.aSoon : i.a;
      return { q: fmt(i.q, vars), a: fmt(answer, vars) };
    });
  return items;
}
