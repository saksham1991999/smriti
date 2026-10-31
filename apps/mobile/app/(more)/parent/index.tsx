import { useStoreSelector } from '@smriti/app-core/react';
import { Banner, Button, Card, Chip, EmptyState, PetAvatar, SettingsGroup, SettingsRow, Text, Toast, TopBar, useTheme } from '@smriti/ui-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { decideTimeRequest, loadControls, loadDashboard, loadReport, saveControls, toControls, type ChildCard } from '../../../src/features/parent/services';
import { parentSession } from '../../../src/features/parent/session';
import { MinuteBars, ParentOnly } from '../../../src/features/parent/ui';
import { useApp, useT } from '../../../src/services/context';
import { Screen, Stack } from '../../../src/ui/Screen';

/** SET-14, the parent dashboard: Needs you, one card per child, and the settings rows. */
export default function ParentDashboard() {
  return (
    <ParentOnly>
      <Dashboard />
    </ParentOnly>
  );
}

function Dashboard() {
  const app = useApp();
  const t = useT();
  const qc = useQueryClient();
  const session = parentSession(app);
  const pinSet = useStoreSelector(session.store, (s) => s.pinSet);
  const online = app.deps.network.isOnline();
  const dash = useQuery({ queryKey: ['parent', 'dashboard'], queryFn: () => loadDashboard(app) });
  const [toast, setToast] = useState<string | null>(null);
  const learners = dash.data?.learners ?? [];
  const requests = learners.flatMap((l) => (l.time_requests ?? []).filter((r) => r.status === 'pending').map((r) => ({ r, child: l })));

  const decide = async (id: string, allow: boolean, child: string) => {
    await decideTimeRequest(app, id, allow);
    setToast(allow ? t('me_money:SET-14.allowed_toast', { child }) : t('me_money:SET-14.declined_toast', { child }));
    await qc.invalidateQueries({ queryKey: ['parent'] });
  };

  const exit = () => {
    session.exit();
    router.replace('/learn');
  };

  return (
    <Screen testID="SET-14" contentStyle={styles.content}>
      <TopBar title={t('me_money:SET-14.title')} trailing={<Button variant="ghost" size="sm" label={t('me_money:SET-14.exit')} onPress={exit} testID="set14-exit" />} />
      {!online ? <Banner tone="offline" icon="WifiSlash" text={t('me_money:SET-16.offline')} /> : null}
      {dash.isError ? <Banner tone="warning" icon="Warning" text={t('me_money:SET-16.offline')} action={{ label: t('ui:common.back'), onPress: () => void dash.refetch() }} /> : null}

      {requests.length ? (
        <View accessibilityLiveRegion="polite">
          <Card tone="tint" testID="set14-needs-you">
            <Stack gap={12}>
              <Text variant="heading">{t('me_money:SET-14.needs_you')}</Text>
              {requests.map(({ r, child }) => (
                <Stack key={r.id} gap={8}>
                  <Text variant="body">{t('me_money:SET-14.time_request', { child: child.first_name })}</Text>
                  <Stack row gap={8}>
                    <Button size="sm" label={t('me_money:SET-14.allow')} icon="Check" disabled={!online} onPress={() => void decide(r.id, true, child.first_name ?? '')} testID={`set14-allow-${r.id}`} />
                    <Button size="sm" variant="secondary" label={t('me_money:SET-14.not_today')} disabled={!online} onPress={() => void decide(r.id, false, child.first_name ?? '')} testID={`set14-decline-${r.id}`} />
                  </Stack>
                </Stack>
              ))}
            </Stack>
          </Card>
        </View>
      ) : null}

      {dash.data && learners.length === 0 ? <EmptyState pet={{ species: 'cat', mood: 'curious' }} text={t('me_money:SET-14.empty')} testID="set14-empty" /> : null}
      {learners.map((c) => (
        <ChildCardView key={c.user_id} child={c} online={online} />
      ))}

      <SettingsGroup>
        <SettingsRow title={t('me_money:SET-14.pin')} icon="LockSimple" value={pinSet ? t('ui:common.on') : t('ui:common.off')} onPress={() => router.push({ pathname: '/grown-ups', params: { set: 'pin' } })} testID="set14-pin" />
      </SettingsGroup>
      <Toast open={toast !== null} message={toast ?? ''} icon="CheckCircle" onDismiss={() => setToast(null)} testID="set14-toast" />
    </Screen>
  );
}

function ChildCardView({ child, online }: { child: ChildCard; online: boolean }) {
  const app = useApp();
  const t = useT();
  const theme = useTheme();
  const qc = useQueryClient();
  const report = useQuery({ queryKey: ['parent', 'report', child.user_id, 'current'], queryFn: () => loadReport(app, child.user_id) });
  const controls = useQuery({ queryKey: ['parent', 'controls', child.user_id], queryFn: () => loadControls(app, child.user_id) });
  const little = child.age_band === 'u10';
  const set = async (patch: Partial<ReturnType<typeof toControls>>) => {
    if (!controls.data) return;
    await saveControls(app, child.user_id, { ...toControls(controls.data), ...patch });
    await qc.invalidateQueries({ queryKey: ['parent', 'controls', child.user_id] });
  };
  const practice = child.last_mock
    ? t('me_money:SET-14.practice_line', { q: child.practice_questions, score: `${child.last_mock.score}/${child.last_mock.max_score}` })
    : t('me_money:SET-14.practice_line.1', { q: child.practice_questions });
  const c = controls.data;
  return (
    <Stack gap={12}>
      <Card size="lg" testID={`set14-child-${child.user_id}`}>
        <Stack gap={12}>
          <Stack row gap={12}>
            {child.pet ? <PetAvatar species={child.pet.species === 'dog' ? 'dog' : 'cat'} size={56} alt={child.pet.name} /> : null}
            <View style={styles.grow}>
              <Text variant="heading">{child.first_name}</Text>
              <Text variant="caption" tone="muted">
                {t('me_money:SET-14.streak', { n: child.streak })}
              </Text>
            </View>
            {child.is_pro ? <Chip label="Pro" tone="primary" /> : null}
          </Stack>
          <Text variant="title" numeric testID="set14-week-minutes">
            {t('me_money:SET-14.minutes', { n: child.week_minutes })}
          </Text>
          {report.data ? <MinuteBars days={report.data.days} testID="set14-bars" /> : <View style={{ height: 88, backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.sm }} />}
          <Text variant="caption" tone="muted">
            {practice}
          </Text>
          <View style={styles.actions}>
            <Button size="sm" variant="secondary" label={t('me_money:SET-14.weekly_report')} icon="TrendUp" onPress={() => router.push({ pathname: '/parent/report/[id]', params: { id: child.user_id } })} testID="set14-report" />
            <Button size="sm" variant="secondary" label={t('me_money:SET-14.time_limits')} icon="Timer" onPress={() => router.push({ pathname: '/parent/limits/[id]', params: { id: child.user_id } })} testID="set14-limits" />
          </View>
        </Stack>
      </Card>
      {c ? (
        <SettingsGroup title={child.first_name ?? undefined}>
          <SettingsRow title={t('me_money:SET-14.weekly_email')} icon="Bell" trailing="switch" checked={c.weekly_report} disabled={!online} onCheckedChange={(v) => void set({ weekly_report: v })} testID="set14-weekly-email" />
          <SettingsRow title={t('me_money:SET-14.ask_before_switching')} icon="UsersThree" trailing="switch" checked={c.ask_before_switching} disabled={!online} onCheckedChange={(v) => void set({ ask_before_switching: v })} testID="set14-ask-switch" />
          {little ? (
            <>
              <SettingsRow title={t('me_money:SET-14.picture_rhymes', { child: child.first_name ?? '' })} icon="Sparkle" trailing="switch" checked={c.picture_rhymes} disabled={!online} onCheckedChange={(v) => void set({ picture_rhymes: v })} testID="set14-rhymes" />
              <SettingsRow title={t('me_money:SET-14.tutor_button', { child: child.first_name ?? '' })} icon="ChatCircleText" trailing="switch" checked={c.tutor_button} disabled={!online} onCheckedChange={(v) => void set({ tutor_button: v })} testID="set14-tutor" />
            </>
          ) : null}
        </SettingsGroup>
      ) : null}
    </Stack>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, maxWidth: 720, width: '100%', alignSelf: 'center' },
  grow: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
