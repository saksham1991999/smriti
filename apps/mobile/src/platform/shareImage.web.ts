import type { RefObject } from 'react';
import type { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import type { ShareTarget } from './shareImage';

export type { ShareTarget } from './shareImage';

/** Web preview: the Web Share API with a file where the browser has it, else a download. */
export async function canShareImage(): Promise<boolean> {
  return typeof document !== 'undefined';
}

async function toBlob(dataUri: string): Promise<Blob> {
  return (await fetch(dataUri)).blob();
}

export async function shareViewAsImage(view: RefObject<View | null>, dialogTitle: string, fileName = 'result.png'): Promise<ShareTarget | null> {
  if (!view.current) return null;
  const dataUri = await captureRef(view, { format: 'png', quality: 1, result: 'data-uri' });
  const file = new File([await toBlob(dataUri)], fileName, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    await nav.share({ files: [file], title: dialogTitle });
    return 'web_share';
  }
  const a = document.createElement('a');
  a.href = dataUri;
  a.download = fileName;
  a.click();
  return 'download';
}
