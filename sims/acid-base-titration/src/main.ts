import '@smriti/sim-kit/styles.css';
import './sim.css';
import type { JsonObject, Reading, TaskSpec } from '@smriti/sim-bridge';
import {
  attr,
  button,
  choice,
  defaultParams,
  familyForSubject,
  group,
  h,
  mountSim,
  numberParam,
  readingMaker,
  resolveParams,
  spokenValue,
  stringParam,
  svg,
  toggle,
  type ParamsSchema,
  type SimController,
  type SimManifest,
  type SimRuntime,
} from '@smriti/sim-kit';
import manifestJson from '../manifest.json';
import en from '../strings.en.json';
import hi from '../strings.hi.json';
import {
  INDICATORS,
  colourName,
  isEndPoint,
  phAfter,
  solutionColour,
  type Analyte,
  type IndicatorId,
  type TitrationSetup,
} from './model';

const manifest = manifestJson as unknown as SimManifest;
const schema = manifest.params as ParamsSchema;
const reading = readingMaker(manifest);

const DROP_ML = 0.05;
/** Flow with the tap open, mL per second (about eight drops a second). */
const FLOW_ML_PER_S = 0.4;
const HISTORY_STEP = 0.05;
const MAX_HISTORY = 2000;

/* Scene geometry: apparatus on the left, pH curve on the right. */
const W = 400;
const H = 300;
const BX = 70; // burette left
const BW = 22;
const BTOP = 24;
const BBOT = 184;
const FLASK_NECK_TOP = 222;
const FLASK_NECK_BOT = 238;
const FLASK_BOT = 292;
const FLASK_L = 30;
const FLASK_R = 132;
const NECK_L = 70;
const NECK_R = 92;
const TIP_Y = 214;
const PX0 = 214;
const PX1 = 384;
const PY0 = 252; // pH 0
const PY1 = 36; // pH 14

interface TitrationState {
  analyte: Analyte;
  indicator: IndicatorId;
  vb: number;
  tapOpen: boolean;
  history: Array<[number, number]>;
}

function rgba(c: [number, number, number, number]): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${c[3].toFixed(3)})`;
}

/** Flask side at height y (linear between the neck and the base). */
function flaskSides(y: number): [number, number] {
  if (y <= FLASK_NECK_BOT) return [NECK_L, NECK_R];
  const t = (y - FLASK_NECK_BOT) / (FLASK_BOT - FLASK_NECK_BOT);
  return [NECK_L + (FLASK_L - NECK_L) * t, NECK_R + (FLASK_R - NECK_R) * t];
}

function mount(rt: SimRuntime): SimController {
  const { i18n } = rt;
  const p = resolveParams(schema, rt.params);
  const capacity = numberParam(p, 'buretteCapacity');
  const setupFor = (analyte: Analyte): TitrationSetup => ({
    analyte,
    acidConc: numberParam(p, 'acidConc'),
    acidVolume: numberParam(p, 'acidVolume'),
    baseConc: numberParam(p, 'baseConc'),
  });
  const initialAnalyte = stringParam(p, 'analyte') as Analyte;
  const initialIndicator = stringParam(p, 'indicator') as IndicatorId;
  const state: TitrationState = {
    analyte: initialAnalyte,
    indicator: initialIndicator,
    vb: 0,
    tapOpen: false,
    history: [[0, phAfter(setupFor(initialAnalyte), 0)]],
  };
  const setup = (): TitrationSetup => setupFor(state.analyte);
  let ph = phAfter(setup(), 0);

  const spokenMl = (v: number): string => spokenValue(i18n.num(v, 2), v, 'mL', i18n.locale);

  /* ------------------------------------------------------------- scene */

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'titration', 'aria-hidden': 'true' });
  const yFor = (ml: number): number => BTOP + (ml / capacity) * (BBOT - BTOP);

  // Stand and clamp (apparatus outline).
  root.append(
    svg('line', { x1: 18, y1: 12, x2: 18, y2: FLASK_BOT + 2, class: 'stand' }),
    svg('line', { x1: 6, y1: FLASK_BOT + 3, x2: 150, y2: FLASK_BOT + 3, class: 'stand' }),
    svg('line', { x1: 18, y1: 60, x2: BX, y2: 60, class: 'clamp' }),
  );

  // Burette: tube, liquid, graduations every 1 mL (labels every 10 mL), stopcock and tip.
  const buretteLiquid = svg('rect', { x: BX + 3, width: BW - 6, class: 'liquid-base' });
  const ticks = svg('g', { class: 'ticks' });
  for (let ml = 0; ml <= capacity; ml += 1) {
    const y = yFor(ml);
    const major = ml % 10 === 0;
    const mid = ml % 5 === 0;
    ticks.append(svg('line', { x1: BX + BW, y1: y, x2: BX + BW - (major ? 10 : mid ? 7 : 4), y2: y, class: 'tick' }));
    if (major) ticks.append(svg('text', { x: BX + BW + 5, y, class: 'sv-text sv-muted tick-label', 'text-anchor': 'start', 'dominant-baseline': 'central' }, i18n.num(ml, 0)));
  }
  const levelMark = svg('line', { x1: BX - 2, x2: BX + BW + 6, class: 'level-mark' });
  const stopcock = svg('rect', { x: BX - 8, y: 192, width: BW + 16, height: 8, rx: 4, class: 'stopcock' });
  root.append(
    svg('rect', { x: BX, y: BTOP - 8, width: BW, height: BBOT - BTOP + 12, rx: 8, class: 'glass' }),
    buretteLiquid,
    ticks,
    levelMark,
    svg('path', { d: `M ${BX + 4} ${BBOT + 4} L ${BX + BW - 4} ${BBOT + 4} L ${BX + BW / 2 + 2} ${TIP_Y} L ${BX + BW / 2 - 2} ${TIP_Y} Z`, class: 'glass' }),
    stopcock,
  );

  // Flask: water layer plus the indicator colour on top.
  const flaskPath = `M ${NECK_L} ${FLASK_NECK_TOP} L ${NECK_L} ${FLASK_NECK_BOT} L ${FLASK_L} ${FLASK_BOT - 6} Q ${FLASK_L - 2} ${FLASK_BOT} ${FLASK_L + 6} ${FLASK_BOT} L ${FLASK_R - 6} ${FLASK_BOT} Q ${FLASK_R + 2} ${FLASK_BOT} ${FLASK_R} ${FLASK_BOT - 6} L ${NECK_R} ${FLASK_NECK_BOT} L ${NECK_R} ${FLASK_NECK_TOP}`;
  const water = svg('path', { class: 'liquid-water' });
  const tint = svg('path', { class: 'liquid-tint' });
  const dropsLayer = svg('g', { class: 'drops' });
  root.append(water, tint, svg('path', { d: flaskPath, class: 'glass flask' }), dropsLayer);

  // Graph.
  const xFor = (ml: number): number => PX0 + (ml / capacity) * (PX1 - PX0);
  const yPh = (v: number): number => PY0 + (v / 14) * (PY1 - PY0);
  const band = svg('rect', { x: PX0, width: PX1 - PX0, class: 'band' });
  const bandLabel = svg('text', { x: PX1 - 4, class: 'sv-text band-label', 'text-anchor': 'end', 'font-size': 10 }, i18n.t('range'));
  const grid = svg('g', { class: 'grid' });
  for (let v = 0; v <= 14; v += 2) {
    const y = yPh(v);
    grid.append(svg('line', { x1: PX0, y1: y, x2: PX1, y2: y, class: v === 7 ? 'grid-line grid-mid' : 'grid-line' }));
    grid.append(svg('text', { x: PX0 - 6, y, class: 'sv-text sv-muted axis-num', 'text-anchor': 'end', 'dominant-baseline': 'central' }, i18n.num(v, 0)));
  }
  for (let ml = 0; ml <= capacity; ml += 10) {
    grid.append(svg('text', { x: xFor(ml), y: PY0 + 14, class: 'sv-text sv-muted axis-num', 'text-anchor': 'middle' }, i18n.num(ml, 0)));
  }
  const curveLine = svg('polyline', { class: 'curve' });
  const nowDot = svg('circle', { r: 5.5, class: 'now-dot' });
  root.append(
    svg('rect', { x: PX0 - 30, y: 14, width: PX1 - PX0 + 40, height: H - 20, rx: 16, class: 'plot-bg' }),
    band,
    bandLabel,
    grid,
    svg('text', { x: PX0 - 6, y: PY1 - 14, class: 'sv-text axis-title', 'text-anchor': 'end' }, i18n.t('axis.ph')),
    svg('text', { x: (PX0 + PX1) / 2, y: PY0 + 30, class: 'sv-text axis-title', 'text-anchor': 'middle' }, i18n.t('axis.volume')),
    curveLine,
    nowDot,
  );
  rt.scene.append(root);

  /* ----------------------------------------------------------- drawing */

  const liquidPath = (topY: number): string => {
    const [l, r] = flaskSides(topY);
    const pts: string[] = [`M ${l} ${topY}`];
    if (topY < FLASK_NECK_BOT) pts.push(`L ${NECK_L} ${FLASK_NECK_BOT}`);
    pts.push(`L ${FLASK_L + 1} ${FLASK_BOT - 6}`, `Q ${FLASK_L} ${FLASK_BOT - 1} ${FLASK_L + 6} ${FLASK_BOT - 1}`, `L ${FLASK_R - 6} ${FLASK_BOT - 1}`, `Q ${FLASK_R} ${FLASK_BOT - 1} ${FLASK_R - 1} ${FLASK_BOT - 6}`);
    if (topY < FLASK_NECK_BOT) pts.push(`L ${NECK_R} ${FLASK_NECK_BOT}`);
    pts.push(`L ${r} ${topY} Z`);
    return pts.join(' ');
  };

  const draw = (): void => {
    const ind = INDICATORS[state.indicator];
    // Burette.
    const level = yFor(state.vb);
    attr(buretteLiquid, { y: level, height: Math.max(0, BBOT - level + 4) });
    attr(levelMark, { y1: level, y2: level });
    stopcock.classList.toggle('open', state.tapOpen);
    // Flask: liquid height grows with the total volume (flask holds about 125 mL to the neck).
    const total = setup().acidVolume + state.vb;
    const topY = FLASK_BOT - 8 - Math.min(1, total / 125) * (FLASK_BOT - FLASK_NECK_BOT - 6);
    const d = liquidPath(topY);
    attr(water, { d });
    attr(tint, { d, fill: rgba(solutionColour(ind, ph)) });
    // Graph.
    attr(band, { y: yPh(ind.range[1]), height: yPh(ind.range[0]) - yPh(ind.range[1]) });
    attr(bandLabel, { y: yPh(ind.range[1]) - 4 });
    attr(curveLine, { points: state.history.map(([v, y]) => `${xFor(v).toFixed(1)},${yPh(y).toFixed(1)}`).join(' ') });
    attr(nowDot, { cx: xFor(state.vb), cy: yPh(ph) });
    for (const b of addButtons) b.disabled = state.vb >= capacity - 1e-9;
  };

  /* ------------------------------------------------------------- drops */

  const drops: Array<{ el: SVGCircleElement; t: number }> = [];
  const spawnDrop = (): void => {
    if (rt.reducedMotion || drops.length > (rt.lowPower ? 2 : 5)) return;
    const el = svg('circle', { cx: BX + BW / 2, cy: TIP_Y + 4, r: 3.2, class: 'drop' });
    dropsLayer.append(el);
    drops.push({ el, t: 0 });
    ensureLoop();
  };

  let flowCarry = 0;
  const loop = rt.loop((dt) => {
    if (state.tapOpen) {
      const before = state.vb;
      add(FLOW_ML_PER_S * dt, { quiet: true });
      flowCarry += state.vb - before;
      if (flowCarry >= DROP_ML * 2) {
        flowCarry = 0;
        spawnDrop();
      }
    }
    for (let i = drops.length - 1; i >= 0; i -= 1) {
      const d = drops[i]!;
      d.t += dt;
      const y = TIP_Y + 4 + 260 * d.t * d.t;
      if (y > FLASK_NECK_BOT + 18) {
        d.el.remove();
        drops.splice(i, 1);
      } else attr(d.el, { cy: y.toFixed(1) });
    }
    if (!state.tapOpen && drops.length === 0) loop.stop();
  });
  const ensureLoop = (): void => {
    if (!rt.paused && !loop.running) loop.start();
  };

  /* ---------------------------------------------------------- actions */

  const pushHistory = (from: number, to: number): void => {
    const s = setup();
    for (let v = from + HISTORY_STEP; v < to - 1e-9; v += HISTORY_STEP) state.history.push([v, phAfter(s, v)]);
    state.history.push([to, phAfter(s, to)]);
    if (state.history.length > MAX_HISTORY) state.history.splice(1, state.history.length - MAX_HISTORY);
  };

  function add(ml: number, opts: { quiet?: boolean } = {}): void {
    const before = state.vb;
    const next = Math.min(capacity, Number((state.vb + ml).toFixed(4)));
    if (next <= before) return;
    state.vb = next;
    pushHistory(before, next);
    ph = phAfter(setup(), state.vb);
    if (state.vb >= capacity - 1e-9 && state.tapOpen) {
      state.tapOpen = false;
      tap?.set(false);
      rt.announcer.now(i18n.t('empty'));
    }
    if (!opts.quiet) spawnDrop();
    draw();
    rt.changed();
  }

  const newFlask = (): void => {
    state.vb = 0;
    state.tapOpen = false;
    tap?.set(false);
    ph = phAfter(setup(), 0);
    state.history = [[0, ph]];
    draw();
    rt.changed();
  };

  /* ---------------------------------------------------------- controls */

  const analyte = choice({
    id: 'analyte',
    label: i18n.t('analyte'),
    options: (['strong', 'weak'] as const).map((value) => ({ value, label: i18n.t(`opt.${value}`) })),
    value: state.analyte,
    onChange: (v) => {
      state.analyte = v as Analyte;
      newFlask();
    },
  });
  const indicator = choice({
    id: 'indicator',
    label: i18n.t('indicator'),
    options: (['phenolphthalein', 'methyl_orange', 'bromothymol_blue'] as const).map((value) => ({ value, label: i18n.t(`ind.${value}`) })),
    value: state.indicator,
    onChange: (v) => {
      state.indicator = v as IndicatorId;
      newFlask();
    },
  });
  const addButtons = [
    button({ label: i18n.t('add.drop'), icon: 'drop', variant: 'primary', onClick: () => add(DROP_ML), id: 'add-drop' }),
    button({ label: i18n.t('add.half'), icon: 'plus', onClick: () => add(0.5), id: 'add-half' }),
    button({ label: i18n.t('add.one'), icon: 'plus', onClick: () => add(1), id: 'add-one' }),
  ];
  addButtons[0]?.setAttribute('aria-label', i18n.t('add.drop_label'));
  addButtons[1]?.setAttribute('aria-label', i18n.t('add.half_label'));
  addButtons[2]?.setAttribute('aria-label', i18n.t('add.one_label'));

  // Reduced motion: no running flow; the student steps through with the buttons.
  const tap = rt.reducedMotion
    ? null
    : toggle({
        id: 'tap',
        label: i18n.t('tap'),
        checked: false,
        i18n,
        onChange: (open) => {
          state.tapOpen = open && state.vb < capacity;
          if (state.tapOpen) ensureLoop();
          draw();
        },
      });

  rt.controls.append(
    group(i18n.t('group.burette'), h('div', { class: 'btn-row add-row' }, ...addButtons), ...(tap ? [tap.el] : [])),
    group(i18n.t('group.flask'), analyte.el, indicator.el, h('p', { class: 'caption-note' }, i18n.t('new_flask'))),
  );

  draw();

  const colourWord = (): string => i18n.t(`colour.${colourName(INDICATORS[state.indicator], ph)}`);

  return {
    readings(): Reading[] {
      return [reading('volume_added', state.vb, 2), reading('burette_reading', state.vb, 2), reading('ph', ph, 2)];
    },
    notes() {
      return [i18n.t('note.colour', { colour: colourWord() })];
    },
    summary() {
      return i18n.t('summary', {
        acid: i18n.t(`opt.${state.analyte}`),
        indicator: i18n.t(`ind.${state.indicator}`),
        volume: spokenMl(state.vb),
        ph: i18n.num(ph, 2),
        colour: colourWord(),
      });
    },
    announcement() {
      return i18n.t('announce', { volume: spokenMl(state.vb), ph: i18n.num(ph, 2), colour: colourWord() });
    },
    record() {
      return {
        name: 'volume_added',
        value: state.vb,
        unit: 'mL',
        context: [reading('ph', ph, 2), reading('burette_reading', state.vb, 2)],
      };
    },
    reset() {
      state.analyte = initialAnalyte;
      state.indicator = initialIndicator;
      analyte.set(state.analyte);
      indicator.set(state.indicator);
      newFlask();
    },
    snapshot(): JsonObject {
      // Keep the snapshot small: every fourth history point is plenty to redraw the curve.
      const hist = state.history.filter((_, i) => i % 4 === 0 || i === state.history.length - 1);
      return { analyte: state.analyte, indicator: state.indicator, vb: state.vb, history: hist.map(([v, y]) => [Number(v.toFixed(3)), Number(y.toFixed(3))]) };
    },
    restore(data) {
      const next = resolveParams(schema, { ...p, analyte: data.analyte as string, indicator: data.indicator as string });
      state.analyte = stringParam(next, 'analyte') as Analyte;
      state.indicator = stringParam(next, 'indicator') as IndicatorId;
      const vb = typeof data.vb === 'number' ? Math.min(capacity, Math.max(0, data.vb)) : 0;
      state.vb = vb;
      state.tapOpen = false;
      tap?.set(false);
      ph = phAfter(setup(), vb);
      const hist = Array.isArray(data.history) ? (data.history as unknown[]) : [];
      state.history = hist
        .filter((pt): pt is [number, number] => Array.isArray(pt) && typeof pt[0] === 'number' && typeof pt[1] === 'number')
        .map(([v, y]) => [v, y]);
      if (state.history.length === 0) state.history = [[vb, ph]];
      analyte.set(state.analyte);
      indicator.set(state.indicator);
      draw();
    },
    conditions: {
      end_point: () => isEndPoint(setup(), INDICATORS[state.indicator], state.vb),
      analyte: (args) => args.is === state.analyte,
      indicator: (args) => args.is === state.indicator,
    },
    pause() {
      state.tapOpen = false;
      tap?.set(false);
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
  conditionNames: ['end_point', 'analyte', 'indicator'],
  aspect: manifest.aspect,
  preferredOrientation: manifest.preferredOrientation,
  standalone: { params: defaultParams(schema), tasks: manifest.tasks as TaskSpec[] },
  mount,
});
