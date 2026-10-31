import { Banner, Button, Card, FriendRow, Text } from '@smriti/ui-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Field } from '../../../src/features/shared/Field';
import { acceptInvite, inviteLink, loadInvite, personName, requestFriend, searchHandle, type Person } from '../../../src/features/social/services';
import { avatarOf, shareOrCopy, SocialToast, socialKeys, useGate } from '../../../src/features/social/ui';
import { useApp, useT } from '../../../src/services/context';
import { BackHeader, Screen, Stack } from '../../../src/ui/Screen';

/**
 * SOC-04, add friends: share my invite link, add a friend's code, or find a username. We never
 * read contacts. QR codes (SOC-05) need a QR library and the camera module, which this build
 * doesn't include, so the link and the short code carry the invite.
 */
export default function AddFriends() {
  const app = useApp();
  const t = useT();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ code?: string }>();
  const gate = useGate();
  const invite = useQuery({ queryKey: ['social', 'invite'], queryFn: () => loadInvite(app) });
  const [code, setCode] = useState(params.code ?? '');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [handle, setHandle] = useState('');
  const [found, setFound] = useState<Person | null | 'none'>(null);
  const [requested, setRequested] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const minor = app.store.getState().profile?.age_band !== '18p';
  const canSearch = gate.data?.features?.includes('search') ?? false;
  const link = invite.data ? inviteLink(app, invite.data.path) : null;

  const share = async () => {
    if (!link) return;
    const out = await shareOrCopy(t('tutor_social:SOC-04.share_message', { app_name: app.appName(), link }), link);
    if (out !== 'failed') app.track('friend_add_method', { method: 'invite_share' });
    if (out === 'copied') setCopied(true);
  };

  const addCode = async (raw = code) => {
    const c = raw.trim().toUpperCase();
    if (!c) return;
    setCodeError(null);
    const out = await acceptInvite(app, c).catch(() => 'invalid' as const);
    if (out === 'invalid') return setCodeError(t('tutor_social:SOC-04.link_invalid'));
    if (out === 'self') return setCodeError(t('tutor_social:SOC-04.own_link'));
    if (out === 'already_friends') return setCodeError(t('tutor_social:SOC-04.already_friends'));
    app.track('friend_add_method', { method: 'invite_open' });
    setCode('');
    setToast(t('tutor_social:SOC-04.added_toast', { name: personName(out.person, t) }));
    await qc.invalidateQueries({ queryKey: socialKeys.all });
  };

  useEffect(() => {
    // A /f/{code} link opened the app here: offer the add at once.
    if (params.code) void addCode(params.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.code]);

  const search = async () => {
    setRequested(false);
    const p = await searchHandle(app, handle.trim()).catch(() => null);
    setFound(p ?? 'none');
    app.track('friend_search_result', { found: Boolean(p) });
  };

  const request = async (p: Person) => {
    if (!p.user_id) return;
    await requestFriend(app, p.user_id, 'search');
    app.track('friend_request_sent', { method: 'username_search' });
    setRequested(true);
  };

  return (
    <Screen testID="SOC-04">
      <BackHeader title={t('tutor_social:SOC-04.title')} backLabel={t('ui:common.back')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/friends'))} />
      {minor ? <Banner tone="info" icon="ShieldCheck" text={t('tutor_social:SOC-04.safety_line_minors')} /> : null}

      <Card size="lg">
        <Stack gap={12}>
          <Text variant="heading">{t('tutor_social:SOC-04.invite_heading')}</Text>
          {invite.data ? (
            <View accessible accessibilityLabel={`${t('tutor_social:SOC-04.code_field')}: ${invite.data.code.split('').join(' ')}`}>
              <Text variant="display" numeric align="center" testID="soc04-my-code">
                {invite.data.code}
              </Text>
              <Text variant="caption" tone="muted" align="center" numberOfLines={1}>
                {link}
              </Text>
            </View>
          ) : null}
          <View style={styles.wrap}>
            <Button icon="PaperPlaneRight" label={copied ? t('tutor_social:SOC-04.copied') : t('tutor_social:SOC-04.share_link')} disabled={!link} onPress={() => void share()} testID="soc04-share" />
          </View>
        </Stack>
      </Card>

      <Card>
        <Stack gap={12}>
          <Text variant="heading">{t('tutor_social:SOC-04.code_heading')}</Text>
          <Field label={t('tutor_social:SOC-04.code_field')} value={code} onChangeText={setCode} autoCapitalize="characters" error={codeError} testID="soc04-code" />
          <Button variant="secondary" label={t('tutor_social:SOC-04.code_add')} disabled={!code.trim()} onPress={() => void addCode()} testID="soc04-code-add" />
        </Stack>
      </Card>

      {canSearch ? (
        <Card>
          <Stack gap={12}>
            <Text variant="heading">{t('tutor_social:SOC-04.find_heading')}</Text>
            <Field label={t('tutor_social:SOC-04.find_heading')} hideLabel value={handle} onChangeText={setHandle} autoCapitalize="none" testID="soc04-handle" />
            <Button variant="secondary" icon="MagnifyingGlass" label={t('tutor_social:SOC-04.search')} disabled={!handle.trim()} onPress={() => void search()} testID="soc04-search" />
            <View accessibilityLiveRegion="polite">
              {found === 'none' ? (
                <Text variant="body" tone="muted" testID="soc04-not-found">
                  {t('tutor_social:SOC-04.not_found')}
                </Text>
              ) : found ? (
                <Stack gap={8}>
                  <FriendRow name={personName(found, t)} avatar={avatarOf(found)} />
                  {found.can_add_friend ? (
                    <Button size="sm" label={requested ? t('tutor_social:SOC-04.request_sent') : t('tutor_social:SOC-04.add_friend')} disabled={requested} onPress={() => void request(found)} testID="soc04-request" />
                  ) : (
                    <Text variant="caption" tone="muted">
                      {t('tutor_social:SOC-04.already_friends')}
                    </Text>
                  )}
                </Stack>
              ) : null}
            </View>
          </Stack>
        </Card>
      ) : null}

      <Text variant="caption" tone="muted" align="center">
        {t('tutor_social:SOC-04.privacy')}
      </Text>
      <SocialToast message={toast} onDismiss={() => setToast(null)} testID="soc04-toast" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
});
