import { expect, test } from '@playwright/test';
import { expectHandshake, expectTask, openSim } from './helpers';

test('lens: loads, handshakes and completes "sharp image with the object between F and 2F"', async ({ page }) => {
  const sim = await openSim(page, 'convex-lens-bench');
  await expectHandshake(sim);

  await sim.frame.locator('#object').fill('15');
  // f = 10 cm, u = −15 cm → v = 30 cm.
  await expect(sim.frame.locator('.readout[data-name=image_distance] .readout-v')).toHaveText(/30\.0/);
  await sim.frame.locator('#screen').fill('22');
  await sim.check('between-f-2f-sharp');
  await expectTask(page, 'between-f-2f-sharp', 'wrong');
  await sim.frame.locator('#screen').fill('30');
  await sim.check('between-f-2f-sharp');
  await expectTask(page, 'between-f-2f-sharp', 'correct');
  expect(sim.errors).toEqual([]);
});

test('lens: virtual image and same size', async ({ page }) => {
  const sim = await openSim(page, 'convex-lens-bench', '&lang=hi&theme=dark');
  await sim.frame.locator('#object').fill('20');
  await sim.check('same-size');
  await expectTask(page, 'same-size', 'correct');
  await sim.frame.locator('#object').fill('5');
  await sim.check('virtual-image');
  await expectTask(page, 'virtual-image', 'correct');
  await expect(sim.frame.locator('.readout-note').first()).toContainText('आभासी');
  expect(sim.errors).toEqual([]);
});
