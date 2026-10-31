import { useAppStore } from '@smriti/app-core/react';
import { comebackChunkFor, localDate, shouldOfferRescue } from '@smriti/app-core';
import { Button, Card, IconButton, Illustration, SettingsGroup, SettingsRow, Spinner, Text } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp, useT } from '../src/services/context';
import { estimateMinutes, Reviews } from '../src/services/reviews';
import { Screen } from '../src/ui/Screen';

/**
 * MEM-01, Memory home. Today's count is built on the device from the FSRS schedule that sync
 * keeps (`srs_cards`), so it is right offline. A backlog well over the usual day offers the
 * comeback plan (MEM-02, R22); a thirsty plant offers the 2-minute rescue (R23).
 */
export default function Memory() {
  const app = useApp();
  const t = useT();
  const reviews = useMemo(() => new Reviews(app), [app]);
  const streak = useAppStore((s) => s.streak);
  const plant = useAppStore((s) => s.plant);
  const data = useQuery({
    queryKey: ['smriti', 'memory', 'today'],
    queryFn: async () => {
      const q = await reviews.queue();
      const offer = await reviews.comebackOffer();
      const minutes = await estimateMinutes(reviews, q.cards.length);
      const all = await reviews.cards();
      const chunk = q.plan ? comebackChunkFor(q.plan, localDate(app.now(), app.deps.timeZone())) : null;
      return { q, offer, minutes, hasCards: all.length > 0, dayIndex: chunk?.dayIndex ?? 0 };
    },
  });
  useFocusEffect(
    useCallback(() => {
      void data.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );
  const back = () => (router.canGoBack() ? router.back() : router.replace('/learn' as Href));
  const d = data.data;
  const due = d?.q.cards.length ?? 0;
  const plan = d?.q.plan ?? null;
  const rescue =
    d !== undefined &&
    shouldOfferRescue({
      todayQualified: streak?.today_qualified ?? false,
      plantThirsty: streak?.at_risk ?? false,
      plantHealth: plant?.health ?? 'thriving',
      comebackActive: plan !== null,
      littleLearner: app.isLittleLearner(),
      hasCards: d.hasCards,
    });
  const dayIndex = d?.dayIndex ?? 0;

  return (
    <Screen testID="MEM-01">
      <View style={styles.top}>
        <IconButton icon="CaretLeft" label={t('ui:common.back')} onPress={back} />
        <Text variant="title" heading>
          {t('memory_labs:MEM-01.title')}
        </Text>
      </View>
      {data.isPending ? <Spinner label={t('memory_labs:MEM-01.title')} /> : null}
      {d ? (
        <View style={styles.center}>
          {due === 0 ? <Illustration name="ui-all-caught-up" decorative width={200} height={150} /> : null}
          <Text variant="heading" align="center" numeric testID="mem-due">
            {plan && dayIndex > 0 ? t('memory_labs:MEM-01.today_comeback', { d: dayIndex, total: plan.planDays }) : due > 0 ? t('memory_labs:MEM-01.today_due', { n: due, m: d.minutes }) : t('memory_labs:MEM-01.today_none')}
          </Text>
          {due > 0 ? <Button label={plan ? t('memory_labs:MEM-01.continue_plan') : t('memory_labs:MEM-01.start')} icon="Play" iconPosition="end" fullWidth onPress={() => router.push('/review' as Href)} testID="mem-start" /> : null}
          {d.q.needsInternet > 0 ? (
            <Text variant="caption" tone="muted">
              {t('memory_labs:MEM-04.needs_net', { s: d.q.needsInternet })}
            </Text>
          ) : null}
        </View>
      ) : null}
      {d?.offer ? (
        <Card tone="tint" testID="mem-comeback">
          <View style={styles.gap}>
            <Text variant="body">{t('memory_labs:MEM-02.body', { total: d.offer.plan.total })}</Text>
            <Button size="sm" label={t('memory_labs:MEM-02.title_guest')} onPress={() => router.push('/comeback' as Href)} testID="mem-comeback-open" />
          </View>
        </Card>
      ) : null}
      {rescue ? <Button variant="secondary" icon="Timer" label={t('memory_labs:MEM-01.rescue')} onPress={() => router.push({ pathname: '/review', params: { kind: 'rescue' } })} testID="mem-rescue" /> : null}
      <SettingsGroup>
        <SettingsRow title={t('memory_labs:MEM-01.tool_decks')} icon="Cards" trailing="none" />
        <SettingsRow title={t('memory_labs:MEM-01.tool_techniques')} icon="Lightbulb" trailing="none" />
        <SettingsRow title={t('memory_labs:MEM-01.tool_focus')} icon="Timer" trailing="none" />
      </SettingsGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  center: { alignItems: 'center', gap: 12 },
  gap: { gap: 10 },
});
