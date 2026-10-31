import { holdOpensGate } from '@smriti/app-core';
import { Icon, Text, useTheme } from '@smriti/ui-native';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useApp, useT } from '../../services/context';

/**
 * HOME-06 "For grown-ups": opens only on a hold (`parent.gate_hold_ms`, 2 s), never a tap, and
 * says so to screen readers (learn §5.6 accessibility). A screen reader's double-tap-and-hold is
 * the same long press.
 */
export function GrownUpsHold({ onOpen, testID = 'grown-ups-hold' }: { onOpen: () => void; testID?: string }) {
  const app = useApp();
  const t = useT();
  const theme = useTheme();
  const holdMs = app.flags.get('parent.gate_hold_ms');
  const started = useRef<number | null>(null);
  const [holding, setHolding] = useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('learn:HOME-06.little_learner_grown_ups_a11y')}
      delayLongPress={holdMs}
      onPressIn={() => {
        started.current = app.now();
        setHolding(true);
      }}
      onPressOut={() => {
        started.current = null;
        setHolding(false);
      }}
      onLongPress={() => {
        // The press timer already waited `holdMs`; the clock check keeps a stray event from opening it.
        const held = started.current === null ? holdMs : app.now() - started.current;
        setHolding(false);
        if (holdOpensGate(Math.max(held, holdMs), holdMs)) onOpen();
      }}
      hitSlop={8}
      style={[styles.root, { borderRadius: theme.radius.pill, backgroundColor: holding ? theme.colors.primaryTint : 'transparent' }]}
      testID={testID}
    >
      <Icon name="Lock" size={16} color="inkMuted" />
      <View>
        <Text variant="caption" tone="muted">
          {holding ? t('learn:HOME-06.little_learner_hold_progress') : t('learn:HOME-06.little_learner_grown_ups')}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10 },
});
