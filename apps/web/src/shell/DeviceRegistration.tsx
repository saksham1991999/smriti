/**
 * Registers this browser with `/v1/devices` once a session exists: when the notification
 * permission changed since the last registration, and once a day while pushes are allowed (a
 * push subscription can change under us). Renders nothing.
 */
import { useEffect } from "react";
import { useAppStore } from "@smriti/app-core/react";
import { useServices } from "../boot/context";
import { useI18n } from "../lib/i18n";
import { notificationPermission, registerDevice } from "../lib/push";
import { prefs } from "../platform/web";

export function DeviceRegistration() {
  const s = useServices();
  const { locale } = useI18n();
  const userId = useAppStore((x) => x.session.userId);
  useEffect(() => {
    if (!userId || s.fakeApi) return;
    const permission = notificationPermission();
    const today = new Date().toISOString().slice(0, 10);
    const key = `${userId}:${permission}:${locale}`;
    if (
      prefs.get("device_registered_key") === key &&
      (permission !== "granted" || prefs.get("device_registered_day") === today)
    )
      return;
    const id = setTimeout(() => {
      void registerDevice(s, locale).then(() => {
        prefs.set("device_registered_key", key);
        prefs.set("device_registered_day", today);
      });
    }, 1500);
    return () => clearTimeout(id);
  }, [s, userId, locale]);
  return null;
}
