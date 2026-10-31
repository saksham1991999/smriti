/**
 * Web Push and notification settings on the server (me-money §6.1, NTF-01/02, SET-03):
 * - `registerDevice` subscribes this browser with the server's VAPID key
 *   (`GET /v1/notifications/web-push-key`) and registers it with `POST /v1/devices`. Without a key
 *   (local) or a service worker (dev and e2e builds), the device is still registered with its
 *   permission state, so the server's rules know this browser can't receive pushes.
 * - `useNotificationPrefs` / `patchNotificationPrefs` read and change `/v1/notification-prefs`.
 * - `openedDeepLink` maps a push's deep link (the server's app paths) onto this app's routes.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { unwrap, type Schemas } from "@smriti/api-client";
import { useAppStore } from "@smriti/app-core/react";
import { useServices } from "../boot/context";
import type { Services } from "../boot/services";
import { timeZone } from "../platform/web";

export type NotificationPrefs = Schemas["NotificationPrefs"];
export type NotificationPrefsPatch = Schemas["NotificationPrefsPatch"];
type Permission = Schemas["DeviceRegister"]["notif_permission"];

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

const asPermission = (p: NotificationPermission | "unsupported"): Permission =>
  p === "granted"
    ? "granted"
    : p === "denied"
      ? "denied"
      : p === "unsupported"
        ? "not_required"
        : "not_asked";

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** The active service worker, or null when none registers within `ms` (dev and e2e builds have none). */
async function readyWorker(ms: number): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  const existing = await navigator.serviceWorker.getRegistration().catch(() => undefined);
  if (!existing) return null;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((r) => setTimeout(() => r(null), ms)),
  ]);
}

async function subscribe(s: Services): Promise<PushSubscriptionJSON | null> {
  const key = await unwrap(s.client.GET("/v1/notifications/web-push-key"), s.client).catch(
    () => null,
  );
  if (!key?.public_key) return null;
  const reg = await readyWorker(5000);
  if (!reg) return null;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(key.public_key),
    }));
  return sub.toJSON();
}

export interface DeviceResult {
  permission: NotificationPermission | "unsupported";
  webPush: boolean;
}

/** Registers this browser (and its push subscription when allowed) with the server. Never throws. */
export async function registerDevice(s: Services, locale: "en" | "hi"): Promise<DeviceResult> {
  const permission = notificationPermission();
  let sub: PushSubscriptionJSON | null = null;
  if (permission === "granted") {
    try {
      sub = await subscribe(s);
    } catch (err) {
      s.logger.warn("push.subscribe_failed", { code: err instanceof Error ? err.name : "unknown" });
    }
  }
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  const web = endpoint && p256dh && auth ? { endpoint, keys: { p256dh, auth } } : null;
  try {
    const out = await unwrap(
      s.client.POST("/v1/devices", {
        body: {
          platform: "web",
          app_version: __APP_VERSION__,
          locale,
          timezone: timeZone(),
          notif_permission: asPermission(permission),
          push_enabled: permission === "granted",
          web_push_subscription: web,
        },
      }),
      s.client,
    );
    return { permission, webPush: out.has_web_push };
  } catch (err) {
    s.logger.warn("push.register_failed", { code: (err as { code?: string }).code ?? "network" });
    return { permission, webPush: false };
  }
}

/** NTF-02 [Allow reminders]: the browser prompt (one per tap), then registration. */
export async function askPermission(s: Services, locale: "en" | "hi"): Promise<DeviceResult> {
  if (typeof Notification === "undefined") return { permission: "unsupported", webPush: false };
  const result = await Notification.requestPermission();
  s.analytics.track("notification_permission_result", { result, surface: "web" });
  return registerDevice(s, locale);
}

export function useNotificationPrefs() {
  const s = useServices();
  const userId = useAppStore((x) => x.session.userId);
  return useQuery({
    queryKey: ["notification-prefs", userId],
    enabled: !!userId && !s.fakeApi,
    retry: false,
    staleTime: 60_000,
    queryFn: () => unwrap(s.client.GET("/v1/notification-prefs"), s.client),
  });
}

/** PATCH one or more prefs; the cache shows the change at once and takes the server's answer. */
export function usePatchPrefs() {
  const s = useServices();
  const qc = useQueryClient();
  const userId = useAppStore((x) => x.session.userId);
  return async (patch: NotificationPrefsPatch): Promise<boolean> => {
    const key = ["notification-prefs", userId];
    const before = qc.getQueryData<NotificationPrefs>(key);
    if (before)
      qc.setQueryData<NotificationPrefs>(key, {
        ...before,
        ...(patch as Partial<NotificationPrefs>),
      });
    try {
      const next = await unwrap(
        s.client.PATCH("/v1/notification-prefs", { body: patch }),
        s.client,
      );
      qc.setQueryData(key, next);
      return true;
    } catch (err) {
      if (before) qc.setQueryData(key, before);
      s.logger.warn("notify.prefs_failed", { code: (err as { code?: string }).code ?? "network" });
      return false;
    }
  };
}

/** "19:00:00" → "19:00" (the server's `time` values). */
export const hhmm = (v: string | null | undefined) => (v ? v.slice(0, 5) : null);

/**
 * A push's deep link (NTF-01, the flow doc §6.3 paths) as a route of this app. Unknown links open
 * Home; links for screens the web app doesn't have open their nearest parent.
 */
export function openedDeepLink(url: string | null | undefined): string {
  const path = (url ?? "").split("?")[0] ?? "";
  const m = (re: RegExp) => path.match(re);
  if (path === "/review" || path.startsWith("/review")) return "/review";
  if (path === "/challenge") return "/practice/challenge";
  let x = m(/^\/mock\/([^/]+)$/);
  if (x) return `/practice/mock/${x[1]}`;
  if (path.startsWith("/mock/")) return "/practice/mocks";
  if (path === "/friends" || path.startsWith("/social")) return "/social";
  x = m(/^\/duel\/([^/]+)$/);
  if (x) return `/social/duel/${x[1]}`;
  if (path === "/pro") return "/pro?source=notification";
  if (path.startsWith("/pro/")) return "/me/plan";
  if (path === "/parent") return "/parent";
  if (path.startsWith("/guardian/requests/")) return "/guardian/link";
  if (path === "/garden" || path === "/pet" || path.startsWith("/books/")) return "/me";
  if (path.startsWith("/privacy/")) return "/me/settings";
  return "/learn";
}

/** Tells the server a push was opened (R34: resets the ignored count and auto-pause). */
export async function reportOpened(s: Services, id: string | null): Promise<void> {
  await unwrap(s.client.POST("/v1/notifications/opened", { body: { id } }), s.client).catch(
    () => undefined,
  );
}
