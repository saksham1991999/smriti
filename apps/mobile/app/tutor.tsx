import { useAppStore } from '@smriti/app-core/react';
import { Banner, Button, Card, Chip, IconButton, Spinner, Text, useTheme } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { useApp, useT, useUiState } from '../src/services/context';
import { openTutorSession, sendTutorMessage, tutorAnswerText, type Quota, type TutorEvent } from '../src/services/practice';
import { BuddyLine } from '../src/ui/Onboarding';
import { BackHeader, Screen } from '../src/ui/Screen';

interface Bubble {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status: 'ok' | 'refused' | 'crisis' | 'error' | 'stopped';
}

const MAX_CHARS = 1000;

/**
 * AI-02, the tutor chat, on `/v1/tutor/sessions` and `/v1/tutor/sessions/{id}/messages` (SSE).
 * Answers arrive once the stream closes (React Native's fetch has no streaming body). The free
 * counter and the AI-06 cap come from the server's `quota` events. Locally the API answers with
 * its marked fake model ("[fake] ...") unless Agnes keys are set on the API.
 */
export default function Tutor() {
  const app = useApp();
  const t = useT();
  const theme = useTheme();
  const params = useLocalSearchParams<{ context?: string }>();
  const userId = useAppStore((s) => s.session.userId);
  const pet = useAppStore((s) => s.pet);
  useUiState((s) => s.locale);
  const exam = app.examProfileId();
  const context = typeof params.context === 'string' ? params.context : null;
  const session = useQuery({ queryKey: ['smriti', 'tutor', 'session', userId, exam, context], queryFn: () => openTutorSession(app, context), staleTime: 10 * 60_000 });
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [capped, setCapped] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/practice' as Href));

  useEffect(() => {
    if (!session.data) return;
    setQuota(session.data.quota);
    setBubbles((session.data.messages ?? []).map((m) => ({ id: m.id, role: m.role, text: m.content, status: m.status === 'ok' || m.status === 'stopped' ? m.status : m.status === 'refused' ? 'refused' : m.status === 'crisis' ? 'crisis' : 'error' })));
  }, [session.data]);

  const send = async (text: string, input: 'typed' | 'chip') => {
    const clean = text.trim();
    if (!clean || !session.data || sending) return;
    setDraft('');
    setSending(true);
    setBubbles((b) => [...b, { id: app.newId(), role: 'user', text: clean, status: 'ok' }]);
    let events: TutorEvent[];
    try {
      events = await sendTutorMessage(app, session.data.id, clean, input);
    } catch {
      events = [{ type: 'error', code: 'network', retry: true }];
    }
    setSending(false);
    for (const e of events) {
      if (e.type === 'quota') setQuota(e.quota);
      if (e.type === 'quota_exhausted') setCapped(true);
    }
    const safety = events.find((e): e is Extract<TutorEvent, { type: 'safety' }> => e.type === 'safety');
    const error = events.find((e) => e.type === 'error');
    const answer = tutorAnswerText(events);
    if (safety?.kind === 'crisis') setBubbles((b) => [...b, { id: app.newId(), role: 'assistant', text: t('tutor_social:AI-08.crisis_body'), status: 'crisis' }]);
    else if (safety?.kind === 'refusal') setBubbles((b) => [...b, { id: app.newId(), role: 'assistant', text: t('tutor_social:AI-08.refusal'), status: 'refused' }]);
    else if (answer) setBubbles((b) => [...b, { id: app.newId(), role: 'assistant', text: answer, status: 'ok' }]);
    else if (error) setBubbles((b) => [...b, { id: app.newId(), role: 'assistant', text: t('tutor_social:AI-02.server_error'), status: 'error' }]);
    if (safety?.kind === 'pii_removed') setBubbles((b) => [...b, { id: app.newId(), role: 'assistant', text: t('tutor_social:AI-08.personal_info_reminder'), status: 'ok' }]);
  };

  const left = quota && !quota.unlimited && quota.limit !== null ? Math.max(0, quota.remaining ?? quota.limit - quota.used) : null;
  const out = capped || left === 0;
  const chips = context
    ? [t('tutor_social:AI-02.starter_chips.1'), t('tutor_social:AI-02.starter_chips.2'), t('tutor_social:AI-02.starter_chips.3')]
    : [t('tutor_social:AI-02.starter_chips_no_context.1'), t('tutor_social:AI-02.starter_chips_no_context.2'), t('tutor_social:AI-02.starter_chips_no_context.3')];

  const footer = (
    <View style={styles.footer}>
      {left !== null && quota?.limit ? (
        <Text variant="caption" tone="muted" align="center" numeric testID="tutor-counter">
          {t('tutor_social:AI-02.free_counter', { n: left, limit: quota.limit })}
        </Text>
      ) : null}
      <View style={[styles.inputRow, { backgroundColor: theme.colors.surface, borderColor: theme.colors.line, borderRadius: theme.radius.pill }]}>
        <TextInput
          value={draft}
          onChangeText={(v) => setDraft(v.slice(0, MAX_CHARS))}
          placeholder={context ? t('tutor_social:AI-02.input_placeholder_with_context') : t('tutor_social:AI-02.input_placeholder_no_context')}
          placeholderTextColor={theme.colors.inkMuted}
          accessibilityLabel={t('tutor_social:AI-02.input_placeholder_no_context')}
          editable={!out && !sending && Boolean(session.data)}
          multiline
          style={[styles.input, { color: theme.colors.ink }]}
          testID="tutor-input"
        />
        <IconButton icon="ArrowRight" variant="filled" label={t('tutor_social:AI-02.send')} disabled={!draft.trim() || sending || out || !session.data} onPress={() => void send(draft, 'typed')} testID="tutor-send" />
      </View>
    </View>
  );

  return (
    <Screen testID="AI-02" footer={footer}>
      <BackHeader title={t('tutor_social:AI-01.accessibility_label', { pet_name: pet?.name ?? '' })} backLabel={t('ui:common.back')} onBack={back} />
      {session.isPending ? <Spinner label={t('tutor_social:AI-02.thinking', { pet_name: pet?.name ?? '' })} /> : null}
      {session.isError ? <Banner tone="warning" icon="Warning" text={t('tutor_social:AI-02.server_error')} action={{ label: t('tutor_social:AI-02.try_again'), onPress: () => void session.refetch() }} testID="tutor-error" /> : null}
      {session.data && bubbles.length === 0 ? (
        <View style={styles.gap}>
          <BuddyLine text={t('tutor_social:AI-02.greeting_pet_line_empty_chat')} />
          <View style={styles.chips}>
            {chips.map((c, i) => (
              <Chip key={c} kind="filter" label={c} onPress={() => void send(c, 'chip')} testID={`tutor-chip-${i}`} />
            ))}
          </View>
        </View>
      ) : null}

      {bubbles.map((b) => (
        <View key={b.id} style={[styles.bubbleRow, b.role === 'user' ? styles.mine : null]}>
          <View
            style={[
              styles.bubble,
              { borderRadius: theme.radius.card },
              b.role === 'user' ? { backgroundColor: theme.colors.primaryTint } : { backgroundColor: theme.colors.surface, borderColor: theme.colors.line, borderWidth: StyleSheet.hairlineWidth },
            ]}
            testID={b.role === 'user' ? 'tutor-msg-user' : 'tutor-msg-ai'}
          >
            {b.status === 'crisis' ? <Text variant="heading">{t('tutor_social:AI-08.crisis_title')}</Text> : null}
            <Text variant="body">{b.text}</Text>
            {b.role === 'assistant' && b.status === 'ok' ? (
              <Text variant="caption" tone="muted">
                {t('tutor_social:AI-02.ai_label')}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
      {sending ? (
        <Text variant="caption" tone="muted" testID="tutor-thinking">
          {t('tutor_social:AI-02.thinking', { pet_name: pet?.name ?? '' })}
        </Text>
      ) : null}

      {out ? (
        <Card tone="tint" testID="AI-06">
          <View style={styles.gap}>
            <Text variant="heading">{t('tutor_social:AI-06.title', { limit: quota?.limit ?? 0 })}</Text>
            <Text variant="body" tone="muted">
              {t('tutor_social:AI-06.body')}
            </Text>
            {app.isLittleLearner() ? null : <Button label={t('practice:PRC-01.pro_link')} onPress={() => router.push({ pathname: '/paywall', params: { from: 'tutor_cap' } })} testID="tutor-pro" />}
            <Button variant="ghost" label={t('tutor_social:AI-06.secondary')} onPress={back} />
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  bubbleRow: { flexDirection: 'row' },
  mine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '85%', padding: 12, gap: 6 },
  footer: { gap: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', borderWidth: 1, paddingLeft: 16, paddingRight: 4, paddingVertical: 4, gap: 8 },
  input: { flex: 1, minHeight: 40, maxHeight: 120, paddingVertical: 8, fontSize: 16 },
});
