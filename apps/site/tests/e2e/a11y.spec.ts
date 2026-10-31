import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// axe-core against WCAG 2.2 AA rules on every page type, in both languages and both themes.
// The bar is zero serious or critical violations (PRD §12/§13).
const PAGES = [
  "/",
  "/exams/",
  "/exams/jee-main/",
  "/exams/neet/biology/",
  "/exams/neet/biology/sample-chapter-3/",
  "/exams/jee-main/physics/sample-chapter-1/sample-topic-1-1/",
  "/privacy/",
  "/childrens-data/",
];

// axe on the home page (periodic table, quiz) is slow on a busy runner.
test.describe.configure({ timeout: 90_000 });

for (const base of PAGES) {
  for (const path of [base, base === "/" ? "/hi/" : `/hi${base}`]) {
    for (const theme of ["light", "dark"] as const) {
      test(`axe: ${path} (${theme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
        await page.goto(path);
        const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
        const bad = result.violations
          .filter((v) => v.impact === "serious" || v.impact === "critical")
          .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
        expect(bad).toEqual([]);
      });
    }
  }
}
