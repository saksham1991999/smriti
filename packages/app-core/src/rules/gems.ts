import { DEFAULT_RULES, type RulesConfig } from './config';

/**
 * Gems and the shop (PRD §7, R36, me-money §3.6).
 * - Gems can never be bought with real money, by anyone. There is no gem product and no code path
 *   that credits gems from a payment: `GEM_SOURCES` is the complete list of ways to earn them.
 * - No random rewards: no loot boxes or mystery items.
 * - The balance never goes below 0; an overdraw is clamped and recorded as an adjustment.
 */

export const GEM_SOURCES = [
  'daily_quest',
  'weekly_quest',
  'badge',
  'league_promotion',
  'streak_milestone',
  'first_revival',
  'referral',
  'adjustment',
] as const;
export type GemSource = (typeof GEM_SOURCES)[number];

export const SHOP_ITEM_KINDS = ['freeze', 'pet_outfit', 'plant_skin', 'theme', 'palace_room', 'treat', 'room_theme'] as const;
export type ShopItemKind = (typeof SHOP_ITEM_KINDS)[number];

export interface ShopItem {
  id: string;
  kind: ShopItemKind;
  price_gems: number;
  pro_only: boolean;
  active: boolean;
}

export interface LedgerEntry {
  delta: number;
  reason: GemSource | `purchase:${string}`;
  ref?: string | null;
}

/** Applies a ledger entry; returns the clamped balance and an adjustment if one was needed. */
export function applyGemDelta(balance: number, entry: LedgerEntry): { balance: number; adjustment: LedgerEntry | null } {
  const next = balance + entry.delta;
  if (next >= 0) return { balance: next, adjustment: null };
  return { balance: 0, adjustment: { delta: -next, reason: 'adjustment', ref: entry.ref ?? null } };
}

export function gemsForStreakMilestone(day: number, cfg: Pick<RulesConfig, 'streakMilestoneGems'> = DEFAULT_RULES): number {
  return cfg.streakMilestoneGems[String(day)] ?? 0;
}

export type PurchaseBlockReason = 'balance' | 'cap' | 'pro_only' | 'offline' | 'inactive' | 'owned';

export interface PurchaseContext {
  gems: number;
  isPro: boolean;
  online: boolean;
  freezesEquipped: number;
  treatsHeld: number;
  /** Quantity of this item already owned (cosmetics are bought once). */
  owned: number;
}

/**
 * Can this item be bought now? Mirrors the server check (`POST /v1/shop/purchase`); the server
 * decides. Analytics `shop_purchase_blocked.reason` uses the same codes.
 */
export function checkPurchase(
  item: ShopItem,
  ctx: PurchaseContext,
  cfg: Pick<RulesConfig, 'freezeSlotsMax' | 'treatsMaxHeld'> = DEFAULT_RULES,
): { ok: true } | { ok: false; reason: PurchaseBlockReason } {
  if (!item.active) return { ok: false, reason: 'inactive' };
  if (!ctx.online) return { ok: false, reason: 'offline' }; // shop is read-only offline
  if (item.pro_only && !ctx.isPro) return { ok: false, reason: 'pro_only' };
  if (item.kind === 'freeze' && ctx.freezesEquipped >= cfg.freezeSlotsMax) return { ok: false, reason: 'cap' };
  if (item.kind === 'treat' && ctx.treatsHeld >= cfg.treatsMaxHeld) return { ok: false, reason: 'cap' };
  const stackable = item.kind === 'freeze' || item.kind === 'treat';
  if (!stackable && ctx.owned > 0) return { ok: false, reason: 'owned' };
  if (ctx.gems < item.price_gems) return { ok: false, reason: 'balance' };
  return { ok: true };
}

/** Items stay owned and equipped when Pro ends; only buying new Pro-only items needs Pro. */
export function canUseOwnedItem(_item: ShopItem, owned: number): boolean {
  return owned > 0;
}
