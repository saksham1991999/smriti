import { ApiError } from '@smriti/api-client';
import { Banner, Button, ChoiceChips, Icon, LimitMeter, Spinner, Text } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp, useQueryScope, useT, useUiState } from '../src/services/context';
import { createSession, DrillRunner, keepRunner, type Difficulty } from '../src/services/drill';
import { fetchPracticeHub, practiceKeys } from '../src/services/practice';
import { FreeLimitSheet } from '../src/ui/FreeLimitSheet';
import { BackHeader, Screen } from '../src/ui/Screen';

const COUNTS = [5, 10, 20];
const PREFS_KEY = 'drill-prefs';

interface Prefs {
  count: number;
  difficulty: Difficulty;
  timed: boolean;
  feedback: 'after_each' | 'at_end';
}
const DEFAULTS: Prefs = { count: 10, difficulty: 'adaptive', timed: false, feedback: 'after_each' };

const list = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v.join(',') : (v ?? ''))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * PRC-03, drill setup. Takes the shared input contract (flow §5.3): `concepts`, or `topic`, or
 * `chapter` (chapter test), or `questions` (a fixed set), plus `source`. The server sizes the
 * session to the free questions left today, so it is shown here and a drill never stops mid-way.
 * Choices are remembered on the device.
 */
export default function DrillSetup() {
  const app = useApp();
  const t = useT();
  const locale = useUiState((s) => s.locale);
  const scope = useQueryScope();
  const exam = app.examProfileId();
  const p = useLocalSearchParams<{ concepts?: string; topic?: string; chapter?: string; questions?: string; paper?: string; source?: string }>();
  const concepts = useMemo(() => list(p.concepts), [p.concepts]);
  const questionIds = useMemo(() => list(p.questions), [p.questions]);
  const topicId = p.topic ? String(p.topic) : null;
  const chapterId = p.chapter ? String(p.chapter) : null;
  const paperId = p.paper ? String(p.paper) : null;
  const source = p.source ? String(p.source) : 'hub';
  const fixed = questionIds.length > 0;
  const chapterTest = chapterId !== null && !fixed;
  const hub = useQuery({ queryKey: practiceKeys.hub(scope, exam), queryFn: () => fetchPracticeHub(app) });
  const quota = hub.data?.limits.practice_questions;
  const remaining = quota && !quota.unlimited ? (quota.remaining ?? 0) : null;
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [limitOpen, setLimitOpen] = useState(false);
  const little = app.ageBand() === '10_12' || app.ageBand() === 'u10';

  useEffect(() => {
    void app.deps.stores.kv
      .get(PREFS_KEY)
      .then((raw) => raw && setPrefs({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) }))
      .catch(() => undefined);
  }, [app]);
  const choose = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    void app.deps.stores.kv.set(PREFS_KEY, JSON.stringify(next)).catch(() => undefined);
  };

  // What will be drilled, in words.
  const scopeLine = useMemo(() => {
    if (fixed) return t('practice:PRC-03.similar_scope', { n: questionIds.length });
    if (chapterId) return app.deps.content.subjects(locale, exam).flatMap((s) => s.chapters).find((c) => c.id === chapterId)?.name ?? t('practice:PRC-03.chapter_test_title');
    if (topicId) return t('practice:PRC-03.scope_topic', { topic_title: app.deps.content.topic(locale, topicId, exam)?.name ?? topicId });
    if (concepts.length === 1) return app.conceptName(concepts[0]!);
    if (concepts.length > 1) return t('practice:PRC-03.scope_concepts', { n: concepts.length });
    return null;
  }, [app, chapterId, concepts, exam, fixed, locale, questionIds.length, t, topicId]);

  // With no scope, pick a topic from what is on the device (the default is the first one).
  const topics = useMemo(() => app.deps.content.topics(locale, exam), [app, locale, exam]);
  const [pickedTopic, setPickedTopic] = useState<string | null>(null);
  const needsPick = !fixed && !chapterId && !topicId && concepts.length === 0;
  const effectiveTopic = topicId ?? (needsPick ? (pickedTopic ?? topics[0]?.id ?? null) : null);

  const size = remaining === null ? prefs.count : Math.min(prefs.count, remaining);
  const capReached = remaining !== null && remaining <= 0;

  const start = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const session = await createSession(app, {
        mode: chapterTest ? 'chapter_test' : source === 'weak_spot' ? 'weak_spots' : 'drill',
        concepts: concepts.length ? concepts : null,
        topic_id: effectiveTopic,
        chapter_id: chapterId,
        question_ids: fixed ? questionIds : null,
        paper_id: paperId,
        count: fixed ? questionIds.length : prefs.count,
        difficulty: fixed ? 'adaptive' : prefs.difficulty,
        source,
      });
      const runner = new DrillRunner(app, session, { feedback: prefs.feedback, timed: prefs.timed, concepts, topicId: effectiveTopic, chapterTest });
      keepRunner(runner);
      app.track('drill_started', {
        session_id: session.id,
        scope: chapterTest ? 'chapter' : concepts.length ? 'concepts' : 'topic',
        concept_count: concepts.length,
        question_count: session.size,
        difficulty_mode: prefs.difficulty,
        timed: prefs.timed,
        feedback_mode: prefs.feedback,
      });
      router.replace({ pathname: '/session/[id]', params: { id: session.id } });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      if (code === 'free_limit_reached') setLimitOpen(true);
      else setProblem(e instanceof ApiError && e.status === 404 ? t('practice:PRC-09.empty') : t('learn:LES-11.error'));
    }
    setBusy(false);
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/practice' as Href));
  const footer = capReached ? (
    <View style={styles.gap}>
      <Button label={t('practice:PRC-17.reviews')} icon="Cards" onPress={() => router.replace('/memory' as Href)} testID="drill-reviews" />
      <Button variant="ghost" label={t('practice:PRC-03.why_link')} onPress={() => setLimitOpen(true)} testID="drill-why" />
    </View>
  ) : (
    <Button label={t('practice:PRC-03.start')} icon="Play" iconPosition="end" loading={busy} disabled={hub.isPending || (needsPick && !effectiveTopic)} onPress={() => void start()} testID="drill-start" />
  );

  return (
    <Screen testID="PRC-03" footer={footer}>
      <BackHeader title={chapterTest ? t('practice:PRC-03.chapter_test_title') : t('practice:PRC-03.title')} backLabel={t('ui:common.close')} onBack={close} />
      {scopeLine ? (
        <View style={styles.scope} testID="drill-scope">
          <Icon name="Barbell" color="primary" />
          <Text variant="heading" style={styles.grow}>
            {scopeLine}
          </Text>
        </View>
      ) : (
        <ChoiceChips label={t('practice:PRC-03.change')} options={topics.map((x) => ({ value: x.id, label: x.name }))} value={effectiveTopic ? [effectiveTopic] : []} onChange={(v) => setPickedTopic(v[0] ?? null)} testID="drill-topic" />
      )}
      {!fixed && !chapterTest ? (
        <>
          <ChoiceChips
            label={t('practice:PRC-03.questions')}
            options={COUNTS.map((n) => ({ value: String(n), label: String(n) }))}
            value={[String(prefs.count)]}
            onChange={(v) => choose({ count: Number(v[0] ?? 10) })}
            testID="drill-count"
          />
          <View style={styles.gap}>
            <ChoiceChips
              label={t('practice:PRC-03.difficulty')}
              options={(['adaptive', 'easy', 'medium', 'hard'] as const).map((d) => ({ value: d, label: t(`practice:PRC-03.${d}`) }))}
              value={[prefs.difficulty]}
              onChange={(v) => choose({ difficulty: (v[0] as Difficulty) ?? 'adaptive' })}
              testID="drill-difficulty"
            />
            {prefs.difficulty === 'adaptive' ? (
              <Text variant="caption" tone="muted">
                {t('practice:PRC-03.adaptive_caption')}
              </Text>
            ) : null}
          </View>
        </>
      ) : null}
      <ChoiceChips
        label={t('practice:PRC-03.timing')}
        options={[
          { value: 'untimed', label: t('practice:PRC-03.untimed') },
          { value: 'timed', label: t('practice:PRC-03.timed') },
        ]}
        value={[prefs.timed ? 'timed' : 'untimed']}
        onChange={(v) => choose({ timed: v[0] === 'timed' })}
        testID="drill-timing"
      />
      <ChoiceChips
        label={t('practice:PRC-03.show_answers')}
        options={[
          { value: 'after_each', label: t('practice:PRC-03.after_each') },
          { value: 'at_end', label: t('practice:PRC-03.at_the_end') },
        ]}
        value={[prefs.feedback]}
        onChange={(v) => choose({ feedback: (v[0] as Prefs['feedback']) ?? 'after_each' })}
        testID="drill-feedback"
      />
      {hub.isPending ? <Spinner label={t('practice:PRC-03.title')} /> : null}
      {quota && !quota.unlimited ? (
        <LimitMeter label={t('practice:PRC-01.title')} used={quota.used} limit={quota.limit ?? 0} proAction={little ? 'ask_grown_up' : 'pro_link'} onProPress={() => setLimitOpen(true)} testID="drill-meter" />
      ) : null}
      {remaining !== null && remaining > 0 && remaining < prefs.count && !fixed ? (
        <Text variant="caption" tone="muted" testID="drill-sized">
          {t('practice:PRC-03.sized_to_free', { remaining: size })}
        </Text>
      ) : null}
      {capReached ? <Banner tone="info" icon="Info" text={t('practice:PRC-03.cap_reached')} testID="drill-cap" /> : null}
      {problem ? <Banner tone="warning" icon="Warning" text={problem} testID="drill-problem" /> : null}
      <FreeLimitSheet open={limitOpen} onOpenChange={setLimitOpen} kind="daily_cap" limit={quota?.limit ?? null} trigger="practice_limit" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scope: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1 },
  gap: { gap: 8 },
});
