/**
 * Guest → onboarding → first lesson → streak day 1 → soft sign-in prompt → link Google (dev auth)
 * → paywall → Razorpay checkout → Pro, against the real apps/api (no fake API). In local mode the
 * API runs FakeRazorpay: the app shows its test approve step and this test plays Razorpay by
 * sending the signed `subscription.activated` webhook (scripts/fake-razorpay.mjs).
 *
 * Start the API first (from apps/api, with the fixture content published and its metadata loaded):
 *   APP_ENV=local AI_PROVIDER=fake \
 *   CONTENT_LOCAL_DIR=<repo>/tools/content-publish/out CONTENT_MANIFEST_PATH='manifests/{exam}.{locale}.json' \
 *   CORS_ORIGINS=http://127.0.0.1:4318 uv run uvicorn smriti_api.main:app --port 8000
 * then: pnpm --filter @smriti/web e2e:real
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { activateSubscription } from "../scripts/fake-razorpay.mjs";
import {
  askTutor,
  dailyChallenge,
  devGoogle,
  drill,
  expectAccessible,
  finishFirstWin,
  guardianHandoff,
  guardianLink,
  mockAttempt,
  onboard,
  parentTurnsOff,
  playLesson,
  type Locale,
} from "./journey";

const API = "http://127.0.0.1:8000";

// The local dev database (scripts/dev/db.sh); the fixture exam's metadata is loaded when missing.
const DB_URL = process.env.SMRITI_DEV_DB_URL ?? "postgres://postgres@127.0.0.1:54322/smriti";
const METADATA = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "tools",
  "content-publish",
  "out",
  "metadata.sql",
);

test.beforeAll(async ({ request }) => {
  const r = await request.get(`${API}/healthz`).catch(() => null);
  test.skip(!r || !r.ok(), `apps/api is not running on ${API}`);
  const exams = (await (await request.get(`${API}/v1/catalog/exams`)).json()) as { id: string }[];
  if (!exams.some((e) => e.id === "fx-exam")) {
    execFileSync("psql", [DB_URL, "-v", "ON_ERROR_STOP=1", "-q", "-f", METADATA], {
      stdio: "inherit",
    });
  }
  // The publisher loads the fixture blueprint as a draft; mocks are built from active blueprints only.
  execFileSync(
    "psql",
    [
      DB_URL,
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      "-c",
      "update content.exam_blueprints set status = 'active' where exam_profile_id = 'fx-exam-2027' and status = 'draft'",
    ],
    { stdio: "inherit" },
  );
});

interface Seen {
  calls: string[];
  userId: string | null;
  subscription: { id: string; intro: boolean } | null;
}

for (const locale of ["en", "hi"] as Locale[]) {
  test(`guest to Pro on the real API (${locale})`, async ({ page }) => {
    const seen: Seen = { calls: [], userId: null, subscription: null };
    page.on("response", async (r) => {
      if (!r.url().startsWith(API)) return;
      const path = new URL(r.url()).pathname;
      seen.calls.push(`${r.request().method()} ${path} ${r.status()}`);
      if (r.status() !== 200) return;
      if (path === "/v1/sync/state") {
        const body = (await r.json().catch(() => null)) as { profile?: { id: string } } | null;
        if (body?.profile?.id) seen.userId = body.profile.id;
      }
      if (path === "/v1/billing/razorpay/subscription") {
        const body = (await r.json()) as { subscription_id: string; intro: boolean };
        seen.subscription = { id: body.subscription_id, intro: body.intro };
      }
    });

    await onboard(page, locale, { petName: locale === "hi" ? "मिट्टी" : "Mitti" });
    await playLesson(page, /\/onboarding\/first-win/);
    await finishFirstWin(page);
    await expectAccessible(page, "HOME-01");

    // The server has the events and agrees on the streak.
    await expect
      .poll(
        async () => {
          await page.evaluate(() => window.dispatchEvent(new Event("online")));
          return seen.calls.filter((c) => /POST \/v1\/sync\/events 20\d/.test(c)).length;
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);
    await page.reload();
    await expect(page.getByTestId("home-streak")).toBeVisible();
    await expect(page.getByTestId("home-streak")).toContainText("1");
    expect(seen.calls.some((c) => /GET \/v1\/sync\/state 200/.test(c))).toBe(true);

    // A drill runs as a server practice session: the server picks, checks and counts.
    await drill(page);
    expect(seen.calls.some((c) => /POST \/v1\/practice\/sessions 20\d/.test(c))).toBe(true);
    expect(
      seen.calls.some((c) => /POST \/v1\/practice\/sessions\/[^/]+\/answers 200/.test(c)),
    ).toBe(true);
    expect(
      seen.calls.some((c) => /POST \/v1\/practice\/sessions\/[^/]+\/complete 200/.test(c)),
    ).toBe(true);
    expect(seen.calls.some((c) => /GET \/v1\/practice\/limits 200/.test(c))).toBe(true);

    // Today's challenge: start, answer once, result from the server.
    await dailyChallenge(page);
    expect(seen.calls.some((c) => /POST \/v1\/daily-challenge\/[^/]+\/answer 200/.test(c))).toBe(
      true,
    );

    // A sectional mock on the attempts API: start, save answers, submit, report, solutions.
    await mockAttempt(page, "bp:fx-exam-2027:paper-1:section-a");
    expect(seen.calls.some((c) => /POST \/v1\/mocks\/[^/]+\/attempts 201/.test(c))).toBe(true);
    expect(seen.calls.some((c) => /PUT \/v1\/attempts\/[^/]+\/answers 200/.test(c))).toBe(true);
    expect(seen.calls.some((c) => /POST \/v1\/attempts\/[^/]+\/submit 200/.test(c))).toBe(true);
    expect(seen.calls.some((c) => /GET \/v1\/attempts\/[^/]+\/solutions 200/.test(c))).toBe(true);

    // AI-02 from MOCK-22 (question context): two answers stream from /v1/tutor.
    await askTutor(page);
    expect(seen.calls.some((c) => /POST \/v1\/tutor\/sessions 200/.test(c))).toBe(true);
    expect(
      seen.calls.filter((c) => /POST \/v1\/tutor\/sessions\/[^/]+\/messages 200/.test(c)).length,
    ).toBe(2);

    // Soft prompt → link Google (dev auth) → paywall with the server's price and eligibility.
    await page.goto("/learn");
    await page.getByTestId("save-plant-link").click();
    await devGoogle(page, `real-${locale}-${Date.now()}@example.test`, "Real API Student");
    await expect(page.getByTestId("auth-01")).toBeHidden();
    await page.goto("/pro?source=me_card");
    await expect(page.getByTestId("trial-timeline")).toBeVisible();
    await expectAccessible(page, "PAY-01");
    await page.getByTestId("pay-cta").click();
    await expect(page.getByTestId("pay-06")).toBeVisible();
    await page.getByTestId("pay-06-cta").click();
    await page.getByTestId("fake-pay-approve").click();
    await expect(page.getByTestId("pay-08")).toBeVisible();

    // Razorpay's webhook turns Pro on while PAY-08 polls the entitlement.
    await expect.poll(() => seen.subscription !== null && seen.userId !== null).toBe(true);
    const sub = seen.subscription as { id: string; intro: boolean } | null;
    if (!sub || !seen.userId) throw new Error("no subscription or user id seen");
    await activateSubscription({
      api: API,
      subscriptionId: sub.id,
      userId: seen.userId,
      intro: sub.intro,
    });
    await expect(page.getByTestId("pro-on")).toBeVisible({ timeout: 30_000 });
    await expectAccessible(page, "PAY-09");
    await page.goto("/me/plan");
    await expect(page.getByTestId("pay-12-cancel")).toBeVisible();

    expect(seen.calls.filter((c) => / 5\d\d$/.test(c))).toEqual([]);
  });
}

// A teen (born 2011) saves their account, then asks a guardian: on the same phone for friends and
// leagues, by link for the voice tutor; the guardian then turns the voice tutor off in Parent mode.
test("teen asks a guardian on the real API (en)", async ({ page, browser }) => {
  const calls: string[] = [];
  page.on("response", (r) => {
    if (r.url().startsWith(API))
      calls.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`);
  });
  const stamp = Date.now();
  const guardian = { email: `guardian-${stamp}@example.test`, name: "Asha Guardian" };
  await onboard(page, "en", { petName: "Mitti", birthYear: "2011" });
  await playLesson(page, /\/onboarding\/first-win/);
  await finishFirstWin(page);
  await page.getByTestId("save-plant-link").click();
  await devGoogle(page, `teen-${stamp}@example.test`, "Ravi Teen");
  await expect(page.getByTestId("auth-01")).toBeHidden();

  await guardianHandoff(page, "social", guardian);
  expect(calls.some((c) => /POST \/v1\/guardian\/consent-requests 201/.test(c))).toBe(true);
  expect(
    calls.some((c) => /POST \/v1\/guardian\/consent-requests\/[^/]+\/confirm 200/.test(c)),
  ).toBe(true);
  await expect(page.getByTestId("set-consent-social")).toBeVisible();

  const guardianContext = await browser.newContext();
  const guardianPage = await guardianContext.newPage();
  await guardianLink(page, guardianPage, "voice", guardian);
  await guardianContext.close();

  await parentTurnsOff(page, "voice", guardian);
  expect(calls.some((c) => /GET \/v1\/guardian\/learners 200/.test(c))).toBe(true);
  expect(
    calls.some((c) => /DELETE \/v1\/guardian\/consents\/[^/]+\/scopes\/voice 200/.test(c)),
  ).toBe(true);

  // SET-03 on the server's prefs: this browser is registered, a teen sees no adult-only rows,
  // and a switch is saved with PATCH.
  await page.context().grantPermissions(["notifications"]);
  await page.goto("/me/notifications");
  await expect(page.getByTestId("set-03")).toBeVisible();
  await expect(page.getByTestId("notify-friends")).toBeVisible();
  await expect(page.getByTestId("notify-smart_timing")).toHaveCount(0);
  await expectAccessible(page, "SET-03");
  await page.getByTestId("notify-friends").click();
  await expect
    .poll(() => calls.some((c) => /PATCH \/v1\/notification-prefs 200/.test(c)))
    .toBe(true);
  await expect
    .poll(() => calls.some((c) => /POST \/v1\/devices 20\d/.test(c)), { timeout: 10_000 })
    .toBe(true);
  expect(calls.filter((c) => / 5\d\d$/.test(c))).toEqual([]);
});
