import { useAppStore } from '@smriti/app-core/react';
import { Button, Chip, Illustration, PlantView, StatTile, Text } from '@smriti/ui-native';
import { Redirect, router, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useApp, useT, useUiState } from '../src/services/context';
import { BuddyLine } from '../src/ui/Onboarding';
import { minutesOf } from '../src/ui/hooks';
import { Screen } from '../src/ui/Screen';

/**
 * LES-08: lesson complete. Streak, plant and XP come from the optimistic Home header that
 * `app.completeLesson` set; the server replaces them on the next sync. The one extra prompt
 * (R15) opens after Continue: the soft login sheet (AUTH-01) or the upsell (PAY-01).
 */
export default function LessonEnd() {
  const app = useApp();
  const t = useT();
  const end = useUiState((s) => s.lessonEnd);
  const streak = useAppStore((s) => s.streak);
  const plant = useAppStore((s) => s.plant);
  const online = app.deps.network.isOnline();
  if (!end) return <Redirect href={'/learn' as Href} />;
  const little = app.isLittleLearner();
  const s = end.summary;
  const petLine = t(`learn:LES-08.pet_lines_rotate.${((app.ui.getState().lessonsCompleted % 3) + 1) as 1 | 2 | 3}`);
  const next = () => {
    if (end.extra === 'soft_login') router.push({ pathname: '/sign-in', params: { mode: 'soft', reason: 'lesson_3', from: 'lesson_end' } });
    else if (end.extra === 'upsell') router.replace({ pathname: '/paywall', params: { from: 'lesson_end' } });
    else router.replace('/learn' as Href);
  };
  const stars = s.total > 0 ? Math.max(1, Math.round((s.correct / s.total) * 3)) : 3;
  return (
    <Screen
      testID="LES-08"
      footer={
        <>
          <Button label={little ? t('learn:LES-08.little_learner_next') : t('learn:LES-08.continue')} onPress={next} fullWidth testID="lesson-end-continue" />
          {!little && app.flags.get('feature.feynman') === true && end.mode !== 'onboarding' ? (
            <Button variant="ghost" icon="ChatCircleText" label={t('learn:LES-08.explain_back')} onPress={() => router.push(`/teach/${end.topicId}` as Href)} fullWidth testID="lesson-end-teach" />
          ) : null}
          {end.nextBiteTitle ? (
            <Text variant="caption" tone="muted" align="center">
              {t('learn:LES-08.next_caption.1', { bite_title: end.nextBiteTitle })}
            </Text>
          ) : null}
        </>
      }
    >
      <View style={styles.center}>
        <Illustration name="scene-lesson-complete" decorative width={220} height={160} />
        <Text variant="display" heading align="center">
          {little ? t('learn:LES-08.little_learner_title', { n: stars }) : t('learn:LES-08.title')}
        </Text>
        <Text variant="body" tone="muted" align="center">
          {t('learn:LES-08.topic_learned', { topic_title: end.topicTitle })}
        </Text>
      </View>
      <View style={styles.tiles}>
        <StatTile style={styles.tile} icon="Lightning" tint value={`+${s.xp}`} label={t('learn:LES-08.stat_labels.1')} testID="end-xp" />
        {s.accuracy !== null ? <StatTile style={styles.tile} icon="CheckCircle" value={`${Math.round(s.accuracy * 100)}%`} label={t('learn:LES-08.stat_labels.2')} testID="end-accuracy" /> : null}
        <StatTile style={styles.tile} icon="Timer" value={app.tPending('learn:WEB-01.minutes', { n: minutesOf(s.msTotal) })} label={t('learn:LES-08.stat_labels.3')} />
      </View>
      <View style={styles.row}>
        <PlantView stage={plant?.stage ?? 'sprout'} health={plant?.health ?? 'thriving'} size={72} decorative />
        <View style={styles.grow}>
          {end.streakUp && streak ? (
            <Chip kind="status" tone="streak" icon="Plant" label={t('learn:LES-08.streak', { n: streak.current })} testID="end-streak" />
          ) : null}
          <Text variant="body">{end.stageUp ? t('learn:LES-08.plant_leaf') : t('learn:LES-08.plant_watered')}</Text>
        </View>
      </View>
      {!online ? (
        <Text variant="caption" tone="muted">
          {t('learn:LES-08.offline_caption')}
        </Text>
      ) : null}
      <BuddyLine text={petLine} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: 8 },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1, gap: 6, alignItems: 'flex-start' },
});
