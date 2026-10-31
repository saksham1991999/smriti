import type { SimFiles } from '../services/labs';

/** On web, sims run from the CDN in a sandboxed iframe; nothing is downloaded. */
export function deviceSimFiles(): SimFiles | null {
  return null;
}
