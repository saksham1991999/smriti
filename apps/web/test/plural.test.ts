import { describe, expect, it } from "vitest";
import { createI18n } from "@smriti/i18n/core";
import enLearn from "@smriti/i18n/locales/en/learn.json";
import hiLearn from "@smriti/i18n/locales/hi/learn.json";

describe("ICU plurals in the web catalogues", () => {
  it("says 1 chapter and 3 chapters on the home tiles", () => {
    const i18n = createI18n({ locale: "en", brand: "Test", resources: { en: { learn: enLearn }, hi: { learn: hiLearn } } });
    expect(i18n.t("learn:HOME-01.tile_meta", { n: 1 })).toBe("1 chapter");
    expect(i18n.t("learn:HOME-01.tile_meta", { n: 3 })).toBe("3 chapters");
    expect(i18n.t("learn:WEB-01.chapters_count", { n: 1 })).toBe("1 chapter");
  });
});
