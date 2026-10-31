import { addDays } from '@smriti/app-core';
import { Card, IconButton, PetLine, StatTile, Text } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { dateRange, loadDashboard, loadReport } from '../../../../src/features/parent/services';
import { MinuteBars, ParentOnly } from '../../../../src/features/parent/ui';
import { useApp, useT, useUiState } from '../../../../src/services/context';
import { BackHeader, Screen, Stack } from '../../../../src/ui/Screen';

/** SET-15, a child's week in counts and topic names only (never chats, notes or typed text). */
export default function WeeklyReport() {
  return (
    <ParentOnly>
      <Report />
    </ParentOnly>
  );
}

function Report() {
  const app = useApp();
  const t = useT();
  const locale = useUiState((s) => s.locale);
  const { id } = useLocalSearchParams<{ id: string }>();
  const [week, setWeek] = useState<string | undefined>(undefined);
  const report = useQuery({ queryKey: ['parent', 'report', id, week ?? 'current'], queryFn: () => loadReport(app, id, week) });
  const dash = useQuery({ queryKey: ['parent', 'dashboard'], queryFn: () => loadDashboard(app) });
  const r = report.data;
  const pet = dash.data?.learners.find((l) => l.user_id === id)?.pet ?? null;
  const name = r?.first_name ?? '';
  const back = () => (router.canGoBack() ? router.back() : router.replace('/parent'));
  const isCurrent = r ? r.week_end >= app.today() : true;

  return (
    <Screen testID="SET-15" contentStyle={styles.content}>
      <BackHeader title={t('me_money:SET-15.title', { child: name })} backLabel={t('ui:common.back')} onBack={back} />
      {r ? (
        <>
          <View style={styles.weekRow}>
            <IconButton icon="CaretLeft" label={t('me_money:SET-15.previous_week')} onPress={() => setWeek(addDays(r.week_start, -7))} testID="set15-prev" />
            <Text variant="label" testID="set15-range">
              {dateRange(r.week_start, r.week_end, locale)}
            </Text>
            <IconButton icon="CaretRight" label={t('me_money:SET-15.next_week')} disabled={isCurrent} onPress={() => setWeek(addDays(r.week_start, 7))} testID="set15-next" />
          </View>
          <View style={styles.tiles}>
            <StatTile value={String(r.minutes)} label={t('me_money:SET-15.minutes')} icon="Clock" tint style={styles.tile} testID="set15-minutes" />
            <StatTile value={String(r.lessons)} label={t('me_money:SET-15.lessons')} icon="BookBookmark" tint style={styles.tile} />
            <StatTile value={String(r.reviews)} label={t('me_money:SET-15.reviews')} icon="Cards" tint style={styles.tile} />
            <StatTile value={String(r.streak)} label={t('me_money:SET-15.streak')} icon="Plant" tint style={styles.tile} />
          </View>
          <Card>
            <Stack gap={12}>
              <Text variant="heading">{t('me_money:SET-15.per_day')}</Text>
              <MinuteBars days={r.days} height={120} showValues testID="set15-bars" />
            </Stack>
          </Card>
          {r.subjects.length ? (
            <Stack gap={8}>
              <Text variant="heading">{t('me_money:SET-15.subjects')}</Text>
              {r.subjects.map((s) => (
                <Card key={s.subject_id} tone="tint" subject={s.subject_id}>
                  <Text variant="label">{s.name[locale] ?? s.name.en}</Text>
                  <Text variant="caption" tone="muted">
                    {s.topics.map((tp) => tp[locale] ?? tp.en).join(' · ')}
                  </Text>
                </Card>
              ))}
            </Stack>
          ) : null}
          {r.mocks.length ? (
            <Stack gap={8}>
              <Text variant="heading">{t('me_money:SET-15.mocks')}</Text>
              {r.mocks.map((m) => (
                <Card key={m.attempt_id} outlined>
                  <Text variant="label">{m.title?.[locale] ?? m.title?.en ?? ''}</Text>
                  <Text variant="caption" tone="muted" numeric>{`${m.score}/${m.max_score}`}</Text>
                </Card>
              ))}
            </Stack>
          ) : null}
          {r.coming_up.length ? (
            <Stack gap={8}>
              <Text variant="heading">{t('me_money:SET-15.coming_up')}</Text>
              {r.coming_up.slice(0, 3).map((c) => (
                <Text key={c.mock_id} variant="body">
                  {c.title[locale] ?? c.title.en}
                </Text>
              ))}
            </Stack>
          ) : null}
          {pet ? <PetLine pet={{ species: pet.species === 'dog' ? 'dog' : 'cat', mood: r.minutes > 0 ? 'happy' : 'curious' }} petName={pet.name} text={r.minutes > 0 ? t('me_money:SET-15.pet_line_good') : t('me_money:SET-15.pet_line_quiet')} testID="set15-pet-line" /> : null}
          <Text variant="caption" tone="muted">
            {t('me_money:SET-15.privacy_line', { child: name })}
          </Text>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, maxWidth: 720, width: '100%', alignSelf: 'center' },
  weekRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { flexBasis: '47%', flexGrow: 1 },
});
