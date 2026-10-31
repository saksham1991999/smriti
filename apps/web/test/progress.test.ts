import { describe, expect, it } from "vitest";
import type { T } from "../src/lib/i18n";
import { emptyLine } from "../src/screens/practice/Progress";

const t = ((key: string, values?: Record<string, unknown>) => `${key}${values ? JSON.stringify(values) : ""}`) as unknown as T;

describe("PRC-14 empty cards", () => {
  it("shows nothing over a card the server shows", () => {
    expect(emptyLine(t, { shown: true, have: 40, needed: 30 }, "answers")).toBeNull();
  });

  it("counts what is still needed from the server's own numbers", () => {
    expect(emptyLine(t, { shown: false, have: 12, needed: 30, reason: "not_enough_data" }, "answers")).toBe('practice:PRC-14.card_empty_answers{"n":18}');
    expect(emptyLine(t, { shown: false, have: 3, needed: 20, reason: "not_enough_data" }, "confidence")).toBe('practice:PRC-14.card_empty_confidence{"n":17}');
  });

  it("never invents a count when the threshold is unset or the card is missing", () => {
    expect(emptyLine(t, { shown: false, have: 5, needed: null, reason: "threshold_unset" }, "answers")).toBe("practice:PRC-14.card_waiting");
    expect(emptyLine(t, undefined, "answers")).toBe("practice:PRC-14.card_waiting");
  });
});
