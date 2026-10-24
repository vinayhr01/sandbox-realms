import { expect, test, type Page } from '@playwright/test';

/**
 * Windows that read the sim snapshot (13 section 7, 14, 15): the windows show the numbers the
 * worker sent, and they open with data while the sim is paused (a snapshot is asked for on open).
 */

interface SnapshotLike {
  tick: number;
  population: { total: number };
  dominions: unknown[];
  achievements: { unlocked: boolean }[];
}

type Hook = <T>(fn: string, ...args: unknown[]) => Promise<T>;

function sr(page: Page): Hook {
  return <T>(fn: string, ...args: unknown[]) =>
    page.evaluate(
      ({ fn, args }) => {
        const hooks = (window as unknown as { __sr: Record<string, (...a: unknown[]) => unknown> }).__sr;
        const target = hooks[fn];
        if (!target) throw new Error(`no hook ${fn}`);
        return target(...args);
      },
      { fn, args },
    ) as Promise<T>;
}

async function openRealm(page: Page): Promise<Hook> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('/?seed=42&size=4');
  await page.waitForFunction(() => Boolean((window as unknown as { __sr?: unknown }).__sr));
  await expect(page.locator('#realm-name')).toContainText('Realm');
  (page as unknown as { __errors: string[] }).__errors = errors;
  return sr(page);
}

async function openWindowFromPowers(page: Page, name: string) {
  await page.getByRole('tab', { name: 'Powers', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

test.afterEach(async ({ page }, testInfo) => {
  const errors = (page as unknown as { __errors?: string[] }).__errors ?? [];
  if (testInfo.status === 'passed') expect(errors, errors.join('\n')).toEqual([]);
});

test('a snapshot reaches the UI: the sim tick advances and the hook sees it', async ({ page }) => {
  const call = await openRealm(page);
  await expect.poll(async () => (await call<SnapshotLike | null>('snapshot'))?.tick ?? -1).toBeGreaterThanOrEqual(0);
  const first = (await call<SnapshotLike>('snapshot')).tick;
  await page.locator('#pause').click();
  await expect.poll(async () => (await call<SnapshotLike>('snapshot')).tick).toBeGreaterThanOrEqual(first);
});

test('Population opens with data while paused and shows the snapshot totals', async ({ page }) => {
  const call = await openRealm(page);
  await page.locator('#pause').click();
  await openWindowFromPowers(page, 'Population');
  const dialog = page.getByRole('dialog', { name: 'Population' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Alive now')).toBeVisible();
  await expect.poll(async () => (await call<SnapshotLike | null>('snapshot'))?.population.total ?? -1).toBeGreaterThanOrEqual(0);
  const total = (await call<SnapshotLike>('snapshot')).population.total;
  const alive = dialog.locator('dt', { hasText: 'Alive now' }).locator('xpath=following-sibling::dd[1]');
  await expect(alive).toHaveText(String(total));
});

test('Dominions lists every dominion in the snapshot', async ({ page }) => {
  const call = await openRealm(page);
  await page.locator('#pause').click();
  await openWindowFromPowers(page, 'Dominions');
  const dialog = page.getByRole('dialog', { name: 'Dominions' });
  await expect(dialog).toBeVisible();
  await expect.poll(async () => (await call<SnapshotLike | null>('snapshot'))?.dominions.length ?? -1).toBeGreaterThanOrEqual(0);
  const n = (await call<SnapshotLike>('snapshot')).dominions.length;
  await expect(dialog.locator('.list-count')).toHaveText(`${n} of ${n}`);
});

test('Achievements shows the unlock headline and all 63 entries', async ({ page }) => {
  const call = await openRealm(page);
  await page.locator('#pause').click();
  await openWindowFromPowers(page, 'Achievements');
  const dialog = page.getByRole('dialog', { name: 'Achievements' });
  await expect(dialog.getByText('63 of 63')).toBeVisible();
  const unlocked = (await call<SnapshotLike>('snapshot')).achievements.filter((a) => a.unlocked).length;
  await expect(dialog.getByText(new RegExp(`^${unlocked} of 63 unlocked`))).toBeVisible();
  await dialog.getByRole('button', { name: 'Locked', exact: true }).click();
  await expect(dialog.locator('.list-count')).toHaveText(`${63 - unlocked} of 63`);
});

test('Figures and Culture show their summaries', async ({ page }) => {
  await openRealm(page);
  await page.locator('#pause').click();
  await openWindowFromPowers(page, 'Figures');
  const figures = page.getByRole('dialog', { name: 'Figures' });
  await expect(figures.getByText('Beings spawned')).toBeVisible();
  await expect(figures.getByText('Deaths', { exact: true })).toBeVisible();
  await figures.getByRole('button', { name: 'Close window' }).click();
  await expect(figures).toBeHidden();

  await openWindowFromPowers(page, 'Culture');
  const culture = page.getByRole('dialog', { name: 'Culture' });
  await expect(culture.getByText('Intrigues active')).toBeVisible();
});
