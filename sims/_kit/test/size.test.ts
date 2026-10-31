import { describe, expect, it } from 'vitest';
import { manifestText, settleSizeBytes } from '../vite';

describe('settleSizeBytes', () => {
  const source = { id: 'demo', title: { en: 'Pendulum', hi: 'सरल लोलक' }, size_bytes: 1 };

  it('counts the manifest in UTF-8 bytes, not characters', () => {
    const size = settleSizeBytes(1000, source);
    const text = manifestText({ ...source, size_bytes: size });
    expect(size).toBe(1000 + Buffer.byteLength(text, 'utf8'));
    expect(size).toBeGreaterThan(1000 + text.length);
  });

  it('settles when the number gains a digit', () => {
    const size = settleSizeBytes(9_700, { id: 'x' });
    expect(size).toBe(9_700 + Buffer.byteLength(manifestText({ id: 'x', size_bytes: size }), 'utf8'));
  });
});
