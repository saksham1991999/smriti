import { IconButton, Text, useTheme } from '@smriti/ui-native';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * The page frame every screen uses: token background, safe areas, a 16 px gutter, an optional
 * pinned footer for the primary action (DESIGN.md §8 "one primary action, at the bottom").
 */
export function Screen({
  children,
  footer,
  scroll = true,
  testID,
  contentStyle,
  edges = 'both',
}: {
  children: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
  testID?: string;
  contentStyle?: ViewStyle;
  /** `top` when a tab bar sits below the screen. */
  edges?: 'both' | 'top';
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = edges === 'both' ? Math.max(insets.bottom, 16) : 16;
  const body = scroll ? (
    <ScrollView style={styles.grow} contentContainerStyle={[styles.content, contentStyle]} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.grow, styles.content, contentStyle]}>{children}</View>
  );
  return (
    <View testID={testID} style={[styles.root, { backgroundColor: theme.colors.bg, paddingTop: insets.top }]}>
      {body}
      {footer ? <View style={[styles.footer, { paddingBottom: footer ? bottom : 0 }]}>{footer}</View> : <View style={{ height: edges === 'both' ? insets.bottom : 0 }} />}
    </View>
  );
}

export function Stack({ gap = 12, children, style, row }: { gap?: number; children: ReactNode; style?: ViewStyle; row?: boolean }) {
  return <View style={[{ gap, flexDirection: row ? 'row' : 'column' }, row ? styles.rowAlign : null, style]}>{children}</View>;
}

/** Back button and title for pushed screens. */
export function BackHeader({ title, backLabel, onBack, trailing }: { title: string; backLabel: string; onBack: () => void; trailing?: ReactNode }) {
  return (
    <View style={styles.header}>
      <IconButton icon="CaretLeft" label={backLabel} onPress={onBack} testID="back" />
      <Text variant="title" heading style={styles.grow}>
        {title}
      </Text>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  root: { flex: 1 },
  grow: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24, gap: 16 },
  footer: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  rowAlign: { alignItems: 'center' },
});
