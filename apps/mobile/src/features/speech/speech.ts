import { Platform } from 'react-native';

import { noAudioIn, noAudioOut, WebAudioIn, WebAudioOut, type AudioIn, type AudioOut } from '../../platform/audio';
import type { SmritiApp } from '../../services/app';

/**
 * Read-aloud and dictation through `/v1/speech/*` (Deepgram behind the API gateway; tutor-social
 * §A8). Text is sent only to be spoken and audio only to be transcribed: neither goes to analytics
 * (AGENTS rule 6), and the API does not store dictation audio.
 */
export interface Speech {
  out: AudioOut;
  in: AudioIn;
}

const perApp = new WeakMap<SmritiApp, Speech>();

export function speechFor(app: SmritiApp): Speech {
  let s = perApp.get(app);
  if (!s) {
    const web = Platform.OS === 'web';
    s = { out: web ? new WebAudioOut() : noAudioOut, in: web ? new WebAudioIn() : noAudioIn };
    perApp.set(app, s);
  }
  return s;
}

/** Tests and stories swap the platform audio. */
export function provideSpeech(app: SmritiApp, speech: Speech): void {
  perApp.set(app, speech);
}

export type SpeakResult = 'played' | 'unavailable' | 'offline' | 'limit';

/** Speaks a short text (a pet line, a label, a tutor answer) in the app's language. */
export async function readAloud(app: SmritiApp, text: string): Promise<SpeakResult> {
  const { out } = speechFor(app);
  if (!out.available || !text.trim()) return 'unavailable';
  if (!app.deps.network.isOnline()) return 'offline';
  const res = await app.api.POST('/v1/speech/read-aloud', { body: { text, locale: app.ui.getState().locale } }).catch(() => null);
  if (!res) return 'offline';
  if (res.error || !res.data) return res.response.status === 429 ? 'limit' : 'unavailable';
  if (res.data.quota.remaining === 0 && !res.data.quota.unlimited && !res.data.url) return 'limit';
  await out.play(res.data.url);
  return 'played';
}

export type DictationResult = { kind: 'text'; text: string } | { kind: 'empty' } | { kind: 'failed' };

/** `POST /v1/speech/dictation` with the recorded audio (raw body, so the platform fetch is used). */
export async function transcribe(app: SmritiApp, audio: { data: Blob; mime: string }): Promise<DictationResult> {
  const token = await app.auth.getAccessToken().catch(() => null);
  const f = (globalThis as { fetch?: typeof fetch }).fetch;
  const url = `${app.deps.env.API_BASE_URL}/v1/speech/dictation?locale=${app.ui.getState().locale}`;
  if (token && app.deps.switches.fakeApi) {
    // DEV and TEST: the in-app fake API takes text bodies only, so the audio stays on the device.
    const res = await app.deps.fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
    if (!res?.ok) return { kind: 'failed' };
    const body = (await res.json()) as { text: string };
    return body.text.trim() ? { kind: 'text', text: body.text.trim() } : { kind: 'empty' };
  }
  if (!token || !f) return { kind: 'failed' };
  try {
    const res = await f(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': audio.mime, 'X-Device-Id': app.deps.deviceId }, body: audio.data });
    if (!res.ok) return { kind: 'failed' };
    const body = (await res.json()) as { text: string };
    return body.text.trim() ? { kind: 'text', text: body.text.trim() } : { kind: 'empty' };
  } catch {
    return { kind: 'failed' };
  }
}
