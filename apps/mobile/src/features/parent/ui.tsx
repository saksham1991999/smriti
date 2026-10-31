import { useStoreSelector } from '@smriti/app-core/react';
import { Text, useTheme } from '@smriti/ui-native';
import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp, useT, useUiState } from '../../services/context';
import { busiestDay, weekdayLong, weekdayShort } from './services';
import { parentSession } from './session';

/** Parent mode screens open only after SET-13 (me-money §4.7). */
export function ParentOnly({ children }: { children: ReactNode }) {
  const app = useApp();
  const unlocked = useStoreSelector(parentSession(app).store, (s) => s.unlocked);
  if (!unlocked) return <Redirect href="/grown-ups" />;
  return <>{children}</>;
}

/**
 * The 7-bar minutes chart (SET-14 mini, SET-15 full). Bars in `primary`, weekday labels, and a
 * text summary for screen readers ("Most on Saturday, 42 minutes").
 */
export function MinuteBars({ days, height = 64, showValues = false, testID }: { days: { day: string; minutes: number }[]; height?: number; showValues?: boolean; testID?: string }) {
  const t = useT();
  const theme = useTheme();
  const locale = useUiState((s) => s.locale);
  const max = Math.max(1, ...days.map((d) => d.minutes));
  const top = busiestDay(days);
  const summary = top ? t('me_money:SET-14.chart_a11y', { day: weekdayLong(top.day, locale), n: top.minutes }) : t('me_money:SET-14.chart_empty_a11y');
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary} style={styles.chart} testID={testID}>
      {days.map((d) => (
        <View key={d.day} style={styles.col}>
          {showValues ? (
            <Text variant="caption" tone="muted" numeric>
              {String(d.minutes)}
            </Text>
          ) : null}
          <View style={[styles.track, { height }]}>
            {/* An empty day keeps a thin baseline so the week still reads as seven days. */}
            <View style={{ height: d.minutes > 0 ? Math.max(6, Math.round((d.minutes / max) * height)) : 4, backgroundColor: d.minutes > 0 ? theme.colors.primary : theme.colors.track, borderRadius: theme.radius.xs }} />
          </View>
          <Text variant="caption" tone="muted">
            {weekdayShort(d.day, locale)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { flexDirection: 'row', gap: 6, alignItems: 'flex-end' },
  col: { flex: 1, alignItems: 'center', gap: 4 },
  track: { width: '100%', justifyContent: 'flex-end', overflow: 'hidden' },
});
