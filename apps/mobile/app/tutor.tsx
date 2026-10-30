import { useAppStore } from '@smriti/app-core/react';
import { Banner, Button, Card, ChatBubble, ChatInput, Chip, ChoiceChips, IconButton, Sheet, Spinner, Text, Toast } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { useApp, useQueryScope, useT, useUiState } from '../src/services/context';
import { openTutorSession, streamTutorMessage, type Helpline, type Quota, type TutorEvent } from '../src/services/practice';
import { FEEDBACK_REASONS, fetchTutorSession, saveTutorCard, tutorFeedback, type FeedbackReason } from '../src/services/tutor';
import { BuddyLine } from '../src/ui/Onboarding';
import { BackHeader, Screen } from '../src/ui/Screen';

interface Bubble {
  id: string;
  /** The server's id for an answer, once `done` arrives (feedback needs it). */
  messageId: string | null;
  role: 'user' | 'assistant';
  text: string;
  status: 'ok' | 'streaming' | 'refused' | 'crisis' | 'error' | 'stopped';
  helplines?: Helpline[];
  rated?: 'up' | 'down';
  saved?: boolean;
}

const MAX_CHARS = 1000;
const REASON_LABEL: Record<FeedbackReason, number> = { wrong: 1, confusing: 2, too_long: 3, didnt_answer: 4, wrong_language: 5, not_suitable: 6 };

/**
 * AI-02, the tutor chat, on `/v1/tutor/sessions` and `/v1/tutor/sessions/{id}/messages`. Answers
 * stream token by token through `expo/fetch`. Also AI-04 (save as flashcard), AI-05 (feedback),
 * AI-06 (daily cap) and AI-08 (refusal and crisis support, with the helplines the server sends
 * from `safety.helplines`; none are in the app). Locally the API answers with its marked fake model.
 */
export default function Tutor() {
  const app = useApp();
  const t = useT();
  const params = useLocalSearchParams<{ context?: string; session?: string }>();
  const scope = useQueryScope();
  const pet = useAppStore((s) => s.pet);
  useUiState((s) => s.locale);
  const exam = app.examProfileId();
  const context = typeof params.context === 'string' ? params.context : null;
  const reopen = typeof params.session === 'string' ? params.session : null;
  const session = useQuery({
    queryKey: ['smriti', 'tutor', 'session', scope, exam, context, reopen],
    queryFn: () => (reopen ? fetchTutorSession(app, reopen) : openTutorSession(app, context)),
    staleTime: 10 * 60_000,
  });
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [capped, setCapped] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [feedbackFor, setFeedbackFor] = useState<Bubble | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const stopped = useRef(false);
  const online = app.deps.network.isOnline();
  const petName = pet?.name ?? '';
  const back = () => (router.canGoBack() ? router.back() : router.replace('/practice' as Href));

  useEffect(() => {
    if (!session.data) return;
    setQuota(session.data.quota);
    setBubbles(
      (session.data.messages ?? []).map((m) => ({
        id: m.id,
        messageId: m.role === 'assistant' ? m.id : null,
        role: m.role,
        text: m.role === 'assistant' && m.status === 'crisis' ? t('tutor_social:AI-08.crisis_body') : m.role === 'assistant' && m.status === 'refused' ? t('tutor_social:AI-08.refusal') : m.content,
        status: m.status === 'ok' || m.status === 'stopped' || m.status === 'refused' || m.status === 'crisis' ? m.status : 'error',
      })),
    );
  }, [session.data, t]);

  const patch = (id: string, fn: (b: Bubble) => Bubble) => setBubbles((list) => list.map((b) => (b.id === id ? fn(b) : b)));

  const send = async (text: string, input: 'typed' | 'chip') => {
    const clean = text.trim();
    if (!clean || !session.data || sending) return;
    setDraft('');
    setSending(true);
    stopped.current = false;
    const answerId = app.newId();
    setBubbles((b) => [...b, { id: app.newId(), messageId: null, role: 'user', text: clean, status: 'ok' }, { id: answerId, messageId: null, role: 'assistant', text: '', status: 'streaming' }]);
    const onEvent = (e: TutorEvent) => {
      if (stopped.current && e.type !== 'done' && e.type !== 'quota') return;
      switch (e.type) {
        case 'delta':
          patch(answerId, (b) => ({ ...b, text: b.text + e.text }));
          break;
        case 'replace':
          patch(answerId, (b) => ({ ...b, text: e.text }));
          break;
        case 'quota':
          setQuota(e.quota);
          break;
        case 'quota_exhausted':
          setCapped(true);
          patch(answerId, (b) => ({ ...b, status: 'error', text: '' }));
          break;
        case 'safety':
          if (e.kind === 'crisis') patch(answerId, (b) => ({ ...b, status: 'crisis', text: t('tutor_social:AI-08.crisis_body'), helplines: e.helplines }));
          else if (e.kind === 'refusal') patch(answerId, (b) => ({ ...b, status: 'refused', text: t('tutor_social:AI-08.refusal') }));
          else if (e.kind === 'pii_removed') setBubbles((b) => [...b, { id: app.newId(), messageId: null, role: 'assistant', text: t('tutor_social:AI-08.personal_info_reminder'), status: 'refused' }]);
          break;
        case 'error':
          patch(answerId, (b) => ({ ...b, status: 'error', text: b.text || t('tutor_social:AI-02.server_error') }));
          break;
        case 'done':
          patch(answerId, (b) => ({ ...b, messageId: e.messageId, status: b.status === 'streaming' ? (stopped.current ? 'stopped' : 'ok') : b.status }));
          break;
        default:
          break;
      }
    };
    try {
      await streamTutorMessage(app, session.data.id, clean, input, onEvent);
    } catch {
      patch(answerId, (b) => ({ ...b, status: 'error', text: t('tutor_social:AI-02.server_error') }));
    }
    patch(answerId, (b) => (b.status === 'streaming' ? { ...b, status: b.text ? 'ok' : 'error', text: b.text || t('tutor_social:AI-02.server_error') } : b));
    setSending(false);
  };

  const rateUp = async (b: Bubble) => {
    if (!b.messageId) return;
    patch(b.id, (x) => ({ ...x, rated: 'up' }));
    setToast(t('tutor_social:AI-05.thumbs_up_toast'));
    app.track('tutor_feedback_given', { rating: 'up', reasons: 'none', reported: false });
    await tutorFeedback(app, b.messageId, 'up').catch(() => undefined);
  };
  const saveCard = async (b: Bubble) => {
    const i = bubbles.findIndex((x) => x.id === b.id);
    const question = [...bubbles.slice(0, i)].reverse().find((x) => x.role === 'user')?.text ?? '';
    const r = await saveTutorCard(app, question, b.text);
    patch(b.id, (x) => ({ ...x, saved: true }));
    setToast(r.online ? t('tutor_social:AI-04.toast') : t('tutor_social:AI-04.offline_toast'));
  };

  const left = quota && !quota.unlimited && quota.limit !== null ? Math.max(0, quota.remaining ?? quota.limit - quota.used) : null;
  const out = capped || left === 0;
  const chips = context
    ? [t('tutor_social:AI-02.starter_chips.1'), t('tutor_social:AI-02.starter_chips.2'), t('tutor_social:AI-02.starter_chips.3')]
    : [t('tutor_social:AI-02.starter_chips_no_context.1'), t('tutor_social:AI-02.starter_chips_no_context.2'), t('tutor_social:AI-02.starter_chips_no_context.3')];
  const canPhoto = !app.isLittleLearner() && app.ageBand() !== '10_12' && app.ageBand() !== 'u10';

  const footer = (
    <View style={styles.footer}>
      {left !== null && quota?.limit ? (
        <Text variant="caption" tone="muted" align="center" numeric testID="tutor-counter">
          {t('tutor_social:AI-02.free_counter', { n: left, limit: quota.limit })}
        </Text>
      ) : null}
      <ChatInput
        value={draft}
        onChange={(v) => setDraft(v.slice(0, MAX_CHARS))}
        onSend={() => void send(draft, 'typed')}
        label={t('tutor_social:AI-02.input_placeholder_no_context')}
        placeholder={context ? t('tutor_social:AI-02.input_placeholder_with_context') : t('tutor_social:AI-02.input_placeholder_no_context')}
        maxLength={MAX_CHARS}
        disabled={out || !session.data || !online}
        streaming={sending}
        onStop={() => {
          stopped.current = true;
        }}
        attach={canPhoto ? <IconButton icon="Plus" label={t('tutor_social:AI-07.photo_title')} onPress={() => router.push('/photo-doubt' as Href)} testID="tutor-photo" /> : undefined}
        testID="tutor-input"
      />
    </View>
  );

  return (
    <Screen testID="AI-02" footer={footer}>
      <BackHeader
        title={t('tutor_social:AI-01.accessibility_label', { pet_name: petName })}
        backLabel={t('ui:common.back')}
        onBack={back}
        trailing={app.isLittleLearner() ? undefined : <IconButton icon="Clock" label={t('tutor_social:AI-09.title')} onPress={() => router.push('/tutor-history' as Href)} testID="tutor-history" />}
      />
      {!online ? <Banner tone="offline" icon="WifiSlash" text={t('tutor_social:AI-02.offline_pet_line')} testID="tutor-offline" /> : null}
      {session.isPending ? <Spinner label={t('tutor_social:AI-02.thinking', { pet_name: petName })} /> : null}
      {session.isError ? <Banner tone="warning" icon="Warning" text={t('tutor_social:AI-02.server_error')} action={{ label: t('tutor_social:AI-02.try_again'), onPress: () => void session.refetch() }} testID="tutor-error" /> : null}
      {session.data?.context?.title ? <Chip label={t('tutor_social:AI-02.context_chip', { context_title: session.data.context.title[app.ui.getState().locale] ?? session.data.context.title.en ?? '' })} tone="primary" /> : null}
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

      {bubbles.map((b) =>
        b.status === 'crisis' ? (
          <Crisis key={b.id} helplines={b.helplines ?? []} petName={petName} />
        ) : (
          <ChatBubble
            key={b.id}
            role={b.role === 'user' ? 'student' : 'tutor'}
            text={b.text}
            authorName={petName}
            {...(b.role === 'assistant' && pet ? { avatar: { species: pet.species } } : {})}
            streaming={b.status === 'streaming'}
            stopped={b.status === 'stopped'}
            showAiLabel={b.role === 'assistant' && (b.status === 'ok' || b.status === 'stopped')}
            actions={
              b.role === 'assistant' && b.status === 'ok' && b.messageId ? (
                <>
                  <IconButton icon="Smiley" label={t('tutor_social:AI-05.thumbs_up_toast')} disabled={Boolean(b.rated)} onPress={() => void rateUp(b)} testID="tutor-up" />
                  <IconButton icon="Flag" label={t('tutor_social:AI-05.title')} disabled={Boolean(b.rated)} onPress={() => setFeedbackFor(b)} testID="tutor-down" />
                  <Button size="sm" variant="ghost" icon="Cards" label={b.saved ? t('tutor_social:AI-04.saved_state') : t('tutor_social:AI-02.save_as_flashcard')} disabled={b.saved} onPress={() => void saveCard(b)} testID="tutor-save-card" />
                </>
              ) : undefined
            }
            testID={b.role === 'user' ? 'tutor-msg-user' : 'tutor-msg-ai'}
          />
        ),
      )}

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

      <FeedbackSheet
        bubble={feedbackFor}
        onClose={() => setFeedbackFor(null)}
        onSent={(b) => {
          patch(b.id, (x) => ({ ...x, rated: 'down' }));
          setToast(t('tutor_social:AI-05.thanks_toast', { pet_name: petName }));
        }}
      />
      <Toast open={toast !== null} message={toast ?? ''} onDismiss={() => setToast(null)} testID="tutor-toast" />
    </Screen>
  );
}

/** AI-05: what went wrong, reasons only (no free text). */
function FeedbackSheet({ bubble, onClose, onSent }: { bubble: Bubble | null; onClose: () => void; onSent: (b: Bubble) => void }) {
  const app = useApp();
  const t = useT();
  const [reasons, setReasons] = useState<FeedbackReason[]>([]);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!bubble?.messageId) return;
    setBusy(true);
    try {
      const r = await tutorFeedback(app, bubble.messageId, 'down', reasons);
      app.track('tutor_feedback_given', { rating: 'down', reasons: reasons.join('|'), reported: r.queued_for_review });
      onSent(bubble);
    } catch {
      // The rating is optional; a failed send leaves the thumbs open to try again.
    }
    setBusy(false);
    setReasons([]);
    onClose();
  };
  return (
    <Sheet open={bubble !== null} onOpenChange={(o) => !o && onClose()} title={t('tutor_social:AI-05.title')} height="40" testID="AI-05" footer={<Button label={t('tutor_social:AI-05.send')} loading={busy} disabled={reasons.length === 0} onPress={() => void send()} testID="feedback-send" />}>
      <View style={styles.gap}>
        <ChoiceChips
          label={t('tutor_social:AI-05.title')}
          hideLabel
          multiple
          options={FEEDBACK_REASONS.map((r) => ({ value: r, label: t(`tutor_social:AI-05.reasons.${REASON_LABEL[r]}` as 'tutor_social:AI-05.reasons.1') }))}
          value={reasons}
          onChange={(v) => setReasons(v as FeedbackReason[])}
          testID="feedback-reasons"
        />
        {reasons.includes('wrong') || reasons.includes('not_suitable') ? (
          <Text variant="caption" tone="muted">
            {t('tutor_social:AI-05.review_line')}
          </Text>
        ) : null}
      </View>
    </Sheet>
  );
}

/**
 * AI-08 crisis support. Every number comes from the server's crisis event (`safety.helplines`,
 * owner-verified config); when it sends none, only the trusted-person line shows.
 */
function Crisis({ helplines, petName }: { helplines: Helpline[]; petName: string }) {
  const t = useT();
  const emergency = helplines.find((h) => h.kind === 'emergency');
  const lines = helplines.filter((h) => h !== emergency);
  return (
    <Card outlined testID="AI-08">
      <View style={styles.gap}>
        <Text variant="heading">{t('tutor_social:AI-08.crisis_title')}</Text>
        <Text variant="body">{t('tutor_social:AI-08.crisis_body')}</Text>
        {lines.map((h) => (
          <View key={`${h.name}-${h.number}`} style={styles.gapSm}>
            <Button icon="Bell" label={t('tutor_social:AI-08.call_button', { helpline_name: h.name })} onPress={() => void Linking.openURL(`tel:${h.number.replace(/[^\d+]/g, '')}`)} testID="crisis-call" />
            {h.description ? (
              <Text variant="caption" tone="muted">
                {`${h.description} · ${h.number}`}
              </Text>
            ) : (
              <Text variant="caption" tone="muted" numeric>
                {h.number}
              </Text>
            )}
          </View>
        ))}
        {emergency ? (
          <Text variant="label" testID="crisis-danger">
            {t('tutor_social:AI-08.danger_line', { emergency_number: emergency.number })}
          </Text>
        ) : null}
        <Text variant="label">{t('tutor_social:AI-08.trusted_person')}</Text>
        <Text variant="body" tone="muted">
          {t('tutor_social:AI-08.trusted_list')}
        </Text>
        <Text variant="caption" tone="muted">
          {t('tutor_social:AI-08.keep_talking', { pet_name: petName })}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 12 },
  gapSm: { gap: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  footer: { gap: 6 },
});
