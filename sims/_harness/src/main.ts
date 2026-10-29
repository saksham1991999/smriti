/**
 * Sim harness: a developer host page. Loads any built sim in a sandboxed
 * iframe through sim-bridge, plays its tasks, records readings and shows every
 * message in an event log. Internal tool, so its own UI is English only; the
 * sim inside switches between English and Hindi.
 *
 * URL: /_harness/dist/index.html?sim=ohms-law-circuit&lang=hi&theme=dark&rm=1&lp=1
 */

import '@smriti/sim-kit/styles.css';
import './harness.css';
import {
  createIframeHost,
  simIframeAttributes,
  type HostEvent,
  type IframeHost,
  type Locale,
  type MeasurementPayload,
  type Reading,
  type SimSnapshot,
  type TaskSpec,
  type ThemeName,
} from '@smriti/sim-bridge';
import { applyTheme, clear, formatNumber, h, withUnit, type SimManifest } from '@smriti/sim-kit';

const found = import.meta.glob<SimManifest>('../../*/manifest.json', { eager: true, import: 'default' });
const manifests = Object.values(found)
  .filter((m) => typeof m.id === 'string')
  .sort((a, b) => a.id.localeCompare(b.id));

interface LogEntry {
  at: number;
  dir: 'sent' | 'received' | 'host';
  type: string;
  detail: string;
}

interface HarnessApi {
  host: IframeHost | null;
  log: LogEntry[];
  status: string;
  simId: string;
}

declare global {
  interface Window {
    __harness: HarnessApi;
  }
}

const q = new URLSearchParams(location.search);
const settings = {
  sim: q.get('sim') ?? manifests[0]?.id ?? '',
  locale: (q.get('lang') === 'hi' ? 'hi' : 'en') as Locale,
  theme: (q.get('theme') === 'dark' ? 'dark' : 'light') as ThemeName,
  reducedMotion: q.get('rm') === '1',
  lowPower: q.get('lp') === '1',
};

const api: HarnessApi = { host: null, log: [], status: 'idle', simId: settings.sim };
window.__harness = api;

applyTheme(document.documentElement, settings.theme, 'physics');

/* ----------------------------------------------------------------- layout */

const app = document.getElementById('harness') ?? document.body;

const select = <T extends string>(id: string, label: string, options: Array<[T, string]>, value: T, onChange: (v: T) => void): HTMLElement => {
  const el = h('select', { id, class: 'h-select' }, ...options.map(([v, t]) => h('option', { value: v }, t)));
  el.value = value;
  el.addEventListener('change', () => onChange(el.value as T));
  return h('label', { class: 'h-field', for: id }, h('span', {}, label), el);
};

const check = (id: string, label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement => {
  const el = h('input', { type: 'checkbox', id });
  el.checked = value;
  el.addEventListener('change', () => onChange(el.checked));
  return h('label', { class: 'h-check', for: id }, el, h('span', {}, label));
};

const statusPill = h('span', { class: 'h-status', 'data-testid': 'status', role: 'status' }, 'idle');
const frameWrap = h('div', { class: 'h-frame' });
const readingsEl = h('div', { class: 'h-readings', 'data-testid': 'readings' });
const tasksEl = h('ol', { class: 'h-tasks', 'data-testid': 'tasks' });
const measurementsEl = h('table', { class: 'h-table', 'data-testid': 'measurements' });
const logEl = h('ol', { class: 'h-log', 'data-testid': 'log', 'aria-live': 'off' });

const actionButton = (label: string, id: string, onClick: () => void): HTMLButtonElement => {
  const b = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', id, 'data-testid': id }, label);
  b.addEventListener('click', onClick);
  return b;
};

let savedSnapshot: SimSnapshot | null = null;
const pauseBtn = actionButton('Pause', 'act-pause', () => {
  const s = api.host?.session;
  if (!s) return;
  if (s.status === 'paused') s.resume();
  else s.pause();
});
const actions = h(
  'div',
  { class: 'btn-row' },
  actionButton('Record reading', 'act-record', () => api.host?.session.record(currentTask())),
  actionButton('Reset', 'act-reset', () => api.host?.session.reset()),
  pauseBtn,
  actionButton('Save', 'act-save', () => {
    void api.host?.session.save().then((snap) => {
      savedSnapshot = snap;
      addLog('host', 'saved', JSON.stringify(snap).slice(0, 200));
    });
  }),
  actionButton('Restore', 'act-restore', () => {
    if (savedSnapshot) api.host?.session.restore(savedSnapshot);
  }),
  actionButton('Reload sim', 'act-reload', () => load()),
);

const manifestFor = (id: string): SimManifest | undefined => manifests.find((m) => m.id === id);

app.append(
  h(
    'header',
    { class: 'h-header' },
    h('h1', { class: 'h-title' }, 'Sim harness'),
    select('sim', 'Sim', manifests.map((m) => [m.id, m.title.en]), settings.sim, (v) => {
      settings.sim = v;
      load();
    }),
    select<Locale>('lang', 'Language', [['en', 'English'], ['hi', 'हिन्दी']], settings.locale, (v) => {
      settings.locale = v;
      api.host?.session.setParams({ locale: v });
      renderTasks();
      renderReadings(api.host?.session.readings ?? []);
    }),
    select<ThemeName>('theme', 'Theme', [['light', 'Light'], ['dark', 'Dark']], settings.theme, (v) => {
      settings.theme = v;
      applyTheme(document.documentElement, v, 'physics');
      api.host?.session.setParams({ theme: v });
    }),
    check('rm', 'Reduced motion', settings.reducedMotion, (v) => {
      settings.reducedMotion = v;
      api.host?.session.setParams({ reducedMotion: v });
    }),
    check('lp', 'Battery saver', settings.lowPower, (v) => {
      settings.lowPower = v;
      api.host?.session.setParams({ lowPower: v });
    }),
    statusPill,
  ),
  h(
    'main',
    { class: 'h-main' },
    h('section', { class: 'h-stage', 'aria-label': 'Sim' }, frameWrap),
    h(
      'aside',
      { class: 'h-panel' },
      h('section', { class: 'h-card' }, h('h2', {}, 'Readings'), readingsEl, actions),
      h('section', { class: 'h-card' }, h('h2', {}, 'Tasks'), tasksEl),
      h('section', { class: 'h-card' }, h('h2', {}, 'Recorded'), measurementsEl),
      h('section', { class: 'h-card' }, h('h2', {}, 'Event log'), logEl),
    ),
  ),
);

/* ----------------------------------------------------------------- render */

function fmtReading(r: Pick<Reading, 'value' | 'unit' | 'precision'>): string {
  return withUnit(formatNumber(r.value, r.precision ?? 2, settings.locale), r.unit);
}

function renderReadings(readings: readonly Reading[]): void {
  clear(readingsEl);
  for (const r of readings) {
    if (!r.label) continue;
    readingsEl.append(h('span', { class: 'readout', 'data-name': r.name }, h('span', { class: 'readout-q' }, r.label[settings.locale]), h('span', { class: 'readout-v tnum' }, fmtReading(r))));
  }
}

function renderMeasurements(rows: readonly MeasurementPayload[]): void {
  clear(measurementsEl);
  if (rows.length === 0) {
    measurementsEl.append(h('tbody', {}, h('tr', {}, h('td', { class: 'muted' }, 'No readings yet.'))));
    return;
  }
  measurementsEl.append(
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, '#'), h('th', { scope: 'col' }, 'Task'), h('th', { scope: 'col' }, 'Reading'), h('th', { scope: 'col' }, 'Context'))),
    h(
      'tbody',
      {},
      ...rows.map((m, i) =>
        h(
          'tr',
          {},
          h('td', {}, String(i + 1)),
          h('td', {}, m.taskId ?? '—'),
          h('td', {}, `${m.name} = ${fmtReading({ value: m.value, unit: m.unit, precision: 2 })}`),
          h('td', {}, (m.context ?? []).map((c) => `${c.name} ${fmtReading(c)}`).join(', ')),
        ),
      ),
    ),
  );
}

let activeTask: string | undefined;
const currentTask = (): string | undefined => activeTask;

function renderTasks(): void {
  clear(tasksEl);
  const session = api.host?.session;
  const tasks: readonly TaskSpec[] = session?.tasks ?? manifestFor(settings.sim)?.tasks ?? [];
  const progress = session?.taskProgress() ?? [];
  tasks.forEach((t, i) => {
    const p = progress.find((x) => x.taskId === t.id);
    const status = p?.status ?? 'pending';
    const icon = status === 'correct' ? '✓' : status === 'skipped' ? '↷' : status === 'wrong' ? '!' : String(i + 1);
    const statusText = status === 'correct' ? 'Correct' : status === 'skipped' ? 'Skipped' : status === 'wrong' ? 'Not quite' : 'Pending';
    const feedback: HTMLElement[] = [];
    if (status === 'wrong') {
      const quantity = p?.quantity ? ` Check ${p.quantity} again.` : '';
      feedback.push(h('p', { class: 'h-feedback', 'data-testid': `feedback-${t.id}` }, `Not quite.${quantity}`));
      if (session?.shouldShowHint(t.id) && t.hint) feedback.push(h('p', { class: 'h-hint' }, `Hint: ${t.hint[settings.locale]}`));
    }
    const li = h(
      'li',
      { class: `h-task status-${status}${activeTask === t.id ? ' active' : ''}`, 'data-testid': `task-${t.id}`, 'data-status': status, 'aria-current': activeTask === t.id ? 'step' : undefined },
      h('span', { class: 'h-task-icon', 'aria-label': statusText }, icon),
      h(
        'div',
        { class: 'h-task-body' },
        h('p', { class: 'h-task-prompt' }, t.prompt[settings.locale]),
        ...feedback,
        h(
          'div',
          { class: 'btn-row' },
          actionButton('Make current', `activate-${t.id}`, () => {
            activeTask = t.id;
            api.host?.session.setActiveTask(t.id);
            renderTasks();
          }),
          actionButton('Check task', `check-${t.id}`, () => api.host?.session.check(t.id)),
          actionButton('Skip task', `skip-${t.id}`, () => {
            api.host?.session.skip(t.id);
            renderTasks();
          }),
        ),
      ),
    );
    tasksEl.append(li);
  });
}

function addLog(dir: LogEntry['dir'], type: string, detail: string): void {
  const entry: LogEntry = { at: Math.round(performance.now()), dir, type, detail };
  api.log.push(entry);
  if (api.log.length > 500) api.log.shift();
  const arrow = dir === 'sent' ? '→' : dir === 'received' ? '←' : '•';
  logEl.prepend(
    h('li', { class: `h-log-${dir}`, 'data-type': type }, h('span', { class: 'h-log-t tnum' }, `${(entry.at / 1000).toFixed(2)}s`), h('span', { class: 'h-log-dir' }, arrow), h('b', {}, type), h('span', { class: 'h-log-d' }, detail)),
  );
  while (logEl.children.length > 200) logEl.lastElementChild?.remove();
}

/* ------------------------------------------------------------------- host */

function onEvent(e: HostEvent, iframe: HTMLIFrameElement): void {
  switch (e.kind) {
    case 'sent':
      addLog('sent', e.message.type, JSON.stringify(e.message.payload).slice(0, 240));
      return;
    case 'message': {
      const m = e.message;
      // State arrives often; keep the log readable by summarising it.
      const detail = m.type === 'state' ? m.payload.readings.map((r) => `${r.name}=${formatNumber(r.value, r.precision ?? 2, 'en')}`).join(' ') : JSON.stringify(m.payload).slice(0, 240);
      addLog('received', m.type, detail);
      if (m.type === 'state' || m.type === 'ready') renderReadings(m.payload.readings);
      if (m.type === 'measurement') renderMeasurements(api.host?.session.measurements ?? []);
      if (m.type === 'resize') iframe.style.height = `${Math.max(320, Math.ceil(m.payload.height))}px`;
      if (m.type === 'ready') renderTasks();
      return;
    }
    case 'status':
      api.status = e.status;
      statusPill.textContent = e.status;
      statusPill.dataset.status = e.status;
      pauseBtn.textContent = e.status === 'paused' ? 'Resume' : 'Pause';
      addLog('host', 'status', `${e.previous} → ${e.status}`);
      return;
    case 'task':
      renderTasks();
      return;
    case 'ready':
      addLog('host', 'loaded', `${e.loadMs} ms`);
      return;
    case 'timeout':
      addLog('host', 'timeout', `no ready after ${e.waitedMs} ms`);
      return;
    case 'rejected':
      addLog('host', 'rejected', `${e.reason}${e.detail ? `: ${e.detail}` : ''}`);
      return;
    case 'crashed':
      addLog('host', 'crashed', e.reason);
      return;
    case 'reloaded':
      addLog('host', 'reloaded', 'sim page reloaded; init sent again');
      return;
  }
}

function load(): void {
  api.host?.destroy();
  api.host = null;
  clear(frameWrap);
  clear(logEl);
  api.log.length = 0;
  api.simId = settings.sim;
  const manifest = manifestFor(settings.sim);
  if (!manifest) {
    frameWrap.append(h('p', {}, `No sim called ${settings.sim}.`));
    return;
  }
  const tasks = manifest.tasks;
  activeTask = tasks[0]?.id;
  const iframe = h('iframe', simIframeAttributes(`Simulation: ${manifest.title.en}`)) as HTMLIFrameElement;
  iframe.className = 'h-iframe';
  iframe.setAttribute('data-testid', 'sim-frame');
  frameWrap.append(iframe);
  // Create the host before setting src, so the first hello is not missed.
  api.host = createIframeHost({
    iframe,
    allowedOrigins: [location.origin],
    allowOpaqueOrigin: true,
    expectedSimId: manifest.id,
    init: {
      locale: settings.locale,
      theme: settings.theme,
      reducedMotion: settings.reducedMotion,
      lowPower: settings.lowPower,
      params: {},
      tasks,
      ...(activeTask ? { activeTaskId: activeTask } : {}),
    },
    onEvent: (e) => onEvent(e, iframe),
  });
  iframe.src = `../../${manifest.id}/dist/index.html`;
  renderTasks();
  renderReadings([]);
  renderMeasurements([]);
}

load();
