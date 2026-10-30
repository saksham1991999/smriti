import { Card, Icon, IconButton, Text } from '@smriti/ui-native';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp, useT, useUiState } from '../../src/services/context';
import { loadTopicStates, type TopicState } from '../../src/services/progress';
import { Screen } from '../../src/ui/Screen';

/** LRN-02: a chapter's topics with their status; a learned topic opens Quick Revision. */
export default function Chapter() {
  const app = useApp();
  const t = useT();
  const locale = useUiState((s) => s.locale);
  const { id } = useLocalSearchParams<{ id: string }>();
  const exam = app.examProfileId();
  const chapter = app.deps.content.subjects(locale, exam).flatMap((s) => s.chapters).find((c) => c.id === id);
  const [states, setStates] = useState<Map<string, TopicState>>(new Map());
  useFocusEffect(
    useCallback(() => {
      void loadTopicStates(app).then(setStates);
    }, [app]),
  );
  const done = chapter ? chapter.topics.filter((tp) => states.get(tp.id)?.status === 'learned').length : 0;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/learn' as Href));
  return (
    <Screen testID="LRN-02">
      <View style={styles.top}>
        <IconButton icon="CaretLeft" label={t('ui:common.back')} onPress={back} />
        <Text variant="title" heading style={styles.grow}>
          {chapter?.name ?? ''}
        </Text>
      </View>
      {chapter ? (
        <Text variant="body" tone="muted">
          {t('learn:LRN-02.progress.1', { done, total: chapter.topics.length })}
        </Text>
      ) : null}
      {chapter?.topics.map((tp) => {
        const st = states.get(tp.id);
        const learned = st?.status === 'learned';
        const mode = learned && tp.hasQuickRevision ? 'quick_revision' : 'deep_dive';
        return (
          <Card key={tp.id} outlined onPress={() => router.push({ pathname: '/lesson/[topicId]', params: { topicId: tp.id, mode } })} accessibilityLabel={tp.name} testID={`topic-${tp.id}`}>
            <View style={styles.row}>
              <Icon name={learned ? 'CheckCircle' : st?.status === 'in_progress' ? 'Play' : 'BookBookmark'} weight={learned ? 'fill' : 'bold'} color={learned ? 'success' : 'primary'} />
              <View style={styles.grow}>
                <Text variant="heading">{tp.name}</Text>
                <Text variant="caption" tone="muted">
                  {learned ? app.tPending('learn:WEB-01.learned') : tp.minutes ? app.tPending('learn:WEB-01.minutes', { n: tp.minutes }) : ''}
                </Text>
              </View>
              <Icon name="CaretRight" color="inkMuted" size={20} />
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
