import type { NotificationPlan, PlannedNotification } from '@smriti/app-core';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/** The OS side of local notifications. Tests use `MemoryNotifier`. */
export interface LocalNotifier {
  permission(): Promise<'granted' | 'denied' | 'undetermined'>;
  /** Shows the OS prompt (ONB-15 [Yes, remind me]). */
  requestPermission(): Promise<boolean>;
  /** Replaces every scheduled habit notification with the plan. */
  replacePlan(items: { id: string; fireAt: string; title: string; body: string; deepLink: string }[]): Promise<void>;
}

/** Copy for one planned send (already localised by the caller). */
export type NotificationCopy = (item: PlannedNotification) => { title: string; body: string };

/** Rebuilds the device's 7-day plan from app-core's `planLocalNotifications` (TRD §12). */
export async function applyNotificationPlan(notifier: LocalNotifier, plan: NotificationPlan, copy: NotificationCopy): Promise<number> {
  if ((await notifier.permission()) !== 'granted') return 0;
  const items = plan.items.map((i) => ({ id: i.id, fireAt: i.fireAt, deepLink: i.deepLink, ...copy(i) }));
  await notifier.replacePlan(items);
  return items.length;
}

const HABIT_CHANNEL = 'habit';

/** expo-notifications. Daily reminders are scheduled locally so they work offline (TRD §3). */
export class ExpoNotifier implements LocalNotifier {
  private channelReady = false;

  async permission() {
    const s = await Notifications.getPermissionsAsync();
    return s.granted ? 'granted' : s.canAskAgain ? 'undetermined' : 'denied';
  }

  async requestPermission() {
    await this.ensureChannel();
    const s = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: true } });
    return s.granted;
  }

  async replacePlan(items: { id: string; fireAt: string; title: string; body: string; deepLink: string }[]) {
    await this.ensureChannel();
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of scheduled) {
      if ((n.content.data as { class?: string } | undefined)?.class === 'habit') await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
    const now = Date.now();
    for (const i of items) {
      const at = Date.parse(i.fireAt);
      if (!(at > now)) continue;
      await Notifications.scheduleNotificationAsync({
        identifier: i.id,
        content: { title: i.title, body: i.body, data: { class: 'habit', url: i.deepLink } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at), channelId: HABIT_CHANNEL },
      });
    }
  }

  private async ensureChannel() {
    if (this.channelReady || Platform.OS !== 'android') return;
    await Notifications.setNotificationChannelAsync(HABIT_CHANNEL, { name: 'Habit', importance: Notifications.AndroidImportance.DEFAULT });
    this.channelReady = true;
  }
}

/** In-memory notifier for tests and the web preview. */
export class MemoryNotifier implements LocalNotifier {
  status: 'granted' | 'denied' | 'undetermined' = 'undetermined';
  scheduled: { id: string; fireAt: string; title: string; body: string; deepLink: string }[] = [];
  constructor(private readonly grantOnRequest = true) {}
  async permission() {
    return this.status;
  }
  async requestPermission() {
    this.status = this.grantOnRequest ? 'granted' : 'denied';
    return this.grantOnRequest;
  }
  async replacePlan(items: { id: string; fireAt: string; title: string; body: string; deepLink: string }[]) {
    this.scheduled = [...items];
  }
}
