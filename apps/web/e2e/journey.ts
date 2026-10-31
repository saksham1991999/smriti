/** Shared steps for the web journeys. Everything goes by test id, so EN and HI run the same code. */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

export type Locale = "en" | "hi";

/** Zero serious or critical axe violations on the current screen. */
export async function expectAccessible(page: Page, screen: string) {
  // Let entrance motion and lazy chunks settle first.
  await page.waitForTimeout(300);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const bad = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    bad.map(
      (v) =>
        `${screen}: ${v.id} (${v.impact}) ${v.nodes
          .map((n) => n.target.join(" "))
          .slice(0, 3)
          .join(" | ")}`,
    ),
  ).toEqual([]);
}

async function visible(l: Locator, ms = 400): Promise<boolean> {
  try {
    await l.first().waitFor({ state: "visible", timeout: ms });
    return true;
  } catch {
    return false;
  }
}

/** ONB-01 → ONB-12: language, goal, birth year (an adult, so no guardian gates), level, buddy, plant. */
export async function onboard(
  page: Page,
  locale: Locale,
  opts: { petName: string; exam?: string; birthYear?: string } = { petName: "Mitti" },
) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/welcome/);
  await expectAccessible(page, "ONB-01");
  await page.getByTestId(`start-${locale}`).click();
  await expect(page).toHaveURL(/\/onboarding\/goal/);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await page.getByTestId(`goal-${opts.exam ?? "fx-exam"}`).click();
  await expectAccessible(page, "ONB-02");
  await page.getByTestId("goal-continue").click();

  for (let guard = 0; guard < 8; guard++) {
    const url = page.url();
    if (/\/onboarding\/class/.test(url)) {
      await page.getByRole("radio").first().click();
      await page.getByTestId("class-continue").click();
    } else if (/\/onboarding\/birth-year/.test(url)) {
      await page
        .getByTestId("birth-year")
        .locator("select")
        .selectOption(opts.birthYear ?? "1998");
      await page.getByTestId("birth-continue").click();
    } else if (/\/onboarding\/exam-date/.test(url)) {
      await page
        .getByTestId("exam-not-sure")
        .locator("[role=radio],[role=checkbox]")
        .first()
        .click();
      await page.getByTestId("exam-date-continue").click();
    } else if (/\/onboarding\/level/.test(url)) {
      await page.getByTestId("level-starting").click();
      await page.getByTestId("level-continue").click();
    } else if (/\/onboarding\/buddy/.test(url)) {
      await page.getByTestId("buddy-cat").click();
      await page.getByTestId("pet-name").fill(opts.petName);
      await expectAccessible(page, "ONB-10");
      await page.getByTestId("buddy-continue").click();
    } else if (/\/onboarding\/plant/.test(url)) {
      await page.getByTestId("plant-pot").click();
      await page.getByTestId("start-first-lesson").click();
      return;
    }
    await page.waitForURL((u) => u.toString() !== url, { timeout: 10_000 });
  }
  throw new Error(`onboarding did not reach the plant step (at ${page.url()})`);
}

/** Plays a lesson to the end: answers "I don't know yet", skips tasks and online-only cards. */
export async function playLesson(page: Page, until: RegExp) {
  await expect(page.getByTestId("lesson-player")).toBeVisible();
  let checkedA11y = false;
  for (let step = 0; step < 80; step++) {
    if (until.test(page.url())) return;
    if (!checkedA11y) {
      await expectAccessible(page, "LES-01");
      checkedA11y = true;
    }
    if (await visible(page.getByTestId("confidence-skip"), 150)) {
      await page.getByTestId("confidence-skip").click();
      continue;
    }
    // Interactive widgets: place every item (any box), then Check; a placed sort counts as done.
    if (await visible(page.getByTestId("task-first"), 150)) {
      const selects = page.getByTestId("lesson-player").locator("select");
      for (let i = 0; i < (await selects.count()); i++) {
        const sel = selects.nth(i);
        if ((await sel.inputValue()) === "") {
          const values = await sel
            .locator("option:not([disabled])")
            .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
          if (values[0]) await sel.selectOption(values[0]);
        }
      }
      const check = page.getByTestId("widget-check");
      if ((await visible(check, 150)) && (await check.isEnabled())) {
        await check.click();
        continue;
      }
    }
    for (const id of [
      "lesson-dont-know",
      "lesson-skip-task",
      "lesson-skip-online",
      "lesson-try-again",
      "lesson-continue",
      "rapid-rating",
    ]) {
      const l = page.getByTestId(id).first();
      if ((await visible(l, 150)) && (await l.isEnabled())) {
        if (id === "rapid-rating") await l.getByRole("button").first().click();
        else await l.click();
        break;
      }
    }
    await page.waitForTimeout(120);
  }
  await expect(page).toHaveURL(until);
}

/** ONB-14 first win → ONB-08 daily goal → ONB-15 reminder (later) → Home. */
export async function finishFirstWin(page: Page) {
  await expect(page.getByTestId("onb-14")).toBeVisible();
  await expect(page.getByTestId("streak-day")).toHaveAttribute("data-streak", "1");
  await expectAccessible(page, "ONB-14");
  await page.getByTestId("first-win-continue").click();
  await page.getByTestId("goal-10").click();
  await page.getByTestId("goal-set").click();
  await page.getByTestId("reminder-later").click();
  await expect(page).toHaveURL(/\/learn/);
  await expect(page.getByTestId("home-01")).toBeVisible();
}

/** The dev Google form (AUTH_MODE=dev stands in for Google locally). */
export async function devGoogle(page: Page, email: string, name: string) {
  await page.getByTestId("google-button").click();
  await page.getByTestId("dev-email").fill(email);
  await page.getByTestId("dev-name").fill(name);
  await page.getByTestId("dev-submit").click();
}

/** PRC-01 → PRC-03 → PRC-04/05 → PRC-06 on the first drill tile; answers each question with its first option. */
export async function drill(page: Page) {
  await page.goto("/practice");
  await expect(page.getByTestId("prc-01")).toBeVisible();
  await expectAccessible(page, "PRC-01");
  await page.locator("[data-testid^=drill-]").first().click();
  await expect(page.getByTestId("prc-03")).toBeVisible();
  await page.getByTestId("drill-start").click();
  await expect(page.getByTestId("prc-04")).toBeVisible();
  await expectAccessible(page, "PRC-04");
  for (let i = 0; i < 30; i++) {
    if (await visible(page.getByTestId("prc-06"), 200)) break;
    const check = page.getByTestId("drill-check");
    if (await visible(check, 200)) {
      const q = page.getByTestId("drill-question");
      const option = q.locator("[data-testid^=option-]").first();
      if (await visible(option, 200)) await option.click();
      else if (await visible(q.locator("input").first(), 200))
        await q.locator("input").first().fill("1");
      if (await check.isEnabled()) await check.click();
      continue;
    }
    const next = page.getByTestId("drill-next");
    if (await visible(next, 200)) {
      await expect(page.getByTestId("prc-05")).toBeVisible();
      await next.click();
    }
  }
  await expect(page.getByTestId("prc-06")).toBeVisible();
  await expectAccessible(page, "PRC-06");
  await page.getByTestId("drill-done").click();
}

/**
 * MOCK-01 → MOCK-05/06 → MOCK-07/08 → MOCK-16 → MOCK-19 → MOCK-22 on a sectional mock: answers the
 * first question with its first option, marks the second for review, then submits.
 */
export async function mockAttempt(page: Page, mockId: string) {
  await page.goto("/practice/mocks");
  await expect(page.getByTestId("mock-01")).toBeVisible();
  await expectAccessible(page, "MOCK-01");
  await page.getByTestId(`mock-card-${mockId}`).click();
  await expect(page.getByTestId("mock-06")).toBeVisible();
  await expectAccessible(page, "MOCK-06");
  await page.getByTestId("mock-declaration").click();
  await page.getByTestId("mock-begin").click();
  await expect(page.getByTestId("mock-07")).toBeVisible();
  await expect(page.getByTestId("mock-timer")).toBeVisible();
  await page.getByTestId("mock-08").locator("[data-testid^=option-]").first().click();
  await page.getByTestId("mock-save-next").click();
  await expect(page.getByTestId("palette-1")).toHaveAttribute("data-state", "answered");
  await page.getByTestId("mock-mark").click();
  await expect(page.getByTestId("palette-2")).toHaveAttribute("data-state", "marked");
  await expectAccessible(page, "MOCK-08");
  await page.getByTestId("mock-submit").click();
  await expect(page.getByTestId("mock-16")).toBeVisible();
  await page
    .getByTestId("mock-16")
    .getByRole("button", { name: /submit|सबमिट/i })
    .last()
    .click();
  await expect(page.getByTestId("mock-19")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("mock-score")).toBeVisible();
  await expectAccessible(page, "MOCK-19");
  await page.getByTestId("mock-solutions").click();
  await expect(page.getByTestId("mock-22")).toBeVisible();
  await expect(page.getByTestId("solution-1")).toBeVisible();
  await expectAccessible(page, "MOCK-22");
}

/** PRC-01 card → PRC-11 start → answer with the first option → PRC-12 result and board. */
export async function dailyChallenge(page: Page) {
  await page.goto("/practice");
  await page.getByTestId("challenge-card").click();
  await expect(page.getByTestId("prc-11")).toBeVisible();
  await expectAccessible(page, "PRC-11");
  await page.getByTestId("challenge-start").click();
  await expect(page.getByTestId("challenge-clock")).toBeVisible();
  await page.getByTestId("challenge-question").locator("[data-testid^=option-]").first().click();
  await page.getByTestId("challenge-submit").click();
  await expect(page.getByTestId("prc-12")).toBeVisible();
  await expect(page.getByTestId("challenge-result")).toBeVisible();
  await expectAccessible(page, "PRC-12");
  await page.getByTestId("challenge-solution").click();
  await expect(page.getByTestId("prc-12").getByTestId("prc-05")).toBeVisible();
}

/**
 * From MOCK-22, AI-02 on question 1: a starter chip streams an answer, then a typed follow-up.
 * The free counter drops by one per answer (the server counts).
 */
export async function askTutor(page: Page) {
  await page.getByTestId("ask-tutor-1").click();
  const panel = page.getByTestId("ai-02");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("tutor-context")).toBeVisible();
  await panel.locator("[data-testid^=tutor-starter-]").first().click();
  await expect(panel.getByTestId("tutor-answer").last()).toHaveAttribute("data-status", "ok", {
    timeout: 30_000,
  });
  await expect(panel.getByTestId("tutor-bubble").last()).not.toBeEmpty();
  await expect(panel.getByTestId("tutor-counter")).toBeVisible();
  await expectAccessible(page, "AI-02");
  await panel.getByTestId("tutor-input").locator("textarea").fill("Why is option A not right?");
  await panel.getByTestId("tutor-input").locator("textarea").press("Enter");
  await expect(panel.getByTestId("tutor-answer")).toHaveCount(2);
  await expect(panel.getByTestId("tutor-answer").last()).toHaveAttribute("data-status", "ok", {
    timeout: 30_000,
  });
  await panel.getByTestId("tutor-close").click();
  await expect(panel).toBeHidden();
}

/**
 * A teen asks from SET-11 → AUTH-18 → AUTH-19 (hand the phone) → the guardian signs in on the
 * separate session → AUTH-20 → done → AUTH-23 "said yes" → back to settings.
 */
export async function guardianHandoff(
  page: Page,
  scope: string,
  guardian: { email: string; name: string },
) {
  await page.goto("/me/settings");
  await page.getByTestId(`set-consent-${scope}`).click();
  await expect(page.getByTestId("auth-18")).toBeVisible();
  await expectAccessible(page, "AUTH-18");
  await page.getByTestId("consent-handoff").click();
  await expect(page.getByTestId("auth-19")).toHaveAttribute("data-view", "student");
  await expectAccessible(page, "AUTH-19 student");
  await page.getByTestId("handoff-they-have-it").click();
  await expect(page.locator("[data-view=guardian]")).toBeVisible();
  await expectAccessible(page, "AUTH-19 guardian");
  await devGoogle(page, guardian.email, guardian.name);
  await expect(page.getByTestId("auth-20")).toBeVisible();
  await expect(page.getByTestId(`consent-row-${scope}`)).toBeVisible();
  await expectAccessible(page, "AUTH-20");
  await expect(page.getByTestId("consent-agree")).toBeDisabled();
  await page.getByTestId("consent-declaration").click();
  await page.getByTestId("consent-agree").click();
  await expect(page.getByTestId("auth-20-done")).toBeVisible();
  await page.getByTestId("handoff-given-back").click();
  await expect(page.getByTestId("auth-23")).toHaveAttribute("data-status", "granted");
  await expectAccessible(page, "AUTH-23");
  await page.getByTestId("consent-result-continue").click();
  await expect(page).toHaveURL(/\/me\/settings/);
}

/**
 * AUTH-21 on the teen's page; the guardian opens the link in their own browser (AUTH-22), signs
 * in and agrees (AUTH-20); the teen's page sees the answer by polling (AUTH-23).
 */
export async function guardianLink(
  page: Page,
  guardianPage: Page,
  scope: string,
  guardian: { email: string; name: string },
) {
  await page.goto("/me/settings");
  await page.getByTestId(`set-consent-${scope}`).click();
  await expect(page.getByTestId("auth-18")).toBeVisible();
  await page.getByTestId("consent-link").click();
  await expect(page.getByTestId("auth-21")).toBeVisible();
  await expectAccessible(page, "AUTH-21");
  const link = (await page.getByTestId("consent-link-url").textContent()) ?? "";
  const code = link.trim().split("/").filter(Boolean).pop() ?? "";
  expect(code).toMatch(/^[A-Za-z0-9]{6,12}$/);
  await guardianPage.goto(`/guardian/${code}`);
  await expect(guardianPage.getByTestId("auth-22")).toBeVisible();
  await expectAccessible(guardianPage, "AUTH-22");
  await devGoogle(guardianPage, guardian.email, guardian.name);
  await expect(guardianPage.getByTestId("auth-20")).toBeVisible();
  await guardianPage.getByTestId("consent-declaration").click();
  await guardianPage.getByTestId("consent-agree").click();
  await expect(guardianPage.getByTestId("auth-20-done")).toBeVisible();
  await expect(page.getByTestId("auth-23")).toHaveAttribute("data-status", "granted", {
    timeout: 20_000,
  });
  await page.getByTestId("consent-result-continue").click();
}

/** AUTH-24 → SET-14: the guardian sees the teen and turns one scope off (SET-17). */
export async function parentTurnsOff(
  page: Page,
  scope: string,
  guardian: { email: string; name: string },
) {
  await page.goto("/parent");
  await expect(page.getByTestId("auth-24")).toBeVisible();
  await expectAccessible(page, "AUTH-24");
  await devGoogle(page, guardian.email, guardian.name);
  await expect(page.getByTestId("set-14")).toBeVisible();
  const row = page.locator(`[data-testid=learner-scope-${scope}]`).first();
  await expect(row).toHaveAttribute("data-on", "true");
  await expectAccessible(page, "SET-14");
  await page.getByTestId(`learner-off-${scope}`).first().click();
  await page
    .getByTestId("learner-off-confirm")
    .getByRole("button", { name: /turn off|बंद करें/i })
    .click();
  await expect(row).toHaveAttribute("data-on", "false");
  await page.getByTestId("parent-exit").click();
}

/** MEM-07 decks → MEM-03 review (Good on every card) → MEM-04 complete; MEM-28 → MEM-29 focus. */
export async function memory(page: Page) {
  await page.goto("/memory/decks");
  await expect(page.getByTestId("mem-07")).toBeVisible();
  await expectAccessible(page, "MEM-07");
  await page.goto("/review?mode=normal");
  for (let i = 0; i < 40; i++) {
    if (await visible(page.getByTestId("mem-04"), 300)) break;
    const show = page.getByTestId("show-answer");
    if (await visible(show, 300)) {
      await show.click();
      await page.getByTestId("rating-buttons").getByRole("button").nth(2).click();
      continue;
    }
    const skip = page.getByTestId("review-missing").getByRole("button");
    if (await visible(skip, 300)) await skip.click();
  }
  await expect(page.getByTestId("mem-04")).toBeVisible();
  await expectAccessible(page, "MEM-04");
  await page.goto("/focus");
  await expect(page.getByTestId("mem-28")).toBeVisible();
  await expectAccessible(page, "MEM-28");
  await page.getByTestId("focus-start").click();
  await expect(page.getByTestId("mem-29")).toHaveAttribute("data-phase", "focus");
  await expectAccessible(page, "MEM-29");
  await page.getByTestId("focus-pause").click();
  await page
    .getByTestId("mem-29")
    .getByRole("button", { name: /close|बंद/i })
    .first()
    .click();
  await page.getByTestId("focus-end").getByRole("button").first().click();
  await expect(page.getByTestId("mem-30")).toBeVisible();
}
