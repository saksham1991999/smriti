import { expect, type FrameLocator, type Page } from '@playwright/test';

export interface OpenedSim {
  frame: FrameLocator;
  errors: string[];
  logTypes(): Promise<string[]>;
  check(taskId: string): Promise<void>;
  taskStatus(taskId: string): Promise<string | null>;
}

/** Open a sim in the harness, wait for the handshake and collect console errors from every frame. */
export async function openSim(page: Page, simId: string, query = ''): Promise<OpenedSim> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/_harness/dist/index.html?sim=${simId}${query}`);
  await expect(page.getByTestId('status')).toHaveText(/running|complete/, { timeout: 10_000 });
  const frame = page.frameLocator('[data-testid=sim-frame]');
  return {
    frame,
    errors,
    logTypes: () => page.evaluate(() => window.__harness.log.map((e) => `${e.dir}:${e.type}`)),
    async check(taskId: string) {
      await page.getByTestId(`check-${taskId}`).click();
    },
    taskStatus: (taskId: string) => page.getByTestId(`task-${taskId}`).getAttribute('data-status'),
  };
}

/** The handshake happened in order: hello, then init, then ready. */
export async function expectHandshake(sim: OpenedSim): Promise<void> {
  const types = await sim.logTypes();
  const hello = types.indexOf('received:hello');
  const init = types.indexOf('sent:init');
  const ready = types.indexOf('received:ready');
  expect(hello).toBeGreaterThanOrEqual(0);
  expect(init).toBeGreaterThan(hello);
  expect(ready).toBeGreaterThan(init);
  expect(types).not.toContain('received:error');
  expect(types).not.toContain('host:rejected');
}

export async function expectTask(page: Page, taskId: string, status: 'correct' | 'wrong' | 'pending' | 'skipped'): Promise<void> {
  await expect(page.getByTestId(`task-${taskId}`)).toHaveAttribute('data-status', status);
}
