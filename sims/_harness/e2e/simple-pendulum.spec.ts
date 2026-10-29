import { expect, test } from '@playwright/test';
import { expectHandshake, expectTask, openSim } from './helpers';

test('pendulum: loads, handshakes and completes "period 2.0 s on Earth"', async ({ page }) => {
  const sim = await openSim(page, 'simple-pendulum');
  await expectHandshake(sim);

  await sim.check('period-two-seconds');
  await expectTask(page, 'period-two-seconds', 'wrong');
  await sim.frame.locator('#length').fill('0.99');
  await expect(sim.frame.locator('.readout[data-name=period] .readout-v')).toHaveText(/2\.00/);
  await sim.check('period-two-seconds');
  await expectTask(page, 'period-two-seconds', 'correct');
  // The pendulum is swinging: oscillations get counted.
  await expect(sim.frame.locator('.readout[data-name=oscillations] .readout-v')).not.toHaveText('0', { timeout: 6000 });
  expect(sim.errors).toEqual([]);
});

test('pendulum: reduced motion steps instead of playing; mass readings', async ({ page }) => {
  const sim = await openSim(page, 'simple-pendulum', '&rm=1&lang=hi');
  await expect(sim.frame.locator('#play')).toHaveCount(0);
  expect(await sim.frame.locator('.ghost').count()).toBeGreaterThan(3);
  await page.getByTestId('activate-mass-readings').click();
  for (const m of ['0.2', '0.8']) {
    await sim.frame.locator('#mass').fill(m);
    await page.getByTestId('act-record').click();
  }
  await sim.check('mass-readings');
  await expectTask(page, 'mass-readings', 'correct');
  await sim.frame.locator('#step').click();
  expect(sim.errors).toEqual([]);
});
