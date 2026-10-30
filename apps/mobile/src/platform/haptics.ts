import * as ExpoHaptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Haptics (DESIGN.md motion). Respects the student's Settings switch (SET-08) and stays quiet when
 * the OS asks for reduced motion. iOS also honours the system "System Haptics" setting itself.
 */
export interface Haptics {
  tap(): void;
  success(): void;
  warning(): void;
}

export function createHaptics(enabled: () => boolean): Haptics {
  const on = () => Platform.OS !== 'web' && enabled();
  return {
    tap: () => {
      if (on()) void ExpoHaptics.selectionAsync().catch(() => undefined);
    },
    success: () => {
      if (on()) void ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Success).catch(() => undefined);
    },
    warning: () => {
      if (on()) void ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Warning).catch(() => undefined);
    },
  };
}

export const silentHaptics: Haptics = { tap() {}, success() {}, warning() {} };
