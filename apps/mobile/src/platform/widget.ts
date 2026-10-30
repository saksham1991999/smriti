import type { KeyValueStore, WidgetSnapshot } from '@smriti/app-core';

/**
 * Where the widget snapshot goes (TRD §3 Widgets, NTF-08..10). The native widgets are Phase 2:
 * iOS WidgetKit via expo-apple-targets reads the App Group `group.<bundleId>`, Android via
 * react-native-android-widget reads SharedPreferences. Until those targets exist, the snapshot
 * is written to the profile key-value store under `widget.snapshot.v1`, the same JSON the
 * native side will read, so the data contract is exercised now.
 */
export interface WidgetBridge {
  write(snapshot: WidgetSnapshot): Promise<void>;
  read(): Promise<WidgetSnapshot | null>;
}

export const WIDGET_KEY = 'widget.snapshot.v1';

export class KvWidgetBridge implements WidgetBridge {
  constructor(private readonly kv: KeyValueStore) {}
  async write(snapshot: WidgetSnapshot) {
    await this.kv.set(WIDGET_KEY, JSON.stringify(snapshot));
  }
  async read() {
    const raw = await this.kv.get(WIDGET_KEY);
    return raw ? (JSON.parse(raw) as WidgetSnapshot) : null;
  }
}
