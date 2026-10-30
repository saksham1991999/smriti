import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const TOPIC = "/exams/jee-main/physics/sample-chapter-1/sample-topic-1-1/";
const PAGES = [
  { path: "/", type: "home" },
  { path: "/exams/", type: "exams" },
  { path: "/exams/jee-main/", type: "exam" },
  { path: "/exams/neet/", type: "exam" },
  { path: "/exams/upsc/", type: "exam" },
  { path: "/exams/ssc/", type: "exam" },
  { path: "/exams/neet/biology/", type: "subject" },
  { path: "/exams/neet/biology/sample-chapter-3/", type: "chapter" },
  { path: TOPIC, type: "topic" },
  { path: "/privacy/", type: "legal" },
  { path: "/terms/", type: "legal" },
];
const hiPath = (p: string) => (p === "/" ? "/hi/" : `/hi${p}`);

async function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}

for (const p of PAGES) {
  for (const lang of ["en", "hi"] as const) {
    const path = lang === "en" ? p.path : hiPath(p.path);
    test(`${path} renders with hreflang`, async ({ page }) => {
      const errors = await collectErrors(page);
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("html")).toHaveAttribute("lang", lang === "hi" ? "hi-IN" : "en-IN");
      const alt = (l: string) => page.locator(`link[rel="alternate"][hreflang="${l}"]`);
      await expect(alt("en")).toHaveAttribute("href", new RegExp(`${p.path.replace(/\//g, "\\/")}$`));
      await expect(alt("hi")).toHaveAttribute("href", new RegExp(`${hiPath(p.path).replace(/\//g, "\\/")}$`));
      await expect(alt("x-default")).toHaveCount(1);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${path.replace(/\//g, "\\/")}$`));
      // Every image has alt text or is marked decorative.
      for (const img of await page.locator("img").all()) expect(await img.getAttribute("alt")).not.toBeNull();
      // The site never signs in: no cookies, no Google script, Sign in goes to the web app.
      expect(await page.context().cookies()).toEqual([]);
      await expect(page.locator('script[src*="accounts.google.com"]')).toHaveCount(0);
      const signIn = page.locator('a[data-cta="sign_in"]').first();
      await expect(signIn).toHaveAttribute("href", /\/login\?next=%2F$/);
      // No horizontal page scroll at any width.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    });
  }
}

test("legal pages are drafts with noindex", async ({ page }) => {
  await page.goto("/privacy/");
  await expect(page.getByText("Draft, pending legal review")).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("home has FAQPage schema and honest pricing", async ({ page }) => {
  await page.goto("/");
  const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
  const types = ld.map((t) => JSON.parse(t)["@type"]);
  expect(types).toContain("FAQPage");
  const pricing = page.locator("#pricing");
  await expect(pricing).toContainText("₹99");
  await expect(pricing).toContainText("All taxes included");
  await expect(pricing).toContainText("eligible");
  await expect(pricing).not.toContainText(/% off|ends in|hurry/i);
});

test("topic page has Course schema and a try-this-lesson hand-off", async ({ page }) => {
  await page.goto(TOPIC);
  const ld = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((t) => JSON.parse(t));
  const courseLd = ld.find((d) => d["@type"] === "Course");
  expect(courseLd?.provider?.name).toBeTruthy();
  expect(ld.some((d) => d["@type"] === "BreadcrumbList")).toBe(true);
  const href = await page.locator('a[data-cta="try_lesson"]').first().getAttribute("href");
  const u = new URL(href!);
  expect(u.pathname).toBe("/start");
  expect(u.searchParams.get("topic")).toBe("phy.sample-chapter-1.sample-topic-1");
  expect(u.searchParams.get("exam")).toBe("jee-main");
  expect(u.searchParams.get("lang")).toBe("en");
});

test("exam page hides the pattern section without a reviewed blueprint", async ({ page }) => {
  await page.goto("/exams/neet/");
  await expect(page.locator("#pattern")).toHaveCount(0);
  await expect(page.locator(".disclaimer")).toContainText("not affiliated with NTA");
});

test("try-a-lesson quiz checks an answer and ends with a hand-off", async ({ page }) => {
  await page.goto("/");
  const quiz = page.getByTestId("try-lesson-quiz");
  await quiz.scrollIntoViewIfNeeded();
  await page.locator("astro-island:not([ssr]) [data-testid=try-lesson-quiz]").waitFor();
  for (let i = 0; i < 3; i++) {
    await quiz.locator("label.opt").first().click();
    await quiz.getByRole("button", { name: "Check" }).click();
    await expect(quiz.locator(".fb")).toBeVisible();
    await quiz.getByRole("button", { name: i < 2 ? "Next question" : "See my result" }).click();
  }
  await expect(quiz.getByRole("heading", { name: /You got \d of 3/ })).toBeVisible();
  const href = await quiz.getByRole("link", { name: /Continue in the app/ }).getAttribute("href");
  expect(new URL(href!).searchParams.get("topic")).toBeTruthy();
});

test("periodic teaser selects elements with click and arrow keys", async ({ page }) => {
  await page.goto("/");
  const pt = page.getByTestId("periodic-teaser");
  await pt.scrollIntoViewIfNeeded();
  await page.locator("astro-island:not([ssr]) [data-testid=periodic-teaser]").waitFor();
  await pt.getByRole("button", { name: /^Sodium, atomic number 11/ }).click();
  await expect(pt.locator(".pt-tile .sym")).toHaveText("Na");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(":focus")).toHaveAttribute("aria-label", /^Magnesium/);
  await page.keyboard.press("Enter");
  await expect(pt.locator(".pt-tile .sym")).toHaveText("Mg");
});

test("404 page renders in both languages", async ({ page }) => {
  const res = await page.goto("/no-such-page/");
  expect(res?.status()).toBe(404);
  await expect(page.locator("h1")).toContainText("This page is resting");
  await expect(page.getByText("यह पेज आराम कर रहा है")).toBeVisible();
});

test("robots.txt and sitemap exist", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(await robots.text()).toContain("Sitemap:");
  const sm = await request.get("/sitemap-0.xml");
  const xml = await sm.text();
  expect(xml).toContain('hreflang="hi"');
  expect(xml).not.toContain("/privacy/");
});

test("no broken internal links in the build", () => {
  test.skip(test.info().project.name !== "desktop", "runs once");
  const r = spawnSync(process.execPath, [join(process.cwd(), "scripts", "check-links.mjs"), "dist"], {
    encoding: "utf8",
    cwd: process.cwd(),
  });
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
});
