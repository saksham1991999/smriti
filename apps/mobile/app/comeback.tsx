import { useAppStore } from '@smriti/app-core/react';
import type { ComebackPlan } from '@smriti/app-core';
import { Button, ChoiceChips, Spinner, Text } from '@smriti/ui-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp, useT } from '../src/services/context';
import { estimateMinutes, Reviews } from '../src/services/reviews';
import { BuddyLine } from '../src/ui/Onboarding';
import { BackHeader, Screen } from '../src/ui/Screen';

/**
 * MEM-02, the comeback plan (R22): the backlog spread over 3, 5 or 7 days (lengths from flags),
 * very faded cards offered as Quick Revision of their topics instead. Built by app-core.
 */
export default function Comeback() {
  const app = useApp();
  const t = useT();
  const queries = useQueryClient();
  const reviews = useMemo(() => new Reviews(app), [app]);
  const profile = useAppStore((s) => s.profile);
  const [days, setDays] = useState<number | null>(null);
  const offer = useQuery({ queryKey: ['smriti', 'memory', 'comeback'], queryFn: () => reviews.comebackOffer() });
  const plan = useQuery({
    queryKey: ['smriti', 'memory', 'comeback-plan', days],
    queryFn: async (): Promise<{ plan: ComebackPlan; minutes: number }> => {
      const p = await reviews.buildPlan(days ?? undefined);
      return { plan: p, minutes: await estimateMinutes(reviews, p.chunks[0]?.cardRefs.length ?? 0) };
    },
  });
  const p = plan.data?.plan;
  const suggested = offer.data?.plan.planDays;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/memory' as Href));
  const start = async () => {
    if (!p) return;
    await reviews.startPlan(p, offer.data?.daysAway ?? 0);
    void queries.invalidateQueries({ queryKey: ['smriti', 'memory'] });
    router.replace('/review' as Href);
  };
  const first = profile?.display_name?.split(' ')[0];

  return (
    <Screen
      testID="MEM-02"
      footer={
        p ? (
          <View style={styles.gap}>
            <Button label={t('memory_labs:MEM-02.start', { k: p.chunks[0]?.cardRefs.length ?? 0 })} onPress={() => void start()} testID="comeback-start" />
            <Button variant="ghost" label={t('memory_labs:MEM-02.normal')} onPress={() => router.replace('/review' as Href)} testID="comeback-normal" />
          </View>
        ) : undefined
      }
    >
      <BackHeader title={first ? t('memory_labs:MEM-02.title', { first_name: first }) : t('memory_labs:MEM-02.title_guest')} backLabel={t('ui:common.back')} onBack={back} />
      {plan.isPending ? <Spinner label={t('memory_labs:MEM-01.title')} /> : null}
      {p ? (
        <>
          <Text variant="body">{t('memory_labs:MEM-02.body', { total: p.total })}</Text>
          <ChoiceChips
            label={t('memory_labs:MEM-02.body', { total: p.total })}
            hideLabel
            options={reviews.config.comeback.planLengths.map((n) => ({ value: String(n), label: `${t(`memory_labs:MEM-02.days_${n}` as 'memory_labs:MEM-02.days_3')}${n === suggested ? ` · ${t('memory_labs:MEM-02.suggested')}` : ''}` }))}
            value={[String(p.planDays)]}
            onChange={(v) => setDays(Number(v[0] ?? p.planDays))}
            testID="comeback-days"
          />
          <Text variant="label" numeric>
            {`${t('memory_labs:MEM-02.per_day', { k: p.chunks[0]?.cardRefs.length ?? 0 })} · ${t('memory_labs:MEM-02.minutes', { m: plan.data?.minutes ?? 1 })}`}
          </Text>
          {p.relearnTopics.length ? (
            <View style={styles.gap}>
              <Text variant="body">{t('memory_labs:MEM-02.relearn', { r: p.relearnTopics.reduce((s, x) => s + x.cardRefs.length, 0), t: p.relearnTopics.length })}</Text>
              <Button
                variant="secondary"
                label={t('memory_labs:MEM-02.relearn_cta')}
                onPress={() => router.push({ pathname: '/lesson/[topicId]', params: { topicId: p.relearnTopics[0]!.topicId, mode: 'quick_revision' } })}
              />
            </View>
          ) : null}
          <BuddyLine text={t('memory_labs:MEM-02.pet_plant', { plant_days: p.planDays })} />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({ gap: { gap: 10 } });
