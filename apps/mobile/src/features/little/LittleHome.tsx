import { displayHealth, gentlePetState, playNode, type PetState } from '@smriti/app-core';
import { useAppStore } from '@smriti/app-core/react';
import type { MessageKey } from '@smriti/i18n';
import { Button, Icon, IconButton, Illustration, PetAvatar, PetView, PlantView, Text, useTheme, useSubject, type IconName } from '@smriti/ui-native';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { bundledIllustrations } from '../../seed/illustrations';
import { useApp, useT, useUiState } from '../../services/context';
import { Screen } from '../../ui/Screen';
import { readAloud, speechFor } from '../speech/speech';
import { useExperience } from './experience';
import { GrownUpsHold } from './GrownUpsHold';
import { loadLittlePath, type LittleNode, type LittlePathModel } from './path';

type PetMood = 'happy' | 'sleepy' | 'excited' | 'curious';

/** Stored pet state → the mood a gentle pet shows (me-money §3.3: happy, content and sleepy only). */
export function gentleMood(state: string | undefined, gentle: boolean): PetMood {
  const s = gentlePetState((state ?? 'happy') as PetState, gentle);
  return s === 'sleepy' || s === 'tired' ? 'sleepy' : 'happy';
}

const KIND_ICON: Record<LittleNode['kind'], IconName> = { lesson: 'BookBookmark', story: 'BookBookmark', song: 'SpeakerHigh', play: 'Smiley' };
const KIND_LABEL: Record<LittleNode['kind'], MessageKey> = {
  lesson: 'learn:HOME-06.little_learner_lesson_node',
  story: 'learn:HOME-06.little_learner_story_node',
  song: 'learn:HOME-06.little_learner_song_node',
  play: 'learn:HOME-06.little_learner_play_node',
};
/** Gentle zig-zag offsets (HOME-06 §3), repeated down the path. */
const ZIG = [0, 56, 0, -56];

/**
 * HOME-06, the little learner Home (class 1–5, `feature.little_learner`): one big [Play], the
 * path, subject circles, a gentle pet and plant, and the 2-second "For grown-ups" hold.
 */
export function LittleHome() {
  const app = useApp();
  const t = useT();
  const theme = useTheme();
  const exp = useExperience();
  const locale = useUiState((s) => s.locale);
  const pet = useAppStore((s) => s.pet);
  const plant = useAppStore((s) => s.plant);
  const wallet = useAppStore((s) => s.wallet);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [model, setModel] = useState<LittlePathModel | null>(null);
  const [line, setLine] = useState<MessageKey>('learn:HOME-06.little_learner_pet_greeting');
  const canSpeak = speechFor(app).out.available;

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void loadLittlePath(app, subjectId).then((m) => {
        if (!alive) return;
        setModel(m);
        if (m.nodes.some((n) => n.done)) setLine('learn:HOME-06.little_learner_pet_after_a_node');
      });
      app.track('home_viewed', { is_little_learner: true, is_guest: app.store.getState().session.isGuest, is_offline: !app.deps.network.isOnline() });
      return () => {
        alive = false;
      };
    }, [app, subjectId, locale]),
  );

  const say = (key: MessageKey) => {
    setLine(key);
    void readAloud(app, t(key));
  };

  const play = (node: LittleNode) => {
    const out = playNode(node, app.deps.network.isOnline());
    if (out.kind === 'not_ready') return say('learn:HOME-06.little_learner_coming_soon');
    if (out.kind === 'needs_internet') return say('learn:HOME-06.little_learner_needs_internet');
    if (out.kind === 'ask_grown_up') return say('learn:HOME-06.little_learner_pro_node');
    if (out.route === 'LES-01') router.push({ pathname: '/lesson/[topicId]', params: { topicId: out.ref, mode: 'deep_dive' } });
  };

  const mood = gentleMood(pet?.state, exp.gentle);
  // learn §5.6: in gentle mode the plant never shows past droopy.
  const shownPlant = plant ? { stage: plant.stage, health: displayHealth(plant.health, { under10: exp.gentle }) } : null;
  const stars = wallet?.xp_total ?? 0;

  return (
    <Screen testID="HOME-06" edges="top" contentStyle={styles.content}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={pet?.name ?? t('learn:HOME-06.little_learner_pet_greeting')} onPress={() => say(line)} style={styles.target} testID="little-pet">
          {pet ? <PetAvatar species={pet.species} mood={mood} size={56} /> : null}
        </Pressable>
        <View accessible accessibilityLabel={t('learn:HOME-06.little_learner_stars_a11y', { n: stars })} style={[styles.stars, { backgroundColor: theme.colors.primaryTint, borderRadius: theme.radius.pill }]} testID="little-stars">
          <Icon name="Star" weight="fill" size={20} color="primary" />
          <Text variant="label" numeric>
            {String(stars)}
          </Text>
        </View>
        {shownPlant ? <PlantView stage={shownPlant.stage} health={shownPlant.health} size={48} alt={t('learn:HOME-06.little_learner_plant_a11y')} testID="little-plant" /> : null}
        <View style={styles.grow} />
        <GrownUpsHold onOpen={() => router.push('/grown-ups')} />
      </View>

      <View style={[styles.bubble, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.cardLarge, borderColor: theme.colors.line }]} accessibilityLiveRegion="polite">
        <Text variant="heading" style={styles.grow} testID="little-line">
          {t(line)}
        </Text>
        {canSpeak ? <IconButton icon="SpeakerHigh" label={t('learn:LRN-11.read_to_me_little_learner')} onPress={() => void readAloud(app, t(line))} size={48} testID="little-speak" /> : null}
      </View>

      <View style={styles.path} testID="little-path">
        {model?.nodes.map((node, i) => (
          <PathNode
            key={node.id}
            node={node}
            index={i}
            isCurrent={i === model.current}
            last={i === model.nodes.length - 1}
            subject={model.subject?.colorFamily ?? 'physics'}
            petSpecies={pet?.species ?? null}
            petName={pet?.name ?? ''}
            mood={mood}
            gentle={exp.gentle}
            offline={!app.deps.network.isOnline()}
            onPlay={() => play(node)}
          />
        ))}
      </View>

      {model && model.subjects.length > 1 ? (
        <View style={styles.subjects} testID="little-subjects">
          {model.subjects.slice(0, 4).map((s) => {
            const active = s.id === model.subject?.id;
            const art = bundledIllustrations[`subject-${s.colorFamily}`] ? `subject-${s.colorFamily}` : null;
            return (
              <Pressable key={s.id} accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={s.name} onPress={() => setSubjectId(s.id)} style={styles.subject} testID={`little-subject-${s.id}`}>
                <SubjectCircle family={s.colorFamily} active={active} art={art} name={s.name} />
                <Text variant="label" align="center" numberOfLines={1}>
                  {s.name}
                </Text>
                {active ? (
                  <Text variant="caption" tone="primary">
                    {t('learn:HOME-06.little_learner_subject_now')}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </Screen>
  );
}

function SubjectCircle({ family, active, art, name }: { family: string; active: boolean; art: string | null; name: string }) {
  const theme = useTheme();
  const s = useSubject(family);
  return (
    <View style={[styles.circle72, { backgroundColor: s.tint, borderColor: active ? theme.colors.primary : 'transparent' }]}>
      {art ? <Illustration name={art} alt={name} width={52} height={52} decorative /> : <Icon name="BookBookmark" color="subjectText" />}
    </View>
  );
}

function PathNode({
  node,
  index,
  isCurrent,
  last,
  subject,
  petSpecies,
  petName,
  mood,
  gentle,
  offline,
  onPlay,
}: {
  node: LittleNode;
  index: number;
  isCurrent: boolean;
  last: boolean;
  subject: string;
  petSpecies: 'cat' | 'dog' | null;
  petName: string;
  mood: PetMood;
  gentle: boolean;
  offline: boolean;
  onPlay: () => void;
}) {
  const t = useT();
  const theme = useTheme();
  const s = useSubject(subject);
  const size = isCurrent ? 112 : 88;
  const label = node.coming ? t(KIND_LABEL[node.kind]) : node.title;
  const a11y = node.coming
    ? t('learn:HOME-06.little_learner_node_coming_a11y', { title: label })
    : node.done
      ? t('learn:HOME-06.little_learner_node_done_a11y', { title: label })
      : node.locked
        ? `${label}. ${t('learn:HOME-06.little_learner_pro_node')}`
        : label;
  const cloud = !node.coming && !node.available && offline;
  return (
    <View style={[styles.nodeWrap, { transform: [{ translateX: ZIG[index % ZIG.length]! }] }]}>
      <View style={styles.nodeRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={a11y}
          onPress={onPlay}
          style={[
            styles.node,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: node.coming ? theme.colors.surfaceSunken : node.done ? s.strong : s.tint,
              borderColor: isCurrent ? theme.colors.primary : theme.colors.line,
              borderWidth: isCurrent ? 4 : 2,
            },
          ]}
          testID={`little-node-${index}`}
        >
          <Icon name={KIND_ICON[node.kind]} size={32} weight="fill" color={node.coming ? 'inkMuted' : node.done ? 'subjectOnStrong' : 'subjectText'} />
          {node.done ? <Badge icon="Star" tone="primary" testID={`little-node-${index}-star`} /> : null}
          {node.locked ? <Badge icon="Lock" tone="muted" /> : null}
          {cloud ? <Badge icon="CloudSlash" tone="muted" /> : null}
        </Pressable>
        {isCurrent && petSpecies ? <PetView species={petSpecies} mood={mood === 'sleepy' ? 'sleepy' : 'happy'} under10={gentle} size={72} alt={`${petName}`} style={styles.nodePet} /> : null}
      </View>
      <Text variant="label" align="center" numberOfLines={2} style={styles.nodeLabel} tone={node.coming ? 'muted' : 'ink'}>
        {node.coming ? `${label} · ${t('learn:HOME-06.little_learner_coming_soon')}` : label}
      </Text>
      {isCurrent && !node.coming ? (
        <Button label={t('learn:HOME-06.little_learner_play')} icon="Play" onPress={onPlay} style={[styles.play, { borderRadius: theme.radius.button }]} testID="little-play" />
      ) : null}
      {!last ? <View style={[styles.dots, { borderColor: theme.colors.track }]} /> : null}
    </View>
  );
}

function Badge({ icon, tone, testID }: { icon: IconName; tone: 'primary' | 'muted'; testID?: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={[styles.badge, { backgroundColor: tone === 'primary' ? theme.colors.primary : theme.colors.surface, borderColor: theme.colors.bg }]}>
      <Icon name={icon} size={16} weight="fill" color={tone === 'primary' ? 'onPrimary' : 'inkMuted'} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingBottom: 32 },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10 },
  target: { minWidth: 64, minHeight: 64, alignItems: 'center', justifyContent: 'center' },
  stars: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, minHeight: 36 },
  grow: { flex: 1 },
  bubble: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16, borderWidth: 1 },
  path: { alignItems: 'center', paddingVertical: 8 },
  nodeWrap: { alignItems: 'center' },
  nodeRow: { flexDirection: 'row', alignItems: 'center' },
  node: { alignItems: 'center', justifyContent: 'center' },
  nodePet: { position: 'absolute', left: '100%', marginLeft: 4 },
  nodeLabel: { maxWidth: 200, marginTop: 6 },
  play: { minHeight: 64, minWidth: 200, marginTop: 10 },
  dots: { height: 28, borderLeftWidth: 4, borderStyle: 'dotted', marginVertical: 6 },
  badge: { position: 'absolute', right: -2, top: -2, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  subjects: { flexDirection: 'row', justifyContent: 'space-around', gap: 8, paddingTop: 8 },
  subject: { alignItems: 'center', gap: 4, minWidth: 72, flex: 1 },
  circle72: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', borderWidth: 3 },
});
