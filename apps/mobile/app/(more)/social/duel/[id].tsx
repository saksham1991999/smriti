import { localize } from '@smriti/content-schema';
import type { Answer, AnyQuestion } from '@smriti/lesson-core';
import { canSubmit, initialDraft, QuestionView } from '@smriti/lesson-player-native';
import { Banner, Button, Card, DuelScoreBar, PetLine, Spinner, Text } from '@smriti/ui-native';
import type { DuelAnswer, DuelSide } from '@smriti/tokens/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { acceptDuel, answerDuel, leaveDuel, loadDuel, personName, type DuelState } from '../../../../src/features/social/services';
import { avatarOf, socialKeys, useLocale } from '../../../../src/features/social/ui';
import { useApp, useT } from '../../../../src/services/context';
import { QuestionHost } from '../../../../src/ui/QuestionHost';
import { BackHeader, Screen, Stack } from '../../../../src/ui/Screen';

const POLL_MS = 1000;

/**
 * One duel: SOC-16 (waiting for a friend), SOC-18 (live: the shared question, the clock and the
 * score bar) and SOC-19 (the result). The server keeps the clock and the keys; the app polls
 * `GET /v1/duels/{id}` every second while the duel is pending or live.
 */
export default function Duel() {
  const app = useApp();
  const t = useT();
  const locale = useLocale();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const key = ['social', 'duel', id];
  const q = useQuery({
    queryKey: key,
    queryFn: () => loadDuel(app, id),
    refetchInterval: (query) => {
      const s = (query.state.data as DuelState | undefined)?.status;
      return s === 'pending' || s === 'live' ? POLL_MS : false;
    },
  });
  const d = q.data;
  const [draft, setDraft] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ index: number; correct: boolean; points: number } | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const shownAt = useRef<{ index: number; at: number }>({ index: -1, at: 0 });
  const tracked = useRef(false);
  const [now, setNow] = useState(app.deps.clock());

  const me = d?.players.find((p) => p.is_me);
  const them = d?.players.find((p) => !p.is_me);
  const themName = them ? personName(them.person, t) : '';
  const current = d?.current ?? null;
  const question = useMemo<AnyQuestion | null>(() => (current?.body ? (localize(current.body as never, locale) as unknown as AnyQuestion) : null), [current?.body, locale]);

  useEffect(() => {
    if (!current) return;
    if (shownAt.current.index !== current.index) {
      shownAt.current = { index: current.index, at: app.deps.clock() };
      setDraft(initialDraft(question));
    }
  }, [app, current, question]);

  useEffect(() => {
    const timer = setInterval(() => setNow(app.deps.clock()), 1000);
    return () => clearInterval(timer);
  }, [app]);

  useEffect(() => {
    if (!d?.result || tracked.current) return;
    tracked.current = true;
    const correct = me?.correct ?? 0;
    if (d.relation === 'solo') app.track('duel_solo_finished', { correct });
    else {
      const r = d.result;
      const result = r.abandoned_by_me ? 'quit' : r.abandoned_by_them ? 'opponent_quit' : r.winner === 'me' ? 'win' : r.winner === 'them' ? 'loss' : r.winner === 'draw' ? 'draw' : 'expired';
      app.track('duel_finished', { relation: d.relation, mode: d.mode === 'async' ? 'async' : 'live', correct, result });
    }
    void qc.invalidateQueries({ queryKey: socialKeys.overview });
  }, [app, d, me, qc]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/friends' as Href));

  const submit = async () => {
    if (!d || !current || !draft || draft.kind !== 'options') return;
    setBusy(true);
    try {
      const out = await answerDuel(app, d.id, current.question_id, draft.optionIds, app.deps.clock() - shownAt.current.at);
      setLast({ index: out.index, correct: out.correct, points: out.points });
      qc.setQueryData(key, out.duel);
    } catch {
      await q.refetch();
    }
    setBusy(false);
  };

  const leave = async () => {
    if (!d) return;
    await leaveDuel(app, d.id);
    setConfirmLeave(false);
    await q.refetch();
  };

  if (!d) {
    return (
      <Screen testID="SOC-18">
        <BackHeader title={t('tutor_social:SOC-15.title')} backLabel={t('ui:common.back')} onBack={back} />
        {q.isError ? <Banner tone="warning" icon="Warning" text={t('tutor_social:SOC-20.ended')} /> : <Spinner label={t('tutor_social:SOC-17.get_ready')} />}
      </Screen>
    );
  }

  const sides = scoreSides(d, t);

  // SOC-16: a friend duel waiting for its opponent (or SOC-20 for the one invited).
  if (d.status === 'pending') {
    const invited = me?.role === 'opponent';
    return (
      <Screen
        testID="SOC-16"
        footer={
          invited ? (
            <Button
              icon="Play"
              label={t('tutor_social:SOC-20.play_now')}
              onPress={async () => {
                qc.setQueryData(key, await acceptDuel(app, d.id));
              }}
              testID="soc20-play"
            />
          ) : (
            <Button variant="secondary" label={t('tutor_social:SOC-16.cancel')} onPress={() => void leave().then(back)} testID="soc16-cancel" />
          )
        }
      >
        <BackHeader title={t('tutor_social:SOC-15.title')} backLabel={t('ui:common.back')} onBack={back} />
        <Spinner label={invited ? t('tutor_social:SOC-20.title', { name: themName }) : t('tutor_social:SOC-16.waiting_for_friend', { name: themName })} />
        <Text variant="title" heading align="center" testID="soc16-waiting">
          {invited ? t('tutor_social:SOC-20.title', { name: themName }) : t('tutor_social:SOC-16.waiting_for_friend', { name: themName })}
        </Text>
        <Text variant="label" tone="muted" align="center" numeric>
          {t('tutor_social:SOC-15.rules', { count: d.question_count, s: d.question_seconds })}
        </Text>
      </Screen>
    );
  }

  // SOC-19: the result.
  if (d.result || d.status === 'finished' || d.status === 'abandoned' || d.status === 'expired' || d.status === 'declined') {
    const r = d.result;
    const solo = d.relation === 'solo';
    const title = solo
      ? t('tutor_social:SOC-19.solo_result', { a: me?.correct ?? 0, count: d.question_count })
      : !r || d.status === 'expired' || d.status === 'declined'
        ? t('tutor_social:SOC-19.expired')
        : r.abandoned_by_them
          ? t('tutor_social:SOC-19.opponent_left', { name: themName })
          : r.abandoned_by_me
            ? t('tutor_social:SOC-19.you_left', { name: themName })
            : r.winner === 'me'
              ? t('tutor_social:SOC-19.won')
              : r.winner === 'them'
                ? t('tutor_social:SOC-19.lost', { name: themName })
                : t('tutor_social:SOC-19.draw');
    const pet = app.store.getState().pet;
    return (
      <Screen
        testID="SOC-19"
        footer={
          solo ? (
            <>
              <Button label={t('tutor_social:SOC-19.solo_buttons.1')} onPress={() => router.replace('/social/duel' as Href)} testID="soc19-real" />
              <Button variant="ghost" label={t('tutor_social:SOC-19.solo_buttons.2')} onPress={() => router.replace('/friends' as Href)} testID="soc19-done" />
            </>
          ) : (
            <Button label={t('tutor_social:SOC-19.done')} onPress={() => router.replace('/friends' as Href)} testID="soc19-done" />
          )
        }
      >
        <BackHeader title={solo ? t('tutor_social:SOC-18.solo_label') : t('tutor_social:SOC-15.title')} backLabel={t('ui:common.back')} onBack={() => router.replace('/friends' as Href)} />
        <View accessibilityLiveRegion="polite">
          <Text variant="display" heading align="center" testID="soc19-title">
            {title}
          </Text>
        </View>
        {r?.not_counted ? <Banner tone="info" icon="Info" text={t('tutor_social:SOC-19.not_counted_flagged')} /> : null}
        <DuelScoreBar count={d.question_count} you={sides.you} opponent={sides.them} testID="soc19-score" />
        {r && r.xp_earned > 0 ? (
          <Text variant="title" tone="primary" align="center" numeric testID="soc19-xp">
            {t('tutor_social:SOC-19.xp', { xp: r.xp_earned })}
          </Text>
        ) : null}
        {pet && !solo ? <PetLine pet={{ species: pet.species === 'dog' ? 'dog' : 'cat', mood: r?.winner === 'me' ? 'proud' : 'happy' }} petName={pet.name} text={r?.winner === 'me' ? t('tutor_social:SOC-19.winner_pet_line') : t('tutor_social:SOC-19.other_pet_line')} /> : null}
      </Screen>
    );
  }

  // SOC-18: live.
  const offset = Date.parse(d.server_time) - (q.dataUpdatedAt || now);
  const left = current ? Math.max(0, Math.ceil((Date.parse(current.closes_at) - (now + offset)) / 1000)) : 0;
  const answered = current?.answered ?? false;
  return (
    <Screen
      testID="SOC-18"
      footer={
        current && !answered ? (
          <Button label={t('practice:PRC-11.submit')} loading={busy} disabled={!canSubmit(question, draft)} onPress={() => void submit()} testID="soc18-submit" />
        ) : undefined
      }
    >
      <BackHeader
        title={d.relation === 'solo' ? t('tutor_social:SOC-18.solo_label') : t('tutor_social:SOC-17.versus', { you: t('tutor_social:SOC-08.you'), opponent: themName })}
        backLabel={t('tutor_social:SOC-18.leave')}
        onBack={() => (d.relation === 'solo' ? void leave() : setConfirmLeave(true))}
      />
      <DuelScoreBar count={d.question_count} you={sides.you} opponent={sides.them} testID="soc18-score" />
      {them?.away ? <Banner tone="info" icon="WifiSlash" text={t('tutor_social:SOC-18.opponent_dropped', { name: themName })} /> : null}
      {confirmLeave ? (
        <Card tone="tint" testID="soc18-leave-confirm">
          <Stack gap={8}>
            <Text variant="body">{t('tutor_social:SOC-18.leave_confirm', { name: themName })}</Text>
            <Stack row gap={8}>
              <Button size="sm" label={t('tutor_social:SOC-18.leave_confirm_buttons.1')} onPress={() => setConfirmLeave(false)} />
              <Button size="sm" variant="secondary" label={t('tutor_social:SOC-18.leave_confirm_buttons.2')} onPress={() => void leave()} testID="soc18-leave" />
            </Stack>
          </Stack>
        </Card>
      ) : null}
      {current ? (
        <>
          <Stack row gap={12}>
            <Text variant="label" numeric style={styles.grow} testID="soc18-count">
              {t('tutor_social:SOC-18.question_count', { n: current.index + 1, count: d.question_count })}
            </Text>
            <Text variant="label" numeric tone={left <= 5 ? 'error' : 'muted'} accessibilityLabel={`${left} s`}>
              {`${left} s`}
            </Text>
          </Stack>
          {question ? (
            <QuestionHost>
              <Card outlined testID="soc18-question">
                <QuestionView question={question} passage={null} draft={draft ?? initialDraft(question)} onChange={setDraft} result={null} struck={[]} disabled={busy || answered} />
              </Card>
            </QuestionHost>
          ) : null}
          <View accessibilityLiveRegion="polite">
            {answered && last?.index === current.index ? (
              <Text variant="heading" tone={last.correct ? 'success' : 'muted'} testID="soc18-feedback">
                {last.correct ? t('tutor_social:SOC-18.correct') : t('tutor_social:SOC-18.not_this_time')}
              </Text>
            ) : null}
            {answered && them && !them.answered_current ? (
              <Text variant="body" tone="muted" testID="soc18-waiting">
                {t('tutor_social:SOC-18.waiting', { name: themName })}
              </Text>
            ) : null}
          </View>
        </>
      ) : (
        <Spinner label={t('tutor_social:SOC-17.get_ready')} />
      )}
    </Screen>
  );
}

/** The score bar's rows: my dots from my answers (right or wrong), theirs only as answered until the end. */
function scoreSides(d: DuelState, t: ReturnType<typeof useT>): { you: DuelSide; them?: DuelSide } {
  const me = d.players.find((p) => p.is_me);
  const them = d.players.find((p) => !p.is_me);
  const mine: DuelAnswer[] = Array.from({ length: d.question_count }, (_, i) => {
    const a = d.my_answers?.find((x) => x.index === i);
    return a ? (a.correct ? 'right' : 'wrong') : 'open';
  });
  const index = d.current?.index ?? d.question_count;
  const theirs: DuelAnswer[] = Array.from({ length: d.question_count }, (_, i) => (i < index || (i === index && them?.answered_current) ? 'answered' : 'open'));
  return {
    you: { name: t('tutor_social:SOC-08.you'), avatar: me ? avatarOf(me.person) : { species: 'cat' }, score: me?.score ?? 0, answers: mine },
    them: them ? { name: personName(them.person, t), avatar: avatarOf(them.person), score: them.score ?? 0, answers: theirs, dropped: them.away } : undefined,
  };
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
});
