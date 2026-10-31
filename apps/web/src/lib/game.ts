/**
 * The pet, plant, gem shop and quests on the server (`/v1/pet`, `/v1/plant`, `/v1/shop`,
 * `/v1/quests`, `/v1/streak/freeze`). The server decides every cap and price; the app-core rules
 * only predict what the buttons show. Every write carries an idempotency key, so a retry is safe.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { newIdempotencyKey, unwrap, type Schemas } from "@smriti/api-client";
import { careActionToWire, type PetCareAction } from "@smriti/app-core";
import { useAppStore } from "@smriti/app-core/react";
import { useServices } from "../boot/context";
import type { Services } from "../boot/services";

export type PetResponse = Schemas["PetResponse"];
export type ShopItem = Schemas["ShopItemOut"];
export type Quest = Schemas["QuestOut"];
export type Plant = Schemas["PlantState"];

const idem = () => ({ header: { "Idempotency-Key": newIdempotencyKey() } });

export const gameKeys = {
  pet: ["game", "pet"] as const,
  plant: ["game", "plant"] as const,
  shop: ["game", "shop"] as const,
  quests: ["game", "quests"] as const,
};

function useGameQuery<T>(key: readonly string[], fn: (s: Services) => Promise<T>) {
  const s = useServices();
  const userId = useAppStore((x) => x.session.userId);
  return useQuery({
    queryKey: [...key, userId],
    enabled: !!userId,
    retry: false,
    staleTime: 15_000,
    queryFn: () => fn(s),
  });
}

export const usePet = () =>
  useGameQuery(gameKeys.pet, (s) => unwrap(s.client.GET("/v1/pet"), s.client));
export const usePlant = () =>
  useGameQuery(gameKeys.plant, (s) => unwrap(s.client.GET("/v1/plant"), s.client));
export const useShop = () =>
  useGameQuery(gameKeys.shop, (s) => unwrap(s.client.GET("/v1/shop"), s.client));
export const useQuests = () =>
  useGameQuery(gameKeys.quests, (s) => unwrap(s.client.GET("/v1/quests"), s.client));

/** Refreshes the game queries and the synced state after a write. */
export function useGameRefresh() {
  const s = useServices();
  const qc = useQueryClient();
  return () => {
    for (const k of Object.values(gameKeys)) void qc.invalidateQueries({ queryKey: k });
    void s.refreshState().catch(() => undefined);
  };
}

/** ME-04 care: pet, play or a treat (sent as `feed` with the treat item). */
export async function careForPet(s: Services, action: PetCareAction): Promise<PetResponse> {
  const r = await unwrap(
    s.client.POST("/v1/pet/care", {
      params: idem(),
      body: { action: careActionToWire(action), item_id: action === "treat" ? "pet_treat" : null },
    }),
    s.client,
  );
  if (r.pet) s.store.getState().patch("pet", r.pet);
  return r;
}

/** ME-18 buy: the server checks price, caps and Pro; the store's gem balance follows its answer. */
export async function buyItem(s: Services, itemId: string) {
  const r = await unwrap(
    s.client.POST("/v1/shop/purchase", { params: idem(), body: { item_id: itemId } }),
    s.client,
  );
  s.store.getState().patch("wallet", { gems: r.gems });
  return r;
}

/** ME-20 claim. */
export async function claimQuest(s: Services, questId: string) {
  const r = await unwrap(
    s.client.POST("/v1/quests/{quest_id}/claim", {
      params: { ...idem(), path: { quest_id: questId } },
    }),
    s.client,
  );
  s.store.getState().patch("wallet", { gems: r.gems });
  return r;
}

/** Equips a held freeze into a slot (ME-10 / ME-17 freeze card). */
export async function equipFreeze(s: Services, slot: number) {
  const r = await unwrap(
    s.client.POST("/v1/streak/freeze", { params: idem(), body: { slot } }),
    s.client,
  );
  s.store.getState().patch("streak", r);
  return r;
}

/** How many of each care action the server counted today (`feed` is the treat). */
export function careUsed(p: PetResponse | undefined) {
  const c = p?.care_today ?? {};
  return { pet: c.pet ?? 0, play: c.play ?? 0, treat: c.feed ?? 0 };
}

/** Care left today, from the config caps (petting is capped by the mood it may add). */
export function careLeft(
  used: { pet: number; play: number; treat: number },
  caps: { moodCap: number; petGain: number; plays: number; treats: number },
) {
  const pets = caps.petGain > 0 ? Math.ceil(caps.moodCap / caps.petGain) : 0;
  return {
    pet: Math.max(0, pets - used.pet),
    play: Math.max(0, caps.plays - used.play),
    treat: Math.max(0, caps.treats - used.treat),
  };
}

/** Hours and minutes until an ISO date (quest resets). */
export function timeLeft(iso: string, now = Date.now()) {
  const ms = Math.max(0, Date.parse(iso) - now);
  const mins = Math.floor(ms / 60_000);
  return { h: Math.floor(mins / 60), m: mins % 60 };
}

export type RevivalLevel = "none" | "wilted" | "resting";

/** ME-08 applies to a wilted plant (3 days) or a resting one (5 days, `dormant`). */
export function revivalLevel(p: Pick<Plant, "health"> | null | undefined): RevivalLevel {
  if (!p) return "none";
  if (p.health === "dormant") return "resting";
  if (p.health === "wilted") return "wilted";
  return "none";
}
