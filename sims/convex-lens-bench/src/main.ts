import '@smriti/sim-kit/styles.css';
import './sim.css';
import type { JsonObject, Reading, TaskSpec } from '@smriti/sim-bridge';
import {
  attr,
  booleanParam,
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
import { blurFraction, isSharpOnScreen, objectRegion, principalRays, solveLens, type LensImage } from './model';

const manifest = manifestJson as unknown as SimManifest;
const schema = manifest.params as ParamsSchema;
const reading = readingMaker(manifest);

/* Scene: 480 × 300 viewBox, lens at the centre. Heights use a larger scale than
   distances (as ray diagrams do); straight lines stay straight, so the rays
   still meet exactly at the image. */
const W = 480;
const H = 300;
const X0 = 240;
const Y0 = 160;
const SX = 5; // px per cm along the axis
const SY = 14; // px per cm for heights
const X_END = (W - X0) / SX + 2;

const toX = (cm: number): number => X0 + cm * SX;
const toY = (cm: number): number => Y0 - cm * SY;

interface LensState {
  f: number;
  d: number;
  s: number;
  h: number;
  rays: boolean;
}

function arrowPath(x: number, h: number): string {
  // Vertical arrow from the axis to height h (cm), with a head at the tip.
  const y1 = toY(h);
  const dir = h >= 0 ? 1 : -1;
  return `M ${x} ${Y0} L ${x} ${y1} M ${x - 7} ${y1 + dir * 10} L ${x} ${y1} L ${x + 7} ${y1 + dir * 10}`;
}

function mount(rt: SimRuntime): SimController {
  const { i18n } = rt;
  const p = resolveParams(schema, rt.params);
  const initial: LensState = {
    f: numberParam(p, 'focalLength'),
    d: numberParam(p, 'objectDistance'),
    s: numberParam(p, 'screenDistance'),
    h: numberParam(p, 'objectHeight'),
    rays: booleanParam(p, 'showRays'),
  };
  const state: LensState = { ...initial };
  let img: LensImage = solveLens(state.f, state.d, state.h);

  const cm = (v: number, d = 1): string => withUnit(i18n.num(v, d), 'cm');
  const spokenCm = (v: number, d = 1): string => spokenValue(i18n.num(v, d), v, 'cm', i18n.locale);
  const onBench = (v: number | null): boolean => v !== null && v > 0 && v <= 45;

  /* ------------------------------------------------------------- scene */

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'bench', 'aria-hidden': 'true' });
  const defs = svg(
    'defs',
    {},
    svg('clipPath', { id: 'bench-clip' }, svg('rect', { x: 0, y: 0, width: W, height: H })),
    svg('filter', { id: 'screen-blur', x: '-50%', y: '-50%', width: '200%', height: '200%' }, svg('feGaussianBlur', { stdDeviation: 0 })),
    svg('marker', { id: 'ray-head', viewBox: '0 0 10 10', refX: 5, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' }, svg('path', { d: 'M 0 1 L 9 5 L 0 9 z', class: 'ray-head' })),
  );
  const blurNode = defs.querySelector('feGaussianBlur') as SVGFEGaussianBlurElement;
  const axis = svg('line', { x1: 8, y1: Y0, x2: W - 8, y2: Y0, class: 'axis' });
  const marks = svg('g', { class: 'marks' });
  const lens = svg('path', { d: `M ${X0} 36 Q ${X0 + 34} ${Y0} ${X0} ${H - 16} Q ${X0 - 34} ${Y0} ${X0} 36 Z`, class: 'lens' });
  const rayLayer = svg('g', { class: 'rays', 'clip-path': 'url(#bench-clip)' });
  const screenG = svg('g', { class: 'screen' });
  const screenRect = svg('rect', { width: 12, height: 156, y: Y0 - 78, rx: 6, class: 'screen-body' });
  const screenImage = svg('path', { class: 'screen-image', filter: rt.lowPower ? undefined : 'url(#screen-blur)' });
  const screenLabel = svg('text', { class: 'sv-text sv-muted sv-caption', 'text-anchor': 'middle' }, i18n.t('label.screen'));
  const screenHit = svg('rect', { width: 44, height: 176, y: Y0 - 88, class: 'hit' });
  screenG.append(screenRect, screenImage, screenLabel, screenHit);
  const objectArrow = svg('path', { class: 'object-arrow' });
  const objectLabel = svg('text', { class: 'sv-text sv-caption', 'text-anchor': 'middle' }, i18n.t('label.object'));
  const objectHit = svg('rect', { width: 44, height: 120, class: 'hit' });
  const imageArrow = svg('path', { class: 'image-arrow' });
  const imageLabel = svg('text', { class: 'sv-text sv-caption image-label', 'text-anchor': 'middle' }, i18n.t('label.image'));
  root.append(defs, axis, rayLayer, lens, marks, screenG, imageArrow, imageLabel, objectArrow, objectLabel, objectHit);
  rt.scene.append(root);

  const drawMarks = (): void => {
    while (marks.firstChild) marks.firstChild.remove();
    const mark = (xcm: number, base: string, sub: string): void => {
      const x = toX(xcm);
      marks.append(svg('circle', { cx: x, cy: Y0, r: 4, class: 'mark-dot' }), symbol(x, Y0 + 20, base, sub, 'sv-text sv-muted mark-label', 13));
    };
    mark(-state.f, 'F', '1');
    mark(-2 * state.f, '2F', '1');
    mark(state.f, 'F', '2');
    mark(2 * state.f, '2F', '2');
    marks.append(svg('text', { x: X0 + 12, y: Y0 + 20, class: 'sv-text sv-muted mark-label', 'font-size': 13, 'dominant-baseline': 'central' }, 'O'));
  };

  const line = (x1: number, y1: number, x2: number, y2: number, cls: string, head = false): SVGLineElement =>
    svg('line', {
      x1: toX(x1).toFixed(1),
      y1: toY(y1).toFixed(1),
      x2: toX(x2).toFixed(1),
      y2: toY(y2).toFixed(1),
      class: cls,
      'marker-end': head ? 'url(#ray-head)' : undefined,
    });

  const drawRays = (): void => {
    while (rayLayer.firstChild) rayLayer.firstChild.remove();
    if (!state.rays) return;
    const { f, d, h } = state;
    const rays = principalRays(f, d, h);
    const xo = -d;
    // Incident halves end in an arrowhead at their midpoint so the direction of light is clear.
    const incident = (y: number): void => {
      const midX = xo / 2;
      const midY = h + (y - h) / 2;
      rayLayer.append(line(xo, h, midX, midY, 'ray', true), line(midX, midY, 0, y, 'ray'));
    };
    // Refracted rays stop at the screen (it blocks the light); beyond it they show faintly.
    const refracted = (y0: number, slope: number): void => {
      const xs = state.s;
      rayLayer.append(line(0, y0, xs, y0 + slope * xs, 'ray'), line(xs, y0 + slope * xs, X_END, y0 + slope * X_END, 'ray-beyond'));
    };
    // 1. Parallel to the axis, refracts through F2.
    incident(rays.parallel);
    refracted(rays.parallel, -rays.parallel / f);
    // 2. Through the optical centre, undeviated.
    incident(0);
    refracted(0, -h / d);
    // 3. Through F1 (or as if from F1), leaves parallel.
    if (rays.focal !== null) {
      if (d < f) rayLayer.append(line(-f, 0, xo, h, 'ray-construction'));
      incident(rays.focal);
      refracted(rays.focal, 0);
    }
    // Virtual image: dashed back-extensions of the refracted rays.
    if (img.nature === 'virtual' && img.v !== null && img.imageHeight !== null) {
      const v = img.v;
      const hv = img.imageHeight;
      rayLayer.append(line(0, rays.parallel, v, hv, 'ray-virtual'), line(0, 0, v, hv, 'ray-virtual'));
      if (rays.focal !== null) rayLayer.append(line(0, rays.focal, v, hv, 'ray-virtual'));
    }
  };

  const drawObjectAndImage = (): void => {
    const xo = toX(-state.d);
    attr(objectArrow, { d: arrowPath(xo, state.h) });
    attr(objectLabel, { x: xo, y: toY(state.h) - 12 });
    attr(objectHit, { x: xo - 22, y: toY(state.h) - 30 });
    if (img.v !== null && img.imageHeight !== null && Math.abs(img.v) < 200) {
      const xi = toX(img.v);
      attr(imageArrow, { d: arrowPath(xi, img.imageHeight), visibility: 'visible' });
      imageArrow.classList.toggle('virtual', img.nature === 'virtual');
      const ly = img.imageHeight >= 0 ? toY(img.imageHeight) - 12 : toY(img.imageHeight) + 22;
      attr(imageLabel, { x: xi, y: Math.max(14, Math.min(H - 6, ly)), visibility: 'visible' });
    } else {
      attr(imageArrow, { visibility: 'hidden' });
      attr(imageLabel, { visibility: 'hidden' });
    }
    // With rays hidden the diagram image is hidden too: the student finds it with the screen.
    if (!state.rays) {
      attr(imageArrow, { visibility: 'hidden' });
      attr(imageLabel, { visibility: 'hidden' });
    }
  };

  const drawScreen = (): void => {
    const xs = toX(state.s);
    attr(screenRect, { x: xs - 6 });
    attr(screenLabel, { x: xs, y: Y0 - 88 });
    attr(screenHit, { x: xs - 22 });
    if (img.nature === 'real' && img.imageHeight !== null && img.v !== null) {
      const bf = blurFraction(img, state.s);
      // Height of the patch on the screen scales with distance from the lens (similar triangles).
      const hScreen = (img.imageHeight * state.s) / img.v;
      attr(screenImage, { d: arrowPath(xs, Math.max(-9, Math.min(9, hScreen))), visibility: 'visible', opacity: (1 - 0.75 * bf).toFixed(2) });
      attr(blurNode, { stdDeviation: (Math.min(1, bf * 3) * 9).toFixed(1) });
    } else {
      attr(screenImage, { visibility: 'hidden' });
    }
    screenG.classList.toggle('sharp', isSharpOnScreen(img, state.s));
  };

  /* ---------------------------------------------------------- controls */

  const update = (): void => {
    img = solveLens(state.f, state.d, state.h);
    drawMarks();
    drawRays();
    drawObjectAndImage();
    drawScreen();
    rt.changed();
  };

  const dRange = rangeOf(schema, 'objectDistance');
  const sRange = rangeOf(schema, 'screenDistance');
  const fRange = rangeOf(schema, 'focalLength');

  const objectSlider = slider({
    id: 'object',
    label: i18n.t('object'),
    ...dRange,
    unit: 'cm',
    decimals: 1,
    value: state.d,
    i18n,
    onInput: (v) => {
      state.d = v;
      update();
    },
  });
  const screenSlider = slider({
    id: 'screen',
    label: i18n.t('screen'),
    ...sRange,
    unit: 'cm',
    decimals: 1,
    value: state.s,
    i18n,
    onInput: (v) => {
      state.s = v;
      update();
    },
  });
  const focalSlider = slider({
    id: 'focal',
    label: i18n.t('focal'),
    ...fRange,
    unit: 'cm',
    decimals: 0,
    value: state.f,
    i18n,
    onInput: (v) => {
      state.f = v;
      update();
    },
  });
  const raysToggle = toggle({
    id: 'rays',
    label: i18n.t('rays'),
    checked: state.rays,
    i18n,
    onChange: (on) => {
      state.rays = on;
      update();
    },
  });

  const snapTo = (v: number, r: { min: number; max: number; step: number }): number =>
    Math.min(r.max, Math.max(r.min, Math.round(v / r.step) * r.step));
  draggable(objectHit, root, {
    onMove: (x) => {
      const d = snapTo((X0 - x) / SX, dRange);
      if (d === state.d) return;
      state.d = d;
      objectSlider.set(d);
      update();
    },
  });
  draggable(screenHit, root, {
    onMove: (x) => {
      const s = snapTo((x - X0) / SX, sRange);
      if (s === state.s) return;
      state.s = s;
      screenSlider.set(s);
      update();
    },
  });

  rt.controls.append(group(i18n.t('group.bench'), objectSlider.el, screenSlider.el), group(i18n.t('group.lens'), focalSlider.el, raysToggle.el));

  const syncControls = (): void => {
    objectSlider.set(state.d);
    screenSlider.set(state.s);
    focalSlider.set(state.f);
    raysToggle.set(state.rays);
  };

  const natureText = (): string =>
    img.nature === 'none'
      ? i18n.t('note.infinity')
      : `${i18n.t(`nature.${img.nature}`)}, ${i18n.t(`orient.${img.orientation}`)}, ${i18n.t(`size.${img.size}`)}`;

  const screenKey = (): 'sharp' | 'blurred' | 'none' =>
    isSharpOnScreen(img, state.s) ? 'sharp' : img.nature === 'real' ? 'blurred' : 'none';

  const imageSentence = (): string => {
    if (img.v === null || img.m === null) return i18n.t('summary.infinity');
    return i18n.t(img.nature === 'virtual' ? 'summary.image_virtual' : 'summary.image', {
      v: spokenCm(Math.abs(img.v)),
      nature: natureText(),
      m: i18n.num(img.m, 2),
    });
  };

  update();

  return {
    readings(): Reading[] {
      const list: Reading[] = [reading('object_distance', -state.d, 1), reading('focal_length', state.f, 1)];
      if (img.v !== null && img.m !== null) {
        list.push(reading('image_distance', img.v, 1), reading('magnification', img.m, 2));
      }
      list.push(reading('screen_distance', state.s, 1));
      return list;
    },
    notes() {
      const notes = [natureText()];
      if (img.nature === 'virtual') notes.push(i18n.t('note.no_screen_image'));
      else if (img.nature === 'real' && !onBench(img.v)) notes.push(i18n.t('note.beyond'));
      else if (img.nature === 'real') notes.push(i18n.t(isSharpOnScreen(img, state.s) ? 'note.sharp' : 'note.blurred'));
      return notes;
    },
    summary() {
      return i18n.t('summary', {
        f: spokenCm(state.f, 0),
        d: spokenCm(state.d),
        region: i18n.t(`region.${objectRegion(state.f, state.d)}`),
        image: imageSentence(),
        s: spokenCm(state.s),
        screen: i18n.t(`screen.${screenKey()}`),
      });
    },
    announcement() {
      return i18n.t('announce', { d: spokenCm(state.d), image: imageSentence() });
    },
    record() {
      const context = [reading('object_distance', -state.d, 1), reading('focal_length', state.f, 1)];
      if (isSharpOnScreen(img, state.s)) {
        rt.announcer.now(i18n.t('recorded.sharp'));
        return { name: 'image_distance', value: state.s, unit: 'cm', context };
      }
      rt.announcer.now(i18n.t('recorded.not_sharp'));
      return { name: 'screen_distance', value: state.s, unit: 'cm', context };
    },
    reset() {
      Object.assign(state, initial);
      syncControls();
      update();
    },
    snapshot(): JsonObject {
      return { ...state };
    },
    restore(data) {
      const next = resolveParams(schema, {
        focalLength: data.f as number,
        objectDistance: data.d as number,
        screenDistance: data.s as number,
        objectHeight: data.h as number,
        showRays: data.rays as boolean,
      });
      state.f = numberParam(next, 'focalLength');
      state.d = numberParam(next, 'objectDistance');
      state.s = numberParam(next, 'screenDistance');
      state.h = numberParam(next, 'objectHeight');
      state.rays = booleanParam(next, 'showRays');
      syncControls();
      update();
    },
    conditions: {
      object_region: (args) => args.is === objectRegion(state.f, state.d),
      image_real: () => img.nature === 'real',
      image_virtual: () => img.nature === 'virtual',
      screen_sharp: () => isSharpOnScreen(img, state.s),
    },
  };
}

mountSim({
  simId: manifest.id,
  simVersion: manifest.version,
  family: familyForSubject(manifest.subject),
  strings: { en, hi },
  conditionNames: ['object_region', 'image_real', 'image_virtual', 'screen_sharp'],
  aspect: manifest.aspect,
  preferredOrientation: manifest.preferredOrientation,
  standalone: { params: defaultParams(schema), tasks: manifest.tasks as TaskSpec[] },
  mount,
});
