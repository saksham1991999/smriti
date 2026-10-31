/**
 * FAKE API, dev and test only: `/v1/insights/*` as apps/api (services/learning_science.py)
 * answers them, from data a test or demo hands in. Calibration follows the API's rules: no
 * `analytics.min_tagged_answers` flag means "threshold_unset", fewer tagged answers than it means
 * "below_threshold". Weak areas and sleep review are what the test set for the user, else the
 * API's answer for a learner with no FSRS history (no topics; sleep review off).
 */
import type { components } from '@smriti/api-client';
import type { HttpResponse } from '@smriti/app-core';

import type { FeatureContext, FeatureModule, FeatureRequest } from './features';
import { json } from './server';

type S = components['schemas'];
type Level = 'sure' | 'fifty' | 'guess';

export class InsightsFakes implements FeatureModule {
  /** Tagged first-attempt answers per user (practice and mocks on the real API). */
  readonly answers = new Map<string, { confidence: Level; correct: boolean }[]>();
  /** Topics whose cards are predicted to fall below target, per user. */
  readonly weak = new Map<string, S['WeakAreaOut'][]>();
  /** Tonight's sleep review per user; unset means "off" (or "pro_required" for free). */
  readonly sleep = new Map<string, S['SleepReviewOut']>();
  targetRetention = 0.9;

  constructor(private readonly ctx: FeatureContext) {}

  tag(userId: string, confidence: Level, correct: boolean): void {
    const list = this.answers.get(userId) ?? [];
    list.push({ confidence, correct });
    this.answers.set(userId, list);
  }

  route({ method, path, user }: FeatureRequest): HttpResponse | null {
    if (method !== 'GET' || !path.startsWith('/v1/insights/')) return null;
    if (path === '/v1/insights/weak-areas') {
      const horizon = Number(this.ctx.flags()['notify.weak_area.horizon_days'] ?? 3);
      return json(200, { target_retention: this.targetRetention, horizon_days: horizon, topics: (this.weak.get(user.id) ?? []).slice(0, 10) } satisfies S['WeakAreasOut']);
    }
    if (path === '/v1/insights/sleep-review') {
      if (user.entitlement.plan !== 'pro') return json(200, { eligible: false, reason: 'pro_required' } satisfies S['SleepReviewOut']);
      return json(200, this.sleep.get(user.id) ?? ({ eligible: false, reason: 'off' } satisfies S['SleepReviewOut']));
    }
    if (path === '/v1/insights/calibration') return json(200, this.calibration(user.id));
    return null;
  }

  private calibration(userId: string): S['CalibrationOut'] {
    const rows = this.answers.get(userId) ?? [];
    const levels = (['sure', 'fifty', 'guess'] as const).map((confidence) => {
      const mine = rows.filter((r) => r.confidence === confidence);
      const correct = mine.filter((r) => r.correct).length;
      return { confidence, answers: mine.length, correct, accuracy: mine.length ? Math.round((correct / mine.length) * 1000) / 1000 : null };
    });
    const tagged = rows.length;
    const raw = this.ctx.flags()['analytics.min_tagged_answers'];
    const needed = typeof raw === 'number' ? raw : null;
    if (needed === null) return { shown: false, reason: 'threshold_unset', tagged, needed: null };
    if (tagged < needed) return { shown: false, reason: 'below_threshold', tagged, needed };
    const sure = levels[0]!;
    const guess = levels[2]!;
    return {
      shown: true,
      tagged,
      needed,
      levels,
      overconfident: sure.answers ? Math.round((1 - sure.correct / sure.answers) * 1000) / 1000 : null,
      underconfident: guess.answers ? Math.round((guess.correct / guess.answers) * 1000) / 1000 : null,
      by_subject: [],
    };
  }
}
