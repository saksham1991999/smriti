import { IconButton, Toast } from '@smriti/ui-native';
import { useState } from 'react';

import { useApp, useT } from '../../services/context';
import { readAloud, speechFor, type SpeakResult } from './speech';

/**
 * A speaker button that reads a short text through `/v1/speech/read-aloud`. Hidden where the
 * platform can't play audio; when the API can't speak (no provider, the daily cap, offline) it
 * says so in a toast instead of failing silently.
 */
export function ReadAloudButton({ text, label, size = 44, source = 'chat', testID }: { text: string; label?: string; size?: 40 | 44 | 48 | 56; source?: 'chat' | 'story' | 'roleplay'; testID?: string }) {
  const app = useApp();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<SpeakResult | null>(null);
  if (!speechFor(app).out.available) return null;
  const play = async () => {
    setBusy(true);
    const r = await readAloud(app, text);
    setBusy(false);
    if (r === 'played') app.track('tutor_read_aloud_played', { source });
    else setNote(r);
  };
  const message = note === 'limit' ? t('tutor_social:AI-11.listen_limit') : note === 'offline' ? t('tutor_social:AI-11.listen_offline') : t('tutor_social:AI-11.listen_unavailable');
  return (
    <>
      <IconButton icon="SpeakerHigh" label={label ?? t('tutor_social:AI-11.listen')} disabled={busy} onPress={() => void play()} size={size} testID={testID} />
      <Toast open={note !== null} message={message} icon="Info" onDismiss={() => setNote(null)} testID={testID ? `${testID}-note` : 'read-aloud-note'} />
    </>
  );
}
