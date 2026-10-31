import '@smriti/sim-kit/styles.css';
import './sim.css';
import type { JsonObject, Reading, TaskSpec } from '@smriti/sim-bridge';
import {
  attr,
  badge,
  booleanParam,
  choice,
  defaultParams,
  draggable,
  familyForSubject,
  group,
  mountSim,
  numberParam,
  rangeOf,
  readingMaker,
  resolveParams,
  slider,
  spokenValue,
  stringParam,
  svg,
  symbol,
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
import { solveCircuit, type Arrangement, type CircuitInput } from './model';

const manifest = manifestJson as unknown as SimManifest;
const schema = manifest.params as ParamsSchema;
const reading = readingMaker(manifest);

/* Scene geometry (viewBox units). Current leaves the + plate (top) and goes clockwise. */
const W = 400;
const H = 300;
const L = 56;
const R = 344;
const T = 62;
const B_SINGLE = 244;
const B_PAR = 208;
const B2 = 264;
const PLUS_Y = 136;
const MINUS_Y = 150;
const SW_A = 98;
const SW_B = 150;
const AM_X = 262;
const AM_R = 26;
const J1 = 118;
const J2 = 282;

type Pt = [number, number];
interface Wire {
  pts: Pt[];
  current: () => number;
}

function zigzag(x0: number, x1: number, y: number): string {
  // Five peaks between x0 and x1 (current flows from x1 to x0, the drawing is symmetric).
  const n = 10;
  const step = (x1 - x0) / n;
  let d = `M ${x0} ${y}`;
  for (let k = 1; k < n; k += 1) d += ` L ${x0 + k * step} ${y + (k % 2 === 1 ? -11 : 11)}`;
  return `${d} L ${x1} ${y}`;
}

function polyLength(pts: Pt[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return len;
}

function pointAt(pts: Pt[], dist: number): Pt {
  let left = dist;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (left <= seg) {
      const t = seg === 0 ? 0 : left / seg;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    left -= seg;
  }
  const last = pts[pts.length - 1]!;
  return [last[0], last[1]];
}

function mount(rt: SimRuntime): SimController {
  const { i18n } = rt;
  const p = resolveParams(schema, rt.params);
  const initial: CircuitInput = {
    emf: numberParam(p, 'voltage'),
    internalResistance: numberParam(p, 'internalResistance'),
    r1: numberParam(p, 'r1'),
    r2: numberParam(p, 'r2'),
    arrangement: stringParam(p, 'arrangement') as Arrangement,
    switchOn: booleanParam(p, 'switchOn'),
  };
  const state: CircuitInput = { ...initial };
  let result = solveCircuit(state);

  const fmt = (v: number, d: number, unit: string): string => withUnit(i18n.num(v, d), unit);
  const spoken = (v: number, d: number, unit: string): string => spokenValue(i18n.num(v, d), v, unit, i18n.locale);
  const rPrecision = (): number => (Number.isInteger(result.externalResistance) ? 1 : 2);

  /* ------------------------------------------------------------- scene */

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'circuit', 'aria-hidden': 'true' });
  const wiresLayer = svg('g', { class: 'wires' });
  const dotsLayer = svg('g', { class: 'dots' });
  const partsLayer = svg('g', { class: 'parts' });
  root.append(wiresLayer, dotsLayer, partsLayer);
  rt.scene.append(root);

  // Battery: long thin plate is +, short thick plate is −.
  const battery = svg(
    'g',
    { class: 'battery' },
    svg('line', { x1: L - 24, y1: PLUS_Y, x2: L + 24, y2: PLUS_Y, class: 'plate plate-pos' }),
    svg('line', { x1: L - 13, y1: MINUS_Y, x2: L + 13, y2: MINUS_Y, class: 'plate plate-neg' }),
    svg('text', { x: L - 36, y: PLUS_Y - 2, class: 'sv-text sv-muted pole', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, '+'),
    svg('text', { x: L - 36, y: MINUS_Y + 4, class: 'sv-text sv-muted pole', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, '−'),
  );
  const batteryBadge = badge(L + 52, (PLUS_Y + MINUS_Y) / 2, '', { tone: 'strong' });
  partsLayer.append(battery, batteryBadge.g);

  // Switch: two terminals and a lever that lifts when off. Tapping it toggles.
  const lever = svg('line', { x1: SW_A, y1: T, x2: SW_B, y2: T, class: 'lever' });
  const switchHit = svg('rect', { x: SW_A - 12, y: T - 40, width: SW_B - SW_A + 24, height: 56, class: 'hit' });
  partsLayer.append(
    svg('g', { class: 'switch-part' }, lever, svg('circle', { cx: SW_A, cy: T, r: 6, class: 'terminal' }), svg('circle', { cx: SW_B, cy: T, r: 6, class: 'terminal' })),
    switchHit,
  );

  // Ammeter with its reading.
  const ammeterBadge = badge(AM_X, T - 44, '', { size: 15 });
  partsLayer.append(
    svg('circle', { cx: AM_X, cy: T, r: AM_R, class: 'meter' }),
    svg('text', { x: AM_X, y: T + 1, class: 'sv-text meter-letter', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, 'A'),
    ammeterBadge.g,
  );

  const bottomLayer = svg('g', { class: 'bottom' });
  partsLayer.append(bottomLayer);
  const rBadges: Array<ReturnType<typeof badge>> = [];

  let wires: Wire[] = [];
  const chevrons = svg('g', { class: 'chevrons' });
  partsLayer.append(chevrons);

  const drawWires = (): void => {
    while (wiresLayer.firstChild) wiresLayer.firstChild.remove();
    while (bottomLayer.firstChild) bottomLayer.firstChild.remove();
    rBadges.length = 0;
    const main = (): number => result.current;
    const B = state.arrangement === 'parallel' ? B_PAR : B_SINGLE;
    const top: Pt[] = [
      [L, PLUS_Y],
      [L, T],
      [R, T],
      [R, B],
    ];
    const resistor = (x0: number, x1: number, y: number, which: 1 | 2): void => {
      bottomLayer.append(svg('rect', { x: x0, y: y - 16, width: x1 - x0, height: 32, class: 'res-pad', rx: 10 }));
      bottomLayer.append(svg('path', { d: zigzag(x0, x1, y), class: 'res' }));
      const cx = (x0 + x1) / 2;
      bottomLayer.append(symbol(cx - 30, y - 32, 'R', String(which), 'sv-text res-symbol'));
      const b = badge(cx + 14, y - 32, '', { size: 13 });
      bottomLayer.append(b.g);
      rBadges.push(b);
    };
    if (state.arrangement === 'parallel') {
      wires = [
        { pts: [...top, [J2, B]], current: main },
        { pts: [[J2, B], [J1, B]], current: () => result.i1 },
        { pts: [[J2, B], [J2, B2], [J1, B2], [J1, B]], current: () => result.i2 },
        { pts: [[J1, B], [L, B], [L, MINUS_Y]], current: main },
      ];
      resistor(170, 230, B, 1);
      resistor(170, 230, B2, 2);
      bottomLayer.append(svg('circle', { cx: J1, cy: B, r: 6, class: 'node' }), svg('circle', { cx: J2, cy: B, r: 6, class: 'node' }));
    } else if (state.arrangement === 'series') {
      wires = [{ pts: [...top, [L, B], [L, MINUS_Y]], current: main }];
      resistor(232, 292, B, 1);
      resistor(108, 168, B, 2);
    } else {
      wires = [{ pts: [...top, [L, B], [L, MINUS_Y]], current: main }];
      resistor(170, 230, B, 1);
    }
    for (const w of wires) {
      wiresLayer.append(svg('polyline', { points: w.pts.map((q) => q.join(',')).join(' '), class: 'wire' }));
    }
  };

  /* ---------------------------------------------------- current flow */

  const spacing = rt.lowPower ? 40 : 24;
  const dots: Array<{ wire: Wire; el: SVGCircleElement; base: number; len: number }> = [];

  const buildDots = (): void => {
    while (dotsLayer.firstChild) dotsLayer.firstChild.remove();
    dots.length = 0;
    if (rt.reducedMotion) return;
    for (const wire of wires) {
      const len = polyLength(wire.pts);
      for (let d = 0; d < len; d += spacing) {
        const el = svg('circle', { r: 3.6, class: 'dot' });
        dotsLayer.append(el);
        dots.push({ wire, el, base: d, len });
      }
    }
  };

  // Distance travelled per wire, so branch dots move at their own current's pace.
  const offsets = new Map<Wire, number>();
  const placeDots = (): void => {
    for (const d of dots) {
      const off = offsets.get(d.wire) ?? 0;
      const at = (((d.base + off) % d.len) + d.len) % d.len;
      const [x, y] = pointAt(d.wire.pts, at);
      attr(d.el, { cx: x.toFixed(1), cy: y.toFixed(1) });
    }
  };

  /** Pixels per second for a current: visible at 0.1 A, capped for large currents. */
  const speedFor = (i: number): number => Math.min(150, 12 + 55 * i);

  const loop = rt.loop((dt) => {
    for (const w of wires) {
      const i = w.current();
      offsets.set(w, (offsets.get(w) ?? 0) + (i > 0 ? speedFor(i) * dt : 0));
    }
    placeDots();
  });

  // Reduced motion: static arrows show the direction of conventional current instead of moving dots.
  const drawChevrons = (): void => {
    while (chevrons.firstChild) chevrons.firstChild.remove();
    if (!rt.reducedMotion || result.current <= 0) return;
    for (const w of wires) {
      if (w.current() <= 0) continue;
      const len = polyLength(w.pts);
      const n = Math.max(1, Math.round(len / 130));
      for (let k = 0; k < n; k += 1) {
        const at = ((k + 0.5) / n) * len;
        const [x, y] = pointAt(w.pts, at);
        const [x2, y2] = pointAt(w.pts, Math.min(len, at + 1));
        const angle = (Math.atan2(y2 - y, x2 - x) * 180) / Math.PI;
        chevrons.append(svg('path', { d: 'M -6 -7 L 4 0 L -6 7', class: 'chev', transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${angle.toFixed(0)})` }));
      }
    }
  };

  const syncMotion = (): void => {
    const shouldRun = !rt.reducedMotion && result.current > 0 && !rt.paused;
    if (shouldRun && !loop.running) loop.start();
    if (!shouldRun && loop.running) loop.stop();
    dotsLayer.classList.toggle('idle', result.current <= 0);
  };

  /* ---------------------------------------------------------- controls */

  const vRange = rangeOf(schema, 'voltage');
  const r1Range = rangeOf(schema, 'r1');
  const r2Range = rangeOf(schema, 'r2');

  const update = (opts: { rebuild?: boolean } = {}): void => {
    result = solveCircuit(state);
    if (opts.rebuild) {
      drawWires();
      buildDots();
    }
    const vText = fmt(state.emf, 1, 'V');
    batteryBadge.set(vText);
    ammeterBadge.set(fmt(result.current, 2, 'A'));
    rBadges[0]?.set(fmt(state.r1, 0, 'Ω'));
    rBadges[1]?.set(fmt(state.r2, 0, 'Ω'));
    attr(lever, state.switchOn ? { x2: SW_B, y2: T } : { x2: SW_A + 46, y2: T - 26 });
    root.classList.toggle('off', !state.switchOn);
    r2Slider.setDisabled(state.arrangement === 'single');
    drawChevrons();
    placeDots();
    syncMotion();
    rt.changed();
  };

  const vSlider = slider({
    id: 'voltage',
    label: i18n.t('voltage'),
    ...vRange,
    unit: 'V',
    decimals: 1,
    value: state.emf,
    i18n,
    onInput: (v) => {
      state.emf = v;
      update();
    },
  });
  const arrangement = choice({
    id: 'arrangement',
    label: i18n.t('arrangement'),
    options: (['single', 'series', 'parallel'] as const).map((value) => ({ value, label: i18n.t(`opt.${value}`) })),
    value: state.arrangement,
    onChange: (v) => {
      state.arrangement = v as Arrangement;
      update({ rebuild: true });
    },
  });
  const r1Slider = slider({
    id: 'r1',
    label: i18n.t('r1'),
    ...r1Range,
    unit: 'Ω',
    decimals: 0,
    value: state.r1,
    i18n,
    onInput: (v) => {
      state.r1 = v;
      update();
    },
  });
  const r2Slider = slider({
    id: 'r2',
    label: i18n.t('r2'),
    ...r2Range,
    unit: 'Ω',
    decimals: 0,
    value: state.r2,
    i18n,
    onInput: (v) => {
      state.r2 = v;
      update();
    },
  });
  const sw = toggle({
    id: 'switch',
    label: i18n.t('switch'),
    checked: state.switchOn,
    i18n,
    onChange: (on) => {
      state.switchOn = on;
      update();
    },
  });
  draggable(switchHit, root, {
    onStart: () => {
      state.switchOn = !state.switchOn;
      sw.set(state.switchOn);
      update();
    },
    onMove: () => undefined,
  });

  rt.controls.append(
    group(i18n.t('group.battery'), vSlider.el, sw.el),
    group(i18n.t('group.resistors'), arrangement.el, r1Slider.el, r2Slider.el),
  );

  const syncControls = (): void => {
    vSlider.set(state.emf);
    r1Slider.set(state.r1);
    r2Slider.set(state.r2);
    arrangement.set(state.arrangement);
    sw.set(state.switchOn);
  };

  drawWires();
  buildDots();
  update();

  return {
    readings(): Reading[] {
      const list: Reading[] = [
        reading('voltage', state.emf, 1),
        reading('resistance', result.externalResistance, rPrecision()),
        reading('current', result.current, 2),
      ];
      if (state.internalResistance > 0) list.push(reading('terminal_voltage', result.terminalVoltage, 2));
      return list;
    },
    notes() {
      return state.switchOn ? [] : [i18n.t('note.off')];
    },
    summary() {
      return i18n.t(`summary.${state.arrangement}`, {
        v: spoken(state.emf, 1, 'V'),
        r1: spoken(state.r1, 0, 'Ω'),
        r2: spoken(state.r2, 0, 'Ω'),
        sw: i18n.t(state.switchOn ? 'sw.on' : 'sw.off'),
        i: spoken(result.current, 2, 'A'),
      });
    },
    announcement() {
      return i18n.t(state.switchOn ? 'announce' : 'announce.off', { i: spoken(result.current, 2, 'A') });
    },
    record() {
      return {
        name: 'current',
        value: result.current,
        unit: 'A',
        context: [reading('voltage', state.emf, 1), reading('resistance', result.externalResistance, rPrecision())],
      };
    },
    reset() {
      Object.assign(state, initial);
      syncControls();
      update({ rebuild: true });
    },
    snapshot(): JsonObject {
      return { ...state };
    },
    restore(data) {
      const next = resolveParams(schema, {
        voltage: data.emf as number,
        r1: data.r1 as number,
        r2: data.r2 as number,
        arrangement: data.arrangement as string,
        switchOn: data.switchOn as boolean,
        internalResistance: data.internalResistance as number,
      });
      state.emf = numberParam(next, 'voltage');
      state.r1 = numberParam(next, 'r1');
      state.r2 = numberParam(next, 'r2');
      state.arrangement = stringParam(next, 'arrangement') as Arrangement;
      state.switchOn = booleanParam(next, 'switchOn');
      state.internalResistance = numberParam(next, 'internalResistance');
      syncControls();
      update({ rebuild: true });
    },
    conditions: {
      arrangement: (args) => args.is === state.arrangement,
      switch_on: () => state.switchOn,
    },
    resume() {
      syncMotion();
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
  conditionNames: ['arrangement', 'switch_on'],
  aspect: manifest.aspect,
  preferredOrientation: manifest.preferredOrientation,
  standalone: { params: defaultParams(schema), tasks: manifest.tasks as TaskSpec[] },
  mount,
});
