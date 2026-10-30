import { Card, Chip, IconButton, Text } from '@smriti/ui-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useApp, useT, useUiState } from '../../src/services/context';
import { Screen } from '../../src/ui/Screen';

/** LRN-01: a subject's chapters in syllabus order, from the manifest on the device. */
export default function Subject() {
  const app = useApp();
  const t = useT();
  const locale = useUiState((s) => s.locale);
  const { id } = useLocalSearchParams<{ id: string }>();
  const subject = app.deps.content.subjects(locale, app.examProfileId()).find((s) => s.id === id);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/learn' as Href));
  return (
    <Screen testID="LRN-01">
      <View style={styles.top}>
        <IconButton icon="CaretLeft" label={t('ui:common.back')} onPress={back} />
        <Text variant="title" heading style={styles.grow}>
          {subject?.name ?? ''}
        </Text>
      </View>
      {subject?.chapters.map((c, i) => (
        <Card key={c.id} outlined subject={subject.colorFamily} onPress={() => router.push({ pathname: '/chapter/[id]', params: { id: c.id } })} accessibilityLabel={c.name} testID={`chapter-${c.id}`}>
          <View style={styles.body}>
            <Text variant="label" tone="subject" subject={subject.colorFamily}>
              {t('learn:LRN-01.chapter_kicker', { n: i + 1 })}
            </Text>
            <Text variant="heading">{c.name}</Text>
            <Chip kind="status" tone="sunken" label={app.tPending('learn:WEB-01.topics_count', { n: c.topics.length })} />
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
  body: { gap: 6, alignItems: 'flex-start' },
});
