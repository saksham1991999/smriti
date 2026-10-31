import { useAttempts, usePracticeSessions } from '@smriti/api-client/react';
import { useAppStore } from '@smriti/app-core/react';
import { Banner, Button, Card, ChoiceChips, EmptyState, Icon, Spinner, Text } from '@smriti/ui-native';
import type { IconName } from '@smriti/tokens/ui';
import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp, useT, useUiState } from '../src/services/context';
import { groupByDay, historyRows, type HistoryFilter, type HistoryRow, type HistoryType } from '../src/services/history';
import { BackHeader, Screen } from '../src/ui/Screen';

const FILTERS: HistoryFilter[] = ['all', 'drill', 'pyq', 'challenge', 'mock'];
const ICON: Record<HistoryType, IconName> = { drill: 'Barbell', pyq: 'FileText', challenge: 'Lightning', mock: 'Exam' };
const LIMIT = 100;

/**
 * PRC-16, practice history: drills, PYQ papers, daily challenges and mocks grouped by day, from
 * `/v1/practice/sessions` and `/v1/attempts` (api-client hooks). Rows reopen the summary or report.
 */
export default function PracticeHistory() {
  const app = useApp();
  const t = useT();
  const locale = useUiState((s) => s.locale);
  const sessions = usePracticeSessions(LIMIT);
  const attempts = useAttempts(LIMIT);
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const rows = useMemo(() => historyRows(sessions.data ?? [], attempts.data ?? [], locale), [sessions.data, attempts.data, locale]);
  const shown = filter === 'all' ? rows : rows.filter((r) => r.type === filter);
  const groups = groupByDay(shown, app.now(), app.deps.timeZone());
  const loading = sessions.isPending || attempts.isPending;
  const failed = sessions.isError && attempts.isError;
  const guest = useAppStore((s) => s.session.status !== 'signed_in');
  const typeName: Record<HistoryType, string> = { drill: t('practice:PRC-16.drills'), pyq: t('practice:PRC-16.pyqs'), challenge: t('practice:PRC-16.daily_challenge'), mock: t('practice:PRC-16.mocks') };
  const back = () => (router.canGoBack() ? router.back() : router.replace('/practice' as Href));
  const open = (r: HistoryRow) => {
    if (r.type === 'mock' || (r.type === 'pyq' && r.scorePct !== null) || (r.type === 'pyq' && r.answered === null)) {
      router.push({ pathname: r.finished ? '/report/[id]' : '/attempt/[id]', params: { id: r.id } });
    } else if (r.type === 'challenge') router.push('/challenge' as Href);
    else router.push({ pathname: r.finished ? '/session-summary/[id]' : '/session/[id]', params: { id: r.id } });
  };
  const dayLabel = (g: { label: string; day: string }) =>
    g.label === 'today' ? t('practice:PRC-16.today') : g.label === 'yesterday' ? t('practice:PRC-16.yesterday') : new Date(`${g.day}T00:00:00`).toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = (iso: string) => new Date(iso).toLocaleTimeString(locale === 'hi' ? 'hi-IN' : 'en-IN', { hour: 'numeric', minute: '2-digit', timeZone: app.deps.timeZone() });

  return (
    <Screen testID="PRC-16">
      <BackHeader title={t('practice:PRC-16.title')} backLabel={t('ui:common.back')} onBack={back} />
      <ChoiceChips
        label={t('practice:PRC-16.title')}
        hideLabel
        options={FILTERS.map((f) => ({ value: f, label: f === 'all' ? t('practice:PRC-16.all') : typeName[f] }))}
        value={[filter]}
        onChange={(v) => setFilter((v[0] as HistoryFilter | undefined) ?? 'all')}
        testID="history-filters"
      />
      {loading ? <Spinner label={t('practice:PRC-16.title')} /> : null}
      {failed ? (
        <Banner
          tone="offline"
          icon="WifiSlash"
          text={t('memory_labs:LAB-05.reason_offline')}
          action={{
            label: t('me_money:ME-23.try_again'),
            onPress: () => {
              void sessions.refetch();
              void attempts.refetch();
            },
          }}
        />
      ) : null}
      {!loading && shown.length === 0 ? <EmptyState illustration="ui-search-empty" alt={t('practice:PRC-16.empty')} text={t('practice:PRC-16.empty')} testID="history-empty" /> : null}
      {groups.map((g) => (
        <View key={g.day} style={styles.gap}>
          <Text variant="label" tone="muted" heading>
            {dayLabel(g)}
          </Text>
          {g.rows.map((r) => {
            const title = r.title ?? typeName[r.type];
            const meta =
              r.answered !== null
                ? r.accuracy !== null
                  ? t('practice:PRC-16.row_meta', { answered: r.answered, accuracy: r.accuracy })
                  : t('practice:PRC-16.row_meta.1', { answered: r.answered })
                : r.scorePct !== null
                  ? `${r.scorePct}%`
                  : '';
            return (
              <Card key={`${r.type}-${r.id}`} outlined onPress={() => open(r)} accessibilityLabel={`${typeName[r.type]}, ${title}, ${meta}, ${time(r.at)}`} testID={`history-${r.id}`}>
                <View style={styles.row}>
                  <Icon name={ICON[r.type]} color="primary" />
                  <View style={styles.grow}>
                    <Text variant="label" numberOfLines={2}>
                      {title}
                    </Text>
                    {meta ? (
                      <Text variant="caption" tone="muted" numeric>
                        {meta}
                      </Text>
                    ) : null}
                  </View>
                  <Text variant="caption" tone="muted" numeric>
                    {time(r.at)}
                  </Text>
                  <Icon name="CaretRight" color="inkMuted" size={20} />
                </View>
              </Card>
            );
          })}
        </View>
      ))}
      {guest && rows.length > 0 ? (
        <Button variant="ghost" size="sm" label={t('practice:PRC-16.guest_footer')} onPress={() => router.push({ pathname: '/sign-in', params: { reason: 'save_progress' } })} testID="history-sign-in" />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1, gap: 2 },
});
