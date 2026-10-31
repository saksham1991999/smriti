import { Button, Chip, Icon, PetLine, Text, useSubject, useTheme } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { autoPlace, filledSpots, loadPalace, placeItem, type PalaceModel } from '../../../../src/features/palace/palaces';
import { useApp, useT } from '../../../../src/services/context';
import { BackHeader, Screen, Stack } from '../../../../src/ui/Screen';

/**
 * MEM-14 Palace builder: rooms in walk order, each with numbered spots. Placing is tap an item,
 * then tap a spot (the accessible way the spec keeps always available; drag comes with a
 * gesture canvas). A filled spot swaps. [Auto-place] fills empty spots in order.
 */
export default function PalaceBuilder() {
  const app = useApp();
  const t = useT();
  const theme = useTheme();
  const s = useSubject('memory');
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ['palace', id], queryFn: () => loadPalace(app, id) });
  const [room, setRoom] = useState(0);
  const [held, setHeld] = useState<string | null>(null);
  const m = q.data;
  const pet = app.store.getState().pet;

  if (!m) return <Screen testID="MEM-14">{null}</Screen>;
  const roomName = (i: number) => m.rooms[i]?.name || `${t('memory_labs:MEM-14.add_room')} ${i + 1}`;
  const spots = m.spots.filter((x) => x.room.room_id === m.rooms[room]?.room_id);
  const placed = filledSpots(m).length;

  const run = async (fn: (model: PalaceModel) => Promise<void>) => {
    await fn(m);
    setHeld(null);
    await q.refetch();
  };
  const tapSpot = (locusId: string, item: string | null) => {
    if (held) return void run((model) => placeItem(app, model, held, locusId));
    if (item) setHeld(item);
  };
  const walk = () => {
    app.track('palace_items_placed', { palace_id: m.palace.palace_id, items: String(placed), rooms: String(m.rooms.length), source: 'mnemonics' });
    router.push(`/palace/${m.palace.palace_id}/walk` as Href);
  };

  return (
    <Screen
      testID="MEM-14"
      footer={
        <>
          {m.unplaced.length ? <Button variant="secondary" label={t('memory_labs:MEM-14.auto')} onPress={() => void run((model) => autoPlace(app, model))} testID="mem14-auto" /> : null}
          <Button label={t('memory_labs:MEM-14.walk')} icon="Play" disabled={!placed} onPress={walk} testID="mem14-walk" />
        </>
      }
    >
      <BackHeader title={m.palace.name} backLabel={t('ui:common.back')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/palace' as Href))} />
      <View style={styles.chips} accessibilityLabel={t('memory_labs:MEM-14.rooms')}>
        {m.rooms.map((r, i) => (
          <Chip key={r.room_id} kind="filter" selected={i === room} label={`${i + 1} · ${roomName(i)}`} onPress={() => setRoom(i)} testID={`mem14-room-${i}`} />
        ))}
      </View>

      <Stack gap={8}>
        {spots.map((x) => {
          const isHeld = !!x.item && held === x.item.item_id;
          const label = t('memory_labs:MEM-14.spot_n', { n: x.n });
          return (
            <Pressable
              key={x.locusId}
              accessibilityRole="button"
              accessibilityLabel={x.label ? `${label}, ${x.label}` : label}
              onPress={() => tapSpot(x.locusId, x.item?.item_id ?? null)}
              testID={`mem14-spot-${x.n}`}
              style={[styles.spot, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderColor: held && !isHeld ? theme.colors.primary : x.label ? s.strong : theme.colors.line, borderWidth: held || x.label ? 2 : 1 }]}
            >
              <View style={[styles.num, { borderColor: x.label ? s.strong : theme.colors.line, backgroundColor: theme.colors.surfaceSunken }]}>
                <Text variant="label" numeric>
                  {String(x.n)}
                </Text>
              </View>
              <Text variant="body" tone={x.label ? 'ink' : 'muted'} style={styles.grow}>
                {x.label ?? (held ? t('memory_labs:MEM-14.drag_hint') : '')}
              </Text>
              {isHeld ? <Icon name="CheckCircle" size={20} weight="fill" color="primary" /> : null}
            </Pressable>
          );
        })}
      </Stack>

      {m.unplaced.length ? (
        <Stack gap={8}>
          <Text variant="heading" heading>
            {t('memory_labs:MEM-14.to_place', { n: m.unplaced.length })}
          </Text>
          <View style={styles.chips}>
            {m.unplaced.map((i) => (
              <Chip key={i.id} kind="filter" selected={held === i.id} label={i.label} onPress={() => setHeld(held === i.id ? null : i.id)} testID={`mem14-item-${i.ref.split(':').pop()}`} />
            ))}
          </View>
          <Text variant="caption" tone="muted">
            {t('memory_labs:MEM-14.drag_hint')}
          </Text>
        </Stack>
      ) : null}
      {pet ? <PetLine pet={{ species: pet.species === 'dog' ? 'dog' : 'cat', mood: 'curious' }} petName={pet.name} text={t('memory_labs:MEM-14.pet_tip')} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  spot: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 12 },
  num: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1 },
});
