import { canSubmit, QuestionView } from '@smriti/lesson-player-native';
import type { Confidence as UiConfidence } from '@smriti/tokens/ui';
import { Banner, Button, Card, Chip, ConfidenceRow, IconButton, MockPaletteCell, SectionTabs, Sheet, Spinner, Text, Timer } from '@smriti/ui-native';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { useApp, useT, useUiState } from '../../src/services/context';
import { examName } from '../../src/services/exams';
import { fetchAttempt, localQuestion, MockRunner, PALETTE_TOKEN, type Confidence } from '../../src/services/mocks';
import { QuestionHost } from '../../src/ui/QuestionHost';
import { Screen } from '../../src/ui/Screen';

const TYPE_KEY: Record<string, 'single_correct' | 'multiple_correct' | 'numerical'> = { mcq_single: 'single_correct', assertion_reason: 'single_correct', mcq_multi: 'multiple_correct', numerical: 'numerical', integer: 'numerical' };
const TO_UI: Record<Confidence, UiConfidence> = { sure: 'sure', fifty_fifty: 'half', guess: 'guess' };
const FROM_UI: Record<UiConfidence, Confidence> = { sure: 'sure', half: 'fifty_fifty', guess: 'guess' };
const AUTOSAVE_MS = 5_000;

/** MOCK-07 the paper, with MOCK-09 palette, MOCK-13 section close, MOCK-14 pause, MOCK-15 leave, MOCK-16 submit, MOCK-17 time's up. */
export default function AttemptScreen() {
  const app = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [runner, setRunner] = useState<MockRunner | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    void fetchAttempt(app, String(id))
      .then((a) => MockRunner.load(app, a))
      .then((r) => {
        if (!alive) return;
        if (r.phase === 'submitted') router.replace({ pathname: '/report/[id]', params: { id: r.attempt.id } });
        else setRunner(r);
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [app, id]);
  if (!runner) return <Loading error={error} />;
  return <Paper runner={runner} />;
}

function Loading({ error }: { error: boolean }) {
  const t = useT();
  return (
    <Screen testID="MOCK-07-loading">
      {error ? (
        <Banner tone="warning" icon="Warning" text={t('practice:MOCK-07.question_load_error')} action={{ label: t('practice:MOCK-15.keep_going'), onPress: () => router.replace('/mocks' as Href) }} />
      ) : (
        <Spinner label={t('practice:MOCK-04.title')} />
      )}
    </Screen>
  );
}

function Paper({ runner }: { runner: MockRunner }) {
  const app = useApp();
  const t = useT();
  const queries = useQueryClient();
  const locale = useUiState((s) => s.locale);
  useSyncExternalStore(
    (fn) => runner.subscribe(fn),
    () => runner.version,
  );
  const [palette, setPalette] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const expiredRef = useRef(false);
  const a = runner.attempt;
  const q = runner.question(runner.current);
  const row = runner.row(runner.current);
  const section = runner.sectionOf(runner.current);
  const question = useMemo(() => (q ? localQuestion(q.body, a.language) : null), [q, a.language]);
  const strict = a.time_policy !== 'practice';

  const finish = async (expired: boolean) => {
    setBusy(true);
    try {
      await runner.submit(expired);
      void queries.invalidateQueries({ queryKey: ['smriti'] });
      router.replace({ pathname: '/report/[id]', params: { id: a.id, ...(expired ? { expired: '1' } : {}) } });
    } catch {
      setBusy(false);
    }
  };

  // Autosave, a save when the app goes to the background, and the deadline.
  useEffect(() => {
    const timer = setInterval(() => {
      void runner.flush();
      if (runner.phase === 'running' && runner.remainingMs() <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        void finish(true);
      }
    }, AUTOSAVE_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') void runner.flush();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
      void runner.flush();
    };
    // finish is stable enough for the interval: it reads the runner, not state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner]);

  const paused = runner.phase === 'paused';
  const counts = runner.counts();
  const total = runner.questions.length;
  const sections = a.sections.map((s) => ({
    code: s.code,
    title: s.title[locale] ?? s.title.en ?? s.code,
    answered: runner.questions.filter((x) => x.section_code === s.code && ['answered', 'answered_marked'].includes(runner.row(x.question_id)!.palette)).length,
    total: s.question_ids.length,
    state: s.status === 'open' ? ('open' as const) : s.status === 'closed' ? ('locked' as const) : ('not_open' as const),
  }));
  const sectionEnds = section ? runner.sectionDeadlineLocal(section.code) : null;
  const rejectedCode = runner.rejected.get(runner.current);
  const leave = async () => {
    setLeaving(false);
    await runner.flush();
    router.replace('/mocks' as Href);
  };

  if (paused) {
    return (
      <Screen
        testID="MOCK-14"
        footer={
          <View style={styles.gap}>
            <Button label={t('practice:MOCK-14.resume')} loading={busy} onPress={() => void runner.resume().catch(() => undefined)} testID="mock-resume-paused" />
            <Button variant="ghost" label={t('practice:MOCK-14.leave')} onPress={() => void leave()} />
          </View>
        }
      >
        <Text variant="display" heading>
          {t('practice:MOCK-14.paused')}
        </Text>
        <Text variant="body" numeric>
          {t('practice:MOCK-14.time_left', { time: clock(a.remaining_ms) })}
        </Text>
        <Text variant="body" numeric>
          {t('practice:MOCK-14.answered', { answered: counts.answered + counts.answered_marked, total })}
        </Text>
        {a.pause_count > 0 ? (
          <Text variant="caption" tone="muted" numeric>
            {t('practice:MOCK-14.paused_count', { count: a.pause_count })}
          </Text>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen
      testID="MOCK-07"
      footer={
        <View style={styles.actions}>
          <Button size="sm" variant="secondary" label={t('practice:MOCK-07.mark_for_review_next')} onPress={() => runner.markNext()} testID="mock-mark-next" style={styles.flex} />
          <Button size="sm" variant="ghost" label={t('practice:MOCK-07.clear_response')} onPress={() => runner.clear()} testID="mock-clear" />
          <Button size="sm" label={t('practice:MOCK-07.save_next')} onPress={() => runner.saveNext()} testID="mock-save-next" style={styles.flex} />
        </View>
      }
    >
      <View style={styles.header}>
        <IconButton icon="X" label={t('practice:MOCK-07.menu_leave')} onPress={() => setLeaving(true)} testID="mock-leave" />
        <View style={styles.flex}>
          <Text variant="label" numberOfLines={1}>
            {t('practice:MOCK-05.header', { exam_name: examName(app, a.exam_profile_id) ?? app.appName() })}
          </Text>
        </View>
        <Timer mode="countdown" endsAt={runner.deadlineLocal()} now={() => app.deps.clock()} warnAtMs={5 * 60_000} finalAtMs={60_000} size="compact" {...(sectionEnds && section ? { sectional: { label: section.title[locale] ?? section.code, endsAt: sectionEnds } } : {})} testID="mock-timer" />
        {!strict ? <IconButton icon="PauseCircle" label={t('practice:MOCK-07.menu_pause')} onPress={() => void runner.pause().catch(() => undefined)} testID="mock-pause" /> : null}
        <IconButton icon="DotsThreeVertical" label={t('practice:MOCK-09.title')} onPress={() => setPalette(true)} testID="mock-palette-open" />
      </View>
      {a.sections.length > 1 ? <SectionTabs sections={sections} activeCode={section?.code ?? ''} navigation={a.section_navigation} onSelect={(code) => {
        const first = runner.questions.find((x) => x.section_code === code);
        if (first) runner.go(first.question_id);
      }} label={t('practice:MOCK-02.sections')} testID="mock-sections" /> : null}
      {!app.deps.network.isOnline() ? <Banner tone="offline" icon="WifiSlash" text={t('practice:MOCK-07.offline_banner')} /> : null}

      {q && question && row ? (
        <View style={styles.gap} testID={`mock-q-${runner.numberOf(q.question_id)}`}>
          <View style={styles.qhead}>
            <Text variant="heading" numeric>
              {t('practice:MOCK-07.question_n', { n: runner.numberOf(q.question_id) })}
            </Text>
            {TYPE_KEY[q.type] ? <Chip label={t(`practice:MOCK-07.${TYPE_KEY[q.type]!}`)} tone="neutral" /> : null}
            <Chip label={t('practice:MOCK-07.marking', { correct: q.marking.correct, wrong: q.marking.wrong })} tone="sunken" />
          </View>
          <QuestionHost>
            <QuestionView question={question} passage={null} draft={runner.draft} onChange={(d) => runner.setDraft(d)} result={null} struck={[]} disabled={false} />
          </QuestionHost>
          {rejectedCode === 'over_attempt' && section?.attempt_any ? <Banner tone="warning" icon="Warning" text={t('practice:MOCK-07.over_attempt', { attempt_any: section.attempt_any })} /> : null}
          {runner.unsaved() && canSubmit(question, runner.draft) ? (
            <Text variant="caption" tone="muted" testID="mock-unsaved">
              {t('practice:MOCK-07.unsaved_tip_practice_policy_once')}
            </Text>
          ) : null}
          <ConfidenceRow value={row.confidence ? TO_UI[row.confidence] : null} onChange={(v) => runner.setConfidence(v ? FROM_UI[v] : null)} testID="mock-confidence" />
          <View style={styles.nav}>
            <Button size="sm" variant="ghost" icon="CaretLeft" label={t('practice:MOCK-07.previous')} onPress={() => runner.step(-1)} testID="mock-prev" />
            <Button size="sm" variant="ghost" icon="CaretRight" iconPosition="end" label={t('practice:MOCK-07.next')} onPress={() => runner.step(1)} testID="mock-next" />
          </View>
          {section && a.early_section_submit && a.sections.length > 1 ? (
            <Button size="sm" variant="secondary" label={t('practice:MOCK-13.submit_section')} onPress={() => setClosing(section.code)} testID="mock-submit-section" />
          ) : null}
        </View>
      ) : (
        <Banner tone="warning" icon="Warning" text={t('practice:MOCK-07.question_load_error')} />
      )}

      <Sheet open={palette} onOpenChange={setPalette} title={t('practice:MOCK-09.title')} height="full" testID="MOCK-09" footer={<Button label={t('practice:MOCK-09.submit')} onPress={() => (setPalette(false), setSubmitting(true))} testID="mock-palette-submit" />}>
        <View style={styles.gap}>
          {a.sections.map((s) => (
            <View key={s.code} style={styles.gapSm}>
              {a.sections.length > 1 ? <Text variant="label">{s.title[locale] ?? s.code}</Text> : null}
              {s.status === 'closed' ? <Text variant="caption" tone="muted">{t('practice:MOCK-09.section_locked')}</Text> : null}
              <View style={styles.grid}>
                {runner.questions
                  .filter((x) => x.section_code === s.code)
                  .map((x) => (
                    <MockPaletteCell
                      key={x.question_id}
                      number={runner.numberOf(x.question_id)}
                      state={PALETTE_TOKEN[runner.row(x.question_id)!.palette]}
                      current={x.question_id === runner.current}
                      onPress={runner.canOpen(x.question_id) ? () => (runner.go(x.question_id), setPalette(false)) : undefined}
                      testID={`palette-${runner.numberOf(x.question_id)}`}
                    />
                  ))}
              </View>
            </View>
          ))}
          <Text variant="caption" tone="muted" numeric>
            {`${t('practice:MOCK-09.answered')} ${counts.answered} · ${t('practice:MOCK-09.not_answered')} ${counts.not_answered} · ${t('practice:MOCK-09.not_visited')} ${counts.not_visited} · ${t('practice:MOCK-09.marked')} ${counts.marked} · ${t('practice:MOCK-09.answered_and_marked')} ${counts.answered_marked}`}
          </Text>
        </View>
      </Sheet>

      <Sheet open={leaving} onOpenChange={setLeaving} title={t('practice:MOCK-15.title')} description={strict ? t('practice:MOCK-15.strict_line') : t('practice:MOCK-15.practice_line')} testID="MOCK-15">
        <View style={styles.gap}>
          <Button label={t('practice:MOCK-15.keep_going')} onPress={() => setLeaving(false)} testID="mock-keep-going" />
          <Button variant="secondary" label={t('practice:MOCK-15.leave_for_now')} onPress={() => void leave()} testID="mock-leave-for-now" />
          <Button variant="secondary" label={t('practice:MOCK-15.submit_now')} onPress={() => (setLeaving(false), setSubmitting(true))} />
          <Button
            variant="destructive"
            label={t('practice:MOCK-15.discard')}
            onPress={() => {
              setLeaving(false);
              void runner.abandon().then(() => router.replace('/mocks' as Href));
            }}
            testID="mock-discard"
          />
        </View>
      </Sheet>

      <Sheet open={submitting} onOpenChange={(o) => (setSubmitting(o), setConfirm(false))} title={t('practice:MOCK-16.title')} height="full" testID="MOCK-16">
        <View style={styles.gap}>
          {a.sections.map((s) => {
            const c = runner.counts(s.code);
            return (
              <Card key={s.code} outlined>
                <View style={styles.gapSm}>
                  <Text variant="label">{s.title[locale] ?? s.code}</Text>
                  <Text variant="caption" numeric>{`${t('practice:MOCK-16.questions')} ${s.question_ids.length} · ${t('practice:MOCK-16.answered')} ${c.answered} · ${t('practice:MOCK-16.not_answered')} ${c.not_answered} · ${t('practice:MOCK-16.marked')} ${c.marked} · ${t('practice:MOCK-16.answered_and_marked')} ${c.answered_marked} · ${t('practice:MOCK-16.not_visited')} ${c.not_visited}`}</Text>
                  {s.status === 'closed' ? <Text variant="caption" tone="muted">{t('practice:MOCK-16.locked_note', { section_title: s.title[locale] ?? s.code })}</Text> : null}
                </View>
              </Card>
            );
          })}
          <Text variant="caption" tone="muted">
            {a.marked_answer_evaluated ? t('practice:MOCK-16.evaluated_note') : t('practice:MOCK-16.not_evaluated_note')}
          </Text>
          {counts.not_answered + counts.not_visited + counts.marked > 0 ? (
            <Banner tone="warning" icon="Warning" text={t('practice:MOCK-16.no_answer_warning', { n: counts.not_answered + counts.not_visited + counts.marked })} />
          ) : null}
          {confirm ? (
            <>
              <Text variant="body">{t('practice:MOCK-16.confirm')}</Text>
              <Button label={t('practice:MOCK-16.yes')} loading={busy} onPress={() => void finish(false)} testID="mock-submit-yes" />
              <Button variant="ghost" label={t('practice:MOCK-16.no')} onPress={() => setConfirm(false)} />
            </>
          ) : (
            <>
              <Button label={t('practice:MOCK-16.submit')} onPress={() => setConfirm(true)} testID="mock-submit" />
              <Button variant="ghost" label={t('practice:MOCK-16.go_back')} onPress={() => setSubmitting(false)} />
            </>
          )}
        </View>
      </Sheet>

      <Sheet open={closing !== null} onOpenChange={(o) => !o && setClosing(null)} title={t('practice:MOCK-13.submit_section')} description={closing ? t('practice:MOCK-13.early_confirm', { section_title: a.sections.find((s) => s.code === closing)?.title[locale] ?? closing }) : ''} testID="MOCK-13">
        <View style={styles.gap}>
          <Button label={t('practice:MOCK-13.submit_section')} onPress={() => closing && void runner.submitSection(closing).finally(() => setClosing(null))} testID="mock-section-yes" />
          <Button variant="ghost" label={t('practice:MOCK-13.go_back')} onPress={() => setClosing(null)} />
        </View>
      </Sheet>

      {runner.phase === 'submitting' ? <Spinner label={t('practice:MOCK-18.scoring')} /> : null}
    </Screen>
  );
}

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  flex: { flex: 1 },
  gap: { gap: 12 },
  gapSm: { gap: 6 },
  qhead: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  nav: { flexDirection: 'row', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
