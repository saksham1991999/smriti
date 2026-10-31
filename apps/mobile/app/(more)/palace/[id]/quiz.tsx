import { Button, Card, Chip, Icon, IconButton, PetLine, StatTile, Text } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { filledSpots, loadPalace } from '../../../../src/features/palace/palaces';
import { useApp, useT } from '../../../../src/services/context';
import { Screen, Stack } from '../../../../src/ui/Screen';

/**
 * MEM-18 Palace quiz, "What's here?" mode: each spot with its item hidden, [Show], then the
 * learner says whether they remembered it. The result panel counts what they remembered and
 * lists the spots to fix. ("Put them back" and FSRS ratings for palace items come later.)
 */
export default function PalaceQuiz() {
  const app = useApp();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ['palace', id], queryFn: () => loadPalace(app, id) });
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const [missed, setMissed] = useState<number[]>([]);
  const [done, setDone] = useState(false);
  const m = q.data;
  const pet = app.store.getState().pet;
  if (!m) return <Screen testID="MEM-18">{null}</Screen>;
  const spots = filledSpots(m);
  const roomName = (roomId: string) => {
    const k = m.rooms.findIndex((r) => r.id === roomId);
    return m.rooms[k]?.name || `${t('memory_labs:MEM-14.add_room')} ${k + 1}`;
  };
  const close = () => router.replace('/palace' as Href);
  const species = pet?.species === 'dog' ? 'dog' : 'cat';

  const answer = (remembered: boolean) => {
    const nextMissed = remembered ? missed : [...missed, i];
    setMissed(nextMissed);
    setShown(false);
    if (i + 1 < spots.length) return setI(i + 1);
    setDone(true);
    const correct = spots.length - nextMissed.length;
    app.track('palace_quiz_completed', { palace_id: m.palace.id, mode: 'recall', spots: String(spots.length), correct, order_score_pct: Math.round((correct / spots.length) * 100) });
  };

  if (done) {
    const correct = spots.length - missed.length;
    const good = correct / spots.length >= 0.8;
    return (
      <Screen
        testID="MEM-18-result"
        footer={
          <>
            <Button label={t('memory_labs:MEM-18.done')} onPress={close} testID="mem18-done" />
            <Button variant="secondary" label={t('memory_labs:MEM-18.walk_again')} onPress={() => router.replace(`/palace/${m.palace.id}/walk` as Href)} />
          </>
        }
      >
        {pet ? <PetLine pet={{ species, mood: good ? 'proud' : 'thinking' }} petName={pet.name} text={good ? t('memory_labs:MEM-18.pet_good') : t('memory_labs:MEM-18.pet_retry')} /> : null}
        <StatTile icon="CheckCircle" value={`${correct} / ${spots.length}`} label={t('memory_labs:MEM-18.remembered')} testID="mem18-remembered" />
        <Stack gap={8}>
          {missed.map((k) => {
            const s = spots[k]!;
            return (
              <Card key={s.locus.id}>
                <Stack gap={8}>
                  <Text variant="caption" tone="muted">{`${t('memory_labs:MEM-14.spot_n', { n: s.n })} · ${roomName(s.room.id)}`}</Text>
                  <Text variant="label">{s.label}</Text>
                  <Button variant="ghost" size="sm" label={t('memory_labs:MEM-18.fix')} onPress={() => router.replace(`/palace/${m.palace.id}` as Href)} />
                </Stack>
              </Card>
            );
          })}
        </Stack>
      </Screen>
    );
  }

  const spot = spots[i];
  if (!spot) return <Screen testID="MEM-18">{null}</Screen>;
  return (
    <Screen
      testID="MEM-18"
      footer={
        shown ? (
          <View style={styles.row}>
            <Button variant="secondary" label={t('memory_labs:MEM-03.again')} onPress={() => answer(false)} style={styles.grow} testID="mem18-missed" />
            <Button label={t('memory_labs:MEM-03.good')} icon="Check" onPress={() => answer(true)} style={styles.grow} testID="mem18-got" />
          </View>
        ) : (
          <Button variant="secondary" label={t('memory_labs:MEM-18.show')} onPress={() => setShown(true)} testID="mem18-show" />
        )
      }
    >
      <View style={styles.top}>
        <IconButton icon="X" label={t('ui:common.close')} onPress={close} />
        <Chip kind="filter" selected label={t('memory_labs:MEM-18.mode_recall')} />
        <View style={styles.grow} />
        <Text variant="label" tone="muted" numeric testID="mem18-counter">
          {t('memory_labs:MEM-17.counter', { n: i + 1, total: spots.length })}
        </Text>
      </View>
      <View accessibilityLiveRegion="polite">
        <Card>
          <Stack gap={8}>
            <Text variant="caption" tone="muted">{`${t('memory_labs:MEM-14.spot_n', { n: spot.n })} · ${roomName(spot.room.id)}`}</Text>
            {shown ? (
              <Text variant="title" heading testID="mem18-item">
                {spot.label}
              </Text>
            ) : (
              <View style={styles.hidden}>
                <Icon name="Question" size={32} color="inkMuted" label={t('memory_labs:MEM-18.mode_recall')} />
              </View>
            )}
          </Stack>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', gap: 12 },
  grow: { flex: 1 },
  hidden: { minHeight: 56, justifyContent: 'center' },
});
