import { useAppStore } from '@smriti/app-core/react';
import { Banner, Card, Chip, ContinueCard, Icon, PetAvatar, StreakCard, StreakPill, SubjectTile, Text, useTheme } from '@smriti/ui-native';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useExperience } from '../../src/features/little/experience';
import { LittleHome } from '../../src/features/little/LittleHome';
import { bundledIllustrations } from '../../src/seed/illustrations';
import { useApp, useT, useUiState } from '../../src/services/context';
import { examName } from '../../src/services/exams';
import { loadHome, type HomeModel } from '../../src/services/progress';
import { Screen } from '../../src/ui/Screen';

const subjectArt = (family: string) => (bundledIllustrations[`subject-${family}`] ? `subject-${family}` : undefined);

/** The Learn tab: HOME-06 for little learners (`learnerExperience`), else HOME-01. */
export default function Learn() {
  return useExperience().littleLearner ? <LittleHome /> : <Home01 />;
}

/** HOME-01: one hero action from app-core's `selectHero`, the streak card, Up next, subjects. */
function Home01() {
  const app = useApp();
  const t = useT();
  const theme = useTheme();
  const locale = useUiState((s) => s.locale);
  const streak = useAppStore((s) => s.streak);
  const plant = useAppStore((s) => s.plant);
  const wallet = useAppStore((s) => s.wallet);
  const pet = useAppStore((s) => s.pet);
  const profile = useAppStore((s) => s.profile);
  const signedIn = useAppStore((s) => s.session.status === 'signed_in');
  const ob = useUiState((s) => s.onboarding);
  const [home, setHome] = useState<HomeModel | null>(null);
  const [online, setOnline] = useState(app.deps.network.isOnline());

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setOnline(app.deps.network.isOnline());
      void loadHome(app).then((h) => alive && setHome(h));
      return () => {
        alive = false;
      };
    }, [app, locale]),
  );

  const exam = app.examProfileId();
  const curious = ob.goals.length > 0 && ob.goals.every((g) => g === 'curious');
  const name = profile?.display_name?.split(' ')[0] ?? null;
  const topicName = (id: string) => app.deps.content.topic(locale, id, exam)?.name ?? '';
  const subjectOf = (id: string) => app.deps.content.subjectOf(locale, id, exam);
  const openLesson = (topicId: string, mode: 'deep_dive' | 'quick_revision') => router.push({ pathname: '/lesson/[topicId]', params: { topicId, mode } });

  const streakMsg = !streak
    ? t('learn:HOME-01.streak_card_not_yet_today')
    : streak.today_qualified
      ? t('learn:HOME-01.streak_card_watered')
      : streak.at_risk
        ? t('learn:HOME-01.streak_card_at_risk')
        : plant?.health === 'droopy'
          ? t('learn:HOME-01.streak_card_droopy')
          : plant?.health === 'dry'
            ? t('learn:HOME-01.streak_card_dry')
            : plant?.health === 'wilted'
              ? t('learn:HOME-01.streak_card_wilted')
              : t('learn:HOME-01.streak_card_not_yet_today');

  return (
    <Screen testID="HOME-01" edges="top">
      <View style={styles.topRow}>
        <Chip
          kind="filter"
          label={curious ? t('learn:HOME-01.exam_chip_just_curious') : (examName(app, exam) ?? app.appName())}
          accessibilityLabel={t('learn:HOME-01.exam_chip_a11y', { exam_name: examName(app, exam) ?? app.appName() })}
          testID="exam-chip"
        />
        <View style={styles.pills}>
          <StreakPill days={streak?.current ?? 0} testID="streak-pill" />
          <View accessible accessibilityLabel={t('learn:HOME-01.gem_pill_a11y', { n: wallet?.gems ?? 0 })} style={[styles.gem, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.pill }]}>
            <Icon name="Diamond" weight="fill" color="primary" size={20} />
            <Text variant="label" numeric>
              {String(wallet?.gems ?? 0)}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.greet}>
        {pet ? <PetAvatar species={pet.species} size={40} /> : null}
        <Text variant="title" heading testID="greeting">
          {name ? t('learn:HOME-01.greeting_any', { name }) : t('learn:HOME-01.greeting_guest')}
        </Text>
      </View>

      {!online ? <Banner tone="offline" icon="WifiSlash" text={t('learn:HOME-01.offline_banner')} testID="offline-banner" /> : null}

      <StreakCard
        message={streakMsg}
        atRisk={streak?.at_risk ?? false}
        freezes={{ ready: streak?.freezes_equipped ?? 0, slots: 2, label: (streak?.freezes_equipped ?? 0) > 0 ? t('learn:HOME-01.freeze_slots.1', { n: streak?.freezes_equipped ?? 0 }) : t('learn:HOME-01.freeze_slots.2') }}
        plant={{ stage: plant?.stage ?? 'seed', health: plant?.health ?? 'thriving' }}
        testID="streak-card"
      />

      {!signedIn && (streak?.current ?? 0) >= 1 ? (
        <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/sign-in', params: { mode: 'soft' } })} testID="save-plant-link">
          <Text variant="label" tone="primary">
            {t('learn:HOME-01.guest_link_day_2')}
          </Text>
        </Pressable>
      ) : null}

      {home ? <Hero app={app} home={home} t={t} topicName={topicName} subjectOf={subjectOf} openLesson={openLesson} /> : null}

      {home?.chapter && home.strip.length ? (
        <View style={styles.section}>
          <View style={styles.rowBetween}>
            <View style={styles.grow}>
              <Text variant="heading">{t('learn:HOME-01.strip_label.1', { chapter_title: home.chapter.name })}</Text>
              <Text variant="caption" tone="muted">
                {t('learn:HOME-01.strip_label.2', { n: home.topicsLeft })}
              </Text>
            </View>
            <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/chapter/[id]', params: { id: home.chapter!.id } })} testID="see-chapter">
              <Text variant="label" tone="primary">
                {t('learn:HOME-01.strip_chips.2')}
              </Text>
            </Pressable>
          </View>
          <View style={styles.strip}>
            {home.strip.map((s) => (
              <Card key={s.topic.id} outlined onPress={() => openLesson(s.topic.id, s.status === 'learned' && s.topic.hasQuickRevision ? 'quick_revision' : 'deep_dive')} accessibilityLabel={s.topic.name} testID={`strip-${s.topic.id}`}>
                <View style={styles.stripItem}>
                  <Icon name={s.status === 'learned' ? 'CheckCircle' : s.status === 'in_progress' ? 'Play' : 'BookBookmark'} weight={s.status === 'learned' ? 'fill' : 'bold'} color={s.status === 'learned' ? 'success' : 'primary'} />
                  <Text variant="body" numberOfLines={1} style={styles.grow}>
                    {s.topic.name}
                  </Text>
                  <Icon name="CaretRight" color="inkMuted" size={20} />
                </View>
              </Card>
            ))}
          </View>
        </View>
      ) : null}

      {home?.subjects.length ? (
        <View style={styles.section}>
          <Text variant="title" heading>
            {t('learn:HOME-01.subjects_heading')}
          </Text>
          <View style={styles.grid}>
            {home.subjects.map((s) => {
              const art = subjectArt(s.colorFamily);
              return (
                <View key={s.id} style={styles.tile}>
                  <SubjectTile
                    subject={s.colorFamily}
                    name={s.name}
                    progress={s.percent / 100}
                    {...(s.next ? { next: t('learn:HOME-01.tile_next', { topic_title: s.next.name }) } : {})}
                    caption={t('learn:HOME-01.tile_meta', { n: s.chapters.length })}
                    {...(art ? { illustration: art } : {})}
                    onPress={() => router.push({ pathname: '/subject/[id]', params: { id: s.id } })}
                    testID={`subject-${s.id}`}
                  />
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={styles.grid}>
        <View style={styles.tile}>
          <Card outlined onPress={() => router.push('/memory' as Href)} accessibilityLabel={t('learn:HOME-01.memory_tile.1')} testID="memory-tile">
            <View style={styles.gap6}>
              <Icon name="Brain" color="primary" />
              <Text variant="heading">{t('learn:HOME-01.memory_tile.1')}</Text>
              <Text variant="caption" tone="muted">
                {t('learn:HOME-01.memory_tile.2')}
              </Text>
            </View>
          </Card>
        </View>
      </View>
    </Screen>
  );
}

function Hero({
  app,
  home,
  t,
  topicName,
  subjectOf,
  openLesson,
}: {
  app: ReturnType<typeof useApp>;
  home: HomeModel;
  t: ReturnType<typeof useT>;
  topicName: (id: string) => string;
  subjectOf: (id: string) => { name: string; colorFamily: string } | null;
  openLesson: (topicId: string, mode: 'deep_dive' | 'quick_revision') => void;
}) {
  const { hero } = home;
  const a = hero.action;
  if (a.type === 'none') return null;
  if (a.type === 'review' || a.type === 'daily_challenge') {
    return (
      <ContinueCard
        subject="physics"
        eyebrow={t('learn:HOME-01.hero_review.1')}
        title={t('learn:HOME-01.hero_review.2', { count: a.type === 'review' ? a.count : 0 })}
        actionLabel={t('learn:HOME-01.hero_review.4')}
        onPress={() => router.push('/memory' as Href)}
        testID="hero"
      />
    );
  }
  const topicId = a.type === 'resume' ? a.bite.topicId : a.topic.topicId;
  const mode = a.type === 'resume' ? a.bite.mode : a.topic.mode;
  const subject = subjectOf(topicId);
  const minutes = a.type === 'resume' ? a.bite.minutesLeft : (a.topic.minutes ?? null);
  const pct = home.strip.find((s) => s.topic.id === topicId)?.percent ?? 0;
  const copy = (() => {
    switch (hero.kind) {
      case 'start_here':
        return { eyebrow: t('learn:HOME-01.hero_start_here.1'), action: t('learn:HOME-01.hero_start_here.2') };
      case 'continue':
        return { eyebrow: t('learn:HOME-01.hero_continue.1'), action: t('learn:HOME-01.hero_continue.3') };
      case 'streak_saver':
        return { eyebrow: t('learn:HOME-01.hero_streak_saver_lesson.1'), action: t('learn:HOME-01.hero_streak_saver_lesson.3') };
      case 'goal_met':
        return { eyebrow: t('learn:HOME-01.hero_goal_met.1'), action: t('learn:HOME-01.hero_goal_met.3') };
      default:
        return { eyebrow: t('learn:HOME-01.hero_next_topic.1'), action: app.tPending('learn:WEB-01.start') };
    }
  })();
  const meta = [subject?.name, minutes ? app.tPending('learn:WEB-01.minutes', { n: minutes }) : null].filter(Boolean).join(' · ');
  return (
    <ContinueCard
      subject={subject?.colorFamily ?? 'physics'}
      eyebrow={copy.eyebrow}
      title={topicName(topicId)}
      meta={meta}
      {...(hero.kind === 'continue' ? { progress: pct / 100, progressLabel: t('learn:HOME-01.hero_continue.2', { percent: pct }) } : {})}
      {...(subject && subjectArt(subject.colorFamily) ? { illustration: subjectArt(subject.colorFamily)! } : {})}
      actionLabel={copy.action}
      onPress={() => openLesson(topicId, mode)}
      testID="hero"
    />
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pills: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  gem: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, minHeight: 36 },
  greet: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  section: { gap: 12 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1 },
  strip: { gap: 8 },
  stripItem: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { width: '47.5%' },
  gap6: { gap: 6 },
});
