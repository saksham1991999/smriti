/**
 * The sim shell. A sim supplies a definition (strings, family, conditions and
 * a `mount` function that builds its scene and controls); the shell does the
 * rest: bridge handshake, theme, locale, reduced motion, battery saver,
 * pause, reset, snapshots, readouts, announcements and resize.
 */

import {
  createSimClient,
  type Capability,
  type ConditionFn,
  type InitPayload,
  type JsonObject,
  type Locale,
  type ParamValues,
  type Reading,
  type RecordedMeasurement,
  type SimClient,
  type SimInitContext,
  type TaskSpec,
  type ThemeName,
} from '@smriti/sim-bridge';
import kitEn from '../strings.en.json';
import kitHi from '../strings.hi.json';
import { createAnnouncer, type Announcer } from './announce';
import { clear, h } from './dom';
import { createI18n, type I18n, type Strings } from './i18n';
import { createLoop, type Loop } from './loop';
import { applyTheme, type SubjectFamily } from './theme';
import { withUnit } from './units';

export interface SimRuntime {
  i18n: I18n;
  locale: Locale;
  theme: ThemeName;
  reducedMotion: boolean;
  lowPower: boolean;
  params: ParamValues;
  /** Where the sim draws its scene (SVG). */
  scene: HTMLElement;
  /** Where the sim puts its controls (below the scene, or beside it on wide screens). */
  controls: HTMLElement;
  /** Call after every model change: updates readouts, the host and the screen reader. */
  changed(opts?: { announce?: boolean }): void;
  /** A frame loop that the shell pauses with the sim. 30 fps in battery saver. */
  loop(onFrame: (dt: number) => void): Loop;
  announcer: Announcer;
  readonly paused: boolean;
}

export interface SimController {
  readings(): Reading[];
  /** Extra text readouts, for example "Real, inverted". */
  notes?(): string[];
  /** One-sentence description of the scene for screen readers. */
  summary(): string;
  /** What to announce after a change. Defaults to `summary()`. */
  announcement?(): string;
  record?(): RecordedMeasurement | null;
  reset(): void;
  snapshot(): JsonObject;
  restore(data: JsonObject): void;
  conditions: Record<string, ConditionFn>;
  pause?(): void;
  resume?(): void;
  destroy?(): void;
}

export interface SimDefinition {
  simId: string;
  simVersion: string;
  family: SubjectFamily;
  strings: Strings;
  /** Rule names the controller implements, for `condition` task checks. */
  conditionNames: string[];
  aspect?: string;
  preferredOrientation?: 'portrait' | 'landscape' | 'any';
  /** Defaults when the page is opened on its own (no host): the manifest's params and tasks. */
  standalone: { params: ParamValues; tasks: TaskSpec[] };
  mount(rt: SimRuntime): SimController;
}

export interface MountedSim {
  client: SimClient;
  controller(): SimController | null;
}

const SNAPSHOT_VERSION = 1;

function readQuery(): Partial<Omit<InitPayload, 'protocolVersion' | 'params' | 'tasks'>> {
  const q = new URLSearchParams(location.search);
  const out: Partial<Omit<InitPayload, 'protocolVersion' | 'params' | 'tasks'>> = {};
  const lang = q.get('lang');
  if (lang === 'en' || lang === 'hi') out.locale = lang;
  const theme = q.get('theme');
  if (theme === 'light' || theme === 'dark') out.theme = theme;
  if (q.has('rm')) out.reducedMotion = q.get('rm') === '1';
  if (q.has('lp')) out.lowPower = q.get('lp') === '1';
  return out;
}

function prefers(query: string): boolean {
  return typeof matchMedia === 'function' && matchMedia(query).matches;
}

export function mountSim(def: SimDefinition, host: HTMLElement = document.getElementById('app') ?? document.body): MountedSim {
  const strings: Strings = { en: { ...kitEn, ...def.strings.en }, hi: { ...kitHi, ...def.strings.hi } };
  const root = document.documentElement;

  let ctrl: SimController | null = null;
  let ctx: SimInitContext | null = null;
  let loops: Loop[] = [];
  let paused = false;
  let announcer: Announcer | null = null;
  let i18n: I18n | null = null;

  const stage = h('div', { class: 'sim-stage', role: 'region' });
  const scene = h('div', { class: 'sim-scene', role: 'img' });
  stage.append(scene);
  const readouts = h('div', { class: 'readouts', role: 'group' });
  const controls = h('div', { class: 'sim-controls', role: 'group' });
  const live = h('div', { class: 'sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const layout = h('main', { class: 'sim-root' }, stage, h('div', { class: 'sim-side' }, readouts, controls), live);
  host.append(layout);

  const renderReadouts = (list: Reading[], notes: string[]): void => {
    if (!i18n) return;
    clear(readouts);
    const locale = i18n.locale;
    for (const r of list) {
      if (!r.label) continue;
      const label = r.label[locale];
      readouts.append(
        h(
          'div',
          { class: 'readout', 'data-name': r.name },
          h('span', { class: 'readout-q' }, label),
          h('span', { class: 'readout-v tnum' }, withUnit(i18n.num(r.value, r.precision ?? 2), r.unit)),
        ),
      );
    }
    for (const n of notes) readouts.append(h('div', { class: 'readout readout-note' }, h('span', { class: 'readout-v' }, n)));
  };

  let client: SimClient;

  const changed = (opts: { announce?: boolean } = {}): void => {
    if (!ctrl) return;
    const list = ctrl.readings();
    const notes = ctrl.notes?.() ?? [];
    renderReadouts(list, notes);
    const summary = ctrl.summary();
    scene.setAttribute('aria-label', summary);
    client.setReadings(list);
    if (opts.announce !== false) announcer?.settle(ctrl.announcement?.() ?? summary);
  };

  const build = (c: SimInitContext, restoreData: JsonObject | null): void => {
    ctrl?.destroy?.();
    for (const l of loops) l.stop();
    loops = [];
    announcer?.destroy();
    clear(scene);
    clear(controls);
    ctx = c;
    i18n = createI18n(strings, c.locale);
    root.lang = c.locale;
    applyTheme(root, c.theme, def.family);
    root.dataset.reducedMotion = String(c.reducedMotion);
    root.dataset.lowPower = String(c.lowPower);
    document.title = i18n.t('title');
    stage.setAttribute('aria-label', i18n.t('kit.region', { title: i18n.t('title') }));
    readouts.setAttribute('aria-label', i18n.t('kit.readings'));
    controls.setAttribute('aria-label', i18n.t('kit.controls'));
    announcer = createAnnouncer(live);
    const rt: SimRuntime = {
      i18n,
      locale: c.locale,
      theme: c.theme,
      reducedMotion: c.reducedMotion,
      lowPower: c.lowPower,
      params: c.params,
      scene,
      controls,
      changed,
      loop(onFrame) {
        const l = createLoop({ fps: c.lowPower ? 30 : 60, onFrame });
        loops.push(l);
        return l;
      },
      announcer,
      get paused() {
        return paused;
      },
    };
    ctrl = def.mount(rt);
    if (restoreData) ctrl.restore(restoreData);
    changed({ announce: false });
  };

  const snapshot = (): JsonObject | null => (ctrl ? ctrl.snapshot() : null);

  const conditions: Record<string, ConditionFn> = {};
  for (const name of def.conditionNames) {
    conditions[name] = (args) => ctrl?.conditions[name]?.(args) ?? false;
  }

  const capabilities: Capability[] = ['tasks', 'record', 'pause', 'set_params', 'snapshot', 'resize'];
  client = createSimClient({
    simId: def.simId,
    simVersion: def.simVersion,
    capabilities,
    ...(def.aspect ? { aspect: def.aspect } : {}),
    ...(def.preferredOrientation ? { preferredOrientation: def.preferredOrientation } : {}),
    conditions,
    handlers: {
      init(c) {
        paused = false;
        build(c, null);
      },
      setParams(change) {
        if (!ctx) return;
        const next: SimInitContext = {
          ...ctx,
          ...(change.locale ? { locale: change.locale } : {}),
          ...(change.theme ? { theme: change.theme } : {}),
          ...(change.reducedMotion !== undefined ? { reducedMotion: change.reducedMotion } : {}),
          ...(change.lowPower !== undefined ? { lowPower: change.lowPower } : {}),
          params: change.params ? { ...ctx.params, ...change.params } : ctx.params,
        };
        const onlyTheme = Object.keys(change).every((k) => k === 'theme');
        if (onlyTheme) {
          ctx = next;
          applyTheme(root, next.theme, def.family);
          return;
        }
        // New params start fresh; locale and power changes keep the student's setup.
        build(next, change.params ? null : snapshot());
        if (paused) for (const l of loops) l.stop();
      },
      reset() {
        ctrl?.reset();
        changed();
      },
      pause() {
        paused = true;
        for (const l of loops) l.stop();
        ctrl?.pause?.();
        root.dataset.paused = 'true';
      },
      resume() {
        paused = false;
        root.dataset.paused = 'false';
        ctrl?.resume?.();
      },
      record() {
        return ctrl?.record?.() ?? null;
      },
      snapshot() {
        return { v: SNAPSHOT_VERSION, data: snapshot() ?? {} };
      },
      restore(s) {
        if (s.v !== SNAPSHOT_VERSION || !ctrl) return;
        ctrl.restore(s.data);
        changed({ announce: false });
      },
    },
  });

  window.addEventListener('error', (e) => {
    client.reportError('internal', e.message ? e.message.slice(0, 200) : 'script error');
  });

  if (typeof ResizeObserver === 'function') {
    let lastHeight = 0;
    new ResizeObserver(() => {
      const height = Math.ceil(layout.getBoundingClientRect().height);
      if (Math.abs(height - lastHeight) < 2) return;
      lastHeight = height;
      client.resize(height);
    }).observe(layout);
  }

  client.start();
  if (!client.embedded) {
    const q = readQuery();
    void client.startStandalone({
      locale: q.locale ?? 'en',
      theme: q.theme ?? (prefers('(prefers-color-scheme: dark)') ? 'dark' : 'light'),
      reducedMotion: q.reducedMotion ?? prefers('(prefers-reduced-motion: reduce)'),
      lowPower: q.lowPower ?? false,
      params: def.standalone.params,
      tasks: def.standalone.tasks,
    });
  }

  return { client, controller: () => ctrl };
}
