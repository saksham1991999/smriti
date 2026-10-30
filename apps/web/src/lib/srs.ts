import type { IntervalPreview } from "@smriti/app-core";
import type { T } from "./i18n";

const LABELS = ["again", "hard", "good", "easy"] as const;

/** "10 min", "3 d" … for RatingButtons, from app-core's FSRS previews. */
export function intervalText(p: IntervalPreview["display"], t: T): string {
  switch (p.unit) {
    case "min":
      return t("memory_labs:MEM-03.interval_min", { n: p.value });
    case "h":
      return t("memory_labs:WEB-03.interval_hour", { n: p.value });
    case "d":
      return t("memory_labs:MEM-03.interval_day", { n: p.value });
    case "mo":
      return t("memory_labs:MEM-03.interval_month", { n: p.value });
    case "y":
      return t("memory_labs:WEB-03.interval_year", { n: p.value });
  }
}

export function intervalLabels(previews: IntervalPreview[], t: T): Record<(typeof LABELS)[number], string> {
  const out = { again: "", hard: "", good: "", easy: "" };
  previews.forEach((p, i) => {
    const k = LABELS[i];
    if (k) out[k] = intervalText(p.display, t);
  });
  return out;
}
