import type { Schemas } from '@smriti/api-client';
import { Banner, Button, ChoiceChips, Text } from '@smriti/ui-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useApp, useT } from '../src/services/context';
import { reportContent } from '../src/services/drill';
import { NoteField } from '../src/ui/NoteField';
import { BuddyLine } from '../src/ui/Onboarding';
import { BackHeader, Screen } from '../src/ui/Screen';

type Kind = Schemas['ContentReportIn']['kind'];
type Reason = Schemas['ContentReportIn']['reason'];

const KINDS: Kind[] = ['lesson_card', 'question', 'review_card', 'solution', 'tutor_message', 'generated_image', 'story_page', 'roleplay_turn', 'community_mnemonic', 'lab', 'album_card'];
const REASONS: Reason[] = ['wrong', 'unclear', 'typo', 'translation', 'offensive', 'other'];
const NOTE_MAX = 500;

/**
 * SET-24, "Report a problem" on any piece of content, sent to `/v1/content/reports` with the item's
 * id (never its text). The note is optional and goes only to the review queue, never to analytics.
 */
export default function ReportContent() {
  const app = useApp();
  const t = useT();
  const p = useLocalSearchParams<{ kind?: string; ref?: string; bundle?: string }>();
  const kind = (KINDS.includes(p.kind as Kind) ? p.kind : 'question') as Kind;
  const ref = String(p.ref ?? '');
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'idle' | 'sent' | 'failed'>('idle');
  const close = () => (router.canGoBack() ? router.back() : router.replace('/learn' as Href));

  const send = async () => {
    if (!reason || !ref) return;
    setBusy(true);
    try {
      await reportContent(app, { kind, item_ref: ref, reason, bundle_hash: p.bundle ? String(p.bundle) : null, note: note.trim() ? note.trim().slice(0, NOTE_MAX) : null });
      setState('sent');
    } catch {
      setState('failed');
    }
    setBusy(false);
  };

  return (
    <Screen
      testID="SET-24"
      footer={state === 'sent' ? <Button label={t('practice:PRC-06.done')} onPress={close} testID="report-done" /> : <Button label={t('me_money:SET-24.send')} loading={busy} disabled={!reason || !ref} onPress={() => void send()} testID="report-send" />}
    >
      <BackHeader title={kind === 'lesson_card' ? t('me_money:SET-24.title_lesson_card_from_les_04') : t('me_money:SET-24.title')} backLabel={t('ui:common.close')} onBack={close} />
      <Text variant="caption" tone="muted">
        {t(`me_money:SET-24.kinds.${KINDS.indexOf(kind) + 1}` as 'me_money:SET-24.kinds.1')}
      </Text>
      {state === 'sent' ? (
        <View style={styles.gap} testID="report-sent">
          <Banner tone="info" icon="CheckCircle" text={t('me_money:SET-24.sent_toast')} />
          <BuddyLine text={t('me_money:SET-24.pet_line')} />
        </View>
      ) : (
        <>
          <ChoiceChips
            label={t('me_money:SET-24.title')}
            hideLabel
            options={REASONS.map((r, i) => ({ value: r, label: t(`me_money:SET-24.reasons.${i + 1}` as 'me_money:SET-24.reasons.1') }))}
            value={reason ? [reason] : []}
            onChange={(v) => setReason((v[0] as Reason | undefined) ?? null)}
            testID="report-reason"
          />
          <NoteField label={t('me_money:SET-24.note')} value={note} onChangeText={setNote} maxLength={NOTE_MAX} testID="report-note" />
          <Text variant="caption" tone="muted">
            {t('me_money:SET-24.caption')}
          </Text>
          {state === 'failed' ? <Banner tone="warning" icon="Warning" text={t('learn:LES-11.error')} testID="report-failed" /> : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({ gap: { gap: 12 } });
