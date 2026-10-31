import { Button, Card, ChoiceChips, EmptyState, Spinner, Text } from '@smriti/ui-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { copyDeck, loadSharedDecks, markHelpful, type SharedDeck } from '../../../src/features/social/services';
import { SocialToast } from '../../../src/features/social/ui';
import { useApp, useT } from '../../../src/services/context';
import { examName } from '../../../src/services/exams';
import { BackHeader, Screen, Stack } from '../../../src/ui/Screen';

/** SOC-21, shared decks from friends or for this exam: add a copy, or mark one helpful. */
export default function SharedDecks() {
  const app = useApp();
  const t = useT();
  const qc = useQueryClient();
  const [scope, setScope] = useState<'friends' | 'exam'>('friends');
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState<Record<string, boolean>>({});
  const decks = useQuery({ queryKey: ['social', 'decks', scope], queryFn: () => loadSharedDecks(app, scope) });
  const exam = examName(app, app.examProfileId()) ?? '';

  const add = async (d: SharedDeck) => {
    const out = await copyDeck(app, d.code);
    app.track('shared_deck_copied', { card_count: out.cards.length, scope, entry: 'list' });
    setCopied((c) => ({ ...c, [d.code]: true }));
    setToast(t('tutor_social:SOC-21.added_toast'));
  };

  const helpful = async (d: SharedDeck) => {
    await markHelpful(app, d.code);
    app.track('shared_deck_helpful', { on: true, scope, entry: 'list' });
    await qc.invalidateQueries({ queryKey: ['social', 'decks', scope] });
  };

  const rows = decks.data ?? [];
  return (
    <Screen testID="SOC-21">
      <BackHeader title={t('tutor_social:SOC-21.title')} backLabel={t('ui:common.back')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/friends' as Href))} />
      <ChoiceChips
        label={t('tutor_social:SOC-21.title')}
        hideLabel
        options={[
          { value: 'friends', label: t('tutor_social:SOC-21.scopes.1') },
          { value: 'exam', label: t('tutor_social:SOC-21.scopes.2', { exam }) },
        ]}
        value={[scope]}
        onChange={(v) => setScope(v[0] === 'exam' ? 'exam' : 'friends')}
        testID="soc21-scope"
      />
      <Text variant="caption" tone="muted">
        {t('tutor_social:SOC-21.disclaimer')}
      </Text>
      {decks.isPending ? <Spinner label={t('tutor_social:SOC-21.title')} /> : null}
      {decks.data && rows.length === 0 ? (
        <EmptyState illustration="ui-search-empty" text={t('tutor_social:SOC-21.empty_friends')} action={{ label: t('tutor_social:SOC-21.empty_action'), onPress: () => router.push('/memory' as Href) }} testID="soc21-empty" />
      ) : null}
      {rows.map((d) => (
        <Card key={d.code} testID={`soc21-deck-${d.code}`}>
          <Stack gap={8}>
            <Text variant="heading">{d.title}</Text>
            <Text variant="caption" tone="muted" numeric>
              {`${t('tutor_social:SOC-21.row_meta.1', { n: d.card_count })} · ${d.shared_by === 'friend' ? t('tutor_social:SOC-21.by_a_friend') : t('tutor_social:SOC-21.by_a_student')}`}
            </Text>
            <Text variant="caption" tone="muted" numeric>
              {t('tutor_social:SOC-21.helpful', { n: d.helpful })}
            </Text>
            <View style={styles.actions}>
              <Button size="sm" variant="secondary" icon="Star" label={t('tutor_social:SOC-21.mark_helpful')} disabled={d.i_found_helpful} onPress={() => void helpful(d)} testID={`soc21-helpful-${d.code}`} />
              <Button size="sm" icon="Plus" label={copied[d.code] ? t('tutor_social:SOC-21.added_toast') : t('tutor_social:SOC-21.add_a_copy')} disabled={copied[d.code]} onPress={() => void add(d)} testID={`soc21-copy-${d.code}`} />
            </View>
          </Stack>
        </Card>
      ))}
      <SocialToast message={toast} onDismiss={() => setToast(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' },
});
