import '@smriti/sim-kit/styles.css';
import './sim.css';
import type { JsonObject, Reading, TaskSpec } from '@smriti/sim-bridge';
import {
  attr,
  booleanParam,
  button,
  defaultParams,
  familyForSubject,
  group,
  h,
  icon,
  mountSim,
  numberParam,
  rangeOf,
  readingMaker,
  resolveParams,
  slider,
  spokenValue,
  svg,
  toggle,
  withUnit,
  type ParamsSchema,
  type SimController,
  type SimManifest,
  type SimRuntime,
} from '@smriti/sim-kit';
import manifestJson from '../manifest.json';
import en from '../strings.en.json';
import hi from '../strings.hi.json';
import { apexTime, clean, maxHeight, niceCeil, pathPoints, positionAt, range, snapStep, tickStep, timeOfFlight, vx, vy, type Launch } from './model';

const manifest = manifestJson as unknown as SimManifest;
const schema = manifest.params as ParamsSchema;
const reading = readingMaker(manifest);
/** Readings the tasks need but the readout row does not show (the sliders already do). */
const hidden = (name: string, value: number, precision: number): Reading => {
  const { label: _label, ...rest } = reading(name, value, precision);
  return rest;
};

const W = 400;
const H = 250;
const OX = 44;
const GY = 212;
const PW = W - OX - 16;
const PH = GY - 20;
const STEP_S = 0.05;
const MAX_KEPT = 3;
const V_RANGE = rangeOf(schema, 'v0');

type Phase = 'ready' | 'flying' | 'landed';

function mount(rt: SimRuntime): SimController {
  const { i18n } = rt;
  const p = resolveParams(schema, rt.params);
  const g = numberParam(p, 'g');
  const h0 = numberParam(p, 'h0');
  const initial = { v0: numberParam(p, 'v0'), angle: numberParam(p, 'angle'), keep: booleanParam(p, 'keepPaths') };
  const cfg = { ...initial };
  let phase: Phase = 'ready';
  let flight: Launch | null = null;
  let t = 0;
  let playing = false;
  let kept: Launch[] = [];
  const samples = rt.lowPower ? 40 : 90;

  const setting = (): Launch => ({ v0: cfg.v0, angle: cfg.angle, g, h0 });
  const spoken = (v: number, d: number, unit: string): string => spokenValue(i18n.num(clean(v), d), clean(v), unit, i18n.locale);

  /* ------------------------------------------------------------- scale */

  // One fixed, equal scale on both axes for this g and h0, big enough for the fastest launch at
  // any angle, so paths keep their true shape and stay comparable as the sliders move.
  let xMax = 1;
  let yMax = 1;
  let scale = 1;
  // One equal scale on both axes, so paths keep their true shape: big enough for the fastest of the
  // current and kept launches at any angle, so paths at one speed compare at a good size.
  const fitScale = (): void => {
    const vmax = Math.max(cfg.v0, ...kept.map((l) => l.v0));
    let farthest = 0;
    for (let a = 0; a <= 90; a += 1) farthest = Math.max(farthest, range({ v0: vmax, angle: a, g, h0 }));
    xMax = niceCeil(farthest * 1.02);
    yMax = niceCeil(maxHeight({ v0: vmax, angle: 90, g, h0 }) * 1.02);
    scale = Math.min(PW / xMax, PH / yMax);
  };
  const sx = (x: number): number => OX + x * scale;
  const sy = (y: number): number => GY - y * scale;
  const f1 = (n: number): string => n.toFixed(1);

  /* ------------------------------------------------------------- scene */

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'projectile', 'aria-hidden': 'true' });
  const axes = svg('g', { class: 'axes' });
  const keptLayer = svg('g', { class: 'kept-layer' });
  const marks = svg('g', { class: 'marks' });
  const current = svg('polyline', { class: 'path-current', points: '' });
  const launcher = svg('g', { class: 'launcher' });
  const arrows = svg('g', { class: 'arrows' });
  const ball = svg('circle', { r: 6, class: 'ball' });
  root.append(axes, keptLayer, marks, current, launcher, arrows, ball);
  rt.scene.append(root);

  const drawAxes = (): void => {
    while (axes.firstChild) axes.firstChild.remove();
    fitScale();
    const xs = tickStep(xMax);
    const visibleY = (GY - 12) / scale;
    const ys = tickStep(Math.min(yMax, visibleY));
    axes.append(
      svg('line', { x1: OX, y1: GY, x2: W - 10, y2: GY, class: 'ground' }),
      svg('line', { x1: OX, y1: GY, x2: OX, y2: 10, class: 'axis' }),
    );
    for (let x = xs; sx(x) <= W - 12; x += xs) {
      axes.append(
        svg('line', { x1: f1(sx(x)), y1: GY, x2: f1(sx(x)), y2: GY + 5, class: 'tick' }),
        svg('text', { x: f1(sx(x)), y: GY + 17, class: 'sv-text sv-muted small', 'text-anchor': 'middle' }, i18n.num(x, 0)),
      );
    }
    for (let y = ys; sy(y) >= 14; y += ys) {
      axes.append(
        svg('line', { x1: OX - 5, y1: f1(sy(y)), x2: OX, y2: f1(sy(y)), class: 'tick' }),
        svg('line', { x1: OX, y1: f1(sy(y)), x2: W - 10, y2: f1(sy(y)), class: 'grid' }),
        svg('text', { x: OX - 8, y: f1(sy(y)), class: 'sv-text sv-muted small', 'text-anchor': 'end', 'dominant-baseline': 'central' }, i18n.num(y, 0)),
      );
    }
    axes.append(
      svg('text', { x: OX - 8, y: GY + 17, class: 'sv-text sv-muted small', 'text-anchor': 'end' }, '0'),
      svg('text', { x: W - 12, y: GY + 30, class: 'sv-text sv-muted small', 'text-anchor': 'end' }, i18n.t('axis.x')),
      svg('text', { x: 6, y: 12, class: 'sv-text sv-muted small' }, i18n.t('axis.y')),
    );
    if (h0 > 0) axes.append(svg('line', { x1: OX, y1: GY, x2: OX, y2: f1(sy(h0)), class: 'platform' }));
  };

  const points = (l: Launch, until?: number): string =>
    pathPoints(l, samples, until)
      .map((pt) => `${f1(sx(pt.x))},${f1(sy(pt.y))}`)
      .join(' ');

  const drawKept = (): void => {
    while (keptLayer.firstChild) keptLayer.firstChild.remove();
    // Each earlier path has its own dash pattern and an angle label at its landing point: not colour alone.
    kept.forEach((l, i) => {
      const top = positionAt(l, apexTime(l));
      keptLayer.append(
        svg('polyline', { points: points(l), class: `path-kept kept-${i}` }),
        svg('text', { x: f1(sx(top.x)), y: f1(sy(top.y) - 6), class: 'sv-text kept-label', 'text-anchor': 'middle' }, `${i18n.num(l.angle, 0)}°`),
      );
    });
  };

  const drawLauncher = (): void => {
    while (launcher.firstChild) launcher.firstChild.remove();
    const a = (cfg.angle * Math.PI) / 180;
    const bx = sx(0);
    const by = sy(h0);
    launcher.append(
      svg('line', { x1: bx, y1: f1(by), x2: f1(bx + 26 * Math.cos(a)), y2: f1(by - 26 * Math.sin(a)), class: 'barrel' }),
      svg('circle', { cx: bx, cy: f1(by), r: 7, class: 'base' }),
    );
  };

  const arrow = (x1: number, y1: number, x2: number, y2: number, cls: string, label: string, anchor: 'start' | 'end' | 'middle'): SVGGElement => {
    const g2 = svg('g', { class: cls });
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 3) return g2;
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    const head = `M ${f1(x2)} ${f1(y2)} L ${f1(x2 - 8 * ux - 4 * uy)} ${f1(y2 - 8 * uy + 4 * ux)} L ${f1(x2 - 8 * ux + 4 * uy)} ${f1(y2 - 8 * uy - 4 * ux)} Z`;
    g2.append(
      svg('line', { x1: f1(x1), y1: f1(y1), x2: f1(x2 - 6 * ux), y2: f1(y2 - 6 * uy), class: 'arrow-shaft' }),
      svg('path', { d: head, class: 'arrow-head' }),
      svg('text', { x: f1(x2 + 8 * ux), y: f1(y2 + 8 * uy), class: 'sv-text arrow-label', 'text-anchor': anchor, 'dominant-baseline': 'central' }, label),
    );
    return g2;
  };

  const drawNow = (): void => {
    const l = flight ?? setting();
    const pos = flight ? positionAt(flight, t) : { x: 0, y: h0 };
    const bx = sx(pos.x);
    const by = sy(Math.max(0, pos.y));
    attr(ball, { cx: f1(bx), cy: f1(by) });
    attr(current, { points: flight && t > 0 ? points(flight, t) : '' });
    while (arrows.firstChild) arrows.firstChild.remove();
    while (marks.firstChild) marks.firstChild.remove();
    if (phase === 'flying' || phase === 'ready') {
      // Velocity components at the ball: vx stays the same; vy shrinks, flips and grows.
      const k = 60 / V_RANGE.max;
      const vxNow = vx(l);
      const vyNow = vy(l, flight ? t : 0);
      arrows.append(
        arrow(bx, by, bx + vxNow * k, by, 'arrow arrow-vx', i18n.t('arrow.vx'), 'start'),
        arrow(bx, by, bx, by - vyNow * k, 'arrow arrow-vy', i18n.t('arrow.vy'), 'middle'),
      );
    }
    if (phase === 'landed' && flight) {
      const ta = apexTime(flight);
      const apex = positionAt(flight, ta);
      marks.append(
        svg('line', { x1: f1(sx(apex.x)), y1: f1(sy(apex.y)), x2: f1(sx(apex.x)), y2: GY, class: 'apex-line' }),
        svg('circle', { cx: f1(sx(apex.x)), cy: f1(sy(apex.y)), r: 3.5, class: 'apex-dot' }),
        svg('text', { x: f1(sx(apex.x) + 6), y: f1(sy(apex.y) - 8), class: 'sv-text mark-label' }, `H = ${withUnit(i18n.num(maxHeight(flight), 2), 'm')}`),
        svg(
          'text',
          { x: f1(sx(range(flight)) + (sx(range(flight)) > W - 90 ? -8 : 8)), y: GY - 8, class: 'sv-text mark-label', 'text-anchor': sx(range(flight)) > W - 90 ? 'end' : 'start' },
          `R = ${withUnit(i18n.num(range(flight), 2), 'm')}`,
        ),
      );
    }
  };

  /** Everything that depends on the scale, which follows the speeds on screen. */
  const redraw = (): void => {
    drawAxes();
    drawLauncher();
    drawKept();
    drawNow();
  };

  /* --------------------------------------------------------- flight */

  const results = (): { R: number; H: number; T: number } | null =>
    phase === 'landed' && flight ? { R: range(flight), H: maxHeight(flight), T: timeOfFlight(flight) } : null;

  const shelve = (): void => {
    // A finished flight joins the kept paths (newest first) when "Keep earlier paths" is on.
    if (phase === 'landed' && flight && cfg.keep) kept = [flight, ...kept].slice(0, MAX_KEPT);
    redraw();
  };

  const land = (): void => {
    if (!flight) return;
    t = timeOfFlight(flight);
    phase = 'landed';
    playing = false;
    syncPlay();
    drawNow();
    const r = results();
    if (r) rt.announcer.now(i18n.t('announce_landed', { R: spoken(r.R, 2, 'm'), H: spoken(r.H, 2, 'm'), T: spoken(r.T, 2, 's') }));
    rt.changed({ announce: false });
  };

  let lastSent = 0;
  const advance = (dt: number, report: boolean): void => {
    if (!flight) return;
    const next = t + dt;
    if (next >= timeOfFlight(flight) - 1e-9) {
      land();
      return;
    }
    t = next;
    drawNow();
    if (report) rt.changed({ announce: false });
  };

  const loop = rt.loop((dt) => {
    const send = t - lastSent >= 0.1;
    if (send) lastSent = t;
    advance(dt, send);
  });

  const syncPlay = (): void => {
    const run = playing && !rt.paused && phase === 'flying';
    if (run && !loop.running) loop.start();
    if (!run && loop.running) loop.stop();
    if (playBtn) {
      playBtn.replaceChildren(icon(playing ? 'pause' : 'play'), h('span', {}, i18n.t(playing ? 'pause' : 'play')));
      playBtn.disabled = phase !== 'flying';
    }
  };

  const start = (): void => {
    shelve();
    flight = setting();
    t = 0;
    lastSent = 0;
    phase = 'flying';
  };

  const launch = (): void => {
    start();
    if (rt.reducedMotion) {
      // Reduced motion: the finished path at once (sim-builder); Step follows a flight instead.
      land();
      return;
    }
    playing = true;
    syncPlay();
    drawNow();
    rt.changed({ announce: false });
  };

  const settingsChanged = (): void => {
    shelve();
    flight = null;
    phase = 'ready';
    t = 0;
    playing = false;
    syncPlay();
    drawLauncher();
    drawNow();
    rt.changed();
  };

  /* ---------------------------------------------------------- controls */

  const vSlider = slider({
    id: 'v0',
    label: i18n.t('v0'),
    ...V_RANGE,
    unit: 'm/s',
    decimals: 1,
    value: cfg.v0,
    i18n,
    onInput: (v) => {
      cfg.v0 = v;
      settingsChanged();
    },
  });
  const aSlider = slider({
    id: 'angle',
    label: i18n.t('angle'),
    ...rangeOf(schema, 'angle'),
    unit: '°',
    decimals: 0,
    value: cfg.angle,
    i18n,
    onInput: (v) => {
      cfg.angle = v;
      settingsChanged();
    },
  });
  const keepToggle = toggle({
    id: 'keep',
    label: i18n.t('keep'),
    checked: cfg.keep,
    i18n,
    onChange: (on) => {
      cfg.keep = on;
      if (!on) {
        kept = [];
        redraw();
      }
      rt.changed({ announce: false });
    },
  });

  const launchBtn = button({ label: i18n.t('launch'), icon: 'play', variant: 'primary', id: 'launch', onClick: launch });
  const playBtn = rt.reducedMotion
    ? null
    : button({
        label: i18n.t('pause'),
        icon: 'pause',
        variant: 'secondary',
        id: 'play',
        onClick: () => {
          playing = !playing;
          syncPlay();
          if (!playing) rt.changed();
        },
      });
  const stepBtn = button({
    label: i18n.t('step'),
    icon: 'step',
    id: 'step',
    onClick: () => {
      if (phase !== 'flying') start();
      playing = false;
      syncPlay();
      advance(snapStep(t + STEP_S, STEP_S) - t, true);
    },
  });
  stepBtn.setAttribute('aria-label', i18n.t('step_label'));
  const clearBtn = button({
    label: i18n.t('clear'),
    icon: 'reset',
    variant: 'ghost',
    id: 'clear',
    onClick: () => {
      kept = [];
      flight = null;
      phase = 'ready';
      t = 0;
      playing = false;
      syncPlay();
      redraw();
      drawNow();
      rt.changed();
    },
  });

  rt.controls.append(
    group(i18n.t('group.launch'), vSlider.el, aSlider.el, h('div', { class: 'btn-row' }, launchBtn)),
    group(i18n.t('group.flight'), h('div', { class: 'btn-row' }, ...(playBtn ? [playBtn] : []), stepBtn, clearBtn), keepToggle.el),
  );
  if (rt.reducedMotion) rt.controls.prepend(h('p', { class: 'caption-note' }, i18n.t('reduced_note')));

  redraw();
  syncPlay();

  const readingsNow = (): Reading[] => {
    const l = flight ?? setting();
    const r = results();
    return [
      reading('time', clean(t), 2),
      reading('vx', vx(l), 2),
      reading('vy', vy(l, flight ? t : 0), 2),
      reading('range', r ? r.R : 0, 2),
      reading('max_height', r ? r.H : 0, 2),
      reading('time_of_flight', r ? r.T : 0, 2),
      hidden('launch_speed', l.v0, 1),
      hidden('angle', l.angle, 0),
      hidden('gravity', g, 2),
    ];
  };

  const syncControls = (): void => {
    vSlider.set(cfg.v0);
    aSlider.set(cfg.angle);
    keepToggle.set(cfg.keep);
  };

  return {
    readings: readingsNow,
    notes() {
      const out = [i18n.t('settings_note', { g: withUnit(i18n.num(g, 1), 'm/s²'), h: withUnit(i18n.num(h0, 0), 'm') })];
      if (!results()) out.push(i18n.t('measure_note'));
      if (kept.length > 0) out.push(i18n.t('kept', { n: i18n.num(kept.length, 0) }));
      return out;
    },
    summary() {
      const l = flight ?? setting();
      const r = results();
      if (r) return i18n.t('summary_landed', { v: spoken(l.v0, 1, 'm/s'), a: spoken(l.angle, 0, '°'), R: spoken(r.R, 2, 'm'), H: spoken(r.H, 2, 'm'), T: spoken(r.T, 2, 's') });
      if (phase === 'flying') return i18n.t('summary_flying', { t: spoken(t, 2, 's'), vx: spoken(vx(l), 2, 'm/s'), vy: spoken(vy(l, t), 2, 'm/s') });
      return i18n.t('summary_ready', { v: spoken(cfg.v0, 1, 'm/s'), a: spoken(cfg.angle, 0, '°') });
    },
    record() {
      const r = results();
      if (!r) return null;
      return { name: 'range', value: Number(r.R.toFixed(4)), unit: 'm', context: readingsNow().filter((x) => x.name !== 'range') };
    },
    reset() {
      Object.assign(cfg, initial);
      kept = [];
      flight = null;
      phase = 'ready';
      t = 0;
      playing = false;
      syncControls();
      syncPlay();
      drawLauncher();
      redraw();
      drawNow();
    },
    snapshot(): JsonObject {
      return { v0: cfg.v0, angle: cfg.angle, keep: cfg.keep, phase, t, kept: kept.map((l) => ({ v0: l.v0, angle: l.angle })) };
    },
    restore(data) {
      const next = resolveParams(schema, { v0: data.v0 as number, angle: data.angle as number, keepPaths: data.keep as boolean });
      cfg.v0 = numberParam(next, 'v0');
      cfg.angle = numberParam(next, 'angle');
      cfg.keep = booleanParam(next, 'keepPaths');
      const list = Array.isArray(data.kept) ? data.kept : [];
      kept = list
        .map((k) => resolveParams(schema, { v0: (k as JsonObject).v0 as number, angle: (k as JsonObject).angle as number }))
        .map((k) => ({ v0: numberParam(k, 'v0'), angle: numberParam(k, 'angle'), g, h0 }))
        .slice(0, MAX_KEPT);
      const saved = data.phase === 'flying' || data.phase === 'landed' ? data.phase : 'ready';
      flight = saved === 'ready' ? null : setting();
      phase = saved;
      const time = typeof data.t === 'number' && Number.isFinite(data.t) ? data.t : 0;
      t = flight ? Math.min(timeOfFlight(flight), Math.max(0, time)) : 0;
      playing = false;
      syncControls();
      syncPlay();
      drawLauncher();
      redraw();
      drawNow();
    },
    conditions: {},
    pause() {
      loop.stop();
    },
    resume() {
      syncPlay();
    },
    destroy() {
      loop.stop();
    },
  };
}

mountSim({
  simId: manifest.id,
  simVersion: manifest.version,
  family: familyForSubject(manifest.subject),
  strings: { en, hi },
  conditionNames: [],
  aspect: manifest.aspect,
  preferredOrientation: manifest.preferredOrientation,
  standalone: { params: defaultParams(schema), tasks: manifest.tasks as TaskSpec[] },
  mount,
});
