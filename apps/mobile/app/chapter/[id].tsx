import { Button, Card, Chip, Icon, IconButton, Illustration, PressableScale, ProgressBar, Sheet, Text, Toast, useTheme } from '@smriti/ui-native';
import type { IconName } from '@smriti/tokens/ui';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { TopicView } from '../../src/content/repo';
import { bundledIllustrations } from '../../src/seed/illustrations';
import { defaultChapterChoice, resetChapter } from '../../src/services/checks';
import { useApp, useT, useUiState } from '../../src/services/context';
import { chapterProgress, dueByTopic } from '../../src/services/learn';
import { loadTopicStates, type TopicState } from '../../src/services/progress';
import { ChapterTestSheet, DownloadSheet, ResetSheet, TopicActionsSheet } from '../../src/ui/ChapterSheets';
import { BuddyLine } from '../../src/ui/Onboarding';
import { Screen } from '../../src/ui/Screen';

const RAIL_X = 22;
const SECONDS_PER_CARD = 12;

/**
 * LRN-02, a chapter as a path of topics: header with progress, the tools row (Practise, Chapter
 * test, Download), the topic rail with the Next row expanded, review rows after learned topics
 * that have cards due today (A14), the chapter test row at the end, and the pinned Continue /
 * Start / Practise action. Long-press a topic for Quick revision, Download and Mark as learned
 * (a one-topic Test out). The overflow downloads, resets progress or reports a problem.
 */
export default function Chapter() {
  const app = useApp();
  const t = useT();
  const theme = useTheme();
  const locale = useUiState((s) => s.locale);
  const online = useUiState(() => app.deps.network.isOnline());
  const { id } = useLocalSearchParams<{ id: string }>();
  const exam = app.examProfileId();
  const subject = app.deps.content.subjects(locale, exam).find((s) => s.chapters.some((c) => c.id === id));
  const chapter = subject?.chapters.find((c) => c.id === id);
  const [states, setStates] = useState<Map<string, TopicState>>(new Map());
  const [due, setDue] = useState<Map<string, number>>(new Map());
  const [testSheet, setTestSheet] = useState(false);
  const [menu, setMenu] = useState(false);
  const [downloadSheet, setDownloadSheet] = useState(false);
  const [resetAsk, setResetAsk] = useState(false);
  const [actionsFor, setActionsFor] = useState<TopicView | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const reload = useCallback(() => {
    void loadTopicStates(app).then(setStates);
    void dueByTopic(app).then(setDue);
  }, [app]);
  useFocusEffect(reload);
  useEffect(() => {
    if (chapter) app.track('chapter_viewed', {});
  }, [app, chapter]);
  const progress = useMemo(() => (chapter ? chapterProgress(chapter, states) : null), [chapter, states]);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/learn' as Href));
  if (!chapter || !subject || !progress) {
    return (
      <Screen testID="LRN-02">
        <IconButton icon="CaretLeft" label={t('ui:common.back')} onPress={back} />
      </Screen>
    );
  }
  const n = subject.chapters.indexOf(chapter) + 1;
  const family = subject.colorFamily;
  const art = bundledIllustrations[`subject-${family}`] ? `subject-${family}` : null;
  const open = (tp: TopicView) => {
    const learned = states.get(tp.id)?.status === 'learned';
    app.track('topic_start_tapped', {});
    router.push({ pathname: '/lesson/[topicId]', params: { topicId: tp.id, mode: learned && tp.hasQuickRevision ? 'quick_revision' : 'deep_dive' } });
  };
  const practise = () => router.push({ pathname: '/drill', params: { chapter: chapter.id, source: 'chapter' } });
  const learnedCount = chapter.topics.filter((tp) => states.get(tp.id)?.status === 'learned').length;
  const defaultChoice = defaultChapterChoice(learnedCount, chapter.topics.length);
  const openTest = () => {
    app.track('chapter_test_opened', { default_choice: defaultChoice });
    setTestSheet(true);
  };
  // Offline downloads are Pro (LRN-15); free students see the paywall's offline reason instead.
  const openDownload = () => {
    setMenu(false);
    setActionsFor(null);
    if (!app.isPro()) router.push({ pathname: '/paywall', params: { from: 'offline_download' } });
    else setDownloadSheet(true);
  };
  const allLearned = progress.status === 'learned';
  const next = progress.next;
  const cta = allLearned ? (
    <Button label={t('learn:LRN-02.cta_all_learned')} icon="Target" fullWidth onPress={openTest} testID="chapter-cta" />
  ) : next ? (
    <Button
      label={progress.nextInProgress ? t('learn:LRN-02.cta_continue', { topic_title: next.name }) : t('learn:LRN-02.cta_start', { topic_title: next.name })}
      icon="Play"
      fullWidth
      onPress={() => open(next)}
      testID="chapter-cta"
    />
  ) : undefined;
  const progressLine =
    progress.minutesLeft !== null && !allLearned
      ? t('learn:LRN-02.progress', { done: progress.done, total: progress.total, minutes: progress.minutesLeft })
      : t('learn:LRN-02.progress.1', { done: progress.done, total: progress.total });
  const fillTo = Math.max(0, chapter.topics.findIndex((tp) => states.get(tp.id)?.status !== 'learned'));

  return (
    <Screen testID="LRN-02" footer={cta}>
      <View style={styles.top}>
        <IconButton icon="CaretLeft" label={t('ui:common.back')} onPress={back} />
        <Text variant="heading" heading numberOfLines={2} style={styles.grow}>
          {chapter.name}
        </Text>
        <IconButton icon="DotsThreeVertical" label={t('ui:common.moreOptions')} onPress={() => setMenu(true)} testID="chapter-menu" />
      </View>

      <Card tone="tint" subject={family} size="lg" testID="chapter-header">
        <View style={styles.headerRow}>
          <View style={styles.grow}>
            <Text variant="caption" tone="subject" subject={family}>
              {t('learn:LRN-02.header_kicker.1', { n })}
            </Text>
            <Text variant="title" heading>
              {chapter.name}
            </Text>
            <Text variant="label" tone="muted" numeric testID="chapter-progress">
              {progressLine}
            </Text>
          </View>
          {art ? <Illustration name={art} decorative width={84} height={84} /> : null}
        </View>
        <ProgressBar value={progress.total ? progress.done / progress.total : 0} tone="subject" subject={family} label={progressLine} />
      </Card>

      <View style={styles.tools}>
        <Tool icon="Target" label={t('learn:LRN-02.tools.2')} onPress={practise} testID="chapter-tool-practise" />
        <Tool icon="Exam" label={t('learn:LRN-02.tools.3')} onPress={openTest} testID="chapter-tool-test" />
        <Tool icon="DownloadSimple" label={t('learn:LRN-02.tools.5')} onPress={openDownload} testID="chapter-tool-download" />
      </View>

      <View>
        <View style={[styles.rail, { backgroundColor: theme.colors.track }]} />
        <View
          style={[styles.rail, { backgroundColor: theme.colors.primary, height: `${Math.round(((allLearned ? chapter.topics.length : fillTo) / Math.max(1, chapter.topics.length + 1)) * 100)}%` }]}
        />
        {chapter.topics.map((tp, i) => {
          const st = states.get(tp.id);
          const learned = st?.status === 'learned';
          const checked = learned && (st?.learnedVia === 'test_out' || st?.learnedVia === 'placement');
          const isNext = next?.id === tp.id;
          const dueN = learned ? (due.get(tp.id) ?? 0) : 0;
          const local = app.deps.content.available(locale, tp.id, learned && tp.hasQuickRevision ? 'quick_revision' : 'deep_dive', exam);
          const icon: IconName = learned ? 'CheckCircle' : st?.status === 'in_progress' ? 'Play' : isNext ? 'Play' : 'Circle';
          const stateWord = learned ? app.tPending('learn:WEB-01.learned') : '';
          return (
            <View key={tp.id}>
              <View style={styles.railRow}>
                <View
                  style={[
                    styles.node,
                    {
                      backgroundColor: learned && !checked ? theme.colors.successTint : theme.colors.surface,
                      borderColor: checked ? theme.colors.success : isNext ? theme.colors.primary : theme.colors.line,
                    },
                  ]}
                >
                  <Icon name={icon} size={20} color={learned ? 'successText' : isNext ? 'primary' : 'inkMuted'} weight={learned && !checked ? 'fill' : 'bold'} />
                </View>
                <PressableScale
                  onPress={() => open(tp)}
                  onLongPress={() => setActionsFor(tp)}
                  accessibilityRole="button"
                  accessibilityLabel={`${i + 1} / ${chapter.topics.length}: ${tp.name}${stateWord ? `, ${stateWord}` : ''}`}
                  accessibilityHint={t('learn:LRN-02.long_press_actions')}
                  testID={`topic-${tp.id}`}
                  style={styles.grow}
                >
                  <Card style={isNext ? styles.nextCard : undefined}>
                    <View style={styles.topicBody}>
                      <Text variant="label" numberOfLines={3}>
                        {tp.name}
                      </Text>
                      {tp.minutes ? (
                        <Text variant="caption" tone="muted" numeric>
                          {t('learn:LRN-02.row_meta.1', { minutes: Math.max(1, Math.round(tp.minutes)) })}
                        </Text>
                      ) : null}
                      {!online && !local ? <Chip icon="WifiSlash" tone="sunken" label={t('learn:LRN-15.offline')} testID={`topic-offline-${tp.id}`} /> : null}
                      {isNext ? <Button size="sm" variant="secondary" label={t('learn:LRN-02.next_row_button')} onPress={() => open(tp)} testID="chapter-next-start" /> : null}
                    </View>
                  </Card>
                </PressableScale>
              </View>
              {dueN > 0 ? (
                <View style={styles.railRow}>
                  <View style={[styles.nodeSmall, { backgroundColor: theme.colors.primaryTint }]}>
                    <Icon name="Cards" size={16} color="primary" />
                  </View>
                  <View style={[styles.reviewRow, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card }]}>
                    <Text variant="label" numeric style={styles.grow}>
                      {`${t('learn:LRN-02.review_row.1', { n: dueN })} · ${t('learn:LRN-02.review_row.2', { minutes: Math.max(1, Math.round((dueN * SECONDS_PER_CARD) / 60)) })}`}
                    </Text>
                    <Button
                      size="sm"
                      variant="ghost"
                      label={t('learn:LRN-02.review_row.3')}
                      onPress={() => {
                        app.track('chapter_review_row_tapped', {});
                        router.push({ pathname: '/review', params: { topic: tp.id } });
                      }}
                      testID={`chapter-review-${tp.id}`}
                    />
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
        <View style={styles.railRow}>
          <View style={[styles.node, { backgroundColor: theme.colors.surface, borderColor: theme.colors.line }]}>
            <Icon name="Exam" size={20} color="ink" />
          </View>
          <Card style={styles.grow} onPress={openTest} accessibilityLabel={t('learn:LRN-02.test_row.1')} testID="chapter-test-row">
            <View style={styles.topicBody}>
              <Text variant="label">{t('learn:LRN-02.test_row.1')}</Text>
              <Text variant="caption" tone="muted">
                {t('learn:LRN-02.test_row.2')}
              </Text>
            </View>
          </Card>
        </View>
      </View>

      {allLearned ? <BuddyLine text={t('learn:LRN-02.chapter_learned_pet_line')} /> : null}

      <ChapterTestSheet open={testSheet} onOpenChange={setTestSheet} chapter={chapter} defaultChoice={defaultChoice} />
      <DownloadSheet open={downloadSheet} onOpenChange={setDownloadSheet} chapter={chapter} subject={subject} onToast={setToast} />
      <ResetSheet
        open={resetAsk}
        onOpenChange={setResetAsk}
        chapter={chapter}
        onReset={() => {
          setResetAsk(false);
          void resetChapter(app, chapter).then(() => {
            reload();
            setToast(t('learn:LRN-02.reset_toast'));
          });
        }}
      />
      <TopicActionsSheet
        topic={actionsFor}
        learned={actionsFor ? states.get(actionsFor.id)?.status === 'learned' : false}
        onOpenChange={(o) => (o ? undefined : setActionsFor(null))}
        onQuickRevision={(tp) => {
          setActionsFor(null);
          router.push({ pathname: '/lesson/[topicId]', params: { topicId: tp.id, mode: 'quick_revision' } });
        }}
        onDownload={openDownload}
        onMarkLearned={(tp) => {
          setActionsFor(null);
          router.push({ pathname: '/check/[chapterId]', params: { chapterId: chapter.id, topic: tp.id } });
        }}
      />
      <Sheet open={menu} onOpenChange={setMenu} title={t('ui:common.moreOptions')} height="40" testID="chapter-overflow">
        <View style={styles.gap}>
          <Button variant="ghost" icon="DownloadSimple" label={t('learn:LRN-02.overflow.1')} onPress={openDownload} testID="chapter-download" />
          <Button
            variant="ghost"
            icon="ArrowCounterClockwise"
            label={t('learn:LRN-02.overflow.2')}
            onPress={() => {
              setMenu(false);
              setResetAsk(true);
            }}
            testID="chapter-reset"
          />
          <Button
            variant="ghost"
            icon="Flag"
            label={t('learn:LRN-02.overflow.3')}
            onPress={() => {
              setMenu(false);
              router.push({ pathname: '/report-content', params: { kind: 'chapter', ref: chapter.id } });
            }}
            testID="chapter-report"
          />
        </View>
      </Sheet>
      <Toast open={toast !== null} message={toast ?? ''} onDismiss={() => setToast(null)} testID="chapter-toast" />
    </Screen>
  );
}

function Tool({ icon, label, onPress, testID }: { icon: IconName; label: string; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={label} testID={testID} style={[styles.tool, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card }]}>
      <Icon name={icon} size={32} color="primary" />
      <Text variant="caption" align="center" numberOfLines={2}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
  gap: { gap: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 12 },
  tools: { flexDirection: 'row', gap: 12 },
  tool: { width: 88, minHeight: 88, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 8 },
  rail: { position: 'absolute', left: RAIL_X - 2, top: 22, width: 4, borderRadius: 2, bottom: 22 },
  railRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  node: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  nodeSmall: { width: 32, height: 32, borderRadius: 16, marginHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  nextCard: { minHeight: 110 },
  topicBody: { gap: 6, alignItems: 'flex-start' },
  reviewRow: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, minHeight: 56 },
});
