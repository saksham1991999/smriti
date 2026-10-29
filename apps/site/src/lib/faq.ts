// FAQ items with their placeholders filled from config and the content index.
import { site, type Locale } from "../config/site";
import { conductingBodies, getIndex } from "../content-index";
import { fmt, formatNumber, list, listOr, messages } from "../i18n";

export function faqItems(lang: Locale): { q: string; a: string }[] {
  const m = messages(lang);
  const idx = getIndex();
  const brand = site.brand.name[lang];
  const vars = {
    brand,
    price: formatNumber(lang, site.pricing.monthlyInr),
    intro: formatNumber(lang, site.pricing.introInr),
    exams: list(lang, idx.exams.map((e) => e.name[lang])),
    bodies: listOr(lang, conductingBodies(idx)),
  };
  const items = Object.entries(m.faq.items)
    .filter(([key]) => key !== "affiliation" || conductingBodies(idx).length > 0)
    .map(([, i]) => ({ q: fmt(i.q, vars), a: fmt(i.a, vars) }));
  return items;
}
