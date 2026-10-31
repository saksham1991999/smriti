import { describe, expect, it } from 'vitest';

import {
  activityByDay,
  activityCompletedPayload,
  activityCompletedXp,
  activityDedupeKey,
  InMemoryStorage,
  ManualNetwork,
  ManualScheduler,
  Outbox,
  STATE_VERSION_KEY,
  SYNC_BATCH_SIZE,
  SyncClient,
  UUID_RE,
  applyServerState,
  backoffDelay,
  readSnapshotSection,
  readStateVersion,
  unsyncedSummary,
  type Logger,
  type SyncEventsRequest,
  type SyncStateResponse,
  type TokenSource,
} from '../src';
import { fakeFetch, jsonResponse, nodeCrypto } from './helpers';

const T0 = Date.UTC(2026, 9, 29, 6, 0, 0);
const T0Iso = new Date(T0).toISOString();

function setup(opts: { online?: boolean; tokens?: TokenSource; handler?: Parameters<typeof fakeFetch>[0] } = {}) {
  const storage = new InMemoryStorage();
  const network = new ManualNetwork(opts.online ?? true);
  const scheduler = new ManualScheduler();
  let stateVersion = 0;
  const server = fakeFetch(
    opts.handler ??
      ((url, _init, body) => {
        if (url.endsWith('/v1/sync/events')) {
          const req = body as SyncEventsRequest;
          stateVersion += 1;
          return jsonResponse(200, { accepted: req.events.map((e) => e.event_id), rejected: [], state_version: stateVersion });
        }
        return jsonResponse(200, { state_version: stateVersion, streak: { current: 3, longest: 5, today_qualified: true, freezes_equipped: 1, freezes_available: 1, rest_day: null, at_risk: false } });
      }),
  );
  const warnings: { message: string; fields?: Record<string, unknown> }[] = [];
  const logger: Logger = { debug() {}, error() {}, warn: (message, fields) => warnings.push({ message, fields }) };
  const outbox = new Outbox({ crypto: nodeCrypto, clock: () => T0, timeZone: () => 'Asia/Kolkata' });
  const client = new SyncClient({
    storage,
    fetch: server.fetch,
    baseUrl: 'https://api.test',
    network,
    tokens: opts.tokens ?? { getAccessToken: async () => 'tok' },
    deviceId: 'dev-1',
    variant: 'jee',
    scheduler,
    clock: () => T0,
    random: () => 0.5,
    logger,
  });
  const add = (n: number) =>
    storage.transaction(async (tx) => {
      for (let i = 0; i < n; i++) await outbox.record(tx, 'lesson_card_viewed', { topic_id: 't1', card_id: `c${i}`, index: i, ms_on_card: 1000 });
    });
  return { storage, network, scheduler, server, client, outbox, add, warnings };
}

describe('outbox', () => {
  it('creates UUIDv7 events with the device timezone, in seq order', async () => {
    const { storage, add } = setup();
    await add(3);
    const rows = await storage.outbox.all();
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(rows.every((r) => UUID_RE.test(r.event_id) && r.tz === 'Asia/Kolkata')).toBe(true);
    expect(rows[0]?.occurred_at).toBe(new Date(T0).toISOString());
  });

  it('sends own-card refs in the canonical d: form', () => {
    const { outbox } = setup();
    const row = outbox.create('review_rated', {
      card_ref: 'u:abc',
      rating: 3,
      confidence: 'fifty_fifty',
      ms_to_answer: 900,
      fsrs_state: { due: T0Iso, stability: 1, difficulty: 5, elapsed_days: 0, scheduled_days: 1, reps: 1, lapses: 0, state: 2 },
    });
    expect(row.payload.card_ref).toBe('d:abc');
    expect(row.payload.confidence).toBe('fifty_fifty');
  });

  it('carries mock answers with their attempt id (contract v1.3)', () => {
    const { outbox } = setup();
    const attempt = '0192f0a0-0000-7000-8000-000000000001';
    const row = outbox.create('answer_submitted', {
      topic_id: 't1',
      question_id: 'q1',
      context: 'mock',
      attempt_id: attempt,
      response: ['a'],
      correct: true,
      attempt: 1,
      confidence: null,
      ms_to_answer: 4000,
    });
    expect(row.payload.context).toBe('mock');
    expect(row.payload.attempt_id).toBe(attempt);
  });

  it('is idempotent on event_id', async () => {
    const { storage, outbox } = setup();
    const row = outbox.create('quest_claimed', { quest_id: 'q1' });
    await storage.outbox.append(row);
    await storage.outbox.append(row);
    expect(await storage.outbox.count()).toBe(1);
  });

  it('rolls back the local write and its event together', async () => {
    const { storage, outbox } = setup();
    await expect(
      storage.transaction(async (tx) => {
        await tx.topic_status.put({ topic_id: 't1', status: 'learned', learned_via: 'lesson', updated_at: 'x' });
        await outbox.record(tx, 'quest_claimed', { quest_id: 'q1' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await storage.outbox.count()).toBe(0);
    expect(await storage.topic_status.count()).toBe(0);
  });

  it('summarises unsynced lessons and reviews by count only', async () => {
    const { storage, outbox } = setup();
    await storage.outbox.append(outbox.create('lesson_completed', { topic_id: 't', mode: 'deep_dive', cards_seen: 5, correct: 4, total: 5, ms_total: 1, xp: 10 }));
    await storage.outbox.append(outbox.create('quest_claimed', { quest_id: 'q' }));
    expect(await unsyncedSummary(storage)).toEqual({ total: 2, lessons: 1, reviews: 0 });
  });
});

describe('SyncClient', () => {
  it('sends batches of at most 200 with the contract headers and empties the outbox', async () => {
    const { client, add, server, storage } = setup();
    await add(450);
    const res = await client.flush();
    expect(res).toMatchObject({ sent: 450, accepted: 450, rejected: 0, status: 'idle' });
    const posts = server.calls.filter((c) => c.url.endsWith('/v1/sync/events'));
    expect(posts.map((c) => (c.body as SyncEventsRequest).events.length)).toEqual([SYNC_BATCH_SIZE, 200, 50]);
    const h = posts[0]?.init?.headers ?? {};
    expect(h.Authorization).toBe('Bearer tok');
    expect(h['X-App-Variant']).toBe('jee');
    expect(h['X-Device-Id']).toBe('dev-1');
    expect((posts[0]?.body as SyncEventsRequest).device_id).toBe('dev-1');
    expect(await storage.outbox.count()).toBe(0);
    // state_version rose, so it pulled state and applied it (server wins).
    expect(server.calls.some((c) => c.url.includes('/v1/sync/state'))).toBe(true);
    expect(await readStateVersion(storage)).toBe(3);
    expect(await readSnapshotSection(storage, 'streak')).toMatchObject({ current: 3 });
  });

  it('drops rejected events (never retried) and logs only the code', async () => {
    const { client, add, storage, warnings } = setup({
      handler: (url, _i, body) => {
        if (!url.endsWith('/events')) return jsonResponse(200, { state_version: 1 });
        const ev = (body as SyncEventsRequest).events;
        return jsonResponse(200, {
          accepted: ev.slice(1).map((e) => e.event_id),
          rejected: [{ event_id: ev[0]?.event_id, code: 'invalid_payload', detail: 'secret detail' }],
          state_version: 1,
        });
      },
    });
    await add(3);
    const res = await client.flush();
    expect(res).toMatchObject({ accepted: 2, rejected: 1 });
    expect(await storage.outbox.count()).toBe(0);
    expect(warnings).toContainEqual({ message: 'sync.event_rejected', fields: { code: 'invalid_payload' } });
    expect(JSON.stringify(warnings)).not.toContain('secret detail');
  });

  it('keeps the batch and backs off exponentially on 5xx, then succeeds', async () => {
    let fail = 3;
    const { client, add, storage, scheduler, server } = setup({
      handler: (url, _i, body) => {
        if (!url.endsWith('/events')) return jsonResponse(200, { state_version: 0 });
        if (fail-- > 0) return jsonResponse(503, {});
        return jsonResponse(200, { accepted: (body as SyncEventsRequest).events.map((e) => e.event_id), rejected: [], state_version: 0 });
      },
    });
    await add(2);
    const r1 = await client.flush();
    expect(r1).toMatchObject({ status: 'backing_off', retryInMs: 1000 });
    expect(client.getStatus()).toBe('backing_off');
    expect((await storage.outbox.all())[0]?.attempts).toBe(1);
    await scheduler.advance(1000); // 2nd attempt fails → 2 s
    await new Promise((r) => setTimeout(r, 0));
    expect(scheduler.pending()).toEqual([2000]);
    await scheduler.advance(2000); // 3rd attempt fails → 4 s
    await new Promise((r) => setTimeout(r, 0));
    expect(scheduler.pending()).toEqual([4000]);
    await scheduler.advance(4000);
    await new Promise((r) => setTimeout(r, 0));
    expect(await storage.outbox.count()).toBe(0);
    expect(client.getStatus()).toBe('idle');
    expect(server.calls.filter((c) => c.url.endsWith('/events'))).toHaveLength(4);
  });

  it('treats a network error like a 5xx', async () => {
    const { client, add, storage } = setup({
      handler: () => {
        throw new TypeError('Network request failed');
      },
    });
    await add(1);
    expect(await client.flush()).toMatchObject({ status: 'backing_off' });
    expect((await storage.outbox.all())[0]?.last_error).toBe('network_error');
  });

  it('waits while offline and flushes on reconnect', async () => {
    const { client, add, network, storage, server } = setup({ online: false });
    await add(5);
    client.start();
    expect(client.getStatus()).toBe('offline');
    expect(server.calls).toHaveLength(0);
    network.set(true);
    await new Promise((r) => setTimeout(r, 0));
    await client.flush();
    expect(await storage.outbox.count()).toBe(0);
    client.stop();
  });

  it('refreshes once on 401, then ends the session if refresh fails; resume() sends the kept outbox', async () => {
    let authorised = false;
    let refreshes = 0;
    const tokens: TokenSource = {
      getAccessToken: async () => (authorised ? 'good' : 'stale'),
      refresh: async () => {
        refreshes++;
        return null;
      },
    };
    const { client, add, storage } = setup({
      tokens,
      handler: (url, init, body) => {
        if (init?.headers?.Authorization !== 'Bearer good') return jsonResponse(401, {});
        if (!url.endsWith('/events')) return jsonResponse(200, { state_version: 0 });
        return jsonResponse(200, { accepted: (body as SyncEventsRequest).events.map((e) => e.event_id), rejected: [], state_version: 0 });
      },
    });
    await add(2);
    expect(await client.flush()).toMatchObject({ status: 'session_ended' });
    expect(refreshes).toBe(1);
    expect(await storage.outbox.count()).toBe(2); // kept for AUTH-31
    expect(await client.flush()).toMatchObject({ status: 'session_ended', sent: 0 });
    authorised = true;
    expect(await client.resume()).toMatchObject({ status: 'idle', accepted: 2 });
  });

  it('a successful refresh retries the same batch', async () => {
    let token = 'stale';
    const { client, add, storage } = setup({
      tokens: { getAccessToken: async () => token, refresh: async () => (token = 'good') },
      handler: (url, init, body) => {
        if (init?.headers?.Authorization !== 'Bearer good') return jsonResponse(401, {});
        if (!url.endsWith('/events')) return jsonResponse(200, { state_version: 0 });
        return jsonResponse(200, { accepted: (body as SyncEventsRequest).events.map((e) => e.event_id), rejected: [], state_version: 0 });
      },
    });
    await add(1);
    expect(await client.flush()).toMatchObject({ status: 'idle', accepted: 1 });
    expect(await storage.outbox.count()).toBe(0);
  });

  it('waits for a session when there is no token', async () => {
    const { client, add } = setup({ tokens: { getAccessToken: async () => null } });
    await add(1);
    expect(await client.flush()).toMatchObject({ status: 'waiting_for_session' });
  });

  it('isolates and drops a single event the server refuses with a 4xx', async () => {
    let bad = '';
    const { client, add, storage, warnings } = setup({
      handler: (url, _i, body) => {
        if (!url.endsWith('/events')) return jsonResponse(200, { state_version: 0 });
        const ev = (body as SyncEventsRequest).events;
        if (ev.some((e) => e.event_id === bad)) return jsonResponse(422, {});
        return jsonResponse(200, { accepted: ev.map((e) => e.event_id), rejected: [], state_version: 0 });
      },
    });
    await add(9);
    bad = (await storage.outbox.all())[6]?.event_id ?? '';
    const res = await client.flush();
    expect(res).toMatchObject({ status: 'idle', accepted: 8, rejected: 1 });
    expect(await storage.outbox.count()).toBe(0);
    expect(warnings.some((w) => w.message === 'sync.event_dropped')).toBe(true);
  });

  it('keeps events the server did not acknowledge', async () => {
    const { client, add, storage } = setup({
      handler: (url, _i, body) => {
        if (!url.endsWith('/events')) return jsonResponse(200, { state_version: 0 });
        const ev = (body as SyncEventsRequest).events;
        return jsonResponse(200, { accepted: [ev[0]?.event_id], rejected: [], state_version: 0 });
      },
    });
    await add(3);
    expect(await client.flush()).toMatchObject({ status: 'backing_off', accepted: 1 });
    const left = await storage.outbox.all();
    expect(left).toHaveLength(2);
    expect(left[0]?.last_error).toBe('not_acknowledged');
  });

  it('concurrent flush calls share one run', async () => {
    const { client, add, server } = setup();
    await add(1);
    const [a, b] = await Promise.all([client.flush(), client.flush()]);
    expect(a).toBe(b);
    expect(server.calls.filter((c) => c.url.endsWith('/events'))).toHaveLength(1);
  });

  it('reports status changes', async () => {
    const { client, add } = setup();
    const seen: string[] = [];
    client.onStatus((s) => seen.push(s));
    await add(1);
    await client.flush();
    expect(seen).toEqual(['flushing', 'idle']);
  });

  it('pullState({full}) omits since', async () => {
    const { client, server, storage } = setup();
    await storage.session_state.put({ key: STATE_VERSION_KEY, data: 7, updated_at: 'x' });
    await client.pullState();
    expect(server.calls.at(-1)?.url).toBe('https://api.test/v1/sync/state?since=7');
    await client.pullState({ full: true });
    expect(server.calls.at(-1)?.url).toBe('https://api.test/v1/sync/state');
  });
});

describe('backoff', () => {
  it('doubles from 1 s, caps at 5 min, and jitters by ±20%', () => {
    expect([1, 2, 3, 4].map((a) => backoffDelay(a))).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffDelay(30)).toBe(300_000);
    expect(backoffDelay(1, undefined, () => 0)).toBe(800);
    expect(backoffDelay(1, undefined, () => 0.999999)).toBe(1200);
  });
});

describe('applyServerState', () => {
  it('server wins: replaces sections, upserts and deletes srs cards and keeps local-only fields', async () => {
    const storage = new InMemoryStorage();
    await storage.srs_cards.put({
      card_ref: 'c:a', deck_id: null, state: 2, due_at: '2026-01-01T00:00:00Z', stability: 1, difficulty: 5, elapsed_days: 1,
      scheduled_days: 1, learning_steps: 0, reps: 1, lapses: 0, last_review_at: null, suspended: false, flags: 4,
      buried_until: null, updated_at: 'x', topic_id: 'phy.kin', concept_ids: ['k1'], sibling_key: null, introduced_on: '2026-01-01',
    });
    await storage.srs_cards.put({
      card_ref: 'c:gone', deck_id: null, state: 2, due_at: '2026-01-01T00:00:00Z', stability: 1, difficulty: 5, elapsed_days: 1,
      scheduled_days: 1, learning_steps: 0, reps: 1, lapses: 0, last_review_at: null, suspended: false, flags: 0, buried_until: null, updated_at: 'x',
    });
    const state: SyncStateResponse = {
      state_version: 42,
      wallet: { xp_total: 100, xp_today: 10, gems: 5 },
      pet: null,
      srs: {
        cards: [{ card_ref: 'c:a', due: '2026-02-01T00:00:00Z', stability: 9, difficulty: 4, state: 2, reps: 2, lapses: 0, last_review: '2026-01-20T00:00:00Z' }],
        deleted: ['c:gone'],
      },
      topic_progress: [{ topic_id: 'phy.kin', status: 'learned', percent: 100 }],
    };
    await storage.transaction((tx) => applyServerState(tx, state, T0));
    const a = await storage.srs_cards.get('c:a');
    expect(a).toMatchObject({ stability: 9, due_at: '2026-02-01T00:00:00Z', flags: 4, topic_id: 'phy.kin', introduced_on: '2026-01-01' });
    expect(await storage.srs_cards.get('c:gone')).toBeUndefined();
    expect(await readSnapshotSection(storage, 'wallet')).toEqual({ xp_total: 100, xp_today: 10, gems: 5 });
    expect((await storage.profile_snapshot.get('pet'))?.data).toBeNull();
    expect(await readSnapshotSection(storage, 'streak')).toBeUndefined();
    expect(await storage.topic_status.get('phy.kin')).toMatchObject({ status: 'learned', percent: 100 });
    expect(await readStateVersion(storage)).toBe(42);
  });
});

describe('activity_completed (v1.4)', () => {
  const completion = {
    kind: 'play' as const,
    activityId: 'play.x',
    topicId: 't.x',
    concepts: ['c.1', 'c.1', 'c.2'],
    bundleVersion: 'v3',
    locale: 'hi',
    stars: 2.4,
    msTotal: -5,
    completedAt: Date.UTC(2026, 9, 30, 19, 0),
  };
  it('builds the wire payload from a lesson-core completion', () => {
    expect(activityCompletedPayload(completion)).toEqual({
      kind: 'play',
      activity_id: 'play.x',
      topic_id: 't.x',
      concept_ids: ['c.1', 'c.2'],
      bundle_version: 'v3',
      locale: 'hi',
      stars: 2,
      ms_total: 0,
      completed_at: '2026-10-30T19:00:00.000Z',
    });
    expect(() => activityCompletedPayload({ ...completion, locale: 'ta' })).toThrow(RangeError);
  });
  it('dedupes by local day, credits stars and counts as a lesson', () => {
    const p = activityCompletedPayload(completion);
    expect(activityDedupeKey(p, 'Asia/Kolkata')).toBe('play.x|v3|2026-10-31');
    expect(activityDedupeKey(p, 'UTC')).toBe('play.x|v3|2026-10-30');
    expect(activityCompletedXp(3)).toBe(3);
    expect(activityCompletedXp(3, 2)).toBe(6);
    const days = activityByDay([{ type: 'activity_completed', occurred_at: p.completed_at }], 'Asia/Kolkata');
    expect(days.get('2026-10-31')?.lessonsCompleted).toBe(1);
  });
});
