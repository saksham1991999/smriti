import { Icon, Text, useTheme } from "@smriti/ui-native";
import { Image, StyleSheet, View } from "react-native";

import { sharedKey, usePlayer } from "./context";

/**
 * A card picture from `bundle.media`. Pictures are Agnes art published with the bundle; when one is
 * not approved yet or not on the device, the alt text shows in a quiet box instead (never a
 * stand-in drawing).
 */
export function Media({ mediaRef, testID, maxHeight = 220 }: { mediaRef: string | null | undefined; testID?: string; maxHeight?: number }) {
  const { bundle, resolveMedia, t } = usePlayer();
  const theme = useTheme();
  if (!mediaRef) return null;
  const m = bundle.media[mediaRef];
  if (!m) return null;
  const source = m.status === "ready" && m.url ? resolveMedia(m.url) : undefined;
  const ratio = m.width && m.height ? m.width / m.height : 4 / 3;
  if (!source) {
    if (m.decorative) return null;
    return (
      <View
        testID={testID}
        accessible
        accessibilityLabel={m.alt ?? t(sharedKey("media_missing"))}
        style={[styles.missing, { backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.md }]}
      >
        <Icon name="FileText" size={20} color="inkMuted" />
        <Text variant="caption" tone="muted">
          {m.alt ?? t(sharedKey("media_missing"))}
        </Text>
      </View>
    );
  }
  return (
    <Image
      testID={testID}
      source={source}
      accessible={!m.decorative}
      accessibilityLabel={m.decorative ? undefined : (m.alt ?? undefined)}
      accessibilityElementsHidden={m.decorative}
      importantForAccessibility={m.decorative ? "no-hide-descendants" : "yes"}
      resizeMode="contain"
      style={[styles.img, { aspectRatio: ratio, maxHeight, borderRadius: theme.radius.md }]}
    />
  );
}

const styles = StyleSheet.create({
  img: { width: "100%" },
  missing: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12 },
});
