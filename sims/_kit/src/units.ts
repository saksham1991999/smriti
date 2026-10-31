/**
 * Unit symbols (SI, as the exams write them) and their spoken names for
 * screen readers. UI labels, not lesson content.
 */

import type { Locale } from '@smriti/sim-bridge';

interface Spoken {
  en: [singular: string, plural: string];
  hi: string;
}

const SPOKEN: Record<string, Spoken> = {
  V: { en: ['volt', 'volts'], hi: 'वोल्ट' },
  A: { en: ['ampere', 'amperes'], hi: 'ऐम्पियर' },
  'Ω': { en: ['ohm', 'ohms'], hi: 'ओम' },
  W: { en: ['watt', 'watts'], hi: 'वाट' },
  m: { en: ['metre', 'metres'], hi: 'मीटर' },
  cm: { en: ['centimetre', 'centimetres'], hi: 'सेंटीमीटर' },
  s: { en: ['second', 'seconds'], hi: 'सेकंड' },
  kg: { en: ['kilogram', 'kilograms'], hi: 'किलोग्राम' },
  g: { en: ['gram', 'grams'], hi: 'ग्राम' },
  mL: { en: ['millilitre', 'millilitres'], hi: 'मिलीलीटर' },
  M: { en: ['molar', 'molar'], hi: 'मोलर' },
  '°': { en: ['degree', 'degrees'], hi: 'डिग्री' },
  'm/s': { en: ['metre per second', 'metres per second'], hi: 'मीटर प्रति सेकंड' },
  'm/s²': { en: ['metre per second squared', 'metres per second squared'], hi: 'मीटर प्रति सेकंड वर्ग' },
  D: { en: ['dioptre', 'dioptres'], hi: 'डायॉप्टर' },
  '×': { en: ['times', 'times'], hi: 'गुना' },
};

/** "0.50 amperes" / "0.50 ऐम्पियर". Unknown units are read as written. */
export function spokenValue(formatted: string, value: number, unit: string, locale: Locale): string {
  if (unit === '') return formatted;
  const s = SPOKEN[unit];
  if (!s) return `${formatted} ${unit}`;
  if (locale === 'hi') return `${formatted} ${s.hi}`;
  const singular = Math.abs(value) === 1;
  return `${formatted} ${singular ? s.en[0] : s.en[1]}`;
}

/** Display form with a thin space where SI puts a space, and none for degrees. */
export function withUnit(formatted: string, unit: string): string {
  if (unit === '') return formatted;
  if (unit === '°') return `${formatted}°`;
  if (unit === '×') return `${formatted}×`;
  return `${formatted} ${unit}`;
}
