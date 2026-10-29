import { expect, test } from '@playwright/test';
import { expectHandshake, expectTask, openSim } from './helpers';

test('circuit: loads, handshakes and completes "make the ammeter read 0.5 A"', async ({ page }) => {
  const sim = await openSim(page, 'ohms-law-circuit');
  await expectHandshake(sim);

  // Default 3 V across 12 Ω is 0.25 A: not right yet.
  await sim.check('current-half-amp');
  await expectTask(page, 'current-half-amp', 'wrong');
  await expect(page.getByTestId('feedback-current-half-amp')).toContainText('current');

  await sim.frame.locator('#voltage').fill('6');
  await expect(sim.frame.locator('.readout[data-name=current] .readout-v')).toHaveText(/0\.50/);
  await sim.check('current-half-amp');
  await expectTask(page, 'current-half-amp', 'correct');
  expect(sim.errors).toEqual([]);
});

test('circuit: doubling the current must keep the voltage; recording three readings', async ({ page }) => {
  const sim = await openSim(page, 'ohms-law-circuit');
  await page.getByTestId('activate-double-current').click();
  await sim.frame.locator('#r1').fill('6');
  await sim.check('double-current');
  await expectTask(page, 'double-current', 'correct');

  await page.getByTestId('activate-three-readings').click();
  for (const v of ['2', '4', '6']) {
    await sim.frame.locator('#voltage').fill(v);
    await page.getByTestId('act-record').click();
  }
  await expect(page.getByTestId('measurements').locator('tbody tr')).toHaveCount(3);
  await sim.check('three-readings');
  await expectTask(page, 'three-readings', 'correct');
  expect(sim.errors).toEqual([]);
});

test('circuit: keyboard, Hindi, dark and reduced motion', async ({ page }) => {
  const sim = await openSim(page, 'ohms-law-circuit', '&lang=hi&theme=dark&rm=1&lp=1');
  const slider = sim.frame.locator('#voltage');
  await slider.focus();
  await slider.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuetext', '3.5 वोल्ट');
  await expect(sim.frame.locator('html')).toHaveAttribute('lang', 'hi');
  await expect(sim.frame.locator('html')).toHaveAttribute('data-theme', 'dark');
  // Reduced motion: no moving dots, static direction arrows instead.
  await expect(sim.frame.locator('.dots circle')).toHaveCount(0);
  expect(await sim.frame.locator('.chevrons path').count()).toBeGreaterThan(0);
  await expect(sim.frame.locator('.sim-scene')).toHaveAttribute('aria-label', /ऐमीटर/);
  expect(sim.errors).toEqual([]);
});
