import { expect, test } from '@playwright/test';
import { expectHandshake, expectTask, openSim } from './helpers';

const readout = (sim: Awaited<ReturnType<typeof openSim>>, name: string) => sim.frame.locator(`.readout[data-name=${name}] .readout-v`);

test('projectile: 20 m/s at 45° lands at 40.8 m after rising 10.2 m', async ({ page }) => {
  const sim = await openSim(page, 'projectile-launcher');
  await expectHandshake(sim);

  // Nothing is measured before a launch.
  await sim.check('range-45');
  await expectTask(page, 'range-45', 'wrong');

  await sim.frame.locator('#launch').click();
  await expect(readout(sim, 'range')).toHaveText(/40\.82/, { timeout: 8000 });
  await expect(readout(sim, 'max_height')).toHaveText(/10\.20/);
  await expect(readout(sim, 'time_of_flight')).toHaveText(/2\.89/);
  await sim.check('range-45');
  await expectTask(page, 'range-45', 'correct');
  await page.getByTestId('activate-height-45').click();
  await sim.check('height-45');
  await expectTask(page, 'height-45', 'correct');
  expect(sim.errors).toEqual([]);
});

test('projectile: 30° and 60° land together at 35.3 m; the earlier path is kept', async ({ page }) => {
  const sim = await openSim(page, 'projectile-launcher', '&rm=1');
  // Reduced motion: no Play/Pause; Launch draws the finished path at once.
  await expect(sim.frame.locator('#play')).toHaveCount(0);
  await sim.frame.locator('#angle').fill('30');
  await sim.frame.locator('#launch').click();
  await expect(readout(sim, 'range')).toHaveText(/35\.35/);
  await page.getByTestId('activate-range-30').click();
  await sim.check('range-30');
  await expectTask(page, 'range-30', 'correct');

  await sim.frame.locator('#angle').fill('60');
  // Changing the angle clears the measurement until the next launch.
  await expect(readout(sim, 'range')).toHaveText(/^0\.00/);
  await sim.frame.locator('#launch').click();
  await expect(readout(sim, 'range')).toHaveText(/35\.35/);
  await expect(sim.frame.locator('.path-kept')).toHaveCount(1);
  await expect(sim.frame.locator('.kept-label')).toHaveText('30°');
  await page.getByTestId('activate-range-60').click();
  await sim.check('range-60');
  await expectTask(page, 'range-60', 'correct');
  expect(sim.errors).toEqual([]);
});

test('projectile: Step follows the flight 0.05 s at a time; vx stays the same', async ({ page }) => {
  const sim = await openSim(page, 'projectile-launcher', '&lang=hi&theme=dark&rm=1&lp=1');
  await expect(sim.frame.locator('html')).toHaveAttribute('lang', 'hi');
  await expect(sim.frame.locator('html')).toHaveAttribute('data-theme', 'dark');
  const vx = await readout(sim, 'vx').textContent();
  for (let i = 0; i < 4; i += 1) await sim.frame.locator('#step').click();
  await expect(readout(sim, 'time')).toHaveText(/0\.20/);
  await expect(readout(sim, 'vx')).toHaveText(vx ?? '');
  await expect(readout(sim, 'vy')).toHaveText(/12\.18/);
  const angle = sim.frame.locator('#angle');
  await angle.focus();
  await angle.press('ArrowRight');
  await expect(angle).toHaveAttribute('aria-valuetext', '46 डिग्री');
  await expect(sim.frame.locator('.sim-scene')).toHaveAttribute('aria-label', /प्रक्षेपक/);
  expect(sim.errors).toEqual([]);
});
