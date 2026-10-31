import { Button, Card, Chip, IconButton, PetLine, Text } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { filledSpots, loadPalace } from '../../../../src/features/palace/palaces';
import { useApp, useT } from '../../../../src/services/context';
import { Screen, Stack } from '../../../../src/ui/Screen';

/** MEM-17 Palace walk: spot by spot in walk order, then [Quiz me] or [Done]. */
export default function PalaceWalk() {
  const app = useApp();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ['palace', id], queryFn: () => loadPalace(app, id) });
  const [i, setI] = useState(0);
  const started = useRef(app.deps.clock());
  const m = q.data;
  const pet = app.store.getState().pet;
  if (!m) return <Screen testID="MEM-17">{null}</Screen>;
  const spots = filledSpots(m);
  const spot = spots[i];
  const last = i === spots.length - 1;
  const roomIndex = (roomId: string) => m.rooms.findIndex((r) => r.id === roomId);
  const roomName = (k: number) => m.rooms[k]?.name || `${t('memory_labs:MEM-14.add_room')} ${k + 1}`;
  const close = () => (router.canGoBack() ? router.back() : router.replace('/palace' as Href));
  const finish = (to: 'quiz' | 'done') => {
    app.track('palace_walk_completed', { palace_id: m.palace.id, spots: String(spots.length), duration_ms: app.deps.clock() - started.current });
    if (to === 'quiz') router.replace(`/palace/${m.palace.id}/quiz` as Href);
    else close();
  };
  if (!spot) return <Screen testID="MEM-17">{null}</Screen>;
  const k = roomIndex(spot.room.id);
  const next = spots[i + 1];
  const nextRoom = next && next.room.id !== spot.room.id ? roomName(roomIndex(next.room.id)) : null;
  const species = pet?.species === 'dog' ? 'dog' : 'cat';

  return (
    <Screen
      testID="MEM-17"
      footer={
        last ? (
          <>
            <Button label={t('memory_labs:MEM-17.quiz')} onPress={() => finish('quiz')} testID="mem17-quiz" />
            <Button variant="secondary" label={t('memory_labs:MEM-17.done')} onPress={() => finish('done')} testID="mem17-done" />
          </>
        ) : (
          <View style={styles.row}>
            <Button variant="secondary" label={t('memory_labs:MEM-17.back')} disabled={i === 0} onPress={() => setI(i - 1)} style={styles.grow} />
            <Button label={t('memory_labs:MEM-17.next')} onPress={() => setI(i + 1)} style={styles.grow} testID="mem17-next" />
          </View>
        )
      }
    >
      <View style={styles.top}>
        <IconButton icon="X" label={t('ui:common.close')} onPress={close} />
        <Text variant="label" style={styles.grow} numberOfLines={1}>
          {m.palace.name}
        </Text>
        <Text variant="label" tone="muted" numeric testID="mem17-counter">
          {t('memory_labs:MEM-17.counter', { n: i + 1, total: spots.length })}
        </Text>
      </View>
      {i === 0 && pet ? <PetLine pet={{ species, mood: 'excited' }} petName={pet.name} text={t('memory_labs:MEM-17.pet_start')} /> : null}
      <View accessibilityLiveRegion="polite">
        <Card testID="mem17-spot" accessibilityLabel={`${t('memory_labs:MEM-17.counter', { n: i + 1, total: spots.length })}, ${roomName(k)}: ${spot.label}`}>
          <Stack gap={8}>
            <Text variant="caption" tone="muted">
              {`${t('memory_labs:MEM-14.spot_n', { n: spot.n })} · ${roomName(k)}`}
            </Text>
            <Text variant="title" heading testID="mem17-item">
              {spot.label}
            </Text>
            {spot.locus.note ? <Text variant="body">{spot.locus.note}</Text> : null}
          </Stack>
        </Card>
      </View>
      <View style={styles.chips}>
        {m.rooms.map((r, j) => (
          <Chip key={r.id} kind="filter" selected={j === k} label={roomName(j)} />
        ))}
      </View>
      {nextRoom ? (
        <Text variant="caption" tone="muted">
          {t('memory_labs:MEM-17.next_room', { room_name: nextRoom })}
        </Text>
      ) : null}
      {last && pet ? <PetLine pet={{ species, mood: 'proud' }} petName={pet.name} text={t('memory_labs:MEM-17.pet_end')} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', gap: 12 },
  grow: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
