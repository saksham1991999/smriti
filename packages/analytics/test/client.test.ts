import { describe, expect, it } from 'vitest';
import {
  AnalyticsClient,
  MemoryTransport,
  httpTransport,
  type AnalyticsClientOptions,
  type CommonContext,
  type EventDef,
  type GuardIssue,
  type PolicyContext,
  type Scheduler,
} from '../src/index';

/** Timers run only when the test says so. */
class ManualScheduler implements Scheduler {
  timers = new Map<number, { fn: () => void; ms: number }>();
  private next = 1;
  setTimeout(fn: () => void, ms: number) {
    const id = this.next++;
    this.timers.set(id, { fn, ms });
    return id;
  }
  clearTimeout(handle: unknown) {
    this.timers.delete(handle as number);
  }
  delays() {
    return [...this.timers.values()].map((t) => t.ms);
  }
  runAll() {
    const all = [...this.timers.entries()];
    this.timers.clear();
    for (const [, t] of all) t.fn();
  }
}

const context: CommonContext = { exam_profile: 'jee_main', platform: 'web', app_variant: 'jee', locale: 'hi', is_guest: false, tier: 'free' };

function setup(over: Partial<AnalyticsClientOptions> & { policyCtx?: Partial<PolicyContext> } = {}) {
  const transport = new MemoryTransport();
  const scheduler = new ManualScheduler();
  const issues: Array<{ event: string; code: string }> = [];
  let n = 0;
  const { policyCtx, ...rest } = over;
  const client = new AnalyticsClient({
    transport,
    scheduler,
    clock: () => Date.UTC(2026, 9, 30, 6, 0, 0),
    newId: () => `id-${++n}`,
    policy: () => ({ audience: 'adult', productAnalyticsOptIn: true, deferUntilConsent: false, guardianConsent: false, ...policyCtx }),
    context: () => context,
    onIssue: (event, issue: GuardIssue | { code: string }) => issues.push({ event, code: issue.code }),
    ...rest,
  });
  return { client, transport, scheduler, issues };
}

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

describe('AnalyticsClient', () => {
  it('queues a clean event with the common context and sends it on flush', async () => {
    const { client, transport, scheduler } = setup();
    const r = client.track('answer_submitted', { question_id: 'q_1', is_correct: true, time_ms: 4200, confidence: 'sure', context: 'lesson' });
    expect(r).toEqual({ queued: true, issues: [] });
    expect(client.pending()).toBe(1);
    expect(scheduler.delays()).toEqual([10_000]);
    expect(await client.flush()).toBe(1);
    expect(transport.events).toEqual([
      {
        event_id: 'id-1',
        name: 'answer_submitted',
        stream: 'learning',
        occurred_at: '2026-10-30T06:00:00.000Z',
        props: { question_id: 'q_1', is_correct: true, time_ms: 4200, confidence: 'sure', context: 'lesson' },
        context,
        audience: 'adult',
      },
    ]);
    expect(client.pending()).toBe(0);
    expect(scheduler.delays()).toEqual([]);
  });

  it('flushes on the timer', async () => {
    const { client, transport, scheduler } = setup();
    client.track('home_viewed', { hero_kind: 'review' });
    scheduler.runAll();
    await flushMicrotasks();
    expect(transport.events).toHaveLength(1);
  });

  it('sends a batch as soon as batchSize is reached, in batches of batchSize', async () => {
    const { client, transport } = setup({ batchSize: 3 });
    client.track('home_viewed');
    client.track('home_viewed');
    expect(transport.batches).toHaveLength(0);
    client.track('home_viewed');
    await flushMicrotasks();
    expect(transport.batches.map((b) => b.length)).toEqual([3]);
    for (let i = 0; i < 7; i++) client.track('home_viewed');
    await client.flush();
    expect(transport.batches.map((b) => b.length)).toEqual([3, 3, 3, 1]);
  });

  it('drops events the policy refuses and reports why', () => {
    const { client, issues } = setup({ policyCtx: { audience: 'teen' } });
    expect(client.track('home_viewed')).toEqual({ queued: false, reason: 'minor_not_allowed' });
    expect(client.track('account_deleted')).toEqual({ queued: false, reason: 'server_only' });
    // @ts-expect-error: not in the catalogue
    expect(client.track('made_up_event')).toEqual({ queued: false, reason: 'unknown_event' });
    expect(client.track('lesson_completed', { topic_id: 't1' }).queued).toBe(true);
    expect(client.pending()).toBe(1);
    expect(issues).toEqual([
      { event: 'home_viewed', code: 'minor_not_allowed' },
      { event: 'account_deleted', code: 'server_only' },
      { event: 'made_up_event', code: 'unknown_event' },
    ]);
  });

  it('never sends free text or personal data', async () => {
    const { client, transport, issues } = setup();
    // @ts-expect-error: `email` is not a prop of this event
    client.track('answer_submitted', { question_id: 'q 1 typed by me', email: 'a@b.co', confidence: 'not sure at all' });
    await client.flush();
    expect(transport.events[0]?.props).toEqual({});
    expect(issues.map((i) => i.code).sort()).toEqual(['blocked_name', 'free_text', 'free_text']);
  });

  it('retries with exponential backoff and keeps events while offline', async () => {
    const { client, transport, scheduler } = setup();
    transport.fail = true;
    client.track('home_viewed');
    scheduler.timers.clear();
    expect(await client.flush()).toBe(0);
    expect(scheduler.delays()).toEqual([1000]);
    scheduler.runAll();
    await flushMicrotasks();
    expect(scheduler.delays()).toEqual([2000]);
    scheduler.runAll();
    await flushMicrotasks();
    expect(scheduler.delays()).toEqual([4000]);
    expect(client.pending()).toBe(1);
    transport.fail = false;
    scheduler.runAll();
    await flushMicrotasks();
    expect(transport.events).toHaveLength(1);
    expect(client.pending()).toBe(0);
    // the backoff resets after a success
    transport.fail = true;
    client.track('home_viewed');
    scheduler.timers.clear();
    await client.flush();
    expect(scheduler.delays()).toEqual([1000]);
  });

  it('caps the backoff at five minutes', async () => {
    const { client, transport, scheduler } = setup();
    transport.fail = true;
    client.track('home_viewed');
    for (let i = 0; i < 12; i++) {
      scheduler.timers.clear();
      await client.flush();
    }
    expect(scheduler.delays()).toEqual([300_000]);
  });

  it('shares one in-flight flush', async () => {
    const { client, transport } = setup();
    client.track('home_viewed');
    const a = client.flush();
    const b = client.flush();
    expect(a).toBe(b);
    expect(await a).toBe(1);
    expect(transport.batches).toHaveLength(1);
  });

  it('keeps only the newest maxQueue events', async () => {
    const { client, transport } = setup({ maxQueue: 5, batchSize: 100 });
    for (let i = 0; i < 8; i++) client.track('home_viewed');
    expect(client.pending()).toBe(5);
    await client.flush();
    expect(transport.events.map((e) => e.event_id)).toEqual(['id-4', 'id-5', 'id-6', 'id-7', 'id-8']);
  });

  it('clear() drops the queue and the timer', () => {
    const { client, scheduler } = setup();
    client.track('home_viewed');
    client.clear();
    expect(client.pending()).toBe(0);
    expect(scheduler.delays()).toEqual([]);
  });

  it('sanitises the common context', async () => {
    const { client, transport } = setup({
      context: () => ({ ...context, exam_profile: 'my name is Ravi', app_variant: 'a@b.co', app_version: '1.2.3' }),
    });
    client.track('home_viewed');
    await client.flush();
    expect(transport.events[0]?.context).toEqual({ ...context, exam_profile: null, app_variant: 'unknown', app_version: '1.2.3' });
  });

  it('strips behavioural props for minors before the guard', async () => {
    const catalogue: Record<string, EventDef> = {
      share_tapped: { stream: 'product', essential: true, areas: ['x'], props: { share_target: { type: 'token' }, screen: { type: 'token' } } },
    };
    const { client, transport } = setup({ catalogue, policyCtx: { audience: 'child' } });
    // @ts-expect-error: a test-only catalogue
    client.track('share_tapped', { share_target: 'whatsapp', screen: 'ME-01' });
    await client.flush();
    expect(transport.events[0]?.props).toEqual({ screen: 'ME-01' });
    expect(transport.events[0]?.audience).toBe('child');
  });

  it('works without a scheduler (flush by hand)', async () => {
    const { client, transport } = setup({ scheduler: undefined });
    client.track('home_viewed');
    await client.flush();
    expect(transport.events).toHaveLength(1);
  });
});

describe('httpTransport', () => {
  it('posts JSON with headers', async () => {
    const calls: Array<{ url: string; init: { headers: Record<string, string>; body: string } }> = [];
    const t = httpTransport({
      url: 'https://api.example.test/v1/events',
      headers: () => ({ Authorization: 'Bearer t' }),
      fetch: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 202 };
      },
    });
    await t.send([]);
    expect(calls[0]?.url).toBe('https://api.example.test/v1/events');
    expect(calls[0]?.init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer t' });
    expect(JSON.parse(calls[0]?.init.body ?? '')).toEqual({ events: [] });
  });

  it('throws on 5xx (retry) but not on 400 (a bad batch is dropped)', async () => {
    const mk = (status: number) => httpTransport({ url: 'https://x.test', fetch: async () => ({ ok: status < 300, status }) });
    await expect(mk(503).send([])).rejects.toThrow('analytics http_503');
    await expect(mk(400).send([])).resolves.toBeUndefined();
  });
});
