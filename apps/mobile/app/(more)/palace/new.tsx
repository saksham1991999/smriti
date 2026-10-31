import { Button, Chip, Icon, Text, useTheme } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { createPalace, palaceSources, type PalaceTemplate } from '../../../src/features/palace/palaces';
import { useApp, useT } from '../../../src/services/context';
import { BackHeader, Screen, Stack } from '../../../src/ui/Screen';

const TEMPLATES: { id: PalaceTemplate; key: 'memory_labs:MEM-13.home' | 'memory_labs:MEM-13.school' | 'memory_labs:MEM-13.mix'; icon: 'House' | 'Exam' | 'Sliders' }[] = [
  { id: 'home', key: 'memory_labs:MEM-13.home', icon: 'House' },
  { id: 'school', key: 'memory_labs:MEM-13.school', icon: 'Exam' },
  { id: 'custom', key: 'memory_labs:MEM-13.mix', icon: 'Sliders' },
];

/**
 * MEM-13 (pick a place and name it) then MEM-15 (what to memorise: list mnemonics from learned
 * topics). [Use these n items] creates the palace and opens the builder (MEM-14).
 */
export default function NewPalace() {
  const app = useApp();
  const t = useT();
  const theme = useTheme();
  const [step, setStep] = useState<1 | 2>(1);
  const [template, setTemplate] = useState<PalaceTemplate | null>(null);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const sources = useQuery({ queryKey: ['palace', 'sources'], queryFn: () => palaceSources(app), enabled: step === 2 });
  const items = (sources.data ?? []).filter((s) => picked.includes(s.id)).flatMap((s) => s.items.map((i) => i.ref));

  const choose = (id: PalaceTemplate, label: string) => {
    setTemplate(id);
    if (!name.trim()) setName(label);
  };
  const create = async () => {
    if (!template || !items.length || busy) return;
    setBusy(true);
    const id = await createPalace(app, { name: name || t(TEMPLATES.find((x) => x.id === template)!.key), template, items, roomName: (n) => t('memory_labs:MEM-13.room_copy', { room_name: t('memory_labs:MEM-14.add_room'), n }) });
    router.replace(`/palace/${id}` as Href);
  };
  const back = () => (step === 2 ? setStep(1) : router.canGoBack() ? router.back() : router.replace('/palace' as Href));

  if (step === 1) {
    return (
      <Screen testID="MEM-13" footer={<Button label={t('memory_labs:MEM-13.next')} disabled={!template || !name.trim()} onPress={() => setStep(2)} testID="mem13-next" />}>
        <BackHeader title={t('memory_labs:MEM-13.title')} backLabel={t('ui:common.back')} onBack={back} />
        <Text variant="body" tone="muted">
          {t('memory_labs:MEM-13.tip')}
        </Text>
        <View accessibilityRole="radiogroup" style={styles.grid}>
          {TEMPLATES.map((x) => {
            const label = t(x.key);
            const on = template === x.id;
            return (
              <Pressable
                key={x.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={label}
                onPress={() => choose(x.id, label)}
                testID={`mem13-${x.id}`}
                style={[styles.tile, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card, borderColor: on ? theme.colors.primary : theme.colors.line, borderWidth: on ? 2 : 1 }]}
              >
                <Icon name={x.icon} size={32} color={on ? 'primary' : 'inkMuted'} />
                <Text variant="label" align="center">
                  {label}
                </Text>
                {x.id === 'custom' ? (
                  <Text variant="caption" tone="muted" align="center">
                    {t('memory_labs:MEM-13.mix_sub')}
                  </Text>
                ) : null}
                {on ? (
                  <View style={styles.check}>
                    <Icon name="CheckCircle" size={20} weight="fill" color="primary" />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
        {template ? (
          <Stack gap={6}>
            <Text variant="label">{t('memory_labs:MEM-13.name')}</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              maxLength={60}
              accessibilityLabel={t('memory_labs:MEM-13.name')}
              style={[styles.input, { backgroundColor: theme.colors.surfaceSunken, color: theme.colors.ink, borderColor: theme.colors.line, borderRadius: theme.radius.md }]}
              testID="mem13-name"
            />
          </Stack>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen
      testID="MEM-15"
      footer={<Button label={t('memory_labs:MEM-15.use', { n: items.length })} disabled={!items.length || busy} onPress={() => void create()} testID="mem15-use" />}
    >
      <BackHeader title={t('memory_labs:MEM-15.title')} backLabel={t('ui:common.back')} onBack={back} />
      <Chip kind="filter" selected label={t('memory_labs:MEM-15.tab_topic')} />
      {sources.isSuccess && !sources.data.length ? (
        <Text variant="body" tone="muted" testID="mem15-none">
          {t('memory_labs:MEM-15.none_learned')}
        </Text>
      ) : null}
      {(sources.data ?? []).map((s) => {
        const on = picked.includes(s.id);
        return (
          <Pressable
            key={s.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${s.topicName}, ${t('memory_labs:MEM-15.items_in_order', { k: s.items.length })}`}
            onPress={() => setPicked(on ? picked.filter((x) => x !== s.id) : [...picked, s.id])}
            testID={`mem15-source-${s.id}`}
            style={[styles.row, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, borderColor: on ? theme.colors.primary : theme.colors.line }]}
          >
            <Icon name={on ? 'CheckCircle' : 'Circle'} size={24} weight={on ? 'fill' : 'bold'} color={on ? 'primary' : 'inkMuted'} />
            <Stack gap={4} style={styles.grow}>
              <Text variant="label">{s.topicName}</Text>
              <Text variant="caption" tone="muted">
                {t('memory_labs:MEM-15.items_in_order', { k: s.items.length })}
              </Text>
              {on ? (
                <View style={styles.chips}>
                  {s.items.map((i) => (
                    <Chip key={i.ref} label={i.label} />
                  ))}
                </View>
              ) : null}
            </Stack>
          </Pressable>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { width: '47%', minHeight: 128, padding: 12, gap: 8, alignItems: 'center', justifyContent: 'center' },
  check: { position: 'absolute', top: 8, right: 8 },
  input: { minHeight: 48, paddingHorizontal: 12, borderWidth: 1, fontSize: 16 },
  row: { flexDirection: 'row', gap: 12, padding: 16, borderWidth: 1, alignItems: 'flex-start' },
  grow: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
