/**
 * FAKE API, dev and test only: Feynman explain-back, the voice tutor and speech, as apps/api
 * answers them locally. The local API has no AI keys, so by default this fake says what that
 * API says: grading is unavailable (503 grading_unavailable), voice is unavailable (the quota's
 * reason), and read-aloud and dictation are unavailable (503 speech_unavailable). A test can
 * hand in a grader, a daily voice allowance or a dictation text to exercise the other states.
 */
import type { components } from '@smriti/api-client';
import type { HttpResponse } from '@smriti/app-core';

import type { FeatureContext, FeatureModule, FeatureRequest } from './features';
import { json, type FakeUser } from './server';

type S = components['schemas'];

export interface FakeFeynmanInput {
  conceptId: string;
  explanation: string;
  attemptNo: number;
  previous: { clarity: number; completeness: number; accuracy: number } | null;
}

export type FakeFeynmanGrade = Pick<S['FeynmanOut'], 'clarity' | 'completeness' | 'accuracy' | 'key_points' | 'follow_ups'>;

export class AiFakes implements FeatureModule {
  /** null: no grader, as on a local API without AI keys. */
  grader: ((input: FakeFeynmanInput) => FakeFeynmanGrade) | null = null;
  /** `pro.voice_daily_seconds`, an owner number: null keeps voice off ("limit_not_set"). */
  voiceDailySeconds: number | null = null;
  /** What dictation hears; null: speech is unavailable. */
  dictationText: string | null = null;
  readonly attempts: { userId: string; out: S['FeynmanOut']; explanation: string }[] = [];
  private seq = 0;

  constructor(private readonly ctx: FeatureContext) {}

  route(req: FeatureRequest): HttpResponse | null {
    const { method: m, path: p, user: u, body } = req;
    if (m === 'GET' && p === '/v1/voice/quota') return json(200, this.quota(u));
    if (m === 'POST' && p === '/v1/voice/sessions') {
      const q = this.quota(u);
      return q.available ? json(503, { code: 'voice_unavailable', reason: 'not_configured' }) : json(503, { code: 'voice_unavailable', reason: q.reason });
    }
    if (m === 'GET' && p === '/v1/voice/sessions') return json(200, []);
    if (m === 'POST' && (p === '/v1/speech/read-aloud' || p === '/v1/speech/dictation')) {
      if (p === '/v1/speech/dictation' && this.dictationText !== null) return json(200, { text: this.dictationText, confidence: 1, quota: this.unlimited() });
      return json(503, { code: 'speech_unavailable' });
    }
    if (m === 'POST' && p === '/v1/feynman/attempts') return this.feynman(u, body);
    const r = /^\/v1\/feynman\/concepts\/([^/]+)$/.exec(p);
    if (r && m === 'GET') return json(200, this.attempts.filter((a) => a.userId === u.id && a.out.concept_id === r[1]).map((a) => a.out));
    return null;
  }

  private unlimited(): S['QuotaOut'] {
    return { unlimited: true, limit: null, used: 0, remaining: null, resets_at: null };
  }

  private quota(u: FakeUser): S['VoiceQuota'] {
    const pro = u.entitlement.plan === 'pro';
    const band = this.ctx.state(u).profile?.age_band;
    const daily = this.voiceDailySeconds;
    const reason = this.ctx.flags()['feature.voice_tutor'] !== true ? 'feature_off' : !pro ? 'pro_required' : band === 'u10' ? 'not_for_age' : daily === null ? 'limit_not_set' : null;
    const midnight = new Date(this.ctx.clock());
    midnight.setUTCHours(18, 30, 0, 0); // next midnight IST
    if (midnight.getTime() <= this.ctx.clock()) midnight.setTime(midnight.getTime() + 86_400_000);
    return {
      available: reason === null,
      reason,
      daily_seconds: daily,
      used_seconds: 0,
      remaining_seconds: daily,
      session_max_seconds: 600,
      reconnect_seconds: 30,
      background_grace_seconds: 20,
      resets_at: midnight.toISOString(),
    };
  }

  private feynman(u: FakeUser, body: Record<string, unknown>): HttpResponse {
    if (this.ctx.flags()['feature.feynman'] !== true) return json(403, { code: 'feature_disabled' });
    if (!this.grader) return json(503, { code: 'grading_unavailable' });
    const conceptId = String(body.concept_id ?? '');
    const mine = this.attempts.filter((a) => a.userId === u.id && a.out.concept_id === conceptId);
    const last = mine.at(-1)?.out ?? null;
    const previous = last ? { clarity: last.clarity, completeness: last.completeness, accuracy: last.accuracy } : null;
    const g = this.grader({ conceptId, explanation: String(body.explanation ?? ''), attemptNo: mine.length + 1, previous });
    const out: S['FeynmanOut'] = {
      id: `fey-${++this.seq}`,
      session_id: `fey-session-${u.id}`,
      concept_id: conceptId,
      attempt_no: mine.length + 1,
      ...g,
      previous,
      mastery_delta: 0,
      status: 'graded',
      safety: null,
      quota: this.unlimited(),
    };
    this.attempts.push({ userId: u.id, out, explanation: String(body.explanation ?? '') });
    return json(200, out);
  }
}
