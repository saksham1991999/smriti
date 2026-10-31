/**
 * G-6 memory palaces (MEM-12 to MEM-18) against the fake API. Palaces live on the device, so the
 * spec only needs a learned topic (written straight into the local database) and Pro.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./journey";
import { makePro, seedStudent, shoot, type Locale } from "./phase2";

const TOPIC = "fx.chapter-a.topic-a";

/** Marks the fixture topic as learned in the app's local database (as a finished lesson would). */
async function learnTopic(page: Page) {
  await page.evaluate(
    (id) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("smriti-local");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("topic_status", "readwrite");
          tx.objectStore("topic_status").put({ k: id, topic_id: id, status: "learned", learned_via: "lesson", updated_at: new Date().toISOString() });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    TOPIC,
  );
}

for (const locale of ["en", "hi"] as Locale[]) {
  test(`palace: build, place, walk and quiz (${locale})`, async ({ page }) => {
    await seedStudent(page, locale);
    await page.goto("/memory/palaces");
    await expect(page.getByTestId("mem-12-empty")).toBeVisible();
    await expect(page.getByTestId("mem-12-pro")).toBeVisible();
    await expectAccessible(page, "MEM-12 free");
    await shoot(page, locale, "MEM-12-free");

    await makePro(page);
    await learnTopic(page);
    await page.goto("/memory/palaces");
    await expect(page.getByTestId("mem-12")).toBeVisible();
    await expect(page.getByTestId("mem-12-pro")).toBeHidden({ timeout: 15_000 });
    await page.getByTestId("mem-12-build").click();

    // MEM-13: pick Home, the name field appears pre-filled.
    await expect(page.getByTestId("mem-13")).toBeVisible();
    await page.getByTestId("mem-13-home").click();
    await expect(page.getByTestId("mem-13-name-input")).toHaveValue(locale === "hi" ? "घर" : "Home");
    await expectAccessible(page, "MEM-13");
    await shoot(page, locale, "MEM-13");
    await page.getByTestId("mem-13-next").click();

    // MEM-15: both fixture lists, four items.
    await expect(page.getByTestId("mem-15")).toBeVisible();
    await page.getByTestId(`mem-15-list-${TOPIC}.sub-1.concept-1`).click();
    await page.getByTestId(`mem-15-list-${TOPIC}.sub-1.concept-2`).click();
    await expect(page.getByTestId("mem-15-use")).toContainText("4");
    await expectAccessible(page, "MEM-15");
    await shoot(page, locale, "MEM-15");
    await page.getByTestId("mem-15-use").click();

    // MEM-14: tap an item, then a spot; then auto-place the rest.
    await expect(page.getByTestId("mem-14")).toBeVisible();
    await expect(page.getByTestId("mem-14-tray")).toContainText("A1.1");
    await shoot(page, locale, "MEM-14");
    await page.getByTestId("mem-14-item-1").click();
    await expect(page.getByTestId("mem-14-holding")).toBeVisible();
    await expectAccessible(page, "MEM-14 placing");
    await shoot(page, locale, "MEM-14-placing");
    await page.getByTestId("mem-14-canvas-spot-0").click();
    await expect(page.getByTestId("mem-14-placed")).toContainText("A1.2");
    await page.getByTestId("mem-14-auto").click();
    await expect(page.getByTestId("mem-14-placed").getByRole("listitem")).toHaveCount(4);
    await expectAccessible(page, "MEM-14");

    // MEM-16: a scene note on spot 1.
    await page.getByTestId("mem-14-canvas-spot-0").click();
    await expect(page.getByTestId("mem-16")).toBeVisible();
    await page.getByTestId("mem-16-note").fill(locale === "hi" ? "झूले पर बैठा एक बड़ा तोता" : "A giant parrot on the swing");
    await expectAccessible(page, "MEM-16");
    await shoot(page, locale, "MEM-16");
    await page.getByTestId("mem-16-save").click();
    await expect(page.getByTestId("mem-14-tray")).toBeVisible();

    // MEM-17: walk all four spots.
    await page.getByTestId("mem-14-walk").click();
    await expect(page.getByTestId("mem-17")).toBeVisible();
    await expect(page.getByTestId("mem-17-item")).toContainText("A1.2");
    await expect(page.getByTestId("mem-17-card")).toContainText(locale === "hi" ? "तोता" : "parrot");
    await expectAccessible(page, "MEM-17");
    await shoot(page, locale, "MEM-17");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("mem-17-counter")).toContainText("2");
    await page.getByTestId("mem-17-next").click();
    await page.getByTestId("mem-17-next").click();
    await expect(page.getByTestId("mem-17-quiz")).toBeVisible();
    await shoot(page, locale, "MEM-17-end");
    await page.getByTestId("mem-17-quiz").click();

    // MEM-18: show, then rate; one Again.
    await expect(page.getByTestId("mem-18")).toBeVisible();
    await expect(page.getByTestId("mem-18-item")).toHaveCount(0);
    await shoot(page, locale, "MEM-18");
    await page.getByTestId("mem-18-show").click();
    await expect(page.getByTestId("mem-18-item")).toContainText("A1.2");
    await expectAccessible(page, "MEM-18");
    await shoot(page, locale, "MEM-18-shown");
    await page.getByTestId("mem-18-rate").getByRole("button").nth(2).click();
    for (const key of ["1", "3", "4"]) {
      await page.getByTestId("mem-18-show").click();
      await page.keyboard.press(key);
    }
    await expect(page.getByTestId("mem-18-result")).toBeVisible();
    await expect(page.getByTestId("mem-18-remembered")).toContainText("3 / 4");
    await expect(page.getByTestId("mem-18-missed-list").getByRole("listitem")).toHaveCount(1);
    await expectAccessible(page, "MEM-18 result");
    await shoot(page, locale, "MEM-18-result");

    // Back on MEM-12 the palace card shows its rooms, items and next walk.
    await page.getByTestId("mem-18-done").click();
    await expect(page.getByTestId("mem-12")).toBeVisible();
    await expect(page.locator('article[data-testid^="mem-12-palace-"]')).toHaveCount(1);
    await expect(page.locator('article[data-testid^="mem-12-palace-"]').first()).toContainText(locale === "hi" ? "3 कमरे" : "3 rooms");
    await expectAccessible(page, "MEM-12");
    await shoot(page, locale, "MEM-12");
  });
}
