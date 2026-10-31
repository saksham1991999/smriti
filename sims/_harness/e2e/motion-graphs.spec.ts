import { expect, test } from '@playwright/test';
import { expectHandshake, expectTask, openSim } from './helpers';

test('motion graphs: the card case, u = 10 m/s and a = −2 m/s², stops at 5 s at 25 m', async ({ page }) => {
  const sim = await openSim(page, 'motion-graphs');
  await expectHandshake(sim);

  await sim.check('stop-time');
  await expectTask(page, 'stop-time', 'wrong');

  // Step 0.1 s at a time from 4.5 s up to 5.0 s.
  await sim.frame.locator('#time').fill('4.5');
  for (let i = 0; i < 5; i += 1) await sim.frame.locator('#step').click();
  await expect(sim.frame.locator('.readout[data-name=time] .readout-v')).toHaveText(/5\.0/);
  await expect(sim.frame.locator('.readout[data-name=velocity] .readout-v')).toHaveText(/^0\.00/);
  await expect(sim.frame.locator('.readout[data-name=position] .readout-v')).toHaveText(/25\.00/);
  await sim.check('stop-time');
  await expectTask(page, 'stop-time', 'correct');
  await page.getByTestId('activate-farthest').click();
  await sim.check('farthest');
  await expectTask(page, 'farthest', 'correct');
  expect(sim.errors).toEqual([]);
});

test('motion graphs: back at the start at 10 s after a 50 m path; both v-t areas shaded', async ({ page }) => {
  const sim = await openSim(page, 'motion-graphs');
  await sim.frame.locator('#time').fill('10');
  await expect(sim.frame.locator('.readout[data-name=position] .readout-v')).toHaveText(/^0\.00/);
  await expect(sim.frame.locator('.readout[data-name=displacement] .readout-v')).toHaveText(/^0\.00/);
  await expect(sim.frame.locator('.readout[data-name=path_length] .readout-v')).toHaveText(/50\.00/);
  await expect(sim.frame.locator('.area-above')).toHaveCount(1);
  await expect(sim.frame.locator('.area-below')).toHaveCount(1);
  await page.getByTestId('activate-back-home').click();
  await sim.check('back-home');
  await expectTask(page, 'back-home', 'correct');
  await page.getByTestId('activate-path').click();
  await sim.check('path');
  await expectTask(page, 'path', 'correct');
  expect(sim.errors).toEqual([]);
});

test('motion graphs: Play runs the clock; a different setup fails the task', async ({ page }) => {
  const sim = await openSim(page, 'motion-graphs');
  await sim.frame.locator('#play').click();
  await expect(sim.frame.locator('.readout[data-name=time] .readout-v')).not.toHaveText(/^0\.0/, { timeout: 6000 });
  await sim.frame.locator('#play').click();
  await sim.frame.locator('#a').fill('-1');
  await sim.frame.locator('#time').fill('10');
  await page.getByTestId('activate-path').click();
  await sim.check('path');
  await expectTask(page, 'path', 'wrong');
  expect(sim.errors).toEqual([]);
});

test('motion graphs: keyboard, Hindi, dark and reduced motion', async ({ page }) => {
  const sim = await openSim(page, 'motion-graphs', '&lang=hi&theme=dark&rm=1&lp=1');
  await expect(sim.frame.locator('#play')).toHaveCount(0);
  const u = sim.frame.locator('#u');
  await u.focus();
  await u.press('ArrowRight');
  await expect(u).toHaveAttribute('aria-valuetext', '10.5 मीटर प्रति सेकंड');
  await expect(sim.frame.locator('html')).toHaveAttribute('lang', 'hi');
  await expect(sim.frame.locator('html')).toHaveAttribute('data-theme', 'dark');
  await sim.frame.locator('#step').click();
  await expect(sim.frame.locator('.readout[data-name=time] .readout-v')).toHaveText(/0\.1/);
  await expect(sim.frame.locator('.sim-scene')).toHaveAttribute('aria-label', /पथ-लंबाई/);
  expect(sim.errors).toEqual([]);
});
