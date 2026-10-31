import type { components } from '@smriti/api-client';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { SmritiApp } from '../../services/app';

type S = components['schemas'];
export type VoiceQuota = S['VoiceQuota'];

/**
 * The realtime voice tutor (AI-13 to AI-15, tutor-social A9). The API mints a short-lived Gemini
 * Live token (`POST /v1/voice/sessions`); a transport streams the mic to it and plays the reply.
 * This build has no realtime audio transport (it needs a native audio module), so the default
 * transport reports itself unavailable and AI-13 offers text instead. Tests pass a scripted one.
 */
export interface VoiceTransport {
  readonly available: boolean;
  connect(session: S['VoiceSessionOut'], events: VoiceEvents): Promise<void>;
  setMuted(muted: boolean): void;
  close(): void;
}

export interface VoiceEvents {
  onState(state: 'listening' | 'thinking' | 'speaking'): void;
  onCaption(turn: { role: 'student' | 'tutor'; text: string }): void;
  onDropped(): void;
}

export type VoiceUnavailable = 'offline' | 'feature_off' | 'pro_required' | 'not_for_age' | 'limit_not_set' | 'daily_limit' | 'not_configured' | 'device' | 'error';

export type VoiceState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'unavailable'; reason: VoiceUnavailable; quota: VoiceQuota | null }
  | { kind: 'connecting'; quota: VoiceQuota }
  | { kind: 'live'; quota: VoiceQuota; activity: 'listening' | 'thinking' | 'speaking'; muted: boolean; startedAt: number }
  | { kind: 'ended'; reason: 'user' | 'session_cap' | 'daily_cap' | 'network'; seconds: number; flashcards: number; quota: VoiceQuota | null };

export const noVoiceTransport: VoiceTransport = {
  available: false,
  connect: async () => undefined,
  setMuted: () => undefined,
  close: () => undefined,
};

/** One voice conversation, from the quota check to the summary. */
export interface VoiceSession {
  readonly store: StoreApi<VoiceState>;
  start(contextRef?: string | null): Promise<void>;
  setMuted(muted: boolean): void;
  end(reason?: 'user' | 'session_cap' | 'daily_cap' | 'network'): Promise<void>;
}

const transports = new WeakMap<SmritiApp, VoiceTransport>();

/** Tests and a future native build provide the realtime transport. */
export function provideVoiceTransport(app: SmritiApp, t: VoiceTransport): void {
  transports.set(app, t);
}

export function createVoiceSession(app: SmritiApp): VoiceSession {
  const store = createStore<VoiceState>(() => ({ kind: 'idle' }));
  const transport = transports.get(app) ?? noVoiceTransport;
  let id: string | null = null;
  let connectStarted = 0;

  const fail = (reason: VoiceUnavailable, quota: VoiceQuota | null) => store.setState({ kind: 'unavailable', reason, quota }, true);

  return {
    store,
    async start(contextRef = null) {
      if (!app.deps.network.isOnline()) return fail('offline', null);
      store.setState({ kind: 'checking' }, true);
      await app.ensureSession();
      const q = await app.api.GET('/v1/voice/quota').catch(() => null);
      const quota = q?.data ?? null;
      if (!quota) return fail(q ? 'error' : 'offline', null);
      if (!quota.available) return fail((quota.reason as VoiceUnavailable | null) ?? 'error', quota);
      if (!transport.available) return fail('device', quota);
      store.setState({ kind: 'connecting', quota }, true);
      connectStarted = app.deps.clock();
      const res = await app.api.POST('/v1/voice/sessions', { body: { client_session_id: app.newId(), context_ref: contextRef, exam: app.examProfileId() } }).catch(() => null);
      if (!res?.data) {
        const reason = ((res?.error as { reason?: string } | undefined)?.reason as VoiceUnavailable | undefined) ?? 'error';
        return fail(reason, quota);
      }
      id = res.data.id;
      try {
        await transport.connect(res.data, {
          onState: (activity) => {
            const s = store.getState();
            if (s.kind === 'live') store.setState({ ...s, activity }, true);
          },
          onCaption: () => undefined,
          onDropped: () => void this.end('network'),
        });
      } catch {
        return fail('error', quota);
      }
      app.track('voice_session_started', { connect_ms: app.deps.clock() - connectStarted });
      store.setState({ kind: 'live', quota, activity: 'listening', muted: false, startedAt: app.deps.clock() }, true);
    },
    setMuted(muted) {
      const s = store.getState();
      if (s.kind !== 'live') return;
      transport.setMuted(muted);
      store.setState({ ...s, muted }, true);
    },
    async end(reason = 'user') {
      const s = store.getState();
      if (s.kind !== 'live') return;
      transport.close();
      const seconds = Math.max(0, Math.round((app.deps.clock() - s.startedAt) / 1000));
      if (id) await app.api.POST('/v1/voice/sessions/{session_id}/end', { params: { path: { session_id: id } }, body: { seconds, end_reason: reason, flashcards_made: 0 } }).catch(() => null);
      app.track('voice_session_ended', { seconds: String(seconds), end_reason: reason === 'session_cap' || reason === 'daily_cap' ? 'cap' : reason });
      store.setState({ kind: 'ended', reason, seconds, flashcards: 0, quota: s.quota }, true);
    },
  };
}
