import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOGUE } from '../src/catalogue.generated';
import { LITTLE_LEARNER_PRODUCT_ALLOWLIST } from '../src/policy';

describe('catalogue.json (read by the API ingest)', () => {
  const doc = JSON.parse(readFileSync(join(__dirname, '..', 'catalogue.json'), 'utf8'));

  it('matches the TypeScript catalogue and policy (run `generate` when this fails)', () => {
    expect(doc.events).toEqual(JSON.parse(JSON.stringify(CATALOGUE)));
    expect(doc.policy.little_learner_product_allowlist).toEqual([...LITTLE_LEARNER_PRODUCT_ALLOWLIST]);
  });
});
