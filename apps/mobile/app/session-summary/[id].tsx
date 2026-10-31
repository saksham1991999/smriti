import { useAppStore } from '@smriti/app-core/react';
import { Button, Card, Chip, Icon, PetView, Spinner, StatTile, Text } from '@smriti/ui-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp, useQueryScope, useT } from '../../src/services/context';
import { clock, dropRunner, DrillRunner, fetchSession, type DrillSummary } from '../../src/services/drill';
import { BuddyLine } from '../../src/ui/Onboarding';
import { Screen } from '../../src/ui/Screen';

const HIGH = 0.8;
const LOW = 0.5;

/**
 * PRC-06, the drill summary. Accuracy and time come from the session (the server's counts once
 * synced, else the device's). There is no mastery section until the server reports per-concept
 * change for a session; nothing is estimated here.
 */
export default function SessionSummary() {
  const app = useApp();
  const t = useT();
  const queries = useQueryClient();
  const scope = useQueryScope();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pet = useAppStore((s) => s.pet);
  const [local, setLocal] = useState<DrillSummary | null | undefined>(undefined);
  const server = useQuery({ queryKey: ['smriti', 'practice', 'session', scope, String(id)], queryFn: () => fetchSession(app, String(id)), retry: 1 });

  useEffect(() => {
    void DrillRunner.loadSummary(app, String(id)).then(setLocal);
    void queries.invalidateQueries({ queryKey: ['smriti', 'practice', 'hub'] });
    return () => dropRunner(String(id));
  }, [app, id, queries]);

  if (local === undefined && server.isPending) return <Screen testID="PRC-06-loading">{<Spinner label={t('practice:PRC-06.title')} />}</Screen>;

  const s = server.data;
  const answered = s?.answered ?? local?.answered ?? 0;
  const correct = s?.correct ?? local?.correct ?? 0;
  const size = s?.size ?? local?.size ?? 0;
  const ms = local?.ms ?? (s?.ended_at ? Date.parse(s.ended_at) - Date.parse(s.started_at) : 0);
  const acc = answered > 0 ? correct / answered : 0;
  const mood = acc >= HIGH ? 'proud' : acc >= LOW ? 'happy' : 'thinking';
  const chapterTest = local?.chapterTest ?? s?.kind === 'chapter_test';
  const partial = (local?.endedBy ?? 'finished') !== 'finished' && answered < size;
  const concepts = local?.concepts ?? [...new Set(s?.questions.flatMap((q) => q.concepts) ?? [])];
  const firstConcept = concepts[0] ?? null;
  const topicId = local?.topicId ?? s?.questions[0]?.topic_id ?? null;
  const lastFree = local?.lastFree ?? (s ? !s.quota.unlimited && s.quota.remaining === 0 : false);
  const done = () => router.replace('/practice' as Href);

  return (
    <Screen testID="PRC-06" footer={<Button label={t('practice:PRC-06.done')} onPress={done} testID="summary-done" />}>
      <View style={styles.center}>
        {pet ? <PetView species={pet.species} mood={mood} size={140} alt={pet.name} /> : null}
        <Text variant="display" heading align="center">
          {chapterTest ? t('practice:PRC-06.chapter_test_title') : t('practice:PRC-06.title')}
        </Text>
        {partial ? (
          <Text variant="body" tone="muted" align="center" testID="summary-partial">
            {t('practice:PRC-06.partial_closed_early', { answered, n: size })}
          </Text>
        ) : null}
      </View>
      <View style={styles.tiles}>
        <StatTile style={styles.tile} icon="Check" value={`${correct}/${answered}`} label={t('practice:PRC-06.accuracy_tile')} testID="summary-accuracy" />
        <StatTile style={styles.tile} icon="Timer" value={clock(ms)} label={t('practice:PRC-06.time_tile')} testID="summary-time" />
      </View>
      <BuddyLine text={acc >= HIGH ? t('practice:PRC-06.pet_line_high_accuracy') : t('practice:PRC-06.pet_line_low_accuracy')} />
      {lastFree ? (
        <Card tone="tint" testID="summary-last-free">
          <View style={styles.row}>
            <Text variant="body" style={styles.grow}>
              {t('practice:PRC-17.title_daily_cap', { limit: s?.quota.limit ?? 0 })}
            </Text>
            <Button size="sm" variant="ghost" label={app.ageBand() === '10_12' ? t('practice:PRC-01.ask_a_grown_up_under_13') : t('practice:PRC-01.pro_link')} onPress={() => router.push({ pathname: '/paywall', params: { from: 'practice_limit' } })} />
          </View>
        </Card>
      ) : null}

      <Text variant="heading">{t('practice:PRC-06.next_steps')}</Text>
      <View style={styles.gap}>
        {chapterTest && topicId ? <Button variant="secondary" label={t('practice:PRC-06.back_to_chapter')} onPress={() => router.replace('/learn' as Href)} /> : null}
        {firstConcept ? (
          <Button
            variant="secondary"
            label={t('practice:PRC-06.drill_again', { concept_name: concepts.length > 1 ? t('practice:PRC-03.scope_concepts', { n: concepts.length }) : app.conceptName(firstConcept) })}
            onPress={() => router.replace({ pathname: '/drill', params: { concepts: concepts.join(','), source: 'summary' } })}
            testID="summary-again"
          />
        ) : null}
        <Button variant="secondary" label={t('practice:PRC-02.review_cards')} onPress={() => router.replace('/memory' as Href)} />
        {topicId ? <Button variant="secondary" label={t('practice:PRC-06.open_lesson')} onPress={() => router.push({ pathname: '/lesson/[topicId]', params: { topicId } })} /> : null}
      </View>

      {local?.questions.length ? (
        <View style={styles.gap} testID="summary-questions">
          <Text variant="heading">{t('practice:PRC-06.questions')}</Text>
          {local.questions.map((q, i) => (
            <View key={q.id} style={styles.row} accessible accessibilityLabel={`${i + 1}. ${q.result === 'correct' ? t('practice:PRC-05.correct') : q.result === 'wrong' ? t('practice:PRC-05.wrong') : t('practice:PRC-04.skip')}. ${clock(q.timeMs)}`}>
              <Icon name={q.result === 'correct' ? 'CheckCircle' : q.result === 'wrong' ? 'XCircle' : 'Minus'} color={q.result === 'correct' ? 'success' : q.result === 'wrong' ? 'error' : 'inkMuted'} />
              <Text variant="body" numeric style={styles.grow}>
                {`${i + 1}`}
              </Text>
              <Text variant="caption" tone="muted" numeric>
                {clock(q.timeMs)}
              </Text>
              {q.difficulty ? <Chip label={t(`practice:PRC-03.${q.difficulty}` as 'practice:PRC-03.easy')} tone="neutral" /> : null}
            </View>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: 8 },
  tiles: { flexDirection: 'row', gap: 12 },
  tile: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1 },
  gap: { gap: 10 },
});
