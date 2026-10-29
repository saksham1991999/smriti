import { describe, expect, it } from 'vitest';
import { HostSession, type HostEvent } from '../src/host/session';
import { simMessage, type HostToSimMessage } from '../src/protocol';
import { FakeClock, sampleTasks } from './helpers';

function setup(overrides: Partial<ConstructorParameters<typeof HostSession>[0]> = {}) {
  const clock = new FakeClock();
  const sent: HostToSimMessage[] = [];
  const events: HostEvent[] = [];
  const session = new HostSession({
    transport: { send: (m) => sent.push(m) },
    init: { locale: 'en', theme: 'light', reducedMotion: false, lowPower: false, params: {}, tasks: sampleTasks },
    clock,
    onEvent: (e) => events.push(e),
    ...overrides,
  });
  return { clock, sent, events, session };
}

const hello = simMessage('hello', { protocolVersion: '1.0.0', simId: 'ohms-law-circuit', simVersion: '1.0.0' });
const ready = simMessage('ready', {
  protocolVersion: '1.0.0',
  simId: 'ohms-law-circuit',
  simVersion: '1.0.0',
  capabilities: ['tasks', 'record'],
  readings: [{ name: 'current', value: 0.25, unit: 'A' }],
});

function boot(s: ReturnType<typeof setup>): void {
  s.session.start();
  s.session.receive(hello);
  s.session.receive(ready);
}

describe('HostSession handshake', () => {
  it('sends init with the protocol version after hello, then runs on ready', () => {
    const s = setup();
    s.session.start();
    expect(s.session.status).toBe('waiting_hello');
    s.clock.advance(300);
    s.session.receive(hello);
    expect(s.sent[0]?.type).toBe('init');
    expect(s.sent[0]?.type === 'init' && s.sent[0].payload.protocolVersion).toBe('1.0.0');
    // A repeated hello while initializing does not send a second init.
    s.session.receive(hello);
    expect(s.sent.filter((m) => m.type === 'init')).toHaveLength(1);
    s.clock.advance(200);
    s.session.receive(ready);
    expect(s.session.status).toBe('running');
    const readyEvent = s.events.find((e) => e.kind === 'ready');
    expect(readyEvent && readyEvent.kind === 'ready' && readyEvent.loadMs).toBe(500);
    expect(s.session.readings[0]?.value).toBe(0.25);
  });

  it('fails on a major version mismatch', () => {
    const s = setup();
    s.session.start();
    s.session.receive(simMessage('hello', { protocolVersion: '2.0.0', simId: 'x', simVersion: '1.0.0' }));
    expect(s.session.status).toBe('failed');
    expect(s.events.some((e) => e.kind === 'crashed' && e.reason === 'version_mismatch')).toBe(true);
    expect(s.sent).toHaveLength(0);
  });

  it('rejects a sim that is not the expected one', () => {
    const s = setup({ expectedSimId: 'simple-pendulum' });
    s.session.start();
    s.session.receive(hello);
    expect(s.sent).toHaveLength(0);
    expect(s.events.some((e) => e.kind === 'rejected' && e.reason === 'sim_id')).toBe(true);
  });

  it('emits timeout when ready does not arrive in time, and keepWaiting re-arms it', () => {
    const s = setup({ readyTimeoutMs: 8000 });
    s.session.start();
    s.session.receive(hello);
    s.clock.advance(7999);
    expect(s.events.some((e) => e.kind === 'timeout')).toBe(false);
    s.clock.advance(1);
    expect(s.events.filter((e) => e.kind === 'timeout')).toHaveLength(1);
    s.session.keepWaiting();
    s.clock.advance(8000);
    expect(s.events.filter((e) => e.kind === 'timeout')).toHaveLength(2);
    s.session.receive(ready);
    expect(s.session.status).toBe('running');
  });

  it('re-sends init with the last snapshot when the sim page reloads', () => {
    const s = setup();
    boot(s);
    s.session.receive(simMessage('state', { readings: [], snapshot: { v: 1, data: { voltage: 9 } } }));
    s.session.receive(hello);
    expect(s.events.some((e) => e.kind === 'reloaded')).toBe(true);
    const inits = s.sent.filter((m) => m.type === 'init');
    expect(inits).toHaveLength(2);
    const last = inits[1];
    expect(last?.type === 'init' && last.payload.snapshot?.data.voltage).toBe(9);
  });
});

describe('HostSession running', () => {
  it('rejects invalid and unexpected messages and fails after too many errors', () => {
    const s = setup({ maxErrors: 3 });
    s.session.start();
    s.session.receive(simMessage('state', { readings: [] })); // before ready
    s.session.receive('garbage');
    s.session.receive({ ns: 'smriti.sim', v: 1, type: 'state', payload: { readings: 'no' } });
    expect(s.events.filter((e) => e.kind === 'rejected')).toHaveLength(3);
    expect(s.session.status).toBe('waiting_hello');
    s.session.receive('garbage');
    expect(s.session.status).toBe('failed');
  });

  it('a fatal error from the sim fails the session', () => {
    const s = setup();
    boot(s);
    s.session.receive(simMessage('error', { code: 'render_failed', message: 'no webgl', fatal: true }));
    expect(s.session.status).toBe('failed');
  });

  it('throttles state to maxStateHz and delivers the latest', () => {
    const s = setup({ maxStateHz: 10 });
    boot(s);
    const states = () => s.events.filter((e) => e.kind === 'message' && e.message.type === 'state');
    for (let i = 1; i <= 5; i += 1) {
      s.session.receive(simMessage('state', { readings: [{ name: 'current', value: i, unit: 'A' }] }));
    }
    expect(states()).toHaveLength(1);
    s.clock.advance(100);
    expect(states()).toHaveLength(2);
    expect(s.session.readings[0]?.value).toBe(5);
  });

  it('tracks task results, tries, hints, skips and completion', () => {
    const s = setup();
    boot(s);
    s.session.check('t1');
    expect(s.sent.at(-1)).toMatchObject({ type: 'check', payload: { taskId: 't1' } });
    s.session.receive(simMessage('task_result', { taskId: 't1', correct: false, quantity: 'current' }));
    s.session.receive(simMessage('task_result', { taskId: 't1', correct: false, quantity: 'current' }));
    expect(s.session.shouldShowHint('t1')).toBe(true);
    s.session.receive(simMessage('task_result', { taskId: 't1', correct: true }));
    expect(s.session.taskProgress()[0]).toMatchObject({ status: 'correct', tries: 2, checkedBy: 'sim' });
    s.session.skip('t2');
    expect(s.session.status).toBe('complete');
    // Unknown task ids are rejected.
    s.session.receive(simMessage('task_result', { taskId: 'nope', correct: true }));
    expect(s.events.some((e) => e.kind === 'rejected' && e.detail === 'unknown task nope')).toBe(true);
  });

  it('pause and resume change status and send messages', () => {
    const s = setup();
    boot(s);
    s.session.pause();
    expect(s.session.status).toBe('paused');
    expect(s.sent.at(-1)?.type).toBe('pause');
    s.session.resume();
    expect(s.session.status).toBe('running');
    expect(s.sent.at(-1)?.type).toBe('resume');
  });

  it('set_params merges into the init used for a reload', () => {
    const s = setup();
    boot(s);
    s.session.setParams({ lowPower: true, params: { voltage: 3 } });
    expect(s.sent.at(-1)).toMatchObject({ type: 'set_params', payload: { lowPower: true } });
    s.session.receive(hello);
    const init = s.sent.filter((m) => m.type === 'init').at(-1);
    expect(init?.type === 'init' && init.payload.lowPower).toBe(true);
    expect(init?.type === 'init' && init.payload.params.voltage).toBe(3);
  });

  it('save resolves with the snapshot reply', async () => {
    const s = setup();
    boot(s);
    const pending = s.session.save();
    expect(s.sent.at(-1)?.type).toBe('save');
    s.session.receive(simMessage('snapshot', { snapshot: { v: 1, data: { a: 1 } } }));
    await expect(pending).resolves.toEqual({ v: 1, data: { a: 1 } });
  });

  it('save falls back to the last state snapshot on timeout', async () => {
    const s = setup();
    boot(s);
    s.session.receive(simMessage('state', { readings: [], snapshot: { v: 1, data: { b: 2 } } }));
    const pending = s.session.save();
    s.clock.advance(2000);
    await expect(pending).resolves.toEqual({ v: 1, data: { b: 2 } });
  });

  it('collects measurements and checks host-side for sims without results', () => {
    const s = setup({
      init: {
        locale: 'en',
        theme: 'light',
        reducedMotion: false,
        lowPower: false,
        params: {},
        tasks: [
          {
            id: 'eq',
            prompt: { en: 'Record the end point volume', hi: 'अंत बिंदु का आयतन दर्ज करें' },
            check: { kind: 'target', quantity: 'volume', value: 25, tolerance: 0.1, on: 'last_recorded' },
          },
        ],
      },
    });
    boot(s);
    expect(s.session.checkLocally('eq', { name: 'volume', value: 24.5, unit: 'mL' })).toMatchObject({ correct: false });
    expect(s.session.checkLocally('eq', { name: 'volume', value: 25.05, unit: 'mL' })).toEqual({ correct: true });
    expect(s.session.measurements).toHaveLength(2);
    expect(s.session.taskProgress()[0]).toMatchObject({ status: 'correct', checkedBy: 'host', tries: 1 });
    expect(s.session.status).toBe('complete');
  });

  it('destroy stops everything', () => {
    const s = setup();
    boot(s);
    s.session.destroy();
    s.session.receive(simMessage('state', { readings: [] }));
    expect(s.session.status).toBe('destroyed');
    expect(s.clock.pending).toBe(0);
  });
});
