import { expect, test } from '@playwright/test';
import { expectHandshake, expectTask, openSim } from './helpers';

test('titration: loads, handshakes, finds the end point and records it', async ({ page }) => {
  const sim = await openSim(page, 'acid-base-titration', '&rm=1');
  await expectHandshake(sim);

  const one = sim.frame.locator('#add-one');
  for (let i = 0; i < 24; i += 1) await one.click();
  await expect(sim.frame.locator('.readout[data-name=volume_added] .readout-v')).toHaveText(/24\.00/);
  await sim.check('end-point');
  await expectTask(page, 'end-point', 'wrong');

  // Drop by drop until phenolphthalein turns pink.
  const drop = sim.frame.locator('#add-drop');
  for (let i = 0; i < 40; i += 1) {
    await drop.click();
    const note = await sim.frame.locator('.readout-note').textContent();
    if (note?.includes('pink') && !note.includes('pale')) break;
  }
  await sim.check('end-point');
  await expectTask(page, 'end-point', 'correct');

  await page.getByTestId('activate-record-end-point').click();
  await page.getByTestId('act-record').click();
  await sim.check('record-end-point');
  await expectTask(page, 'record-end-point', 'correct');
  expect(sim.errors).toEqual([]);
});

test('titration: excess base pushes the pH above 11', async ({ page }) => {
  const sim = await openSim(page, 'acid-base-titration', '&lang=hi&theme=dark&lp=1');
  for (let i = 0; i < 27; i += 1) await sim.frame.locator('#add-one').click();
  await sim.check('excess-base');
  await expectTask(page, 'excess-base', 'correct');
  await expect(sim.frame.locator('.readout-note')).toContainText('गुलाबी');
  expect(sim.errors).toEqual([]);
});
