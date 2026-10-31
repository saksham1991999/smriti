import { Button, Sheet, Spinner, Text } from '@smriti/ui-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Linking, StyleSheet, View } from 'react-native';

import { useApp, useQueryScope, useT } from '../services/context';
import { drillKeys, fetchPyqPaper, sourceHost } from '../services/drill';
import { examName } from '../services/exams';

/** PRC-18: where a PYQ is from, with its official source. Nothing here is typed by us. */
export function PyqSourceSheet({ paperId, number, onClose }: { paperId: string | null; number?: number | null; onClose: () => void }) {
  const app = useApp();
  const t = useT();
  const scope = useQueryScope();
  const paper = useQuery({ queryKey: drillKeys.paper(scope, paperId ?? ''), queryFn: () => fetchPyqPaper(app, paperId!), enabled: paperId !== null });
  const p = paper.data;
  const rows: [string, string | null | undefined][] = p
    ? [
        [t('practice:PRC-18.exam'), examName(app, p.exam_id) ?? p.exam_id],
        [t('practice:PRC-18.year'), String(p.year)],
        [t('practice:PRC-18.session'), p.session_label],
        [t('practice:PRC-18.held_on'), p.held_on],
        [t('practice:PRC-18.question_number'), number ? String(number) : null],
        [t('practice:PRC-18.source'), sourceHost(p.source_url)],
      ]
    : [];
  return (
    <Sheet open={paperId !== null} onOpenChange={(o) => !o && onClose()} title={t('practice:PRC-18.title')} height="60" testID="PRC-18">
      {paper.isPending ? <Spinner label={t('practice:PRC-18.title')} /> : null}
      {p ? (
        <View style={styles.gap}>
          {rows
            .filter(([, v]) => Boolean(v))
            .map(([k, v]) => (
              <View key={k} style={styles.row}>
                <Text variant="caption" tone="muted" style={styles.key}>
                  {k}
                </Text>
                <Text variant="body" style={styles.grow}>
                  {v}
                </Text>
              </View>
            ))}
          <Text variant="caption" tone="muted">
            {t('practice:PRC-18.note', { brand: app.appName() })}
          </Text>
          {p.source_url ? <Button variant="secondary" icon="ShieldCheck" label={t('practice:PRC-18.open_source')} onPress={() => void Linking.openURL(p.source_url!)} testID="source-open" /> : null}
          <Button
            variant="ghost"
            label={t('practice:PRC-18.whole_paper')}
            onPress={() => {
              onClose();
              router.push({ pathname: '/pyq-paper/[id]', params: { id: p.id } });
            }}
          />
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 10 },
  row: { flexDirection: 'row', gap: 12 },
  key: { width: 120 },
  grow: { flex: 1 },
});
