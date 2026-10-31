import { canSubmit, initialDraft, QuestionView, RichText } from '@smriti/lesson-player-native';
import type { Confidence as UiConfidence } from '@smriti/tokens/ui';
import { Banner, Button, Chip, ChoiceChips, ConfidenceRow, Dialog, Icon, IconButton, SegmentedProgress, Sheet, Spinner, Text, Timer, Toast, useTheme } from '@smriti/ui-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp, useT } from '../../src/services/context';
import { clock, DrillRunner, fetchSession, keepRunner, liveRunner, type MistakeType } from '../../src/services/drill';
import type { Confidence } from '../../src/services/mocks';
import { QuestionHost } from '../../src/ui/QuestionHost';
import { Screen } from '../../src/ui/Screen';

const TO_UI: Record<Confidence, UiConfidence> = { sure: 'sure', fifty_fifty: 'half', guess: 'guess' };
const FROM_UI: Record<UiConfidence, Confidence> = { sure: 'sure', half: 'fifty_fifty', guess: 'guess' };
const MISTAKES: { value: MistakeType; key: string }[] = [
  { value: 'conceptual', key: 'concept' },
  { value: 'calculation', key: 'calculation' },
  { value: 'misread', key: 'misread' },
  { value: 'silly', key: 'silly' },
  { value: 'time', key: 'time' },
];

/** PRC-04, the practice runner, and PRC-05, the answer and solution sheet. */
export default function SessionScreen() {
  const app = useApp();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [runner, setRunner] = useState<DrillRunner | null>(() => liveRunner(String(id)));
  const [error, setError] = useState(false);
  useEffect(() => {
    if (runner) return;
    let alive = true;
    // Opened cold (a restart, a link): rebuild from the server with the default options.
    void fetchSession(app, String(id))
      .then((s) => {
        if (!alive) return;
        if (s.ended_at) {
          router.replace({ pathname: '/session-summary/[id]', params: { id: s.id } });
          return;
        }
        const r = new DrillRunner(app, s, { feedback: 'after_each', timed: false, concepts: [], topicId: null, chapterTest: s.kind === 'chapter_test' });
        keepRunner(r);
        setRunner(r);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [app, id, runner]);
  if (!runner)
    return (
      <Screen testID="PRC-04-loading">
        {error ? <Banner tone="warning" icon="Warning" text={t('learn:LES-11.error')} action={{ label: t('practice:PRC-04.exit_leave'), onPress: () => router.replace('/practice' as Href) }} /> : <Spinner label={t('practice:PRC-03.title')} />}
      </Screen>
    );
  return <Runner runner={runner} />;
}

function Runner({ runner }: { runner: DrillRunner }) {
  const app = useApp();
  const t = useT();
  const theme = useTheme();
  useSyncExternalStore(
    (fn) => runner.subscribe(fn),
    () => runner.version,
  );
  const [sheet, setSheet] = useState(false);
  const [exit, setExit] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [timeUp, setTimeUp] = useState(false);
  const row = runner.current;
  const sq = runner.sq;
  const q = row.question;
  const afterEach = runner.options.feedback === 'after_each';
  const checked = row.result !== null;
  const total = runner.rows.length;
  const done = runner.rows.filter((r) => r.first !== null || r.skipped).length;
  const endsAt = runner.options.timed ? runner.startedAt + runner.timedTotalMs() : undefined;
  const topic = useMemo(() => app.deps.content.topic(app.ui.getState().locale, sq.topic_id, app.examProfileId()), [app, sq.topic_id]);

  useEffect(() => {
    if (!endsAt) return;
    const left = endsAt - app.deps.clock();
    if (left <= 0) {
      setTimeUp(true);
      return;
    }
    const id = setTimeout(() => setTimeUp(true), left);
    return () => clearTimeout(id);
  }, [app, endsAt]);

  // Answers still queued are sent when the screen goes away.
  useEffect(() => () => void runner.flush(), [runner]);

  const finish = async (endedBy: 'finished' | 'closed' | 'time_up') => {
    setBusy(true);
    setSheet(false);
    await runner.finish(endedBy);
    app.track('drill_completed', { session_id: runner.session.id, answered: runner.summary().answered, correct: runner.summary().correct, duration_ms: runner.summary().ms, ended_by: endedBy, free_cap: runner.session.capped_by_free_limit ? 'capped' : 'none' });
    router.replace({ pathname: '/session-summary/[id]', params: { id: runner.session.id } });
  };

  const check = () => {
    runner.check();
    if (afterEach) setSheet(true);
    else advance();
  };
  const advance = () => {
    setSheet(false);
    if (timeUp || runner.isLast()) void finish(timeUp ? 'time_up' : 'finished');
    else runner.next();
  };

  const resultLabel = row.result ? (row.result.correct ? t('practice:PRC-05.correct') : t('practice:PRC-05.wrong')) : '';
  const answerLine = useMemo(() => {
    if (!q || !row.result || row.result.correct || !row.result.local || row.result.local.detail.kind !== 'options') return null;
    const ids = row.result.local.detail.correctIds;
    const opts = (q as { options?: { id: string }[] }).options ?? [];
    const letters = ids.map((x) => String.fromCharCode(65 + Math.max(0, opts.findIndex((o) => o.id === x))));
    return t('practice:PRC-05.answer_line', { correct_option_label: letters.join(', ') });
  }, [q, row.result, t]);

  let footer;
  if (!q) footer = null;
  else if (!checked) {
    footer = (
      <Button
        label={afterEach ? t('practice:PRC-04.check') : runner.isLast() ? t('practice:PRC-05.see_summary') : t('practice:PRC-04.at_the_end_mode_next')}
        disabled={!canSubmit(q, row.draft) || busy}
        loading={busy}
        onPress={check}
        testID="drill-check"
      />
    );
  } else {
    footer = (
      <View style={styles.footerRow}>
        <Button variant="secondary" size="lg" label={t('practice:PRC-05.in_plain_words')} onPress={() => setSheet(true)} style={styles.grow} testID="drill-solution" />
        <Button label={runner.isLast() || timeUp ? t('practice:PRC-05.see_summary') : t('practice:PRC-05.next')} loading={busy} onPress={advance} style={styles.grow} testID="drill-next" />
      </View>
    );
  }

  return (
    <Screen testID="PRC-04" footer={footer}>
      <View style={styles.top}>
        <IconButton icon="X" label={t('practice:PRC-04.exit_title')} onPress={() => setExit(true)} testID="drill-close" />
        <View style={styles.grow}>
          <SegmentedProgress total={total} done={done} current={runner.index} label={t('practice:PRC-04.counter', { i: runner.index + 1, n: total })} />
        </View>
        <Text variant="label" numeric testID="drill-counter">
          {runner.options.chapterTest ? `${t('practice:PRC-03.chapter_test_title')} · ` : ''}
          {t('practice:PRC-04.counter', { i: runner.index + 1, n: total })}
        </Text>
        {endsAt ? <Timer mode="countdown" endsAt={endsAt} now={app.deps.clock} warnAtMs={runner.timedTotalMs() * 0.2} size="compact" announce="warnings" /> : <Timer mode="countup" startedAt={runner.startedAt} now={app.deps.clock} size="compact" announce="none" />}
      </View>
      <View style={styles.meta}>
        {topic ? (
          <Text variant="caption" tone="muted" style={styles.grow}>
            {topic.name}
          </Text>
        ) : (
          <View style={styles.grow} />
        )}
        {sq.difficulty ? <Chip label={t(`practice:PRC-03.${sq.difficulty}` as 'practice:PRC-03.easy')} tone="neutral" /> : null}
      </View>
      {timeUp ? <Banner tone="warning" icon="Timer" text={t('practice:PRC-04.time_up_timed')} testID="drill-time-up" /> : null}
      {!q ? (
        <View style={styles.gap} testID="drill-not-loaded">
          <Banner tone="warning" icon="Warning" text={t('practice:PRC-04.not_loaded')} />
          <View style={styles.footerRow}>
            <Button variant="secondary" label={t('practice:PRC-04.retry')} onPress={() => runner.reload()} style={styles.grow} />
            <Button variant="ghost" label={t('practice:PRC-04.skip')} onPress={() => (runner.isLast() ? void finish('finished') : runner.skip())} style={styles.grow} testID="drill-skip" />
          </View>
        </View>
      ) : (
        <QuestionHost>
          <View style={[styles.card, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.card }]} testID="drill-question">
            <QuestionView
              question={q}
              passage={null}
              draft={row.draft ?? initialDraft(q)}
              onChange={(a) => runner.setDraft(a)}
              result={afterEach ? (row.result?.local ?? null) : null}
              struck={row.struck}
              disabled={checked || busy}
            />
          </View>
          {!checked ? <ConfidenceRow value={row.confidence ? TO_UI[row.confidence] : null} onChange={(c) => runner.setConfidence(c ? FROM_UI[c] : null)} testID="drill-confidence" /> : null}
        </QuestionHost>
      )}

      <Sheet open={sheet && checked && afterEach} onOpenChange={setSheet} title={resultLabel} height="60" tone={row.result?.correct ? 'success' : 'error'} testID="PRC-05" footer={<Button label={runner.isLast() || timeUp ? t('practice:PRC-05.see_summary') : t('practice:PRC-05.next')} onPress={advance} testID="solution-next" />}>
        <View style={styles.gap}>
          <View style={styles.resultHead}>
            <Icon name={row.result?.correct ? 'CheckCircle' : 'XCircle'} color={row.result?.correct ? 'success' : 'error'} label={resultLabel} />
            <Text variant="heading" testID="solution-result">
              {resultLabel}
            </Text>
          </View>
          {answerLine ? <Text variant="label">{answerLine}</Text> : null}
          <Text variant="caption" tone="muted" numeric>
            {sq.ideal_time_s ? t('practice:PRC-05.time_line', { time: clock(row.timeMs), time_2: clock(sq.ideal_time_s * 1000) }) : t('practice:PRC-05.time_line.1', { time: clock(row.timeMs) })}
          </Text>
          {runner.canRetry() ? <Button variant="secondary" label={t('practice:PRC-05.try_again')} icon="ArrowCounterClockwise" onPress={() => (setSheet(false), runner.retry())} testID="solution-retry" /> : null}
          {row.result && !row.result.correct ? (
            <ChoiceChips
              label={t('practice:PRC-05.mistake_prompt')}
              options={MISTAKES.map((m) => ({ value: m.value, label: t(`practice:PRC-05.${m.key}` as 'practice:PRC-05.concept') }))}
              value={row.mistake ? [row.mistake] : []}
              onChange={(v) => {
                const m = (v[0] as MistakeType | undefined) ?? null;
                runner.setMistake(m);
                if (m) app.track('mistake_tagged', { question_id: sq.question_id, context: 'practice', mistake_type: m });
              }}
              testID="solution-mistake"
            />
          ) : null}
          <SolutionBody runner={runner} />
          <View style={styles.actions}>
            <Button size="sm" variant="ghost" icon="Sparkle" label={t('practice:PRC-05.ask_why')} disabled={!app.deps.network.isOnline()} onPress={() => (setSheet(false), router.push({ pathname: '/tutor', params: { context: `question:${sq.question_id}` } }))} testID="solution-ask" />
            <Button size="sm" variant="ghost" icon="BookBookmark" label={t('practice:PRC-05.learn_this_topic')} onPress={() => (setSheet(false), router.push({ pathname: '/lesson/[topicId]', params: { topicId: sq.topic_id } }))} />
            <Button
              size="sm"
              variant="ghost"
              icon="Cards"
              label={t('practice:PRC-05.add_to_cards')}
              onPress={() => {
                void app.record('cards_queued', { concept_ids: sq.concepts, source: 'practice' });
                setToast(t('practice:PRC-05.added_toast'));
              }}
              testID="solution-add-card"
            />
            <Button size="sm" variant="ghost" icon="Flag" label={t('practice:PRC-05.report')} onPress={() => (setSheet(false), router.push({ pathname: '/report-content', params: { kind: 'question', ref: sq.question_id } }))} testID="solution-report" />
          </View>
        </View>
      </Sheet>

      <Dialog
        open={exit}
        onOpenChange={setExit}
        title={t('practice:PRC-04.exit_title')}
        description={t('practice:PRC-04.exit_body')}
        confirm={{ label: t('practice:PRC-04.exit_leave'), onPress: () => (setExit(false), void finish('closed')) }}
        cancel={{ label: t('practice:PRC-04.exit_keep_going'), onPress: () => setExit(false) }}
        testID="drill-exit"
      />
      <Toast open={toast !== null} message={toast ?? ''} onDismiss={() => setToast(null)} testID="drill-toast" />
    </Screen>
  );
}

/** "In plain words", "Step by step", "Shortcut" and "Common traps", from the bundle or the server. */
export function SolutionBody({ runner }: { runner: DrillRunner }) {
  const t = useT();
  const s = runner.current.solution;
  const chosen = runner.current.draft?.kind === 'options' ? runner.current.draft.optionIds : [];
  if (!s) return null;
  return (
    <QuestionHost>
      <View style={styles.gap} testID="solution-body">
        {s.feynman ? (
          <View style={styles.section}>
            <Text variant="label">{t('practice:PRC-05.in_plain_words')}</Text>
            <RichText text={s.feynman} />
          </View>
        ) : null}
        {s.steps.length ? (
          <View style={styles.section}>
            <Text variant="label">{t('practice:PRC-05.step_by_step')}</Text>
            {s.steps.map((step, i) => (
              <RichText key={i} text={`${i + 1}. ${step}`} />
            ))}
          </View>
        ) : null}
        {s.shortcut ? (
          <View style={styles.section}>
            <Text variant="label">{t('practice:PRC-05.shortcut')}</Text>
            <RichText text={s.shortcut} />
            {s.shortcutFails ? (
              <Text variant="caption" tone="muted">
                {`${t('practice:PRC-05.shortcut_fails')}: ${s.shortcutFails}`}
              </Text>
            ) : null}
          </View>
        ) : null}
        {s.traps.length ? (
          <View style={styles.section}>
            <Text variant="label">{t('practice:PRC-05.common_traps')}</Text>
            {s.traps.map((trap, i) => (
              <View key={i} style={styles.trap}>
                {trap.optionId && chosen.includes(trap.optionId) ? <Chip label={t('practice:PRC-05.your_pick')} tone="warning" /> : null}
                <RichText text={trap.why} />
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </QuestionHost>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
  gap: { gap: 12 },
  card: { padding: 16 },
  footerRow: { flexDirection: 'row', gap: 12 },
  resultHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  section: { gap: 6 },
  trap: { gap: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
