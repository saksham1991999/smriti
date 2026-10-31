import { Banner, Button, Card, ChoiceChips, Switch, Text } from '@smriti/ui-native';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';

import { Field } from '../../../../src/features/shared/Field';
import { createSquad, joinSquad, previewSquad } from '../../../../src/features/social/services';
import { socialKeys } from '../../../../src/features/social/ui';
import { examName } from '../../../../src/services/exams';
import { useApp, useT } from '../../../../src/services/context';
import { BackHeader, Screen, Stack } from '../../../../src/ui/Screen';

type Preview = Awaited<ReturnType<typeof previewSquad>>;

/** SOC-13, create or join a squad. The server names a new squad from the config word list. */
export default function Squads() {
  const app = useApp();
  const t = useT();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<'create' | 'join'>(params.tab === 'join' ? 'join' : 'create');
  const [examOnly, setExamOnly] = useState(true);
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const exam = examName(app, app.examProfileId());
  const max = Number(app.flags.get('social.squad_max_members') ?? 20);
  const minor = app.store.getState().profile?.age_band !== '18p';

  const create = async () => {
    setBusy(true);
    try {
      const s = await createSquad(app, examOnly);
      await qc.invalidateQueries({ queryKey: socialKeys.all });
      router.replace({ pathname: '/social/squads/[id]', params: { id: s.id, created: '1' } } as unknown as Href);
    } catch {
      setError(t('tutor_social:SOC-15.offline'));
    }
    setBusy(false);
  };

  const look = async () => {
    setError(null);
    const p = await previewSquad(app, code.trim().toUpperCase()).catch(() => null);
    if (!p) return setError(t('tutor_social:SOC-04.link_invalid'));
    if (p.already_member) return router.replace(`/social/squads/${p.id}` as Href);
    if (p.member_count >= p.max_members) return setError(t('tutor_social:SOC-13.full'));
    setPreview(p);
  };

  const join = async () => {
    if (!preview) return;
    const s = await joinSquad(app, code.trim().toUpperCase()).catch(() => null);
    if (!s) return setError(t('tutor_social:SOC-13.too_many_squads', { n: Number(app.flags.get('social.squads_per_user') ?? 3) }));
    await qc.invalidateQueries({ queryKey: socialKeys.all });
    router.replace(`/social/squads/${s.id}` as Href);
  };

  return (
    <Screen
      testID="SOC-13"
      footer={
        tab === 'create' ? (
          <Button label={t('tutor_social:SOC-13.create')} loading={busy} onPress={() => void create()} testID="soc13-create" />
        ) : preview ? (
          <Button label={t('tutor_social:SOC-13.join')} onPress={() => void join()} testID="soc13-join" />
        ) : (
          <Button label={t('tutor_social:SOC-13.enter_code')} disabled={!code.trim()} onPress={() => void look()} testID="soc13-look" />
        )
      }
    >
      <BackHeader title={t('tutor_social:SOC-01.squads')} backLabel={t('ui:common.back')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/friends' as Href))} />
      <ChoiceChips
        label={t('tutor_social:SOC-01.squads')}
        hideLabel
        options={[
          { value: 'create', label: t('tutor_social:SOC-13.tabs.1') },
          { value: 'join', label: t('tutor_social:SOC-13.tabs.2') },
        ]}
        value={[tab]}
        onChange={(v) => {
          setTab(v[0] === 'join' ? 'join' : 'create');
          setError(null);
        }}
        testID="soc13-tabs"
      />
      {error ? <Banner tone="warning" icon="Warning" text={error} testID="soc13-error" /> : null}
      {tab === 'create' ? (
        <Card>
          <Stack gap={12}>
            <Text variant="body">{t('tutor_social:SOC-13.size_line', { max })}</Text>
            {exam ? <Switch label={t('tutor_social:SOC-13.exam_toggle', { exam })} checked={examOnly} onCheckedChange={setExamOnly} testID="soc13-exam" /> : null}
          </Stack>
        </Card>
      ) : (
        <Card>
          <Stack gap={12}>
            {minor ? <Text variant="caption" tone="muted">{t('tutor_social:SOC-13.minor_join_note')}</Text> : null}
            <Field
              label={t('tutor_social:SOC-13.enter_code')}
              value={code}
              autoCapitalize="characters"
              onChangeText={(v) => {
                setCode(v);
                setPreview(null);
              }}
              testID="soc13-code"
            />
            {preview ? (
              <Stack gap={4}>
                <Text variant="heading" testID="soc13-preview">
                  {t('tutor_social:SOC-13.join_confirm', { squad_name: preview.name })}
                </Text>
                <Text variant="caption" tone="muted" numeric>
                  {t('tutor_social:SOC-13.members_line', { n: preview.member_count, max: preview.max_members })}
                </Text>
              </Stack>
            ) : null}
          </Stack>
        </Card>
      )}
    </Screen>
  );
}
