/**
 * Controls for sims: slider with − / + steppers, segmented choice, switch and
 * button. Built on native inputs, so keyboard, touch and screen readers work
 * without extra code. Every control has a visible label.
 */

import type { Locale } from '@smriti/sim-bridge';
import { h } from './dom';
import type { I18n } from './i18n';
import { icon, type IconName } from './icons';
import { spokenValue, withUnit } from './units';

export interface SliderOptions {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit: string;
  decimals: number;
  i18n: I18n;
  onInput(value: number): void;
  /** Optional custom display, for example signed distances. */
  format?(value: number): string;
}

export interface SliderHandle {
  el: HTMLElement;
  input: HTMLInputElement;
  get value(): number;
  set(value: number): void;
  setDisabled(disabled: boolean): void;
}

function snap(value: number, min: number, max: number, step: number): number {
  const n = Math.round((value - min) / step);
  const v = min + n * step;
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  return Math.min(max, Math.max(min, Number(v.toFixed(decimals))));
}

export function slider(o: SliderOptions): SliderHandle {
  const fmt = (v: number): string => o.format?.(v) ?? withUnit(o.i18n.num(v, o.decimals), o.unit);
  const spoken = (v: number): string => spokenValue(o.format?.(v) ?? o.i18n.num(v, o.decimals), v, o.unit, o.i18n.locale);
  const input = h('input', {
    type: 'range',
    id: o.id,
    min: o.min,
    max: o.max,
    step: o.step,
    value: o.value,
    class: 'range',
  });
  const output = h('output', { for: o.id, class: 'ctl-value tnum' }, fmt(o.value));
  const dec = h('button', { type: 'button', class: 'step-btn', 'aria-label': o.i18n.t('kit.decrease', { name: o.label }) }, icon('minus'));
  const inc = h('button', { type: 'button', class: 'step-btn', 'aria-label': o.i18n.t('kit.increase', { name: o.label }) }, icon('plus'));
  const el = h(
    'div',
    { class: 'ctl ctl-slider' },
    h('div', { class: 'ctl-head' }, h('label', { for: o.id, class: 'ctl-label' }, o.label), output),
    h('div', { class: 'slider-row' }, dec, input, inc),
  );
  let current = o.value;
  const paint = (): void => {
    const pct = ((current - o.min) / (o.max - o.min)) * 100;
    input.style.setProperty('--fill', `${pct}%`);
    output.textContent = fmt(current);
    input.setAttribute('aria-valuetext', spoken(current));
    dec.disabled = input.disabled || current <= o.min;
    inc.disabled = input.disabled || current >= o.max;
  };
  const change = (v: number): void => {
    const next = snap(v, o.min, o.max, o.step);
    if (next === current) return;
    current = next;
    input.value = String(next);
    paint();
    o.onInput(next);
  };
  input.addEventListener('input', () => change(Number(input.value)));
  dec.addEventListener('click', () => change(current - o.step));
  inc.addEventListener('click', () => change(current + o.step));
  paint();
  return {
    el,
    input,
    get value() {
      return current;
    },
    set(v: number) {
      current = snap(v, o.min, o.max, o.step);
      input.value = String(current);
      paint();
    },
    setDisabled(disabled: boolean) {
      input.disabled = disabled;
      paint();
    },
  };
}

export interface ChoiceOption {
  value: string;
  label: string;
}

export interface ChoiceHandle {
  el: HTMLElement;
  get value(): string;
  set(value: string): void;
}

let groupCounter = 0;

/** A radio group drawn as chips. The selected chip carries a check mark, never colour alone. */
export function choice(o: { id: string; label: string; options: ChoiceOption[]; value: string; onChange(value: string): void }): ChoiceHandle {
  groupCounter += 1;
  const name = `${o.id}-${groupCounter}`;
  const legendId = `${o.id}-legend`;
  let current = o.value;
  const inputs: HTMLInputElement[] = [];
  const chips = o.options.map((opt) => {
    const input = h('input', { type: 'radio', name, value: opt.value, class: 'chip-input', id: `${name}-${opt.value}` });
    input.checked = opt.value === current;
    input.addEventListener('change', () => {
      if (!input.checked) return;
      current = opt.value;
      o.onChange(opt.value);
    });
    inputs.push(input);
    return h('label', { class: 'chip-choice', for: `${name}-${opt.value}` }, input, h('span', { class: 'chip-face' }, icon('check', 16), h('span', {}, opt.label)));
  });
  const el = h(
    'div',
    { class: 'ctl ctl-choice', role: 'radiogroup', 'aria-labelledby': legendId },
    h('div', { class: 'ctl-head' }, h('span', { id: legendId, class: 'ctl-label' }, o.label)),
    h('div', { class: 'chip-row' }, ...chips),
  );
  return {
    el,
    get value() {
      return current;
    },
    set(v: string) {
      current = v;
      for (const i of inputs) i.checked = i.value === v;
    },
  };
}

export interface ToggleHandle {
  el: HTMLElement;
  get checked(): boolean;
  set(checked: boolean): void;
}

/** A switch with its state in words ("On" / "Off") next to it. */
export function toggle(o: { id: string; label: string; checked: boolean; i18n: I18n; onChange(checked: boolean): void }): ToggleHandle {
  const input = h('input', { type: 'checkbox', role: 'switch', id: o.id, class: 'switch-input' });
  input.checked = o.checked;
  const state = h('span', { class: 'switch-state', 'aria-hidden': 'true' });
  const paint = (): void => {
    state.textContent = input.checked ? o.i18n.t('kit.on') : o.i18n.t('kit.off');
  };
  input.addEventListener('change', () => {
    paint();
    o.onChange(input.checked);
  });
  paint();
  const el = h(
    'div',
    { class: 'ctl ctl-toggle' },
    h('label', { for: o.id, class: 'ctl-label' }, o.label),
    h('span', { class: 'switch-wrap' }, state, h('span', { class: 'switch' }, input, h('span', { class: 'switch-knob', 'aria-hidden': 'true' }))),
  );
  return {
    el,
    get checked() {
      return input.checked;
    },
    set(v: boolean) {
      input.checked = v;
      paint();
    },
  };
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export function button(o: { label: string; icon?: IconName; variant?: ButtonVariant; small?: boolean; onClick(): void; id?: string }): HTMLButtonElement {
  const b = h(
    'button',
    { type: 'button', class: `btn btn-${o.variant ?? 'secondary'}${o.small ? ' btn-sm' : ''}`, id: o.id },
    o.icon ? icon(o.icon) : null,
    h('span', {}, o.label),
  );
  b.addEventListener('click', () => o.onClick());
  return b;
}

/** A titled group of controls on a card. */
export function group(title: string, ...children: HTMLElement[]): HTMLElement {
  return h('section', { class: 'ctl-group' }, h('h2', { class: 'ctl-group-title' }, title), ...children);
}

export function langAttr(locale: Locale): string {
  return locale === 'hi' ? 'hi' : 'en';
}
