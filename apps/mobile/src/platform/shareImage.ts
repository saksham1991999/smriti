import * as Sharing from 'expo-sharing';
import type { RefObject } from 'react';
import type { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

/** How the image left the app, for `daily_challenge_shared.share_target` (no recipient data). */
export type ShareTarget = 'os_sheet' | 'web_share' | 'download';

/** Whether this device can share an image (iOS and Android: the OS share sheet). */
export async function canShareImage(): Promise<boolean> {
  return Sharing.isAvailableAsync();
}

/**
 * Captures the view as a PNG in the cache folder and opens the OS share sheet with it. Nothing is
 * uploaded or sent through Smriti. Resolves with the target, or null when sharing is unavailable.
 */
export async function shareViewAsImage(view: RefObject<View | null>, dialogTitle: string): Promise<ShareTarget | null> {
  if (!view.current || !(await Sharing.isAvailableAsync())) return null;
  const uri = await captureRef(view, { format: 'png', quality: 1, result: 'tmpfile' });
  await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle });
  return 'os_sheet';
}
