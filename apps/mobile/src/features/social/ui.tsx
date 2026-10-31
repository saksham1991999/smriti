import type { MessageKey } from '@smriti/i18n';
import { Button, CheerButton, Illustration, Sheet, Text, Toast } from '@smriti/ui-native';
import type { IconName } from '@smriti/tokens/ui';
import { useQuery } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Platform, Share, StyleSheet, View } from 'react-native';

import { useApp, useT, useUiState } from '../../services/context';
import type { SmritiApp } from '../../services/app';
import { Stack } from '../../ui/Screen';
import { CHEER_PRESETS, loadGate, NUDGE_PRESETS, sendCheer, type Gate, type Person } from './services';

export const socialKeys = {
  gate: ['social', 'gate'] as const,
  overview: ['social', 'overview'] as const,
  all: ['social'] as const,
};

export function useGate() {
  const app = useApp();
  return useQuery({ queryKey: socialKeys.gate, queryFn: () => loadGate(app) });
}

/** The tier crest's Agnes illustration (`league-tier` preset): `league-01-seed` … `league-10-banyan`. */
export function crestFor(app: SmritiApp, tier: number): string {
  const names = app.flags.get('league.tier_names') as { en: string }[] | null;
  const slug = (names?.[tier - 1]?.en ?? 'seed').toLowerCase().replace(/[^a-z]+/g, '-');
  return `league-${String(tier).padStart(2, '0')}-${slug}`;
}

export const avatarOf = (p: Person) => ({ species: p.avatar?.species === 'dog' ? ('dog' as const) : ('cat' as const) });

/** SOC-02: the locked Friends states, chosen by the server's gate (R46, DPDP for minors). */
export function GatePanel({ gate }: { gate: Gate }) {
  const t = useT();
  const app = useApp();
  const [why, setWhy] = useState(false);
  const copy: Record<string, { title: MessageKey; body: MessageKey; cta: MessageKey; go: Href; why?: { link: MessageKey; sheet: MessageKey } }> = {
    guest: { title: 'tutor_social:SOC-02.guest_title', body: 'tutor_social:SOC-02.guest_body', cta: 'tutor_social:SOC-02.guest_cta', go: '/sign-in', why: { link: 'tutor_social:SOC-02.guest_why_link', sheet: 'tutor_social:SOC-02.guest_why_sheet' } },
    minor_no_consent: { title: 'tutor_social:SOC-02.teen_title', body: 'tutor_social:SOC-02.teen_body', cta: 'tutor_social:SOC-02.teen_cta', go: '/grown-ups', why: { link: 'tutor_social:SOC-02.teen_why_link', sheet: 'tutor_social:SOC-02.teen_why_sheet' } },
    consent_pending: { title: 'tutor_social:SOC-02.pending_title', body: 'tutor_social:SOC-02.pending_body', cta: 'tutor_social:SOC-02.pending_secondary', go: '/grown-ups' },
    consent_revoked: { title: 'tutor_social:SOC-02.revoked_title', body: 'tutor_social:SOC-02.revoked_body', cta: 'tutor_social:SOC-02.revoked_cta', go: '/grown-ups' },
    parent_off: { title: 'tutor_social:SOC-02.revoked_title', body: 'tutor_social:SOC-02.revoked_body', cta: 'tutor_social:SOC-02.revoked_cta', go: '/grown-ups' },
    u13_no_scope: { title: 'tutor_social:SOC-02.under_13_title', body: 'tutor_social:SOC-02.under_13_body', cta: 'tutor_social:SOC-02.under_13_cta', go: '/grown-ups' },
    little_learner: { title: 'tutor_social:SOC-02.under_13_title', body: 'tutor_social:SOC-02.under_13_body', cta: 'tutor_social:SOC-02.under_13_cta', go: '/grown-ups' },
  };
  const c = copy[gate.state] ?? copy.guest!;
  const xp = app.store.getState().wallet?.xp_total ?? 0;
  return (
    <Stack gap={16}>
      <View testID="SOC-02" accessibilityLiveRegion="polite" style={styles.centre}>
        <Illustration name="scene-friends-locked" fallback={[app.store.getState().pet?.species === 'dog' ? 'dog-wave' : 'cat-wave']} decorative width={200} height={200} />
        <Text variant="title" heading align="center" testID="soc02-title">
          {t(c.title)}
        </Text>
      </View>
      <Text variant="body" align="center" testID="soc02-body">
        {t(c.body)}
      </Text>
      {gate.state === 'guest' ? (
        <>
          {xp > 0 ? (
            <Text variant="caption" tone="muted" align="center" numeric>
              {t('tutor_social:SOC-02.real_data_line_guest', { xp })}
            </Text>
          ) : null}
          <Stack gap={6}>
            {(['what_you_get.1', 'what_you_get.2', 'what_you_get.3'] as const).map((k) => (
              <Text key={k} variant="body">{`• ${t(`tutor_social:SOC-02.${k}`)}`}</Text>
            ))}
          </Stack>
        </>
      ) : null}
      <Button label={t(c.cta)} onPress={() => router.push(c.go)} testID="soc02-cta" />
      {gate.state === 'guest' ? (
        <Text variant="caption" tone="muted" align="center">
          {t('tutor_social:SOC-02.trust_line_r40')}
        </Text>
      ) : null}
      {c.why ? <Button variant="ghost" label={t(c.why.link)} onPress={() => setWhy(true)} testID="soc02-why" /> : null}
      {c.why ? (
        <Sheet open={why} onOpenChange={setWhy} title={t(c.why.link)}>
          <Text variant="body">{t(c.why.sheet)}</Text>
        </Sheet>
      ) : null}
    </Stack>
  );
}

const CHEER_ICONS: IconName[] = ['HandsClapping', 'Plant', 'Star', 'Lightning', 'Sparkle', 'Plant'];

/**
 * SOC-22: preset cheers or nudges only, never free text (AGENTS rule 6). `send` defaults to
 * `/v1/social/nudges`; a Duo nudge passes its own sender.
 */
export function CheerSheet({ open, onClose, to, name, kind = 'cheer', send }: { open: boolean; onClose: () => void; to: string; name: string; kind?: 'cheer' | 'nudge'; send?: (preset: string) => Promise<'sent' | 'limit'> }) {
  const app = useApp();
  const t = useT();
  const [sent, setSent] = useState<string | null>(null);
  const [limit, setLimit] = useState(false);
  const presets = kind === 'cheer' ? CHEER_PRESETS : NUDGE_PRESETS;
  const go = async (preset: string) => {
    const out = await (send ? send(preset) : sendCheer(app, to, kind, preset)).catch(() => 'limit' as const);
    // The server records the cheer; the analytics catalogue has no cheer event of its own.
    if (out === 'sent') setSent(preset);
    else setLimit(true);
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setSent(null);
          setLimit(false);
          onClose();
        }
      }}
      title={kind === 'cheer' ? t('tutor_social:SOC-22.title') : t('tutor_social:SOC-22.nudge_title', { name })}
      testID="SOC-22"
    >
      <Stack gap={8}>
        {presets.map((p, i) => (
          <CheerButton key={p} kind="message" icon={CHEER_ICONS[i] ?? 'Sparkle'} label={t(`tutor_social:SOC-22.${p}` as MessageKey)} sent={sent === p} disabled={sent !== null || limit} onPress={() => void go(p)} testID={`soc22-${p}`} />
        ))}
        <View accessibilityLiveRegion="polite">
          {sent ? (
            <Text variant="label" tone="success" testID="soc22-sent">
              {t('tutor_social:SOC-22.sent')}
            </Text>
          ) : null}
          {limit ? (
            <Text variant="label" tone="muted" testID="soc22-limit">
              {t('tutor_social:SOC-22.limit', { name })}
            </Text>
          ) : null}
        </View>
      </Stack>
    </Sheet>
  );
}

/** Share a link through the OS sheet (native), or copy it (web, where sharing isn't everywhere). */
export async function shareOrCopy(message: string, link: string): Promise<'shared' | 'copied' | 'failed'> {
  if (Platform.OS === 'web') {
    const nav = (globalThis as { navigator?: { clipboard?: { writeText(s: string): Promise<void> } } }).navigator;
    if (nav?.clipboard) {
      await nav.clipboard.writeText(link).catch(() => undefined);
      return 'copied';
    }
    return 'failed';
  }
  const r = await Share.share({ message }).catch(() => null);
  return r ? 'shared' : 'failed';
}

export function SocialToast({ message, onDismiss, testID = 'social-toast' }: { message: string | null; onDismiss: () => void; testID?: string }) {
  return <Toast open={message !== null} message={message ?? ''} icon="CheckCircle" onDismiss={onDismiss} testID={testID} />;
}

export function useLocale() {
  return useUiState((s) => s.locale);
}

export const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  centre: { alignItems: 'center', gap: 12 },
});
