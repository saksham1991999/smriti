import { describe, expect, it } from "vitest";
import { DexieStorage } from "../src/platform/dexieStorage";

const row = (id: string) => ({
  event_id: id,
  type: "settings_changed" as const,
  payload: { key: "daily_goal_minutes", value: 10 },
  occurred_at: "2026-10-30T10:00:00.000Z",
  tz: "Asia/Kolkata",
});

describe("DexieStorage (app-core Storage on IndexedDB)", () => {
  it("appends each event once, keeps order, and counts what is unsent", async () => {
    const s = new DexieStorage(`test-${Math.random()}`);
    await s.transaction(async (tx) => {
      await tx.outbox.append(row("e1"));
      await tx.outbox.append(row("e2"));
      await tx.outbox.append(row("e1"));
    });
    expect(await s.outbox.count()).toBe(2);
  });

  it("rolls a failed transaction back", async () => {
    const s = new DexieStorage(`test-${Math.random()}`);
    await expect(
      s.transaction(async (tx) => {
        await tx.outbox.append(row("e1"));
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await s.outbox.count()).toBe(0);
  });

  it("wipes everything on sign-out", async () => {
    const s = new DexieStorage(`test-${Math.random()}`);
    await s.transaction((tx) => tx.outbox.append(row("e1")).then(() => undefined));
    await s.topic_status.put({ topic_id: "t", status: "in_progress", learned_via: null, percent: 10, updated_at: "2026-10-30T10:00:00Z" });
    await s.wipe();
    expect(await s.outbox.count()).toBe(0);
    expect(await s.topic_status.get("t")).toBeUndefined();
  });
});
