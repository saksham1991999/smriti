import '@smriti/sim-kit/styles.css';
import './sim.css';
import type { JsonObject, Reading, TaskSpec } from '@smriti/sim-bridge';
import {
  attr,
  booleanParam,
  button,
  defaultParams,
  draggable,
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
  type ParamsSchema,
  type SimController,
  type SimManifest,
  type SimRuntime,
} from '@smriti/sim-kit';
import manifestJson from '../manifest.json';
import en from '../strings.en.json';
import hi from '../strings.hi.json';
import {
  axisRange,
  clean,
  displacement,
  pathLength,
  position,
  positionRange,
  snapTenth,
  stopTime,
  velocity,
  type Motion,
} from './model';

const manifest = manifestJson as unknown as SimManifest;
const schema = manifest.params as ParamsSchema;
const reading = readingMaker(manifest);

const W = 400;
const H = 400;
const GL = 50;
const GR = 388;
const TRACK_Y = 40;
const PANEL_TOP: readonly [number, number, number] = [84, 186, 288];
const PANEL_H = 84;
const STEP_S = 0.1;
/** Parameter ranges fix the a-t axis, so the line's height always means the same acceleration. */
const A_LIMIT = Math.max(Math.abs(rangeOf(schema, 'a').min), Math.abs(rangeOf(schema, 'a').max));

interface Cfg {
  x0: number;
  u: number;
  a: number;
}

function mount(rt: SimRuntime): SimController {
  const { i18n } = rt;
  const p = resolveParams(schema, rt.params);
  const initial: Cfg = { x0: numberParam(p, 'x0'), u: numberParam(p, 'u'), a: numberParam(p, 'a') };
  const tMax = numberParam(p, 't_max');
  const cfg: Cfg = { ...initial };
  let t = 0;
  // Reduced motion: no auto-play; the student steps through (sim-builder).
  let playing = booleanParam(p, 'autoplay') && !rt.reducedMotion;
  const samples = rt.lowPower ? 60 : 120;

  const motion = (): Motion => ({ x0: cfg.x0, u: cfg.u, a: cfg.a });
  const spoken = (v: number, d: number, unit: string): string => spokenValue(i18n.num(clean(v), d), clean(v), unit, i18n.locale);

  /* ------------------------------------------------------------- scene */

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'motion-graphs', 'aria-hidden': 'true' });
  const defs = svg(
    'defs',
    {},
    svg(
      'pattern',
      { id: 'mg-hatch', patternUnits: 'userSpaceOnUse', width: 6, height: 6, patternTransform: 'rotate(45)' },
      svg('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'hatch-line' }),
    ),
    svg('pattern', { id: 'mg-dots', patternUnits: 'userSpaceOnUse', width: 6, height: 6 }, svg('circle', { cx: 3, cy: 3, r: 1.3, class: 'dot-fill' })),
  );
  const trackLayer = svg('g', { class: 'track' });
  const cartLayer = svg('g', { class: 'cart-layer' });
  const frames = svg('g', { class: 'frames' });
  const areas = svg('g', { class: 'areas' });
  const ghosts = svg('g', { class: 'ghosts' });
  const traces = svg('g', { class: 'traces' });
  const cursor = svg('g', { class: 'cursor' });
  const hit = svg('rect', { x: GL, y: PANEL_TOP[0], width: GR - GL, height: PANEL_TOP[2] + PANEL_H - PANEL_TOP[0], class: 'hit' });
  root.append(defs, trackLayer, cartLayer, frames, areas, ghosts, traces, cursor, hit);
  rt.scene.append(root);

  // Axis ranges for the current setup over the whole clock.
  let xr: [number, number] = [0, 1];
  let vr: [number, number] = [0, 1];
  const ar: [number, number] = axisRange(-A_LIMIT, A_LIMIT);
  const tx = (time: number): number => GL + (time / tMax) * (GR - GL);
  const py = (panel: number, value: number, range: [number, number]): number => {
    const top = PANEL_TOP[panel] ?? 0;
    return top + PANEL_H - ((value - range[0]) / (range[1] - range[0])) * PANEL_H;
  };
  const trackX = (x: number): number => GL + ((x - xr[0]) / (xr[1] - xr[0])) * (GR - GL);
  const f1 = (n: number): string => n.toFixed(1);
  const axisLabel = (v: number): string => i18n.num(clean(v), Number.isInteger(v) ? 0 : 1);

  const computeRanges = (): void => {
    const m = motion();
    const [lo, hi2] = positionRange(m, tMax);
    xr = axisRange(lo, hi2);
    const v0 = velocity(m, 0);
    const v1 = velocity(m, tMax);
    vr = axisRange(Math.min(v0, v1), Math.max(v0, v1));
  };

  const tickStep = tMax <= 10 ? 2 : 5;

  const drawFrames = (): void => {
    while (frames.firstChild) frames.firstChild.remove();
    while (trackLayer.firstChild) trackLayer.firstChild.remove();
    // Track: a number line in metres with its ends and zero labelled.
    trackLayer.append(svg('line', { x1: GL, y1: TRACK_Y, x2: GR, y2: TRACK_Y, class: 'track-line' }));
    for (const v of [xr[0], 0, xr[1]]) {
      const x = trackX(v);
      trackLayer.append(
        svg('line', { x1: f1(x), y1: TRACK_Y, x2: f1(x), y2: TRACK_Y + 6, class: 'tick' }),
        svg('text', { x: f1(x), y: TRACK_Y + 18, class: 'sv-text sv-muted small', 'text-anchor': 'middle' }, axisLabel(v)),
      );
    }
    trackLayer.append(svg('text', { x: 4, y: TRACK_Y - 8, class: 'sv-text sv-muted small', 'text-anchor': 'start' }, i18n.t('track')));
    const panels: Array<{ range: [number, number]; label: string }> = [
      { range: xr, label: i18n.t('axis.x') },
      { range: vr, label: i18n.t('axis.v') },
      { range: ar, label: i18n.t('axis.a') },
    ];
    panels.forEach(({ range, label }, i) => {
      const top = PANEL_TOP[i] ?? 0;
      frames.append(svg('rect', { x: GL, y: top, width: GR - GL, height: PANEL_H, class: 'g-frame' }));
      for (let k = 0; k <= tMax + 1e-9; k += tickStep) {
        frames.append(svg('line', { x1: f1(tx(k)), y1: top, x2: f1(tx(k)), y2: top + PANEL_H, class: 'g-grid' }));
      }
      const zy = py(i, 0, range);
      frames.append(svg('line', { x1: GL, y1: f1(zy), x2: GR, y2: f1(zy), class: 'g-zero' }));
      const labels = new Map<number, string>([
        [range[1], axisLabel(range[1])],
        [0, i18n.num(0, 0)],
        [range[0], axisLabel(range[0])],
      ]);
      for (const [v, text] of labels) {
        frames.append(svg('text', { x: GL - 6, y: f1(py(i, v, range)), class: 'sv-text sv-muted small', 'text-anchor': 'end', 'dominant-baseline': 'central' }, text));
      }
      frames.append(svg('text', { x: GR - 6, y: top + 13, class: 'sv-text panel-label', 'text-anchor': 'end' }, label));
    });
    const bottom = (PANEL_TOP[2] ?? 0) + PANEL_H;
    for (let k = 0; k <= tMax + 1e-9; k += tickStep) {
      frames.append(svg('text', { x: f1(tx(k)), y: bottom + 13, class: 'sv-text sv-muted small', 'text-anchor': 'middle' }, i18n.num(k, 0)));
    }
    frames.append(svg('text', { x: GL - 6, y: bottom + 13, class: 'sv-text sv-muted small', 'text-anchor': 'end' }, i18n.t('axis.t')));
  };

  const curvePath = (panel: number, range: [number, number], fn: (time: number) => number, until: number): string => {
    const n = Math.max(2, Math.ceil((samples * until) / tMax));
    let d = '';
    for (let k = 0; k <= n; k += 1) {
      const time = (until * k) / n;
      d += `${k === 0 ? 'M' : 'L'} ${f1(tx(time))} ${f1(py(panel, fn(time), range))} `;
    }
    return d.trim();
  };

  const series = (): Array<{ panel: number; range: [number, number]; fn: (time: number) => number }> => {
    const m = motion();
    return [
      { panel: 0, range: xr, fn: (time) => position(m, time) },
      { panel: 1, range: vr, fn: (time) => velocity(m, time) },
      { panel: 2, range: ar, fn: () => m.a },
    ];
  };

  const drawGhosts = (): void => {
    while (ghosts.firstChild) ghosts.firstChild.remove();
    for (const s of series()) ghosts.append(svg('path', { d: curvePath(s.panel, s.range, s.fn, tMax), class: 'curve-ghost' }));
  };

  const drawAreas = (): void => {
    while (areas.firstChild) areas.firstChild.remove();
    if (t <= 0) return;
    const m = motion();
    const ts = stopTime(m);
    const cuts = ts !== null && ts > 0 && ts < t ? [0, ts, t] : [0, t];
    for (let i = 0; i < cuts.length - 1; i += 1) {
      const t1 = cuts[i] ?? 0;
      const t2 = cuts[i + 1] ?? 0;
      const mid = velocity(m, (t1 + t2) / 2);
      if (Math.abs(mid) < 1e-12) continue;
      const above = mid > 0;
      const zy = py(1, 0, vr);
      const pts = [
        [tx(t1), zy],
        [tx(t1), py(1, velocity(m, t1), vr)],
        [tx(t2), py(1, velocity(m, t2), vr)],
        [tx(t2), zy],
      ]
        .map(([x, y]) => `${f1(x ?? 0)},${f1(y ?? 0)}`)
        .join(' ');
      areas.append(svg('polygon', { points: pts, class: above ? 'area area-above' : 'area area-below', fill: above ? 'url(#mg-hatch)' : 'url(#mg-dots)' }));
      if (tx(t2) - tx(t1) > 46) {
        // Label at the region's centroid (a trapezoid on the axis), where it is widest.
        const h1 = Math.abs(py(1, velocity(m, t1), vr) - zy);
        const h2 = Math.abs(py(1, velocity(m, t2), vr) - zy);
        const sum = Math.max(h1 + h2, 1e-9);
        const cx = tx(t1) + ((tx(t2) - tx(t1)) * (h1 + 2 * h2)) / (3 * sum);
        const cy = zy + (above ? -1 : 1) * ((h1 * h1 + h1 * h2 + h2 * h2) / (3 * sum));
        areas.append(svg('text', { x: f1(cx), y: f1(cy), class: 'sv-text area-label', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, i18n.t(above ? 'area.above' : 'area.below')));
      }
    }
  };

  const arrow = (y: number, value: number, scale: number, cls: string, label: string): SVGGElement => {
    const x = trackX(position(motion(), t));
    const len = Math.max(-80, Math.min(80, value * scale));
    const g = svg('g', { class: cls });
    if (Math.abs(len) < 2) return g;
    const end = x + len;
    const dir = Math.sign(len);
    g.append(
      svg('line', { x1: f1(x), y1: y, x2: f1(end - dir * 5), y2: y, class: 'arrow-shaft' }),
      svg('path', { d: `M ${f1(end)} ${y} L ${f1(end - dir * 8)} ${y - 5} L ${f1(end - dir * 8)} ${y + 5} Z`, class: 'arrow-head' }),
      svg('text', { x: f1(end + dir * 8), y, class: 'sv-text arrow-label', 'text-anchor': dir > 0 ? 'start' : 'end', 'dominant-baseline': 'central' }, label),
    );
    return g;
  };

  const drawNow = (): void => {
    const m = motion();
    while (traces.firstChild) traces.firstChild.remove();
    while (cursor.firstChild) cursor.firstChild.remove();
    while (cartLayer.firstChild) cartLayer.firstChild.remove();
    if (t > 0) for (const s of series()) traces.append(svg('path', { d: curvePath(s.panel, s.range, s.fn, t), class: 'curve' }));
    const cx = tx(t);
    cursor.append(svg('line', { x1: f1(cx), y1: PANEL_TOP[0] ?? 0, x2: f1(cx), y2: (PANEL_TOP[2] ?? 0) + PANEL_H, class: 'cursor-line' }));
    for (const s of series()) cursor.append(svg('circle', { cx: f1(cx), cy: f1(py(s.panel, s.fn(t), s.range)), r: 4, class: 'cursor-dot' }));
    // The cart: an outline on the track, with its velocity (solid) and acceleration (dashed) arrows.
    const x = trackX(position(m, t));
    cartLayer.append(
      svg('rect', { x: f1(x - 12), y: TRACK_Y - 16, width: 24, height: 12, rx: 3, class: 'cart' }),
      svg('circle', { cx: f1(x - 6), cy: TRACK_Y - 2, r: 2.5, class: 'wheel' }),
      svg('circle', { cx: f1(x + 6), cy: TRACK_Y - 2, r: 2.5, class: 'wheel' }),
    );
    const vMax = Math.max(Math.abs(vr[0]), Math.abs(vr[1]), 1);
    cartLayer.append(
      arrow(TRACK_Y - 30, velocity(m, t), 70 / vMax, 'arrow arrow-v', i18n.t('arrow.v')),
      arrow(TRACK_Y + 30, m.a, 70 / A_LIMIT, 'arrow arrow-a', i18n.t('arrow.a')),
    );
    drawAreas();
  };

  const redrawAll = (): void => {
    computeRanges();
    drawFrames();
    drawGhosts();
    drawNow();
  };

  /* --------------------------------------------------------- clock */

  let lastSent = 0;
  const atRest = (): boolean => t > 0 && Math.abs(velocity(motion(), t)) < 1e-9;

  const setTime = (next: number, opts: { announce?: boolean; report?: boolean } = {}): void => {
    const before = velocity(motion(), t);
    t = Math.min(tMax, Math.max(0, next));
    const after = velocity(motion(), t);
    timeSlider.set(t);
    drawNow();
    // Crossing v = 0 while the clock runs is the moment the card asks about: say it once.
    if (opts.announce === false && before !== 0 && (Math.sign(before) !== Math.sign(after) || after === 0)) {
      rt.announcer.now(i18n.t('announce_rest', { t: spoken(t, 1, 's'), x: spoken(position(motion(), t), 2, 'm') }));
    }
    if (opts.report !== false) rt.changed({ announce: opts.announce !== false });
  };

  const loop = rt.loop((dt) => {
    let next = t + dt;
    if (next >= tMax) {
      next = tMax;
      playing = false;
      syncPlay();
    }
    const send = next - lastSent >= 0.1 || next === tMax;
    if (send) lastSent = next;
    setTime(next, { announce: false, report: send });
  });

  const syncPlay = (): void => {
    const run = playing && !rt.paused;
    if (run && !loop.running) loop.start();
    if (!run && loop.running) loop.stop();
    playBtn?.replaceChildren(icon(playing ? 'pause' : 'play'), h('span', {}, i18n.t(playing ? 'pause' : 'play')));
  };

  const stopPlaying = (): void => {
    if (!playing) return;
    playing = false;
    syncPlay();
  };

  /* ---------------------------------------------------------- controls */

  const uSlider = slider({
    id: 'u',
    label: i18n.t('u'),
    ...rangeOf(schema, 'u'),
    unit: 'm/s',
    decimals: 1,
    value: cfg.u,
    i18n,
    onInput: (v) => {
      cfg.u = v;
      redrawAll();
      rt.changed();
    },
  });
  const aSlider = slider({
    id: 'a',
    label: i18n.t('a'),
    ...rangeOf(schema, 'a'),
    unit: 'm/s²',
    decimals: 1,
    value: cfg.a,
    i18n,
    onInput: (v) => {
      cfg.a = v;
      redrawAll();
      rt.changed();
    },
  });
  const timeSlider = slider({
    id: 'time',
    label: i18n.t('time'),
    min: 0,
    max: tMax,
    step: STEP_S,
    unit: 's',
    decimals: 1,
    value: 0,
    i18n,
    onInput: (v) => {
      stopPlaying();
      setTime(v);
    },
  });

  const playBtn = rt.reducedMotion
    ? null
    : button({
        label: i18n.t(playing ? 'pause' : 'play'),
        icon: playing ? 'pause' : 'play',
        variant: 'primary',
        id: 'play',
        onClick: () => {
          if (!playing && t >= tMax) setTime(0);
          playing = !playing;
          syncPlay();
          if (!playing) {
            // Pausing reports the exact readings at once.
            rt.changed();
          }
        },
      });
  const stepBtn = button({
    label: i18n.t('step'),
    icon: 'step',
    id: 'step',
    onClick: () => {
      stopPlaying();
      setTime(snapTenth(snapTenth(t) + STEP_S));
    },
  });
  stepBtn.setAttribute('aria-label', i18n.t('step_label'));
  const restartBtn = button({
    label: i18n.t('restart'),
    icon: 'reset',
    variant: 'ghost',
    id: 'restart',
    onClick: () => {
      stopPlaying();
      setTime(0);
    },
  });

  rt.controls.append(
    group(i18n.t('group.clock'), h('div', { class: 'btn-row' }, ...(playBtn ? [playBtn] : []), stepBtn, restartBtn), timeSlider.el),
    group(i18n.t('group.motion'), uSlider.el, aSlider.el),
  );
  if (rt.reducedMotion) rt.controls.prepend(h('p', { class: 'caption-note' }, i18n.t('reduced_note')));

  // Drag across the graphs to move the time cursor (a shortcut for the time slider).
  draggable(hit, root, {
    onStart: stopPlaying,
    onMove: (x) => setTime(snapTenth(((x - GL) / (GR - GL)) * tMax)),
  });

  redrawAll();
  syncPlay();

  const syncControls = (): void => {
    uSlider.set(cfg.u);
    aSlider.set(cfg.a);
    timeSlider.set(t);
  };

  const readingsNow = (): Reading[] => {
    const m = motion();
    return [
      reading('time', clean(t), 1),
      reading('position', clean(position(m, t)), 2),
      reading('velocity', clean(velocity(m, t)), 2),
      reading('acceleration', clean(m.a), 1),
      reading('displacement', clean(displacement(m, t)), 2),
      reading('path_length', clean(pathLength(m, t)), 2),
      reading('initial_velocity', clean(m.u), 1),
    ];
  };

  return {
    readings: readingsNow,
    notes() {
      return atRest() ? [i18n.t('at_rest')] : [];
    },
    summary() {
      const m = motion();
      return i18n.t('summary', {
        u: spoken(m.u, 1, 'm/s'),
        a: spoken(m.a, 1, 'm/s²'),
        t: spoken(t, 1, 's'),
        x: spoken(position(m, t), 2, 'm'),
        v: spoken(velocity(m, t), 2, 'm/s'),
        d: spoken(displacement(m, t), 2, 'm'),
        s: spoken(pathLength(m, t), 2, 'm'),
      });
    },
    announcement() {
      const m = motion();
      if (atRest()) return i18n.t('announce_rest', { t: spoken(t, 1, 's'), x: spoken(position(m, t), 2, 'm') });
      return i18n.t('announce', { t: spoken(t, 1, 's'), x: spoken(position(m, t), 2, 'm'), v: spoken(velocity(m, t), 2, 'm/s') });
    },
    record() {
      const m = motion();
      const all = readingsNow();
      return {
        name: 'position',
        value: Number(clean(position(m, t)).toFixed(4)),
        unit: 'm',
        context: all.filter((r) => r.name !== 'position'),
      };
    },
    reset() {
      Object.assign(cfg, initial);
      t = 0;
      playing = booleanParam(p, 'autoplay') && !rt.reducedMotion;
      syncControls();
      redrawAll();
      syncPlay();
    },
    snapshot(): JsonObject {
      return { ...cfg, t, playing };
    },
    restore(data) {
      const next = resolveParams(schema, { x0: data.x0 as number, u: data.u as number, a: data.a as number });
      cfg.x0 = numberParam(next, 'x0');
      cfg.u = numberParam(next, 'u');
      cfg.a = numberParam(next, 'a');
      const time = typeof data.t === 'number' && Number.isFinite(data.t) ? data.t : 0;
      t = Math.min(tMax, Math.max(0, time));
      playing = data.playing === true && !rt.reducedMotion;
      syncControls();
      redrawAll();
      syncPlay();
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
