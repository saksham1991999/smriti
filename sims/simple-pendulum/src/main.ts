import '@smriti/sim-kit/styles.css';
import './sim.css';
import type { JsonObject, Reading, TaskSpec } from '@smriti/sim-bridge';
import {
  attr,
  booleanParam,
  button,
  choice,
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
  stringParam,
  svg,
  type ParamsSchema,
  type SimController,
  type SimManifest,
  type SimRuntime,
} from '@smriti/sim-kit';
import manifestJson from '../manifest.json';
import en from '../strings.en.json';
import hi from '../strings.hi.json';
import { GRAVITY, advance, exactPeriod, type PendulumState, type Planet } from './model';

const manifest = manifestJson as unknown as SimManifest;
const schema = manifest.params as ParamsSchema;
const reading = readingMaker(manifest);

const W = 400;
const H = 300;
const PX = 214;
const PY = 30;
/** Drawing height for the longest string on the current ruler. */
const RULER_PX = 236;
/** Ruler ranges (m): the view zooms to the smallest one that fits the string, and the ruler always shows the true scale. */
const RULER_RANGES = [0.5, 1, 2];
const RULER_X = 52;
const TRAIL = 18;

interface PState {
  length: number;
  amplitude: number; // degrees
  mass: number;
  planet: Planet;
}

const rad = (d: number): number => (d * Math.PI) / 180;

function mount(rt: SimRuntime): SimController {
  const { i18n } = rt;
  const p = resolveParams(schema, rt.params);
  const initial: PState = {
    length: numberParam(p, 'length'),
    amplitude: numberParam(p, 'amplitude'),
    mass: numberParam(p, 'mass'),
    planet: stringParam(p, 'planet') as Planet,
  };
  const cfg: PState = { ...initial };
  let motion: PendulumState = { theta: rad(cfg.amplitude), omega: 0 };
  let elapsed = 0;
  let count = 0;
  // Reduced motion: no auto-play loop; the student steps through (sim-builder).
  let playing = booleanParam(p, 'autoplay') && !rt.reducedMotion;
  const trail: Array<[number, number]> = [];

  const g = (): number => GRAVITY[cfg.planet];
  const period = (): number => exactPeriod(cfg.length, g(), rad(cfg.amplitude));
  const spoken = (v: number, d: number, unit: string): string => spokenValue(i18n.num(v, d), v, unit, i18n.locale);

  /* ------------------------------------------------------------- scene */

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pendulum', 'aria-hidden': 'true' });
  const ruler = svg('g', { class: 'ruler' });
  let rulerMax = 0;
  let pxPerM = RULER_PX / 2;
  const drawRuler = (): void => {
    const max = RULER_RANGES.find((r) => cfg.length <= r + 1e-9) ?? 2;
    pxPerM = RULER_PX / max;
    if (max === rulerMax) return;
    rulerMax = max;
    while (ruler.firstChild) ruler.firstChild.remove();
    ruler.append(svg('line', { x1: RULER_X, y1: PY, x2: RULER_X, y2: PY + RULER_PX, class: 'ruler-line' }));
    const minor = max / 20;
    const decimals = 1;
    for (let k = 0; k <= 20; k += 1) {
      const y = PY + k * minor * pxPerM;
      const major = k % 4 === 0;
      ruler.append(svg('line', { x1: RULER_X, y1: y, x2: RULER_X + (major ? 12 : 6), y2: y, class: 'ruler-tick' }));
      if (major) ruler.append(svg('text', { x: RULER_X - 6, y, class: 'sv-text sv-muted ruler-label', 'text-anchor': 'end', 'dominant-baseline': 'central' }, i18n.num(k * minor, decimals)));
    }
    ruler.append(svg('text', { x: RULER_X - 6, y: PY + RULER_PX + 18, class: 'sv-text sv-muted ruler-label', 'text-anchor': 'end' }, i18n.t('ruler')));
  };
  const lengthMark = svg('line', { x1: RULER_X - 2, x2: RULER_X + 18, class: 'length-mark' });

  const guides = svg('g', { class: 'guides' });
  const strobe = svg('g', { class: 'strobe' });
  const trailLayer = svg('g', { class: 'trail' });
  const string = svg('line', { x1: PX, y1: PY, class: 'string' });
  const bob = svg('circle', { class: 'bob' });
  const bobHit = svg('circle', { class: 'hit' });
  root.append(
    svg('rect', { x: PX - 70, y: PY - 14, width: 140, height: 12, rx: 6, class: 'support' }),
    ruler,
    lengthMark,
    guides,
    strobe,
    trailLayer,
    string,
    bob,
    svg('circle', { cx: PX, cy: PY, r: 5, class: 'pivot' }),
    bobHit,
  );
  rt.scene.append(root);

  const bobPos = (theta: number): [number, number] => {
    const L = cfg.length * pxPerM;
    return [PX + L * Math.sin(theta), PY + L * Math.cos(theta)];
  };
  const bobRadius = (): number => 8 + 10 * cfg.mass;

  const drawGuides = (): void => {
    drawRuler();
    while (guides.firstChild) guides.firstChild.remove();
    const L = cfg.length * pxPerM;
    const a = rad(cfg.amplitude);
    const [lx, ly] = bobPos(-a);
    const [rx, ry] = bobPos(a);
    guides.append(
      svg('line', { x1: PX, y1: PY, x2: PX, y2: PY + L + 18, class: 'guide-rest' }),
      svg('path', { d: `M ${lx.toFixed(1)} ${ly.toFixed(1)} A ${L} ${L} 0 0 0 ${rx.toFixed(1)} ${ry.toFixed(1)}`, class: 'guide-arc' }),
      svg('line', { x1: PX, y1: PY, x2: rx, y2: ry, class: 'guide-amp' }),
    );
    const r = Math.min(46, L * 0.45);
    const [ax, ay] = [PX + r * Math.sin(a), PY + r * Math.cos(a)];
    guides.append(
      svg('path', { d: `M ${PX} ${PY + r} A ${r} ${r} 0 0 0 ${ax.toFixed(1)} ${ay.toFixed(1)}`, class: 'angle-arc' }),
      svg('text', { x: PX + r * 0.9 * Math.sin(a / 2) + 10, y: PY + r * Math.cos(a / 2) + 14, class: 'sv-text angle-label', 'font-size': 13 }, `${i18n.num(cfg.amplitude, 0)}°`),
    );
    attr(lengthMark, { y1: PY + L, y2: PY + L });
  };

  const drawStrobe = (): void => {
    while (strobe.firstChild) strobe.firstChild.remove();
    if (!rt.reducedMotion) return;
    // Positions through one half swing at equal time steps: data from the same integrator.
    const T = period();
    let s: PendulumState = { theta: rad(cfg.amplitude), omega: 0 };
    for (let k = 0; k <= 6; k += 1) {
      const [x, y] = bobPos(s.theta);
      strobe.append(svg('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: bobRadius(), class: 'ghost' }));
      s = advance(s, cfg.length, g(), T / 12);
    }
  };

  const drawBob = (): void => {
    const [x, y] = bobPos(motion.theta);
    attr(string, { x2: x.toFixed(1), y2: y.toFixed(1) });
    attr(bob, { cx: x.toFixed(1), cy: y.toFixed(1), r: bobRadius() });
    attr(bobHit, { cx: x.toFixed(1), cy: y.toFixed(1), r: bobRadius() + 16 });
    while (trailLayer.firstChild) trailLayer.firstChild.remove();
    if (rt.lowPower || rt.reducedMotion) return;
    trail.forEach(([tx, ty], i) => trailLayer.append(svg('circle', { cx: tx, cy: ty, r: 3, class: 'trail-dot', opacity: ((i + 1) / trail.length) * 0.5 })));
  };

  /* --------------------------------------------------------- dynamics */

  let lastSent = 0;
  const step = (dt: number): void => {
    const before = motion.theta;
    motion = advance(motion, cfg.length, g(), dt);
    elapsed += dt;
    if (before < 0 && motion.theta >= 0) count += 1;
    const [x, y] = bobPos(motion.theta);
    trail.push([Number(x.toFixed(1)), Number(y.toFixed(1))]);
    if (trail.length > TRAIL) trail.shift();
    drawBob();
    // Timer readings change every frame; report them a few times a second without announcing.
    if (elapsed - lastSent >= 0.25) {
      lastSent = elapsed;
      rt.changed({ announce: false });
    }
  };

  const loop = rt.loop((dt) => step(dt));

  const release = (): void => {
    motion = { theta: rad(cfg.amplitude), omega: 0 };
    elapsed = 0;
    lastSent = 0;
    count = 0;
    trail.length = 0;
  };

  const syncPlay = (): void => {
    const run = playing && !rt.paused;
    if (run && !loop.running) loop.start();
    if (!run && loop.running) loop.stop();
    playBtn?.replaceChildren(icon(playing ? 'pause' : 'play'), h('span', {}, i18n.t(playing ? 'pause' : 'play')));
  };

  const update = (opts: { release?: boolean } = {}): void => {
    if (opts.release) release();
    drawGuides();
    drawStrobe();
    drawBob();
    rt.changed();
  };

  /* ---------------------------------------------------------- controls */

  const lengthSlider = slider({
    id: 'length',
    label: i18n.t('length'),
    ...rangeOf(schema, 'length'),
    unit: 'm',
    decimals: 2,
    value: cfg.length,
    i18n,
    onInput: (v) => {
      cfg.length = v;
      update({ release: true });
    },
  });
  const ampSlider = slider({
    id: 'amplitude',
    label: i18n.t('amplitude'),
    ...rangeOf(schema, 'amplitude'),
    unit: '°',
    decimals: 0,
    value: cfg.amplitude,
    i18n,
    onInput: (v) => {
      cfg.amplitude = v;
      update({ release: true });
    },
  });
  const massSlider = slider({
    id: 'mass',
    label: i18n.t('mass'),
    ...rangeOf(schema, 'mass'),
    unit: 'kg',
    decimals: 1,
    value: cfg.mass,
    i18n,
    onInput: (v) => {
      cfg.mass = v;
      update();
    },
  });
  const planet = choice({
    id: 'planet',
    label: i18n.t('planet'),
    options: (['earth', 'moon', 'mars', 'jupiter'] as const).map((value) => ({ value, label: i18n.t(`planet.${value}`) })),
    value: cfg.planet,
    onChange: (v) => {
      cfg.planet = v as Planet;
      update({ release: true });
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
          playing = !playing;
          syncPlay();
        },
      });
  const stepBtn = button({
    label: i18n.t('step'),
    icon: 'step',
    id: 'step',
    onClick: () => {
      playing = false;
      syncPlay();
      step(period() / 8);
      rt.changed();
    },
  });
  stepBtn.setAttribute('aria-label', i18n.t('step_label'));
  const releaseBtn = button({
    label: i18n.t('release'),
    icon: 'reset',
    variant: 'ghost',
    id: 'release',
    onClick: () => update({ release: true }),
  });

  const runRow = h('div', { class: 'btn-row' }, ...(playBtn ? [playBtn] : []), stepBtn, releaseBtn);
  rt.controls.append(
    group(i18n.t('group.pendulum'), runRow, lengthSlider.el, ampSlider.el, massSlider.el),
    group(i18n.t('group.place'), planet.el),
  );
  if (rt.reducedMotion) rt.controls.prepend(h('p', { class: 'caption-note' }, i18n.t('strobe_note')));

  // Drag the bob sideways to set the release angle (a shortcut for the slider).
  const ampRange = rangeOf(schema, 'amplitude');
  draggable(bobHit, root, {
    onStart: () => {
      playing = false;
      syncPlay();
    },
    onMove: (x, y) => {
      const angle = Math.abs((Math.atan2(x - PX, y - PY) * 180) / Math.PI);
      const a = Math.min(ampRange.max, Math.max(ampRange.min, Math.round(angle)));
      if (a !== cfg.amplitude) {
        cfg.amplitude = a;
        ampSlider.set(a);
      }
      update({ release: true });
    },
    onEnd: () => {
      playing = !rt.reducedMotion;
      syncPlay();
    },
  });

  update();
  syncPlay();

  const syncControls = (): void => {
    lengthSlider.set(cfg.length);
    ampSlider.set(cfg.amplitude);
    massSlider.set(cfg.mass);
    planet.set(cfg.planet);
  };

  return {
    readings(): Reading[] {
      return [
        reading('length', cfg.length, 2),
        reading('gravity', g(), 2),
        reading('period', period(), 2),
        reading('oscillations', count, 0),
        reading('elapsed', elapsed, 1),
      ];
    },
    summary() {
      return i18n.t('summary', {
        L: spoken(cfg.length, 2, 'm'),
        m: spoken(cfg.mass, 1, 'kg'),
        planet: i18n.t(`planet.${cfg.planet}`),
        a: spoken(cfg.amplitude, 0, '°'),
        T: spoken(period(), 2, 's'),
        n: i18n.num(count, 0),
        t: spoken(elapsed, 1, 's'),
      });
    },
    announcement() {
      return i18n.t('announce', { T: spoken(period(), 2, 's') });
    },
    record() {
      return {
        name: 'period',
        value: Number(period().toFixed(4)),
        unit: 's',
        context: [reading('length', cfg.length, 2), reading('gravity', g(), 2), reading('mass', cfg.mass, 1), reading('amplitude', cfg.amplitude, 0)],
      };
    },
    reset() {
      Object.assign(cfg, initial);
      syncControls();
      playing = booleanParam(p, 'autoplay') && !rt.reducedMotion;
      update({ release: true });
      syncPlay();
    },
    snapshot(): JsonObject {
      return { ...cfg, theta: motion.theta, omega: motion.omega, elapsed, count, playing };
    },
    restore(data) {
      const next = resolveParams(schema, {
        length: data.length as number,
        amplitude: data.amplitude as number,
        mass: data.mass as number,
        planet: data.planet as string,
      });
      cfg.length = numberParam(next, 'length');
      cfg.amplitude = numberParam(next, 'amplitude');
      cfg.mass = numberParam(next, 'mass');
      cfg.planet = stringParam(next, 'planet') as Planet;
      const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
      motion = { theta: num(data.theta, rad(cfg.amplitude)), omega: num(data.omega, 0) };
      elapsed = num(data.elapsed, 0);
      count = num(data.count, 0);
      playing = data.playing === true && !rt.reducedMotion;
      syncControls();
      update();
      syncPlay();
    },
    conditions: {
      planet: (args) => args.is === cfg.planet,
    },
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
  conditionNames: ['planet'],
  aspect: manifest.aspect,
  preferredOrientation: manifest.preferredOrientation,
  standalone: { params: defaultParams(schema), tasks: manifest.tasks as TaskSpec[] },
  mount,
});
