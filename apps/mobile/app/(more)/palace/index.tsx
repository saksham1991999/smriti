import { Button, EmptyState, PetLine, RoomCard, Text } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback } from 'react';

import { listPalaces } from '../../../src/features/palace/palaces';
import { useApp, useT } from '../../../src/services/context';
import { BackHeader, Screen, Stack } from '../../../src/ui/Screen';

/** MEM-12 My palaces: the learner's palaces (RoomCard) and [Build a palace] (Pro). */
export default function Palaces() {
  const app = useApp();
  const t = useT();
  const q = useQuery({ queryKey: ['palaces'], queryFn: () => listPalaces(app) });
  useFocusEffect(
    useCallback(() => {
      void q.refetch();
    }, [q.refetch]), // eslint-disable-line react-hooks/exhaustive-deps
  );
  const pro = app.isPro();
  const pet = app.store.getState().pet;
  const build = () => (pro ? router.push('/palace/new' as Href) : router.push({ pathname: '/paywall', params: { from: 'palace' } } as unknown as Href));
  const open = (id: string, action: 'walk' | 'quiz' | 'edit') => {
    router.push((action === 'edit' ? `/palace/${id}` : `/palace/${id}/${action}`) as Href);
  };
  const list = q.data ?? [];

  return (
    <Screen testID="MEM-12" footer={<Button label={t('memory_labs:MEM-12.build')} icon="Plus" onPress={build} testID="mem12-build" />}>
      <BackHeader title={t('memory_labs:MEM-12.title')} backLabel={t('ui:common.back')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/learn' as Href))} />
      {pet ? <PetLine pet={{ species: pet.species === 'dog' ? 'dog' : 'cat', mood: 'happy' }} petName={pet.name} text={t('memory_labs:MEM-12.intro')} /> : null}
      {!pro ? (
        <Text variant="body" tone="muted" testID="mem12-pro-line">
          {t('memory_labs:MEM-12.pro_line')}
        </Text>
      ) : null}
      {q.isSuccess && !list.length ? <EmptyState pet={{ species: pet?.species === 'dog' ? 'dog' : 'cat', mood: 'curious' }} text={t('memory_labs:MEM-12.empty')} testID="mem12-empty" /> : null}
      <Stack gap={16}>
        {list.map(({ palace, rooms, items }) => (
          <RoomCard
            key={palace.palace_id}
            name={palace.name}
            image={`palace-${palace.template}`}
            meta={`${t('memory_labs:MEM-12.meta.1', { rooms })} · ${t('memory_labs:MEM-12.meta.2', { items })}`}
            onPress={() => open(palace.palace_id, 'edit')}
            onWalk={items ? () => open(palace.palace_id, 'walk') : undefined}
            onQuiz={items ? () => open(palace.palace_id, 'quiz') : undefined}
            testID={`palace-${palace.palace_id}`}
          />
        ))}
      </Stack>
    </Screen>
  );
}
