import type { Network } from '@smriti/app-core';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';

/**
 * app-core's `Network` on NetInfo. "Online" means connected and not known to be unreachable
 * (`isInternetReachable` is null until NetInfo has checked, which counts as online).
 */
export class NetInfoNetwork implements Network {
  private online = true;
  private cellular = false;
  private listeners = new Set<(online: boolean) => void>();
  private unsubscribe: (() => void) | null = null;

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = NetInfo.addEventListener((s) => this.update(s));
    void NetInfo.fetch().then((s) => this.update(s));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private update(s: NetInfoState) {
    this.cellular = s.type === 'cellular';
    const next = Boolean(s.isConnected) && s.isInternetReachable !== false;
    if (next === this.online) return;
    this.online = next;
    for (const l of [...this.listeners]) l(next);
  }

  isOnline(): boolean {
    return this.online;
  }

  /** On mobile data (NetInfo `type === 'cellular'`): LRN-15 "Wi-Fi only" and LAB-03's size confirm. */
  isCellular(): boolean {
    return this.cellular;
  }

  subscribe(listener: (online: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/**
 * Runs `onForeground` when the app comes back to the foreground (AppState `active`), which is
 * when the outbox flushes and the notification plan is rebuilt (TRD §12).
 */
export function onForeground(onForegroundFn: () => void): () => void {
  let last: AppStateStatus = AppState.currentState;
  const sub = AppState.addEventListener('change', (next) => {
    if (last !== 'active' && next === 'active') onForegroundFn();
    last = next;
  });
  return () => sub.remove();
}
