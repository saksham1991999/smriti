import { localize } from '@smriti/content-schema';
import type { Answer, AnyQuestion } from '@smriti/lesson-core';
import { canSubmit, initialDraft, QuestionView } from '@smriti/lesson-player-native';
import { Banner, Button, Card, Spinner, StatTile, Text } from '@smriti/ui-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp, useT, useUiState, useQueryScope } from '../src/services/context';
import { answerDailyChallenge, fetchDailyChallenge, practiceKeys, startDailyChallenge, type DailyChallenge } from '../src/services/practice';
import { BuddyLine } from '../src/ui/Onboarding';
import { QuestionHost } from '../src/ui/QuestionHost';
import { BackHeader, Screen } from '../src/ui/Screen';

/**
 * PRC-11 and PRC-12, today's challenge, on `/v1/daily-challenge/today`, `/start` and `/answer`.
 * The question arrives without its key (the server checks it), rendered by lesson-player-native's
 * `QuestionView`. Maths with no build-time SVG shows its TeX source.
 */

export default function Challenge() {
  const app = useApp();
  const t = useT();
  const queries = useQueryClient();
  const locale = useUiState((s) => s.locale);
  const scope = useQueryScope();
  const exam = app.examProfileId();
  const key = practiceKeys.challenge(scope, exam);
  const today = useQuery({ queryKey: key, queryFn: () => fetchDailyChallenge(app), retry: 0 });
  const [draft, setDraft] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const shownAt = useRef<number>(0);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/practice' as Href));
  const c = today.data;

  const question = useMemo<AnyQuestion | null>(() => (c?.question ? (localize(c.question, locale) as unknown as AnyQuestion) : null), [c?.question, locale]);

  const update = (next: DailyChallenge) => {
    queries.setQueryData(key, next);
    void queries.invalidateQueries({ queryKey: ['smriti', 'practice', 'hub'] });
  };
  const start = async () => {
    if (!c) return;
    setBusy(true);
    setFailed(false);
    try {
      const next = await startDailyChallenge(app, c.id);
      shownAt.current = app.deps.clock();
      setDraft(initialDraft(next.question ? (localize(next.question, locale) as unknown as AnyQuestion) : null));
      update(next);
    } catch {
      setFailed(true);
    }
    setBusy(false);
  };
  const submit = async () => {
    if (!c || !draft) return;
    setBusy(true);
    setFailed(false);
    try {
      const began = shownAt.current || (c.started_at ? Date.parse(c.started_at) : app.deps.clock());
      update(await answerDailyChallenge(app, c.id, draft, app.deps.clock() - began));
    } catch {
      setFailed(true);
    }
    setBusy(false);
  };

  let body;
  let footer = null;
  if (today.isPending) body = <Spinner label={t('practice:PRC-11.title')} />;
  else if (today.isError || !c) body = <Banner tone="info" icon="Info" text={t('practice:PRC-11.not_published')} testID="challenge-none" />;
  else if (c.result) {
    const r = c.result;
    body = (
      <View style={styles.gap} testID="PRC-12">
        <Text variant="display" heading align="center">
          {r.correct ? t('practice:PRC-12.solved') : t('practice:PRC-12.not_this_time')}
        </Text>
        <View style={styles.tiles}>
          <StatTile style={styles.tile} icon="Timer" value={`${Math.round(r.time_ms / 100) / 10}s`} label={t('practice:PRC-12.time_tile')} />
          <StatTile style={styles.tile} icon="Star" value={r.rank !== null ? `#${r.rank}` : '–'} label={r.rank !== null ? t('practice:PRC-12.rank_tile', { rank: r.rank }) : t('practice:PRC-12.rank_soon')} />
        </View>
        {r.rank === null && r.min_players_for_rank !== null ? (
          <Text variant="caption" tone="muted" align="center" numeric>
            {t('practice:PRC-12.threshold', { count: r.players, min_players: r.min_players_for_rank })}
          </Text>
        ) : null}
        <BuddyLine text={r.correct ? t('practice:PRC-12.pet_line_right') : t('practice:PRC-12.pet_line_wrong')} />
      </View>
    );
    footer = <Button label={t('practice:PRC-12.done')} onPress={back} testID="challenge-done" />;
  } else if (c.started_at && question) {
    body = (
      <QuestionHost>
        <Card outlined testID="challenge-question">
          <QuestionView question={question} passage={null} draft={draft ?? initialDraft(question)} onChange={setDraft} result={null} struck={[]} disabled={busy} />
        </Card>
      </QuestionHost>
    );
    footer = <Button label={t('practice:PRC-11.submit')} loading={busy} disabled={!canSubmit(question, draft)} onPress={() => void submit()} testID="challenge-submit" />;
  } else {
    body = (
      <View style={styles.gap} testID="PRC-11">
        <Text variant="title" heading>
          {t('practice:PRC-11.headline')}
        </Text>
        {(['rule_1', 'rule_2', 'rule_5'] as const).map((r) => (
          <Text key={r} variant="body">
            {`• ${t(`practice:PRC-11.${r}`)}`}
          </Text>
        ))}
        <BuddyLine text={t('practice:PRC-11.pet_line')} />
      </View>
    );
    footer = <Button label={t('practice:PRC-11.start')} loading={busy} onPress={() => void start()} testID="challenge-start" />;
  }

  return (
    <Screen testID="PRC-11-screen" footer={footer}>
      <BackHeader title={t('practice:PRC-11.title')} backLabel={t('ui:common.back')} onBack={back} />
      {failed ? <Banner tone="warning" icon="Warning" text={t('learn:LES-11.error')} testID="challenge-failed" /> : null}
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 12 },
  tiles: { flexDirection: 'row', gap: 12 },
  tile: { flex: 1 },
});
