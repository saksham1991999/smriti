/**
 * FAKE API, dev and test only: `/v1/live/mocks/*` (MOCK-03 room, registration, MOCK-24
 * leaderboard) as apps/api services/live_mocks.py answers them. A test or demo schedules a live
 * mock and the scores of first attempts made in its window; `publish` freezes ranks the API's
 * way (`mock.min_attempts_for_percentile`, rank by score, percentile as cumulative share).
 */
import type { components } from '@smriti/api-client';
import type { HttpResponse } from '@smriti/app-core';

import type { FeatureContext, FeatureModule, FeatureRequest } from './features';
import { json, type FakeUser } from './server';

type S = components['schemas'];

export interface FakeLiveMock {
  id: string;
  title: Record<string, string>;
  windowStart: number;
  windowEnd: number;
  resultsAt: number | null;
  durationS: number | null;
  registrations: Set<string>;
  /** First attempts started inside the window: user id → score. */
  scores: Map<string, number>;
  attempts: Map<string, { id: string; status: string }>;
  published: { ranked: number; reason: S['LiveLeaderboard']['reason'] } | null;
}

export class LiveFakes implements FeatureModule {
  readonly mocks = new Map<string, FakeLiveMock>();

  constructor(private readonly ctx: FeatureContext) {}

  schedule(m: Omit<FakeLiveMock, 'registrations' | 'scores' | 'attempts' | 'published'>): FakeLiveMock {
    const full: FakeLiveMock = { ...m, registrations: new Set(), scores: new Map(), attempts: new Map(), published: null };
    this.mocks.set(m.id, full);
    return full;
  }

  /** Freezes ranks after results, as the API's job does. */
  publish(mockId: string): void {
    const m = this.mocks.get(mockId);
    if (!m) return;
    const raw = this.ctx.flags()['mock.min_attempts_for_percentile'];
    const needed = typeof raw === 'number' ? raw : null;
    const n = m.scores.size;
    m.published = needed === null ? { ranked: 0, reason: 'threshold_unset' } : n < needed ? { ranked: 0, reason: 'below_threshold' } : { ranked: n, reason: null };
  }

  route({ method, path, user }: FeatureRequest): HttpResponse | null {
    const r = /^\/v1\/live\/mocks\/([^/]+)(\/registration|\/leaderboard)?$/.exec(path);
    if (!r) return null;
    if (this.ctx.flags()['live.enabled'] !== true) return json(404, { code: 'not_found', message: "Live mocks aren't available here" });
    const m = this.mocks.get(r[1]!);
    if (!m) return json(404, { code: 'not_found', message: "This live mock isn't available" });
    const now = this.ctx.clock();
    if (!r[2] && method === 'GET') return json(200, this.room(m, user, now));
    if (r[2] === '/registration' && method === 'POST') {
      if (now >= m.windowEnd) return json(409, { code: 'window_closed', message: 'This live mock has ended' });
      if (user.entitlement.plan !== 'pro') return json(403, { code: 'pro_required', message: 'Live mocks are part of Pro', paywall_trigger: 'mock_limit', paywall_source: 'live_mock' });
      m.registrations.add(user.id);
      const opens = this.opens(m);
      return json(200, { mock_id: m.id, registered: true, reminder_at: opens > now ? new Date(opens).toISOString() : null });
    }
    if (r[2] === '/registration' && method === 'DELETE') {
      m.registrations.delete(user.id);
      return json(200, { mock_id: m.id, registered: false, reminder_at: null });
    }
    if (r[2] === '/leaderboard' && method === 'GET') return json(200, this.board(m, user));
    return null;
  }

  private opens(m: FakeLiveMock): number {
    const lead = this.ctx.flags()['live.room_lead_min'];
    return typeof lead === 'number' ? m.windowStart - lead * 60_000 : m.windowStart;
  }

  private status(m: FakeLiveMock, now: number): S['LiveRoom']['status'] {
    if (m.published) return 'results';
    if (now >= m.windowEnd) return 'closed';
    if (now >= m.windowStart) return 'live';
    return now >= this.opens(m) ? 'room_open' : 'scheduled';
  }

  private room(m: FakeLiveMock, u: FakeUser, now: number): S['LiveRoom'] {
    const status = this.status(m, now);
    const attempt = m.attempts.get(u.id) ?? null;
    const iso = (t: number) => new Date(t).toISOString();
    return {
      mock_id: m.id,
      title: m.title,
      status,
      server_time: iso(now),
      window_start: iso(m.windowStart),
      window_end: iso(m.windowEnd),
      results_at: m.resultsAt === null ? null : iso(m.resultsAt),
      room_opens_at: iso(this.opens(m)),
      duration_s: m.durationS,
      full_duration_until: m.durationS === null ? null : iso(m.windowEnd - m.durationS * 1000),
      deadline_if_started_now: status === 'live' && m.durationS !== null ? iso(Math.min(now + m.durationS * 1000, m.windowEnd)) : null,
      can_start: status === 'live' && u.entitlement.plan === 'pro' && attempt === null,
      registered: m.registrations.has(u.id),
      registrations: m.registrations.size,
      attempt_id: attempt?.id ?? null,
      attempt_status: attempt?.status ?? null,
      ranks_published: m.published !== null,
      channel: `mock:${m.id}`,
      events_url: `/v1/live/mocks/${m.id}/events`,
    };
  }

  private board(m: FakeLiveMock, me: FakeUser): S['LiveLeaderboard'] {
    if (!m.published || m.published.reason) return { mock_id: m.id, published: m.published !== null && !m.published.reason ? true : false, reason: m.published?.reason ?? 'results_pending', ranked: 0, rows: [], you: null };
    const sorted = [...m.scores.entries()].sort((a, b) => b[1] - a[1]);
    const n = sorted.length;
    let you: S['LiveLeaderboardRow'] | null = null;
    const rows: S['LiveLeaderboardRow'][] = [];
    sorted.forEach(([userId, score]) => {
      const rank = 1 + sorted.filter(([, s]) => s > score).length;
      const atOrBelow = sorted.filter(([, s]) => s <= score).length;
      const u = this.ctx.user(userId);
      const st = u ? this.ctx.state(u) : null;
      const minor = st?.profile?.age_band !== '18p';
      const row: S['LiveLeaderboardRow'] = {
        rank,
        score,
        percentile: Math.round((10_000 * atOrBelow) / n) / 100,
        is_you: userId === me.id,
        name: minor ? null : (u?.displayName ?? null),
        avatar: minor ? `pet:${st?.pet?.species ?? 'cat'}` : null,
      };
      if (row.is_you) you = row;
      if (!minor || row.is_you) rows.push(row);
    });
    return { mock_id: m.id, published: true, ranked: m.published.ranked, rows: rows.slice(0, 100), you };
  }
}
