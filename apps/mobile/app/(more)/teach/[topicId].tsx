import { localize } from '@smriti/content-schema';
import type { MessageKey } from '@smriti/i18n';
import { Banner, Button, Card, ChoiceChips, Icon, IconButton, PetLine, ProgressBar, Spinner, Text, Toast, useTheme } from '@smriti/ui-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { bandOf, conceptFor, submitExplanation, wordCount, type Band, type FeynmanOut } from '../../../src/features/feynman/services';
import { ReadAloudButton } from '../../../src/features/speech/ReadAloudButton';
import { speechFor, transcribe } from '../../../src/features/speech/speech';
import type { Recording } from '../../../src/platform/audio';
import { useApp, useT, useUiState } from '../../../src/services/context';
import { saveTutorCard } from '../../../src/services/tutor';
import { BackHeader, Screen, Stack } from '../../../src/ui/Screen';

const BAND_ICON = { needs_work: 'Warning', getting_there: 'ArrowUp', clear: 'CheckCircle' } as const;
const BAND_KEY: Record<Band, MessageKey> = { needs_work: 'tutor_social:AI-11.bands.1', getting_there: 'tutor_social:AI-11.bands.2', clear: 'tutor_social:AI-11.bands.3' };

/**
 * AI-10 (explain it, typed or spoken) and AI-11 (how you did) for a topic's concept, on
 * `/v1/feynman/attempts`. Spoken explanations go through `/v1/speech/dictation` and come back as
 * editable text. The explanation itself never reaches analytics: events carry bands and counts.
 */
export default function TeachBack() {
  const app = useApp();
  const t = useT();
  const theme = useTheme();
  const locale = useUiState((s) => s.locale);
  const { topicId } = useLocalSearchParams<{ topicId: string }>();
  const topic = app.deps.content.topic(locale, topicId, app.examProfileId());
  const conceptId = conceptFor(app, topicId);
  const title = topic?.name ?? '';
  const min = Number(app.flags.get('feynman.min_words') ?? 30);
  const maxSec = Number(app.flags.get('feynman.max_record_seconds') ?? 120);
  const speech = speechFor(app);
  const pet = app.store.getState().pet;
  const petName = pet?.name ?? '';
  const [mode, setMode] = useState<'type' | 'speak'>('type');
  const [text, setText] = useState('');
  const [input, setInput] = useState<'text' | 'voice'>('text');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FeynmanOut | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const rec = useRef<Recording | null>(null);
  const started = useRef(false);
  const words = wordCount(text);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/learn' as Href));

  const startedOnce = () => {
    if (started.current) return;
    started.current = true;
    app.track('feynman_started', { input: input === 'voice' ? 'voice' : 'typed' });
  };

  const record = async () => {
    setError(null);
    if (recording && rec.current) {
      setRecording(false);
      setTranscribing(true);
      const audio = await rec.current.stop();
      rec.current = null;
      const out = audio ? await transcribe(app, audio) : { kind: 'failed' as const };
      setTranscribing(false);
      if (out.kind === 'text') {
        setText((v) => (v ? `${v} ${out.text}` : out.text));
        setInput('voice');
        startedOnce();
      } else setError(t('tutor_social:AI-11.grading_error'));
      return;
    }
    const r = await speech.in.start();
    if (!r) return setError(t('tutor_social:AI-12.denied_body'));
    rec.current = r;
    setRecording(true);
  };

  const submit = async () => {
    if (!conceptId) return;
    setBusy(true);
    setError(null);
    app.track('feynman_submitted', { input: input === 'voice' ? 'voice' : 'typed' });
    const out = await submitExplanation(app, conceptId, text.trim(), input);
    setBusy(false);
    if (out.kind === 'graded') {
      setResult(out.out);
      const gaps = out.out.key_points.filter((k) => k.status !== 'covered').length;
      app.track('feynman_completed', {
        input: input === 'voice' ? 'voice' : 'typed',
        clarity_band: bandOf(app, out.out.clarity),
        completeness_band: bandOf(app, out.out.completeness),
        accuracy_band: bandOf(app, out.out.accuracy),
        gaps_count: gaps,
        followups_answered: 0,
      });
    } else if (out.kind === 'offline') setError(t('tutor_social:AI-10.offline'));
    else setError(t('tutor_social:AI-11.grading_error'));
  };

  if (result) {
    return (
      <Result
        out={result}
        title={title}
        topicId={topicId}
        petName={petName}
        species={pet?.species === 'dog' ? 'dog' : 'cat'}
        onTryAgain={() => setResult(null)}
        onDone={back}
        onAdded={(n) => setToast(t('tutor_social:AI-11.added_toast', { n }))}
        toast={toast}
        clearToast={() => setToast(null)}
      />
    );
  }

  return (
    <Screen
      testID="AI-10"
      footer={<Button label={t('tutor_social:AI-10.submit')} loading={busy} disabled={!conceptId || words < min || recording || transcribing} onPress={() => void submit()} testID="ai10-submit" />}
    >
      <BackHeader title={t('tutor_social:AI-10.title')} backLabel={t('ui:common.back')} onBack={back} />
      {!conceptId ? <Banner tone="info" icon="Info" text={t('learn:LES-11.error')} /> : null}
      <Card tone="tint">
        <Text variant="heading" testID="ai10-prompt">
          {t('tutor_social:AI-10.prompt', { concept_title: title })}
        </Text>
      </Card>
      {speech.in.available ? (
        <ChoiceChips
          label={t('tutor_social:AI-10.title')}
          hideLabel
          options={[
            { value: 'type', label: t('tutor_social:AI-10.type') },
            { value: 'speak', label: t('tutor_social:AI-10.speak') },
          ]}
          value={[mode]}
          onChange={(v) => setMode(v[0] === 'speak' ? 'speak' : 'type')}
          testID="ai10-mode"
        />
      ) : null}
      {mode === 'speak' ? (
        <View style={styles.centre}>
          <IconButton icon={recording ? 'Stop' : 'Circle'} variant="primary" size={56} label={t('tutor_social:AI-10.hold_to_record')} onPress={() => void record()} testID="ai10-record" />
          <Text variant="caption" tone="muted">
            {transcribing ? t('tutor_social:AI-10.transcribing') : t('tutor_social:AI-10.recording_limit', { max_min: Math.round(maxSec / 60) })}
          </Text>
        </View>
      ) : null}
      <View>
        {mode === 'speak' && text ? (
          <Text variant="label" style={styles.label}>
            {t('tutor_social:AI-10.transcript_label')}
          </Text>
        ) : null}
        <TextInput
          value={text}
          onChangeText={(v) => {
            setText(v);
            startedOnce();
          }}
          multiline
          accessibilityLabel={t('tutor_social:AI-10.prompt', { concept_title: title })}
          placeholderTextColor={theme.colors.inkMuted}
          style={[styles.area, { backgroundColor: theme.colors.surfaceSunken, color: theme.colors.ink, borderRadius: theme.radius.md, borderColor: theme.colors.line }]}
          testID="ai10-text"
        />
        <View accessibilityLiveRegion="polite">
          <Text variant="caption" tone={words >= min ? 'success' : 'muted'} numeric testID="ai10-count">
            {t('tutor_social:AI-10.word_counter', { n: words, min })}
          </Text>
        </View>
      </View>
      {error ? <Banner tone="warning" icon="Warning" text={error} testID="ai10-error" /> : null}
      {busy ? <Spinner label={t('tutor_social:AI-11.grading')} /> : null}
      {pet ? <PetLine pet={{ species: pet.species === 'dog' ? 'dog' : 'cat', mood: 'thinking' }} petName={petName} text={t('tutor_social:AI-10.tip_pet_line')} /> : null}
    </Screen>
  );
}

function Result({ out, title, topicId, petName, species, onTryAgain, onDone, onAdded, toast, clearToast }: { out: FeynmanOut; title: string; topicId: string; petName: string; species: 'cat' | 'dog'; onTryAgain: () => void; onDone: () => void; onAdded: (n: number) => void; toast: string | null; clearToast: () => void }) {
  const app = useApp();
  const t = useT();
  const locale = useUiState((s) => s.locale);
  const [added, setAdded] = useState(false);
  const meters = [
    { key: 'tutor_social:AI-11.meters.1' as const, score: out.clarity },
    { key: 'tutor_social:AI-11.meters.2' as const, score: out.completeness },
    { key: 'tutor_social:AI-11.meters.3' as const, score: out.accuracy },
  ];
  const bands = meters.map((m) => bandOf(app, m.score));
  const missed = out.key_points.filter((k) => k.status === 'missing');
  const wrong = out.key_points.filter((k) => k.status === 'misconception');
  const gaps = [...missed, ...wrong];
  const line = bands.every((b) => b === 'clear') ? 'pet_line_all_clear' : bands.some((b) => b === 'needs_work') ? 'pet_line_needs_work' : 'pet_line_mixed';
  const since = out.previous ? Math.round((out.clarity + out.completeness + out.accuracy - (Number(out.previous.clarity) + Number(out.previous.completeness) + Number(out.previous.accuracy))) / 3) : 0;
  const text = (k: (typeof out.key_points)[number]) => localize(k.text as never, locale) as unknown as string;

  const addGaps = async () => {
    for (const k of gaps) await saveTutorCard(app, title, k.note ? `${text(k)}\n\n${k.note}` : text(k));
    setAdded(true);
    onAdded(gaps.length);
  };

  return (
    <Screen
      testID="AI-11"
      footer={
        <>
          {gaps.length ? <Button label={t('tutor_social:AI-11.add_gaps')} disabled={added} onPress={() => void addGaps()} testID="ai11-add-gaps" /> : <Button label={t('tutor_social:AI-11.done')} onPress={onDone} testID="ai11-done" />}
          <Button variant="secondary" label={t('tutor_social:AI-11.try_again')} onPress={onTryAgain} testID="ai11-try-again" />
        </>
      }
    >
      <BackHeader title={t('tutor_social:AI-11.title')} backLabel={t('ui:common.back')} onBack={onDone} trailing={gaps.length ? <Button size="sm" variant="ghost" label={t('tutor_social:AI-11.done')} onPress={onDone} /> : undefined} />
      <PetLine pet={{ species, mood: line === 'pet_line_all_clear' ? 'proud' : line === 'pet_line_mixed' ? 'thinking' : 'curious' }} petName={petName} text={t(`tutor_social:AI-11.${line}`)} />
      <Stack gap={16}>
        {meters.map((m, i) => {
          const band = bands[i]!;
          const label = t('tutor_social:AI-11.meter_a11y', { meter: t(m.key), band: t(BAND_KEY[band]), score: m.score });
          return (
            <View key={m.key} accessible accessibilityLabel={label} testID={`ai11-meter-${i}`}>
              <Stack row gap={8}>
                <Text variant="label" style={styles.grow}>
                  {t(m.key)}
                </Text>
                <Icon name={BAND_ICON[band]} size={16} color={band === 'clear' ? 'successText' : 'inkMuted'} />
                <Text variant="label">{t(BAND_KEY[band])}</Text>
                <Text variant="caption" tone="muted" numeric>
                  {t('tutor_social:AI-11.score', { score: m.score })}
                </Text>
              </Stack>
              <ProgressBar value={m.score / 100} tone="primary" label={label} />
            </View>
          );
        })}
      </Stack>
      {since > 0 ? (
        <Stack row gap={4}>
          <Icon name="ArrowUp" size={16} color="successText" />
          <Text variant="label" tone="success" numeric>
            {t('tutor_social:AI-11.since_last_time', { n: since })}
          </Text>
        </Stack>
      ) : null}
      {gaps.length === 0 ? (
        <Text variant="body" tone="success" testID="ai11-no-gaps">
          {t('tutor_social:AI-11.no_gaps')}
        </Text>
      ) : null}
      {(
        [
          ['tutor_social:AI-11.you_missed', missed],
          ['tutor_social:AI-11.not_quite_right', wrong],
        ] as const
      ).map(([head, list]) =>
        list.length ? (
          <Stack key={head} gap={8}>
            <Text variant="heading">{t(head)}</Text>
            {list.map((k) => (
              <Card key={k.index} outlined testID={`ai11-gap-${k.index}`}>
                <Stack gap={8}>
                  <Text variant="body">{text(k)}</Text>
                  {k.note ? (
                    <Text variant="caption" tone="muted">
                      {k.note}
                    </Text>
                  ) : null}
                  <Button size="sm" variant="ghost" label={t('tutor_social:AI-11.learn_this')} onPress={() => router.push(`/lesson/${topicId}` as Href)} />
                </Stack>
              </Card>
            ))}
          </Stack>
        ) : null,
      )}
      {out.follow_ups.length ? (
        <Stack gap={8}>
          <Text variant="heading">{t('tutor_social:AI-11.follow_ups_header', { pet_name: petName })}</Text>
          {out.follow_ups.map((q, i) => (
            <Card key={i} tone="tint">
              <Stack row gap={8}>
                <Text variant="body" style={styles.grow}>
                  {q}
                </Text>
                <ReadAloudButton text={q} testID={`ai11-listen-${i}`} />
              </Stack>
            </Card>
          ))}
        </Stack>
      ) : null}
      <Toast open={toast !== null} message={toast ?? ''} icon="CheckCircle" onDismiss={clearToast} testID="ai11-toast" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  centre: { alignItems: 'center', gap: 8 },
  label: { marginBottom: 4 },
  area: { minHeight: 160, padding: 12, borderWidth: 1, textAlignVertical: 'top', fontSize: 16 },
});
