import { describe, expect, it, vi } from "vitest";
import { alternates, basePath, localePath, signInUrl, startUrl } from "../../src/lib/urls";
import { course, faqPage, jsonLdScript } from "../../src/lib/seo";
import { BeaconTransport, NoopTransport, privacyOptOut, setTransport, track } from "../../src/lib/analytics";
import { robotsTxt } from "../../src/lib/robots";
import { tokenCss } from "../../src/styles/tokens";
import { scoreQuiz, localiseLesson } from "../../src/islands/quiz-logic";
import { subjectFamily } from "../../src/lib/subjects";
import fixture from "../../src/content-index/fixture/site-index.fixture.json";
import { parseIndex } from "../../src/content-index";

describe("urls", () => {
  it("prefixes Hindi paths with /hi", () => {
    expect(localePath("en", "/exams/neet/")).toBe("/exams/neet/");
    expect(localePath("hi", "/exams/neet/")).toBe("/hi/exams/neet/");
    expect(localePath("hi", "/")).toBe("/hi/");
    expect(basePath("/hi/exams/neet/")).toBe("/exams/neet/");
    expect(basePath("/hi/")).toBe("/");
    expect(alternates("/privacy/")).toEqual({ en: "/privacy/", hi: "/hi/privacy/" });
  });

  it("hands off to the web app /start with preselections (onboarding §6.12)", () => {
    const u = new URL(startUrl("https://app.x.example", { lang: "hi", placement: "hero", exam: "neet-ug", topic: "phy.a.b" }));
    expect(u.origin + u.pathname).toBe("https://app.x.example/start");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      lang: "hi",
      exam: "neet-ug",
      topic: "phy.a.b",
      utm_source: "site",
      utm_medium: "cta",
      utm_campaign: "hero",
    });
  });

  it("sends Sign in to the web app's /login?next= (auth §5.4)", () => {
    expect(signInUrl("https://app.x.example")).toBe("https://app.x.example/login?next=%2F");
  });
});

describe("seo", () => {
  it("builds a free Course with an online instance and no invented workload", () => {
    const c = course({ name: "N", description: "D", url: "https://s/x/", lang: "hi", providerName: "B", siteUrl: "https://s" });
    expect(c["@type"]).toBe("Course");
    expect(c.isAccessibleForFree).toBe(true);
    expect((c.provider as { name: string }).name).toBe("B");
    expect(JSON.stringify(c)).not.toContain("courseWorkload");
    const timed = course({ name: "N", description: "D", url: "u", lang: "en", providerName: "B", siteUrl: "s", minutes: 12 });
    expect(JSON.stringify(timed)).toContain('"courseWorkload":"PT12M"');
  });

  it("builds FAQPage and escapes script-breaking characters", () => {
    const f = faqPage([{ q: "Q?", a: "</script><b>" }], "en");
    expect((f.mainEntity as unknown[]).length).toBe(1);
    const s = jsonLdScript(f);
    expect(s).not.toContain("</script>");
    expect(JSON.parse(s)).toEqual(f);
  });
});

describe("analytics", () => {
  it("honours Global Privacy Control and Do Not Track", () => {
    expect(privacyOptOut({ globalPrivacyControl: true })).toBe(true);
    expect(privacyOptOut({ doNotTrack: "1" })).toBe(true);
    expect(privacyOptOut({})).toBe(false);
    expect(privacyOptOut(undefined)).toBe(true);
  });

  it("is a no-op by default outside the browser", () => {
    setTransport(undefined);
    expect(() => track("site_quiz_complete", { score: 1, total: 3 })).not.toThrow();
    const noop = new NoopTransport();
    expect(noop.send()).toBeUndefined();
  });

  it("posts without credentials when configured", () => {
    vi.stubGlobal("location", { pathname: "/hi/" });
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(null)));
    const t = new BeaconTransport("https://collect.example/e", fetchImpl as unknown as typeof fetch);
    setTransport(t);
    track("site_cta_click", { cta: "start", placement: "hero", lang: "hi" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://collect.example/e");
    expect(init.credentials).toBe("omit");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ name: "site_cta_click", props: { cta: "start", placement: "hero", lang: "hi" }, path: "/hi/" });
    expect(Object.keys(body).sort()).toEqual(["name", "path", "props", "ts"]);
    setTransport(undefined);
    vi.unstubAllGlobals();
  });
});

describe("robots", () => {
  it("points at the sitemap, or blocks everything on previews", () => {
    expect(robotsTxt("https://s.example", false)).toContain("Sitemap: https://s.example/sitemap-index.xml");
    expect(robotsTxt("https://s.example", true)).toBe("User-agent: *\nDisallow: /\n");
  });
});

describe("tokens css", () => {
  it("defines light and dark variables and subject families from tokens.json", () => {
    expect(tokenCss).toContain("--bg:#F6F7FB");
    expect(tokenCss).toContain('@media (prefers-color-scheme: dark){:root:not([data-theme="light"])');
    expect(tokenCss).toContain(':root[data-theme="dark"]{');
    expect(tokenCss).toContain(".s-chemistry{");
    expect(tokenCss).toContain(".x-neet{");
    expect(tokenCss).not.toMatch(/undefined|NaN/);
  });

  it("gives NEET and SSC accents dark ink text (DESIGN §2.3)", () => {
    const neet = tokenCss.match(/\.x-neet\{([^}]*)\}/)![1]!;
    expect(neet).toContain("--on-primary:#151A2D");
  });

  it("applies dark exam accents on <html> itself, above the dark :root block", () => {
    expect(tokenCss).toContain(':root:not([data-theme="light"]).x-neet,:root:not([data-theme="light"]) .x-neet{--primary:#3FD08A');
    expect(tokenCss).toContain(':root[data-theme="dark"].x-ssc,');
  });

  it("maps subjects to colour families via subjectMap", () => {
    expect(subjectFamily("economy")).toBe("polity");
    expect(subjectFamily("quant")).toBe("maths");
    expect(subjectFamily("unknown-subject")).toBe("physics");
  });
});

describe("quiz logic", () => {
  it("scores answers", () => {
    expect(scoreQuiz([true, false, true])).toEqual({ correct: 2, total: 3 });
    expect(scoreQuiz([])).toEqual({ correct: 0, total: 0 });
  });
  it("localises a lesson to one language", () => {
    const idx = parseIndex(fixture, "fixture");
    const v = localiseLesson(idx.home_try_lesson!, "hi");
    expect(v.title).toBe("नमूना पाठ");
    expect(v.questions[0]!.options[0]!.text).toBe("विकल्प A");
  });
});
