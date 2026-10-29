/**
 * End-to-end over fake windows: the iframe host and the sim SDK talk exactly
 * as they would in a browser (source and origin checks included).
 */
import { describe, expect, it } from 'vitest';
import { createIframeHost } from '../src/host/iframe';
import type { HostEvent } from '../src/host/session';
import { createWebViewHost, injectionScript } from '../src/host/webview';
import { hostMessage, type ParamValues, type Reading, type SimSnapshot } from '../src/protocol';
import { SimClient, type SimWindowLike } from '../src/sim/client';
import { FakeClock, flush, sampleTasks } from './helpers';

type Listener = (event: { data: unknown; origin: string; source: unknown }) => void;

class FakeWindow implements SimWindowLike {
  listeners = new Set<Listener>();
  ReactNativeWebView?: { postMessage(data: string): void };
  SmritiSimBridge?: { receive(raw: unknown): void; version: string };
  addEventListener(_type: 'message', fn: Listener): void {
    this.listeners.add(fn);
  }
  removeEventListener(_type: 'message', fn: Listener): void {
    this.listeners.delete(fn);
  }
  dispatch(data: unknown, origin: string, source: unknown): void {
    for (const fn of [...this.listeners]) fn({ data: structuredClone(data), origin, source });
  }
}

const HOST_ORIGIN = 'https://app.smriti.test';

/** A tiny Ohm's-law "sim" driven by the SDK. */
function makeSim(simWin: FakeWindow, parent: { postMessage(m: unknown, o: string): void } | null, clock: FakeClock) {
  let params: ParamValues = {};
  const state = { voltage: 3, resistance: 12, paused: false };
  const readings = (): Reading[] => [
    { name: 'voltage', value: state.voltage, unit: 'V' },
    { name: 'resistance', value: state.resistance, unit: 'Ω' },
    { name: 'current', value: state.voltage / state.resistance, unit: 'A' },
  ];
  const client: SimClient = new SimClient({
    simId: 'ohms-law-circuit',
    simVersion: '1.0.0',
    capabilities: ['tasks', 'record', 'pause', 'snapshot', 'set_params'],
    self: simWin,
    parent,
    clock,
    conditions: { high_voltage: () => state.voltage > 10 },
    handlers: {
      init(ctx) {
        params = ctx.params;
        if (typeof params.voltage === 'number') state.voltage = params.voltage;
        client.setReadings(readings());
      },
      reset() {
        state.voltage = 3;
        state.resistance = 12;
        client.setReadings(readings());
      },
      pause() {
        state.paused = true;
      },
      resume() {
        state.paused = false;
      },
      record() {
        const r = readings();
        return { name: 'current', value: state.voltage / state.resistance, unit: 'A', context: r.filter((x) => x.name !== 'current') };
      },
      snapshot(): SimSnapshot {
        return { v: 1, data: { voltage: state.voltage, resistance: state.resistance } };
      },
      restore(s) {
        state.voltage = Number(s.data.voltage);
        state.resistance = Number(s.data.resistance);
        client.setReadings(readings());
      },
    },
  });
  const set = (voltage: number, resistance: number): void => {
    state.voltage = voltage;
    state.resistance = resistance;
    client.setReadings(readings());
  };
  return { client, state, set };
}

function iframePair() {
  const clock = new FakeClock();
  const hostWin = new FakeWindow();
  const simWin = new FakeWindow();
  // `parentRef` is what the sim sees as window.parent; `contentWindow` is the iframe's window as the host sees it.
  const parentRef = {
    postMessage: (m: unknown) => hostWin.dispatch(m, 'null', contentWindow),
  };
  const contentWindow = {
    postMessage: (m: unknown) => simWin.dispatch(m, HOST_ORIGIN, parentRef),
  };
  const sim = makeSim(simWin, parentRef, clock);
  const events: HostEvent[] = [];
  const host = createIframeHost({
    iframe: { contentWindow },
    allowedOrigins: ['https://sims.smriti.test'],
    allowOpaqueOrigin: true,
    win: hostWin,
    init: { locale: 'hi', theme: 'dark', reducedMotion: true, lowPower: true, params: { voltage: 6 }, tasks: sampleTasks },
    clock,
    onEvent: (e) => events.push(e),
    pauseWhenHidden: false,
  });
  return { clock, hostWin, simWin, parentRef, contentWindow, sim, host, events };
}

describe('iframe host ↔ sim SDK', () => {
  it('handshakes, plays both tasks, records and completes', async () => {
    const p = iframePair();
    p.sim.client.start();
    await flush();
    expect(p.host.session.status).toBe('running');
    expect(p.sim.client.context).toMatchObject({ locale: 'hi', theme: 'dark', reducedMotion: true, lowPower: true });
    expect(p.host.session.readings.find((r) => r.name === 'current')?.value).toBeCloseTo(0.5);

    // Task 1: current is already 0.5 A because init set 6 V across 12 Ω.
    p.host.session.check('t1');
    await flush();
    expect(p.host.session.taskProgress()[0]?.status).toBe('correct');

    // Task 2: double the current while holding the voltage.
    p.host.session.setActiveTask('t2');
    await flush();
    p.sim.set(12, 12); // doubled by voltage: not allowed
    p.host.session.check('t2');
    await flush();
    expect(p.host.session.taskProgress()[1]).toMatchObject({ status: 'wrong', quantity: 'voltage' });
    p.sim.set(6, 6);
    p.host.session.check('t2');
    await flush();
    expect(p.host.session.taskProgress()[1]?.status).toBe('correct');
    expect(p.events.some((e) => e.kind === 'message' && e.message.type === 'complete')).toBe(true);
    expect(p.host.session.status).toBe('complete');

    p.host.session.record('t2');
    await flush();
    expect(p.host.session.measurements[0]).toMatchObject({ name: 'current', value: 1, unit: 'A', taskId: 't2' });
  });

  it('keeps sending hello until the host answers', async () => {
    const p = iframePair();
    // Host not listening yet: drop the first hellos.
    const listeners = [...p.hostWin.listeners];
    p.hostWin.listeners.clear();
    p.sim.client.start();
    p.clock.advance(800);
    for (const l of listeners) p.hostWin.listeners.add(l);
    p.clock.advance(400);
    await flush();
    expect(p.host.session.status).toBe('running');
  });

  it('ignores messages from other frames and rejects wrong origins', async () => {
    const p = iframePair();
    p.sim.client.start();
    await flush();
    const before = p.events.length;
    p.hostWin.dispatch({ ns: 'smriti.sim', v: 1, type: 'complete', payload: { tasksDone: 2, tasksTotal: 2 } }, 'null', {});
    expect(p.events.length).toBe(before);
    p.hostWin.dispatch({ ns: 'smriti.sim', v: 1, type: 'complete', payload: { tasksDone: 2, tasksTotal: 2 } }, 'https://evil.test', p.contentWindow);
    expect(p.events.at(-1)).toMatchObject({ kind: 'rejected', reason: 'origin' });
    expect(p.host.session.status).toBe('running');
  });

  it('the sim pins the host origin from init', async () => {
    const p = iframePair();
    p.sim.client.start();
    await flush();
    // A different origin speaking through the same parent is ignored.
    p.simWin.dispatch(hostMessage('reset', {}), 'https://evil.test', p.parentRef);
    p.sim.set(9, 9);
    p.simWin.dispatch(hostMessage('reset', {}), 'https://evil.test', p.parentRef);
    expect(p.sim.state.voltage).toBe(9);
    p.host.session.reset();
    await flush();
    expect(p.sim.state.voltage).toBe(3);
  });

  it('pause, resume, save and restore go through', async () => {
    const p = iframePair();
    p.sim.client.start();
    await flush();
    p.host.session.pause();
    expect(p.sim.state.paused).toBe(true);
    p.host.session.resume();
    expect(p.sim.state.paused).toBe(false);
    p.sim.set(4.5, 9);
    const snap = await p.host.session.save();
    expect(snap.data).toEqual({ voltage: 4.5, resistance: 9 });
    p.sim.set(1, 1);
    p.host.session.restore(snap);
    await flush();
    expect(p.sim.state).toMatchObject({ voltage: 4.5, resistance: 9 });
  });

  it('the sim refuses an incompatible init', async () => {
    const p = iframePair();
    p.sim.client.start();
    await flush();
    const errors: unknown[] = [];
    p.host.session.subscribe((e) => {
      if (e.kind === 'message' && e.message.type === 'error') errors.push(e.message.payload);
    });
    p.simWin.dispatch(
      hostMessage('init', { ...hostMessage('init', { protocolVersion: '2.0.0', locale: 'en', theme: 'light', reducedMotion: false, lowPower: false, params: {}, tasks: [] }).payload }),
      HOST_ORIGIN,
      p.parentRef,
    );
    await flush();
    expect(errors[0]).toMatchObject({ code: 'version_mismatch', fatal: true });
  });

  it('pauses when the page is hidden', async () => {
    const clock = new FakeClock();
    const hostWin = new FakeWindow();
    const simWin = new FakeWindow();
    const parentRef = { postMessage: (m: unknown) => hostWin.dispatch(m, 'null', contentWindow) };
    const contentWindow = { postMessage: (m: unknown) => simWin.dispatch(m, HOST_ORIGIN, parentRef) };
    const sim = makeSim(simWin, parentRef, clock);
    let onVis: () => void = () => undefined;
    const doc = {
      hidden: false,
      addEventListener: (_t: 'visibilitychange', fn: () => void) => {
        onVis = fn;
      },
      removeEventListener: () => undefined,
    };
    const host = createIframeHost({
      iframe: { contentWindow },
      allowedOrigins: [],
      win: hostWin,
      doc,
      clock,
      init: { locale: 'en', theme: 'light', reducedMotion: false, lowPower: false, params: {}, tasks: [] },
    });
    sim.client.start();
    await flush();
    doc.hidden = true;
    onVis();
    expect(host.session.status).toBe('paused');
    expect(sim.state.paused).toBe(true);
    doc.hidden = false;
    onVis();
    expect(host.session.status).toBe('running');
    host.destroy();
  });
});

describe('React Native WebView host ↔ sim SDK', () => {
  it('handshakes through injectJavaScript and ReactNativeWebView.postMessage', async () => {
    const clock = new FakeClock();
    const simWin = new FakeWindow();
    const url = 'file:///data/app/sims/ohms-law-circuit/1.0.0/index.html';
    let onMessage: ((e: { nativeEvent: { data: string; url?: string } }) => void) | null = null;
    simWin.ReactNativeWebView = {
      postMessage: (data: string) => onMessage?.({ nativeEvent: { data, url } }),
    };
    const sim = makeSim(simWin, null, clock);
    const injected: string[] = [];
    const host = createWebViewHost({
      injectJavaScript: (js) => {
        injected.push(js);
        // Evaluate the injected script against the fake window, as the WebView would.
        new Function('window', js)(simWin);
      },
      allowedUrlPrefixes: ['file:///data/app/sims/ohms-law-circuit/1.0.0/'],
      init: { locale: 'en', theme: 'light', reducedMotion: false, lowPower: false, params: {}, tasks: sampleTasks },
      clock,
    });
    onMessage = host.onMessage;
    sim.client.start();
    await flush();
    expect(host.session.status).toBe('running');
    expect(injected[0]).toContain('SmritiSimBridge');
    sim.set(6, 12);
    host.session.check('t1');
    await flush();
    expect(host.session.taskProgress()[0]?.status).toBe('correct');

    // Messages reported from another URL are refused.
    const events: HostEvent[] = [];
    host.session.subscribe((e) => events.push(e));
    host.onMessage({ nativeEvent: { data: '{}', url: 'https://evil.test/' } });
    expect(events[0]).toMatchObject({ kind: 'rejected', reason: 'origin' });
    expect(host.shouldStartLoad('https://evil.test/')).toBe(false);
    expect(host.shouldStartLoad(url)).toBe(true);
  });

  it('injection survives quotes, line separators and script tags', () => {
    const msg = hostMessage('set_params', { params: { label: 'a"b\'c d</script>' } });
    const js = injectionScript(msg);
    expect(js).not.toContain(' ');
    expect(js).not.toMatch(/<\/script/i);
    let received: unknown = null;
    new Function('window', js)({ SmritiSimBridge: { receive: (raw: unknown) => (received = raw) } });
    expect(JSON.parse(String(received))).toEqual(msg);
  });
});

describe('SimClient on its own', () => {
  it('throttles state to maxStateHz with a trailing send', async () => {
    const clock = new FakeClock();
    const posted: Array<{ type: string }> = [];
    const parent = { postMessage: (m: unknown) => posted.push(m as { type: string }) };
    const simWin = new FakeWindow();
    const client = new SimClient({
      simId: 's',
      simVersion: '1.0.0',
      self: simWin,
      parent,
      clock,
      maxStateHz: 10,
      handlers: { init: () => undefined },
    });
    client.start();
    simWin.dispatch(
      hostMessage('init', { protocolVersion: '1.0.0', locale: 'en', theme: 'light', reducedMotion: false, lowPower: false, params: {}, tasks: [] }),
      HOST_ORIGIN,
      parent,
    );
    await flush();
    for (let i = 0; i < 10; i += 1) client.setReadings([{ name: 'x', value: i, unit: '' }]);
    expect(posted.filter((m) => m.type === 'state')).toHaveLength(1);
    clock.advance(100);
    const states = posted.filter((m) => m.type === 'state') as Array<{ type: string; payload: { readings: Reading[] } }>;
    expect(states).toHaveLength(2);
    expect(states[1]?.payload.readings[0]?.value).toBe(9);
  });

  it('runs standalone without posting anything', async () => {
    const posted: unknown[] = [];
    let inited = false;
    const client = new SimClient({
      simId: 's',
      simVersion: '1.0.0',
      self: new FakeWindow(),
      parent: null,
      handlers: {
        init: () => {
          inited = true;
        },
      },
    });
    client.start();
    await client.startStandalone({ locale: 'en', theme: 'light', reducedMotion: false, lowPower: false, params: {}, tasks: [] });
    client.setReadings([{ name: 'x', value: 1, unit: '' }]);
    expect(inited).toBe(true);
    expect(client.embedded).toBe(false);
    expect(posted).toHaveLength(0);
  });

  it('reports handler failures as errors instead of throwing', async () => {
    const clock = new FakeClock();
    const posted: Array<{ type: string; payload: { code?: string } }> = [];
    const parent = { postMessage: (m: unknown) => posted.push(m as { type: string; payload: { code?: string } }) };
    const simWin = new FakeWindow();
    const client = new SimClient({
      simId: 's',
      simVersion: '1.0.0',
      self: simWin,
      parent,
      clock,
      handlers: {
        init: () => {
          throw new Error('no canvas');
        },
      },
    });
    client.start();
    simWin.dispatch(
      hostMessage('init', { protocolVersion: '1.0.0', locale: 'en', theme: 'light', reducedMotion: false, lowPower: false, params: {}, tasks: [] }),
      HOST_ORIGIN,
      parent,
    );
    await flush();
    expect(posted.find((m) => m.type === 'error')?.payload.code).toBe('init_failed');
    expect(posted.some((m) => m.type === 'ready')).toBe(false);
  });
});
