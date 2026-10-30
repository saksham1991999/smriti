import type { NotificationPlan, PlannedNotification } from '@smriti/app-core';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/** The OS side of local notifications. Tests use `MemoryNotifier`. */
export interface LocalNotifier {
  permission(): Promise<'granted' | 'denied' | 'undetermined'>;
  /** Shows the OS prompt (ONB-15 [Yes, remind me]). */
  requestPermission(): Promise<boolean>;
  /** Replaces every scheduled habit notification with the plan. */
  replacePlan(items: { id: string; fireAt: string; title: string; body: string; deepLink: string }[]): Promise<void>;
  /**
   * The Expo push token for server pushes (TRD §12), or null when there is none: no permission,
   * a simulator, the web preview, or no EAS project id yet (`EAS_PROJECT_ID`).
   */
  pushToken(): Promise<string | null>;
  /**
   * Calls back when the student taps a notification: its deep link (`data.url`) and, for a server
   * push, the outbox id (`data.id`) that `/v1/notifications/opened` stamps. Returns an unsubscribe.
   */
  onOpened(listener: (tap: { url: string | null; id: string | null }) => void): () => void;
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

  async pushToken() {
    if (Platform.OS === 'web') return null;
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    if (!projectId || (await this.permission()) !== 'granted') return null;
    try {
      return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    } catch {
      return null;
    }
  }

  onOpened(listener: (tap: { url: string | null; id: string | null }) => void) {
    if (Platform.OS === 'web') return () => undefined;
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const data = (r.notification.request.content.data ?? {}) as { url?: unknown; id?: unknown; class?: unknown };
      listener({ url: typeof data.url === 'string' ? data.url : null, id: data.class !== 'habit' && typeof data.id === 'string' ? data.id : null });
    });
    return () => sub.remove();
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
  /** Tests set a token to check registration with `/v1/devices`. */
  token: string | null = null;
  async pushToken() {
    return this.status === 'granted' ? this.token : null;
  }
  private listeners = new Set<(tap: { url: string | null; id: string | null }) => void>();
  onOpened(listener: (tap: { url: string | null; id: string | null }) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
  /** Tests: simulates a tap. */
  tap(t: { url: string | null; id: string | null }) {
    for (const l of this.listeners) l(t);
  }
}
