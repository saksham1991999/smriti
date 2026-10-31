import { Banner, Button, Card, ChoiceChips, Icon, Picker, Switch, Text } from '@smriti/ui-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { loadControls, loadDashboard, saveControls, toControls, type Controls, type DailyLimit } from '../../../../src/features/parent/services';
import { parentSession } from '../../../../src/features/parent/session';
import { ParentOnly } from '../../../../src/features/parent/ui';
import { useApp, useT } from '../../../../src/services/context';
import { BackHeader, Screen, Stack } from '../../../../src/ui/Screen';

/** Half-hour steps for the allowed hours (SET-16). */
const TIMES = Array.from({ length: 36 }, (_, i) => {
  const m = 6 * 60 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});

/** SET-16, time limits for one child. Enforced on the child's device, offline too. */
export default function TimeLimitsScreen() {
  return (
    <ParentOnly>
      <Limits />
    </ParentOnly>
  );
}

function Limits() {
  const app = useApp();
  const t = useT();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const controls = useQuery({ queryKey: ['parent', 'controls', id], queryFn: () => loadControls(app, id) });
  const dash = useQuery({ queryKey: ['parent', 'dashboard'], queryFn: () => loadDashboard(app) });
  const name = dash.data?.learners.find((l) => l.user_id === id)?.first_name ?? '';
  const [draft, setDraft] = useState<Controls | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const online = app.deps.network.isOnline();
  const options = app.flags.get('parent.time_limit_options');

  useEffect(() => {
    if (controls.data && !draft) setDraft(toControls(controls.data));
  }, [controls.data, draft]);

  const patch = (p: Partial<Controls>) => {
    setSaved(false);
    setDraft((d) => (d ? { ...d, ...p } : d));
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await saveControls(app, id, draft);
      app.track('parent_limit_changed', { limit_type: 'daily_limit', value_bucket: String(draft.daily_limit_min ?? 0) });
      setSaved(true);
      await qc.invalidateQueries({ queryKey: ['parent'] });
    } finally {
      setBusy(false);
    }
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace('/parent'));
  const hours = draft?.allowed_from != null && draft?.allowed_to != null;
  const here = id === app.store.getState().session.userId && parentSession(app).mode() === 'separate';
  const timeOptions = TIMES.map((v) => ({ value: v, label: v }));

  return (
    <Screen
      testID="SET-16"
      contentStyle={styles.content}
      footer={<Button label={t('me_money:SET-16.save')} disabled={!draft || !online || busy} loading={busy} onPress={() => void save()} fullWidth testID="set16-save" />}
    >
      <BackHeader title={t('me_money:SET-16.title', { child: name })} backLabel={t('ui:common.back')} onBack={back} />
      {!online ? <Banner tone="offline" icon="WifiSlash" text={t('me_money:SET-16.offline')} /> : null}
      {draft ? (
        <Stack gap={20}>
          <ChoiceChips
            label={t('me_money:SET-16.daily_limit')}
            options={options.map((n) => ({ value: String(n), label: n === 0 ? t('me_money:SET-16.off') : t('me_money:SET-16.chip_minutes_a11y', { n }) }))}
            value={[String(draft.daily_limit_min ?? 0)]}
            onChange={(v) => {
              const n = Number(v[0] ?? 0);
              patch({ daily_limit_min: n === 0 ? null : (n as DailyLimit) });
            }}
            testID="set16-limit"
          />
          <Card outlined>
            <Stack gap={12}>
              <Switch label={t('me_money:SET-16.allowed_hours')} checked={hours} onCheckedChange={(on) => patch(on ? { allowed_from: '16:00', allowed_to: '20:00' } : { allowed_from: null, allowed_to: null })} testID="set16-hours" />
              {hours ? (
                <View style={styles.times}>
                  <View style={styles.grow}>
                    <Picker label={t('me_money:SET-16.from')} options={timeOptions} value={draft.allowed_from?.slice(0, 5) ?? null} onChange={(v) => patch({ allowed_from: v })} testID="set16-from" />
                  </View>
                  <View style={styles.grow}>
                    <Picker label={t('me_money:SET-16.to')} options={timeOptions} value={draft.allowed_to?.slice(0, 5) ?? null} onChange={(v) => patch({ allowed_to: v })} testID="set16-to" />
                  </View>
                </View>
              ) : null}
            </Stack>
          </Card>
          <Switch label={t('me_money:SET-16.breaks', { child: name })} checked={draft.break_reminders} onCheckedChange={(v) => patch({ break_reminders: v })} testID="set16-breaks" />
          <Stack row gap={8}>
            <Icon name="Info" size={20} color="inkMuted" />
            <Text variant="caption" tone="muted" style={styles.grow}>
              {t('me_money:SET-16.note')}
            </Text>
          </Stack>
          {saved ? (
            <View accessibilityLiveRegion="polite">
              <Stack row gap={8}>
                <Icon name="CheckCircle" size={20} color="success" weight="fill" />
                <Text variant="body" tone="success" style={styles.grow} testID="set16-saved">
                  {here ? t('me_money:SET-16.saved_here') : t('me_money:SET-16.saved', { child: name })}
                </Text>
              </Stack>
            </View>
          ) : null}
        </Stack>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, maxWidth: 720, width: '100%', alignSelf: 'center' },
  times: { flexDirection: 'row', gap: 12 },
  grow: { flex: 1 },
});
