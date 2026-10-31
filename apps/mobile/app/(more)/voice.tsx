import type { MessageKey } from '@smriti/i18n';
import { useStoreSelector } from '@smriti/app-core/react';
import { Button, Icon, IconButton, Illustration, PetLine, Spinner, StatTile, Text } from '@smriti/ui-native';
import { router, type Href } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { createVoiceSession, type VoiceQuota, type VoiceUnavailable } from '../../src/features/voice/session';
import { useApp, useT } from '../../src/services/context';
import { Screen, Stack } from '../../src/ui/Screen';

/**
 * The voice tutor: AI-13 (connecting, or why voice isn't available), AI-14 (live) and AI-15
 * (summary). The session checks `/v1/voice/quota` first; locally the API says voice is off (no
 * owner-set daily allowance and no provider), and this build has no realtime audio transport,
 * so the usual path here is the "not ready" state with a way into text.
 */
export default function Voice() {
  const app = useApp();
  const t = useT();
  const session = useMemo(() => createVoiceSession(app), [app]);
  const state = useStoreSelector(session.store, (s) => s);
  const pet = app.store.getState().pet;
  const petName = pet?.name ?? '';
  const species = pet?.species === 'dog' ? 'dog' : 'cat';

  useEffect(() => {
    void session.start();
    return () => void session.end('user');
  }, [session]);

  const toText = () => {
    app.track('voice_fallback_to_text', { reason: state.kind === 'unavailable' ? state.reason : state.kind });
    router.replace('/tutor' as Href);
  };
  const close = () => (router.canGoBack() ? router.back() : router.replace('/learn' as Href));

  if (state.kind === 'ended') {
    const minutes = Math.max(1, Math.round(state.seconds / 60));
    return (
      <Screen testID="AI-15" footer={<Button label={t('tutor_social:AI-15.continue_in_text')} onPress={toText} testID="ai15-text" />}>
        <Header onClose={close} />
        <Text variant="display" heading align="center">
          {state.reason === 'network' ? t('tutor_social:AI-15.title_dropped') : state.reason === 'user' ? t('tutor_social:AI-15.title_normal') : t('tutor_social:AI-15.title_time_cap')}
        </Text>
        <View style={styles.tiles}>
          <StatTile style={styles.tile} icon="Timer" value={String(minutes)} label={t('tutor_social:AI-15.stat_labels.1')} testID="ai15-minutes" />
          <StatTile style={styles.tile} icon="Cards" value={String(state.flashcards)} label={t('tutor_social:AI-15.stat_labels.2')} />
        </View>
        {state.reason !== 'user' && state.quota ? (
          <Text variant="body" tone="muted" align="center">
            {t('tutor_social:AI-15.time_cap_line', { reset_time: resetTime(app, state.quota) })}
          </Text>
        ) : null}
      </Screen>
    );
  }

  if (state.kind === 'live') {
    const activity: MessageKey = state.activity === 'thinking' ? 'tutor_social:AI-14.thinking' : 'tutor_social:AI-14.listening';
    return (
      <Screen
        testID="AI-14"
        footer={
          <View style={styles.controls}>
            <IconButton icon={state.muted ? 'PauseCircle' : 'SpeakerHigh'} variant="filled" size={56} label={state.muted ? t('tutor_social:AI-14.unmute') : t('tutor_social:AI-14.mute')} onPress={() => session.setMuted(!state.muted)} testID="ai14-mute" />
            <IconButton icon="ChatCircleText" variant="filled" size={56} label={t('tutor_social:AI-14.switch_to_text')} onPress={() => void session.end('user').then(toText)} />
            <IconButton icon="X" variant="primary" size={56} label={t('tutor_social:AI-14.end')} onPress={() => void session.end('user')} testID="ai14-end" />
          </View>
        }
      >
        <Header onClose={() => void session.end('user')} />
        <View style={styles.hero}>
          <Illustration name={`${species}-thinking`} decorative width={200} height={200} />
          <View accessibilityLiveRegion="polite">
            <Text variant="heading" align="center" testID="ai14-state">
              {state.muted ? t('tutor_social:AI-14.muted_hint') : t(activity)}
            </Text>
          </View>
        </View>
      </Screen>
    );
  }

  if (state.kind === 'unavailable') {
    return <NotReady reason={state.reason} quota={state.quota} petName={petName} species={species} onText={toText} onClose={close} onRetry={() => void session.start()} />;
  }

  // AI-13: checking and connecting.
  const quota = state.kind === 'connecting' ? state.quota : null;
  return (
    <Screen testID="AI-13" footer={<Button variant="ghost" label={t('tutor_social:AI-13.cancel')} onPress={close} />}>
      <Header onClose={close} />
      <View style={styles.hero}>
        <Illustration name="scene-voice-tutor" fallback={[`${species}-wave`]} alt={t('tutor_social:AI-13.connecting', { pet_name: petName })} width={240} height={240} />
        <Spinner label={t('tutor_social:AI-13.connecting', { pet_name: petName })} />
        <Text variant="heading" align="center">
          {t('tutor_social:AI-13.connecting', { pet_name: petName })}
        </Text>
        {quota?.remaining_seconds != null ? <TimeLeft seconds={quota.remaining_seconds} /> : null}
      </View>
      {pet ? <PetLine pet={{ species, mood: 'happy' }} petName={petName} text={t('tutor_social:AI-13.tip')} /> : null}
    </Screen>
  );
}

const REASONS: Partial<Record<VoiceUnavailable, MessageKey>> = {
  pro_required: 'tutor_social:AI-13.pro_required',
  device: 'tutor_social:AI-13.needs_update',
  offline: 'tutor_social:AI-13.needs_internet',
  error: 'tutor_social:AI-13.error',
};

/** AI-13's "not ready" state: why, in words, and the way on in text. Never a dead end. */
function NotReady({ reason, quota, petName, species, onText, onClose, onRetry }: { reason: VoiceUnavailable; quota: VoiceQuota | null; petName: string; species: 'cat' | 'dog'; onText: () => void; onClose: () => void; onRetry: () => void }) {
  const app = useApp();
  const t = useT();
  const daily = reason === 'daily_limit';
  const body = daily ? t('tutor_social:AI-13.no_time_left', { reset_time: quota ? resetTime(app, quota) : '' }) : REASONS[reason] ? t(REASONS[reason]!, { pet_name: petName }) : t('tutor_social:AI-13.not_ready_body', { pet_name: petName });
  return (
    <Screen
      testID="AI-13"
      contentStyle={styles.fill}
      footer={
        <>
          <Button icon="ChatCircleText" label={t('tutor_social:AI-13.switch_to_text')} onPress={onText} testID="ai13-text" />
          {reason === 'pro_required' ? <Button variant="secondary" label={t('tutor_social:AI-13.see_pro')} onPress={() => router.push({ pathname: '/paywall', params: { from: 'voice' } } as unknown as Href)} testID="ai13-pro" /> : null}
          {reason === 'offline' || reason === 'error' ? <Button variant="secondary" label={t('tutor_social:AI-13.try_again')} onPress={onRetry} testID="ai13-retry" /> : null}
        </>
      }
    >
      <Header onClose={onClose} />
      <View style={[styles.hero, styles.centred]} accessibilityLiveRegion="polite">
        <Illustration name={`${species}-resting`} fallback={[`${species}-sleepy`]} decorative width={200} height={200} />
        <Text variant="title" heading align="center" testID="ai13-title">
          {daily ? t('tutor_social:AI-15.title_time_cap') : t('tutor_social:AI-13.not_ready_title')}
        </Text>
        <Text variant="body" tone="muted" align="center" testID="ai13-body">
          {body}
        </Text>
      </View>
    </Screen>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <View style={styles.header}>
      <IconButton icon="X" label={t('ui:common.close')} onPress={onClose} testID="voice-close" />
    </View>
  );
}

function TimeLeft({ seconds }: { seconds: number }) {
  const t = useT();
  return (
    <Stack row gap={6}>
      <Icon name="Timer" size={16} color="inkMuted" />
      <Text variant="caption" tone="muted" numeric>
        {t('tutor_social:AI-13.time_left', { n: Math.floor(seconds / 60) })}
      </Text>
    </Stack>
  );
}

function resetTime(app: ReturnType<typeof useApp>, quota: VoiceQuota): string {
  const locale = app.ui.getState().locale;
  return new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', { hour: 'numeric', minute: '2-digit', timeZone: app.deps.timeZone() }).format(new Date(quota.resets_at));
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row' },
  hero: { alignItems: 'center', gap: 12, paddingTop: 24 },
  fill: { flexGrow: 1 },
  centred: { flex: 1, justifyContent: 'center', paddingBottom: 48 },
  tiles: { flexDirection: 'row', gap: 12 },
  tile: { flex: 1 },
  controls: { flexDirection: 'row', justifyContent: 'space-around' },
});

