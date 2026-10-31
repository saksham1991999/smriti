import { Banner, Card, Dialog, EmptyState, Icon, IconButton, Spinner, Text, Toast } from '@smriti/ui-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp, useQueryScope, useT, useUiState } from '../src/services/context';
import { deleteTutorSession, listTutorSessions, type TutorSessionSummary } from '../src/services/tutor';
import { BackHeader, Screen } from '../src/ui/Screen';

const DAY = 86_400_000;

/**
 * AI-09, past tutor chats from `/v1/tutor/sessions`, grouped by day. Rows open the chat again;
 * delete asks first and then removes it on the server. Retention days come from the flag.
 */
export default function TutorHistory() {
  const app = useApp();
  const t = useT();
  const locale = useUiState((s) => s.locale);
  const scope = useQueryScope();
  const queries = useQueryClient();
  const key = ['smriti', 'tutor', 'history', scope];
  const list = useQuery({ queryKey: key, queryFn: () => listTutorSessions(app) });
  const [confirm, setConfirm] = useState<TutorSessionSummary | 'all' | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const retention = app.flags.get('ai.tutor_retention_days');
  const now = app.now();
  useEffect(() => app.track('ai_history_opened'), [app]);

  const label = (iso: string) => {
    const d = new Date(iso);
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    if (d.getTime() >= start.getTime()) return t('practice:PRC-16.today');
    if (d.getTime() >= start.getTime() - DAY) return t('practice:PRC-16.yesterday');
    return d.toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short' });
  };
  const groups = new Map<string, TutorSessionSummary[]>();
  for (const s of list.data ?? []) {
    const k = label(s.last_message_at ?? s.started_at);
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }

  const remove = async (target: TutorSessionSummary | 'all') => {
    setConfirm(null);
    const ids = target === 'all' ? (list.data ?? []).map((s) => s.id) : [target.id];
    try {
      for (const id of ids) await deleteTutorSession(app, id);
      app.track('ai_session_deleted');
    } catch {
      setToast(t('tutor_social:AI-02.server_error'));
    }
    void queries.invalidateQueries({ queryKey: key });
    void queries.invalidateQueries({ queryKey: ['smriti', 'tutor', 'session'] });
  };

  return (
    <Screen testID="AI-09">
      <BackHeader
        title={t('tutor_social:AI-09.title')}
        backLabel={t('ui:common.back')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/tutor' as Href))}
        trailing={list.data?.length ? <IconButton icon="Trash" label={t('tutor_social:AI-09.delete_all')} onPress={() => setConfirm('all')} testID="history-delete-all" /> : undefined}
      />
      {list.isPending ? <Spinner label={t('tutor_social:AI-09.title')} /> : null}
      {list.isError ? <Banner tone="warning" icon="Warning" text={t('tutor_social:AI-02.server_error')} action={{ label: t('tutor_social:AI-02.try_again'), onPress: () => void list.refetch() }} /> : null}
      {list.data && list.data.length === 0 ? <EmptyState illustration="ui-all-caught-up" alt="" text={t('tutor_social:AI-09.empty')} action={{ label: t('tutor_social:AI-02.send'), onPress: () => router.replace('/tutor' as Href) }} testID="tutor-history-empty" /> : null}
      {[...groups.entries()].map(([day, rows]) => (
        <View key={day} style={styles.gap}>
          <Text variant="heading">{day}</Text>
          {rows.map((s) => {
            const time = new Date(s.last_message_at ?? s.started_at).toLocaleTimeString(locale === 'hi' ? 'hi-IN' : 'en-IN', { hour: 'numeric', minute: '2-digit' });
            return (
              <Card key={s.id} outlined onPress={() => router.push({ pathname: '/tutor', params: { session: s.id } })} accessibilityLabel={`${t('tutor_social:AI-09.title')}, ${s.context_ref ?? ''}, ${time}`} testID={`tutor-session-${s.id}`}>
                <View style={styles.row}>
                  <Icon name="ChatCircleText" color="primary" />
                  <View style={styles.grow}>
                    <Text variant="label" numberOfLines={1}>
                      {s.context_ref ? app.conceptName(s.context_ref.replace(/^[a-z]+:/, '')) : t('tutor_social:AI-02.menu_new_chat')}
                    </Text>
                    <Text variant="caption" tone="muted" numeric>
                      {`${s.message_count} · ${time}`}
                    </Text>
                  </View>
                  <IconButton icon="Trash" label={t('tutor_social:AI-09.delete')} onPress={() => setConfirm(s)} testID={`tutor-delete-${s.id}`} />
                </View>
              </Card>
            );
          })}
        </View>
      ))}
      {typeof retention === 'number' ? (
        <Text variant="caption" tone="muted" align="center">
          {t('tutor_social:AI-09.retention_note', { retention_days: retention })}
        </Text>
      ) : null}
      <Dialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'all' ? t('tutor_social:AI-09.delete_all') : t('tutor_social:AI-09.delete')}
        description={t('tutor_social:AI-09.delete_confirm')}
        confirm={{ label: t('tutor_social:AI-09.delete'), destructive: true, onPress: () => confirm && void remove(confirm) }}
        cancel={{ label: t('practice:PRC-04.exit_keep_going'), onPress: () => setConfirm(null) }}
        testID="tutor-delete-dialog"
      />
      <Toast open={toast !== null} message={toast ?? ''} tone="error" onDismiss={() => setToast(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1 },
});
