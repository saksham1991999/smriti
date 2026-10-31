import { Banner, Button, Card, Chip, ChoiceChips, EmptyState, IconButton, Sheet, Spinner, Text } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp, useQueryScope, useT, useUiState } from '../src/services/context';
import { drillKeys, fetchWeakSpots, type WeakSpot } from '../src/services/drill';
import { BuddyLine } from '../src/ui/Onboarding';
import { BackHeader, Screen } from '../src/ui/Screen';

const REASON_TONE = { low_accuracy: 'warning', fading: 'primary', missed_in_mock: 'error', overconfident: 'warning' } as const;
const REASONS = ['low_accuracy', 'fading', 'missed_in_mock', 'overconfident'] as const;
const TOP = 5;

/**
 * PRC-02, every weak spot with its reason, from `/v1/practice/weak-spots`. Rows open PRC-03
 * prefilled; [Drill all top n] drills the first n together. Nothing here is guessed: the reasons
 * and numbers are the server's.
 */
export default function WeakSpots() {
  const app = useApp();
  const t = useT();
  const locale = useUiState((s) => s.locale);
  const scope = useQueryScope();
  const exam = app.examProfileId();
  const list = useQuery({ queryKey: drillKeys.weakSpots(scope, exam), queryFn: () => fetchWeakSpots(app) });
  const [reason, setReason] = useState<string>('all');
  const [info, setInfo] = useState(false);
  const [menu, setMenu] = useState<WeakSpot | null>(null);
  const items = list.data?.items ?? [];
  const shown = useMemo(() => items.filter((w) => reason === 'all' || w.reasons.includes(reason as (typeof REASONS)[number])), [items, reason]);
  const name = (m: Record<string, string>) => m[locale] ?? m.en ?? '';
  const drill = (concepts: string[], source: string) => router.push({ pathname: '/drill', params: { concepts: concepts.join(','), source } });
  const top = shown.slice(0, TOP);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/practice' as Href));

  const meta = (w: WeakSpot) => (w.accuracy !== null ? t('practice:PRC-02.meta_accuracy', { accuracy: Math.round(w.accuracy * 100), attempts: w.attempts }) : null);

  return (
    <Screen
      testID="PRC-02"
      footer={top.length > 0 ? <Button label={t('practice:PRC-02.drill_all', { n: top.length })} icon="Barbell" onPress={() => drill(top.map((w) => w.concept_id), 'weak_spot')} testID="weak-drill-all" /> : undefined}
    >
      <BackHeader title={t('practice:PRC-02.title')} backLabel={t('ui:common.back')} onBack={back} trailing={<IconButton icon="Info" label={t('practice:PRC-02.info_sheet_title')} onPress={() => setInfo(true)} testID="weak-info" />} />
      <ChoiceChips
        label={t('practice:PRC-02.title')}
        hideLabel
        options={[{ value: 'all', label: t('practice:PRC-16.all') }, ...REASONS.map((r) => ({ value: r, label: t(`practice:PRC-02.reason_${r}`) }))]}
        value={[reason]}
        onChange={(v) => setReason(v[0] ?? 'all')}
        testID="weak-filter"
      />
      <BuddyLine text={t('practice:PRC-02.pet_line')} />
      {list.isPending ? <Spinner label={t('practice:PRC-02.title')} /> : null}
      {list.isError ? <Banner tone="warning" icon="Warning" text={t('learn:LES-11.error')} action={{ label: t('tutor_social:AI-02.try_again'), onPress: () => void list.refetch() }} testID="weak-error" /> : null}
      {list.data && items.length === 0 ? (
        <EmptyState
          illustration="ui-all-caught-up"
          alt=""
          text={t('practice:PRC-02.empty', { n: list.data.needs_more_answers ?? 0 })}
          action={{ label: t('practice:PRC-03.start'), onPress: () => router.push('/drill' as Href) }}
          testID="weak-empty"
        />
      ) : null}
      {list.data && items.length > 0 && shown.length === 0 ? (
        <View style={styles.center}>
          <Text variant="body" tone="muted">
            {t('practice:PRC-07.filter_empty')}
          </Text>
          <Button variant="ghost" label={t('practice:PRC-07.clear_filters')} onPress={() => setReason('all')} />
        </View>
      ) : null}
      {shown.map((w) => (
        <Card
          key={w.concept_id}
          outlined
          onPress={() => drill([w.concept_id], 'weak_spot')}
          accessibilityLabel={[name(w.concept_name), name(w.topic_name), ...w.reasons.map((r) => t(`practice:PRC-02.reason_${r}`)), meta(w) ?? ''].filter(Boolean).join('. ')}
          testID={`weak-row-${w.concept_id}`}
        >
          <View style={styles.row}>
            <View style={[styles.grow, styles.gap]}>
              <Text variant="caption" tone="muted">
                {name(w.topic_name)}
              </Text>
              <Text variant="label">{name(w.concept_name)}</Text>
              <View style={styles.chips}>
                {w.reasons.map((r) => (
                  <Chip key={r} label={t(`practice:PRC-02.reason_${r}`)} tone={REASON_TONE[r]} />
                ))}
              </View>
              {meta(w) ? (
                <Text variant="caption" tone="muted" numeric>
                  {meta(w)}
                </Text>
              ) : null}
            </View>
            <IconButton icon="DotsThreeVertical" label={`${t('ui:common.moreOptions')}: ${name(w.concept_name)}`} onPress={() => setMenu(w)} testID={`weak-more-${w.concept_id}`} />
          </View>
        </Card>
      ))}

      <Sheet open={info} onOpenChange={setInfo} title={t('practice:PRC-02.info_sheet_title')} height="40" testID="weak-info-sheet">
        <Text variant="body">{t('practice:PRC-02.info_body')}</Text>
      </Sheet>
      <Sheet open={menu !== null} onOpenChange={(o) => !o && setMenu(null)} title={menu ? name(menu.concept_name) : ''} height="40" testID="weak-menu">
        {menu ? (
          <View style={styles.gap}>
            <Button variant="secondary" icon="BookBookmark" label={t('practice:PRC-02.open_lesson')} onPress={() => (setMenu(null), router.push({ pathname: '/lesson/[topicId]', params: { topicId: menu.topic_id } }))} />
            <Button variant="secondary" icon="Cards" label={t('practice:PRC-02.review_cards')} onPress={() => (setMenu(null), router.push({ pathname: '/review', params: { topic: menu.topic_id } }))} />
            <Button variant="secondary" icon="Barbell" label={t('practice:PRC-01.drill')} onPress={() => (setMenu(null), drill([menu.concept_id], 'weak_spot'))} />
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  grow: { flex: 1 },
  gap: { gap: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  center: { alignItems: 'center', gap: 8, paddingVertical: 16 },
});
