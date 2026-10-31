import { useAppStore } from '@smriti/app-core/react';
import { Banner, Button, Card, ChoiceChips, Chip, EmptyState, Spinner, Text } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp, useQueryScope, useT, useUiState } from '../src/services/context';
import { listAttempts } from '../src/services/mocks';
import { BackHeader, Screen } from '../src/ui/Screen';

/** MOCK-25: every attempt from `/v1/attempts`, newest first; in-progress ones resume. */
export default function MockHistory() {
  const app = useApp();
  const t = useT();
  const locale = useUiState((s) => s.locale);
  const scope = useQueryScope();
  const signedIn = useAppStore((s) => s.session.status === 'signed_in');
  const [filter, setFilter] = useState<'all' | 'in_progress'>('all');
  const list = useQuery({ queryKey: ['smriti', 'attempts', scope], queryFn: () => listAttempts(app) });
  const shown = (list.data ?? []).filter((a) => a.status !== 'abandoned' && (filter === 'all' || a.status === 'in_progress'));
  return (
    <Screen testID="MOCK-25">
      <BackHeader title={t('practice:MOCK-25.title')} backLabel={t('ui:common.back')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/mocks' as Href))} />
      <ChoiceChips label={t('practice:MOCK-25.title')} hideLabel options={[{ value: 'all', label: t('practice:MOCK-25.all') }, { value: 'in_progress', label: t('practice:MOCK-25.in_progress') }]} value={[filter]} onChange={(v) => setFilter(((Array.isArray(v) ? v[0] : v) as 'all' | 'in_progress') ?? 'all')} />
      {list.isPending ? <Spinner label={t('practice:MOCK-25.title')} /> : null}
      {list.isError ? <Banner tone="warning" icon="Warning" text={t('learn:LES-11.error')} action={{ label: t('tutor_social:AI-02.try_again'), onPress: () => void list.refetch() }} /> : null}
      {list.data && shown.length === 0 ? <EmptyState illustration="ui-all-caught-up" alt="" text={t('practice:MOCK-25.empty')} action={{ label: t('practice:MOCK-25.find_a_mock'), onPress: () => router.replace('/mocks' as Href) }} testID="history-empty" /> : null}
      {shown.map((a) => (
        <Card
          key={a.id}
          outlined
          onPress={() => router.push(a.status === 'in_progress' ? { pathname: '/attempt/[id]', params: { id: a.id } } : { pathname: '/report/[id]', params: { id: a.id } })}
          accessibilityLabel={a.title[locale] ?? a.title.en ?? ''}
          testID={`history-${a.id}`}
        >
          <View style={styles.gap}>
            <View style={styles.row}>
              <Text variant="heading" style={styles.flex}>
                {a.title[locale] ?? a.title.en ?? ''}
              </Text>
              {a.status === 'in_progress' ? <Chip label={t('practice:MOCK-25.in_progress')} tone="primary" /> : a.score == null ? <Chip label={t('practice:MOCK-25.report_pending')} tone="neutral" /> : null}
            </View>
            <Text variant="caption" tone="muted" numeric>
              {`${t('practice:MOCK-19.attempt_line', { n: a.attempt_no, date: a.started_at.slice(0, 10) })}${a.score != null ? ` · ${t('practice:MOCK-19.score', { score: a.score, max_score: a.max_score ?? 0 })}` : ''}`}
            </Text>
          </View>
        </Card>
      ))}
      <Text variant="caption" tone="muted" align="center">
        {signedIn ? t('practice:MOCK-25.sync_line') : t('practice:MOCK-25.guest_footer')}
      </Text>
      <Button variant="ghost" label={t('practice:MOCK-25.find_a_mock')} onPress={() => router.replace('/mocks' as Href)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
});
