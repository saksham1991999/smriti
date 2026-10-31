import { ApiError } from '@smriti/api-client';
import { Banner, Button, Card, Icon, ProChip, Spinner, StatTile, Text } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp, useQueryScope, useT, useUiState } from '../../src/services/context';
import { createSession, DrillRunner, drillKeys, fetchPyqPaper, keepRunner, pyqMockId, sourceHost } from '../../src/services/drill';
import { examName } from '../../src/services/exams';
import { fetchMockDetail } from '../../src/services/mocks';
import { FreeLimitSheet } from '../../src/ui/FreeLimitSheet';
import { PyqSourceSheet } from '../../src/ui/PyqSourceSheet';
import { BackHeader, Screen } from '../../src/ui/Screen';

/**
 * PRC-10, one official past paper. The pattern summary (duration, marks, sections, marking) is the
 * paper's mock from `/v1/mocks/pyq:{paper_id}`, i.e. the blueprint effective on the day it was
 * held. With no such mock the timed option is hidden and the "no blueprint" line shows.
 */
export default function PyqPaper() {
  const app = useApp();
  const t = useT();
  const locale = useUiState((s) => s.locale);
  const scope = useQueryScope();
  const { id } = useLocalSearchParams<{ id: string }>();
  const paperId = String(id);
  const paper = useQuery({ queryKey: drillKeys.paper(scope, paperId), queryFn: () => fetchPyqPaper(app, paperId) });
  const mock = useQuery({ queryKey: ['smriti', 'mock', scope, pyqMockId(paperId)], queryFn: () => fetchMockDetail(app, pyqMockId(paperId)), retry: 0 });
  const [source, setSource] = useState(false);
  const [busy, setBusy] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);
  const [problem, setProblem] = useState(false);
  const p = paper.data;
  const m = mock.data;
  const examShort = examName(app, p?.exam_id ?? app.examProfileId()) ?? app.appName();
  const child = app.ageBand() === '10_12' || app.ageBand() === 'u10';
  const locked = m ? !m.access.allowed : false;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/pyq' as Href));

  const takeMock = () => {
    if (!m) return;
    app.track('pyq_paper_opened', { paper_id: paperId, action: 'mock' });
    if (m.in_progress_attempt_id) router.push({ pathname: '/attempt/[id]', params: { id: m.in_progress_attempt_id } });
    else if (locked) router.push({ pathname: '/paywall', params: { from: 'mock_limit' } });
    else router.push({ pathname: '/mock/[id]', params: { id: m.id } });
  };
  const practise = async () => {
    if (!p) return;
    app.track('pyq_paper_opened', { paper_id: paperId, action: 'practice' });
    setBusy(true);
    setProblem(false);
    try {
      const s = await createSession(app, { mode: 'drill', paper_id: paperId, count: Math.min(100, Math.max(1, p.question_count)), difficulty: 'adaptive', source: 'pyq' });
      keepRunner(new DrillRunner(app, s, { feedback: 'after_each', timed: false, concepts: [], topicId: null, chapterTest: false }));
      router.push({ pathname: '/session/[id]', params: { id: s.id } });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'free_limit_reached') setLimitOpen(true);
      else setProblem(true);
    }
    setBusy(false);
  };

  const marking = m?.sections[0] ? Object.values(m.sections[0].marking)[0] : null;
  const host = sourceHost(p?.source_url);

  return (
    <Screen
      testID="PRC-10"
      footer={
        p ? (
          <View style={styles.gap}>
            {m ? (
              <View style={styles.row}>
                <Button label={t('practice:PRC-10.take_as_mock')} icon="Timer" onPress={takeMock} style={styles.grow} testID="paper-mock" />
                {locked ? <ProChip askGrownUp={child} onPress={takeMock} testID="paper-pro" /> : null}
              </View>
            ) : null}
            <Button variant="secondary" label={t('practice:PRC-10.practise')} loading={busy} onPress={() => void practise()} testID="paper-practise" />
          </View>
        ) : undefined
      }
    >
      <BackHeader title={p ? `${examShort} ${p.year}` : t('practice:PRC-07.title')} backLabel={t('ui:common.back')} onBack={back} />
      {paper.isPending ? <Spinner label={t('practice:PRC-07.title')} /> : null}
      {paper.isError ? <Banner tone="warning" icon="Warning" text={t('learn:LES-11.error')} action={{ label: t('tutor_social:AI-02.try_again'), onPress: () => void paper.refetch() }} /> : null}
      {p ? (
        <>
          {p.session_label || p.held_on ? (
            <Text variant="body" tone="muted">
              {p.session_label && p.held_on ? t('practice:PRC-10.subtitle', { session_label: p.session_label, held_on: p.held_on }) : p.held_on ? t('practice:PRC-10.subtitle.2', { held_on: p.held_on }) : p.session_label}
            </Text>
          ) : null}
          <Card outlined onPress={() => setSource(true)} accessibilityLabel={`${host ? t('practice:PRC-07.source', { source_host: host }) : t('practice:PRC-18.title')}. ${t('practice:PRC-18.title')}`} testID="paper-source">
            <View style={styles.row}>
              <Icon name="ShieldCheck" color="success" label={t('practice:PRC-18.source')} />
              <View style={[styles.grow, styles.gapSm]}>
                {host ? <Text variant="label">{t('practice:PRC-07.source', { source_host: host })}</Text> : null}
                {p.notes ? (
                  <Text variant="caption" tone="muted">
                    {p.notes}
                  </Text>
                ) : null}
              </View>
              <Icon name="CaretRight" color="inkMuted" />
            </View>
          </Card>
          {m ? (
            <>
              <View style={styles.tiles}>
                <StatTile style={styles.tile} value={t('practice:PRC-10.duration_tile', { duration_min: m.duration_min })} label={t('practice:PRC-03.timing')} />
                <StatTile style={styles.tile} value={t('practice:PRC-10.questions_tile', { question_count: m.question_count })} label={t('practice:PRC-03.questions')} />
                {m.max_marks !== null ? <StatTile style={styles.tile} value={t('practice:PRC-10.marks_tile', { max_marks: m.max_marks })} label={t('practice:MOCK-19.score_tile')} /> : null}
              </View>
              {m.sections.length > 1
                ? m.sections.map((s) => (
                    <Text key={s.code} variant="body" numeric>
                      {`${s.title[locale] ?? s.title.en ?? s.code} · ${s.question_count}`}
                    </Text>
                  ))
                : null}
              {marking ? (
                <Text variant="body" testID="paper-marking">
                  {t('practice:PRC-10.marking_line', { marking_correct: marking.correct, marking_wrong: marking.wrong })}
                </Text>
              ) : null}
              {locked ? (
                <Text variant="caption" tone="muted" testID="paper-locked">
                  {t('practice:PRC-10.locked_line')}
                </Text>
              ) : null}
              {m.past_attempts?.length ? (
                <View style={styles.gap}>
                  <Text variant="heading">{t('practice:PRC-10.past_attempts')}</Text>
                  {m.past_attempts.map((a) => (
                    <Card key={a.id} outlined onPress={() => router.push(a.status === 'in_progress' ? { pathname: '/attempt/[id]', params: { id: a.id } } : { pathname: '/report/[id]', params: { id: a.id } })} accessibilityLabel={a.started_at.slice(0, 10)}>
                      <View style={styles.row}>
                        <Text variant="body" style={styles.grow} numeric>
                          {a.started_at.slice(0, 10)}
                        </Text>
                        {a.score !== null ? (
                          <Text variant="label" numeric>
                            {`${a.score}/${a.max_score ?? ''}`}
                          </Text>
                        ) : null}
                        <Icon name="CaretRight" color="inkMuted" />
                      </View>
                    </Card>
                  ))}
                </View>
              ) : null}
            </>
          ) : mock.isError ? (
            <Banner tone="info" icon="Info" text={t('practice:PRC-10.no_blueprint')} testID="paper-no-blueprint" />
          ) : null}
          {problem ? <Banner tone="warning" icon="Warning" text={t('learn:LES-11.error')} /> : null}
        </>
      ) : null}
      <PyqSourceSheet paperId={source ? paperId : null} onClose={() => setSource(false)} />
      <FreeLimitSheet open={limitOpen} onOpenChange={setLimitOpen} kind="daily_cap" trigger="practice_limit" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1 },
  gap: { gap: 10 },
  gapSm: { gap: 4 },
  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1 },
});
