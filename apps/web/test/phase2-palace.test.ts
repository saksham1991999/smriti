import { describe, expect, it } from "vitest";
import { InMemoryStorage, MemoryKeyValueStore, SrsScheduler } from "@smriti/app-core";
import type { Services } from "../src/boot/services";
import { addItems, allSpots, autoPlace, cardText, nextWalk, place, remembered, removeItem, shortLabel, spotKey, spotPositions, unplace, walkStops, whenFrom, type Placement } from "../src/screens/phase2/palace/logic";
import { createPalace, deletePalace, listPalaces, loadPalace, savePalace } from "../src/screens/phase2/palace/store";

const rooms = [
  { id: "b", sort: 1 },
  { id: "a", sort: 0 },
];

describe("palace spots", () => {
  it("lays five spots left to right along a zig-zag path inside the room", () => {
    const pos = spotPositions(5);
    expect(pos).toHaveLength(5);
    expect(pos.map((p) => p.x)).toEqual([...pos.map((p) => p.x)].sort((x, y) => x - y));
    expect(pos.every((p) => p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1)).toBe(true);
    expect(pos[0]?.y).not.toBe(pos[1]?.y);
  });

  it("walks rooms by sort order, then spot", () => {
    expect(allSpots(rooms, 2)).toEqual(["a:0", "a:1", "b:0", "b:1"]);
  });
});

describe("placing items (MEM-14)", () => {
  const start: Placement = { placed: {}, tray: ["x", "y", "z"] };

  it("moves an item from the tray to a spot", () => {
    const p = place(start, "y", spotKey("a", 2));
    expect(p.placed).toEqual({ "a:2": "y" });
    expect(p.tray).toEqual(["x", "z"]);
  });

  it("swaps two items when one is dropped on a filled spot", () => {
    let p = place(start, "x", "a:0");
    p = place(p, "y", "a:1");
    p = place(p, "y", "a:0");
    expect(p.placed).toEqual({ "a:0": "y", "a:1": "x" });
    // From the tray onto a filled spot: the old item goes back to the tray.
    p = place(p, "z", "a:0");
    expect(p.placed["a:0"]).toBe("z");
    expect(p.tray).toEqual(["y"]);
  });

  it("auto-places the tray in walk order, skipping filled spots", () => {
    const p = autoPlace(place(start, "z", "a:0"), allSpots(rooms, 2));
    expect(p.placed).toEqual({ "a:0": "z", "a:1": "x", "b:0": "y" });
    expect(p.tray).toEqual([]);
  });

  it("unplaces, removes and adds without duplicates", () => {
    let p = place(start, "x", "a:0");
    p = unplace(p, "a:0");
    expect(p.tray[0]).toBe("x");
    p = removeItem(p, "y");
    expect(p.tray).toEqual(["x", "z"]);
    p = addItems(p, ["z", "w", "w"]);
    expect(p.tray).toEqual(["x", "z", "w"]);
  });

  it("lists the walk stops in order", () => {
    const stops = walkStops(rooms, { "b:0": "q", "a:3": "p" });
    expect(stops.map((s) => [s.key, s.ref])).toEqual([
      ["a:3", "p"],
      ["b:0", "q"],
    ]);
  });
});

describe("next walk (MEM-12, MEM-18)", () => {
  const srs = new SrsScheduler({ enableFuzz: false });
  const now = Date.parse("2026-10-30T10:00:00Z");

  it("is now (not due) for a palace never quizzed, and the earliest rated item otherwise", () => {
    expect(nextWalk({}, ["a"], now)).toEqual({ at: null, due: false });
    const a = srs.schedule(srs.newCard("palace:a", now), 3, now).card;
    const b = { ...srs.newCard("palace:b", now), due_at: new Date(now - 1000).toISOString() };
    expect(nextWalk({ a, b }, ["a", "b"], now)).toEqual({ at: now - 1000, due: true });
    expect(nextWalk({ a }, ["a"], now).due).toBe(false);
  });

  it("names the day", () => {
    expect(whenFrom(null, now)).toEqual({ key: "now" });
    expect(whenFrom(now + 60_000, now)).toEqual({ key: "today" });
    expect(whenFrom(now + 86_400_000, now)).toEqual({ key: "tomorrow" });
    expect(whenFrom(now + 4 * 86_400_000, now)).toEqual({ key: "days", n: 4 });
  });

  it("counts everything but Again as remembered", () => {
    expect(remembered([1, 2, 3, 4, 1])).toBe(3);
  });
});

describe("labels", () => {
  it("reads card sides and shortens long labels", () => {
    expect(cardText({ text: "Front" })).toBe("Front");
    expect(cardText("Plain")).toBe("Plain");
    expect(cardText({ text: { en: "En", hi: "Hi" } })).toBe("En");
    expect(cardText(null)).toBe("");
    expect(shortLabel("a".repeat(40), 10)).toBe(`${"a".repeat(9)}…`);
  });
});

describe("palace store", () => {
  const services = () => ({ storage: new InMemoryStorage(), kv: new MemoryKeyValueStore() }) as unknown as Pick<Services, "storage" | "kv">;

  it("creates a home palace with three rooms and the items in the tray, then saves placements", async () => {
    const s = services();
    const doc = await createPalace(s, { name: "Home", template: "home", roomName: (k) => k.name, items: [{ ref: "kp:c#0", label: "One" }, { ref: "kp:c#1", label: "Two" }], source: "list" });
    expect(doc.rooms.map((r) => r.background_asset_id)).toEqual(["scene-memory-palace", "scene-pet-room", "scene-notebook-desk"]);
    expect(doc.placement.tray).toEqual(["kp:c#0", "kp:c#1"]);

    const room = doc.rooms[1]?.id as string;
    const placement = place(doc.placement, "kp:c#1", spotKey(room, 3));
    await savePalace(s, { ...doc, placement, extras: { ...doc.extras, notes: { [spotKey(room, 3)]: "A silly scene" } } });
    const back = await loadPalace(s, doc.palace.id);
    expect(back?.placement).toEqual({ placed: { [spotKey(room, 3)]: "kp:c#1" }, tray: ["kp:c#0"] });
    expect(back?.extras.labels["kp:c#1"]).toBe("Two");
    const loci = await s.storage.palace_loci.where({ room_id: room });
    expect(loci).toHaveLength(1);
    expect(loci[0]).toMatchObject({ sort: 3, item_ref: "kp:c#1", note: "A silly scene" });

    // Moving the item rewrites the room's spots rather than adding to them.
    await savePalace(s, { ...back!, placement: place(back!.placement, "kp:c#1", spotKey(room, 0)) });
    expect((await s.storage.palace_loci.where({ room_id: room })).map((l) => l.sort)).toEqual([0]);
  });

  it("lists palaces and hides deleted ones", async () => {
    const s = services();
    const a = await createPalace(s, { name: "A", template: "custom", roomName: () => "R", items: [], source: "list" });
    await createPalace(s, { name: "B", template: "home", roomName: () => "R", items: [], source: "deck" });
    expect((await listPalaces(s)).map((d) => d.palace.name).sort()).toEqual(["A", "B"]);
    await deletePalace(s, a);
    expect((await listPalaces(s)).map((d) => d.palace.name)).toEqual(["B"]);
    expect(await loadPalace(s, a.palace.id)).toBeNull();
  });
});
