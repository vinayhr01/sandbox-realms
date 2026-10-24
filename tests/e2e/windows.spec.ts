import { expect, test, type Page } from '@playwright/test';

/**
 * Windows and the first-run tutorial (13 section 7, 15, 17): the Realm Rules toggles reach the sim,
 * the achievements list searches, the settings groups show, the coach strip advances and stays
 * dismissed across reloads, and the power catalogue arms a power.
 */

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

test.afterEach(async ({ page }, testInfo) => {
  const errors = (page as unknown as { __errors?: string[] }).__errors ?? [];
  if (testInfo.status === 'passed') expect(errors, errors.join('\n')).toEqual([]);
});

test('Realm Rules: search, then a toggle changes the rule and sends it to the sim', async ({ page }) => {
  const call = await openRealm(page);
  await page.getByRole('tab', { name: 'Powers', exact: true }).click();
  await page.getByRole('tab', { name: 'Powers: Realm' }).click();
  await page.getByRole('button', { name: 'Realm Rules', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Realm Rules' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('searchbox', { name: 'Search Realm rules' }).fill('sky');
  const sky = dialog.getByRole('switch', { name: 'Sky clouds' });
  await expect(sky).toHaveAttribute('aria-checked', 'true');
  await sky.click();
  await expect(sky).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => call<boolean>('rule', 'sky_clouds')).toBe(false);
  // Kind 8 is SetRule (src/shared/protocol.ts).
  await expect.poll(() => call<number[]>('commands')).toContain(8);
});

test('Achievements: the catalogue lists all 63 and search narrows it', async ({ page }) => {
  await openRealm(page);
  await page.getByRole('tab', { name: 'Powers', exact: true }).click();
  await page.getByRole('button', { name: 'Achievements', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Achievements' });
  await expect(dialog.getByText('63 of 63')).toBeVisible();
  await dialog.getByRole('searchbox', { name: 'Search Achievements' }).fill('cradle');
  await expect(dialog.getByText('1 of 63')).toBeVisible();
  await expect(dialog.getByRole('listitem').filter({ hasText: 'Cradle' })).toBeVisible();
});

test('Settings: the spec groups show and a setting that is not active yet says so', async ({ page }) => {
  await openRealm(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByRole('group')).toHaveCount(11);
  await expect(dialog.getByRole('group', { name: 'Map' })).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: /Bloom/ })).toBeVisible();
  await expect(dialog.getByText('not active yet').first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
});

test('Tutorial: the coach strip follows the steps, and skipping keeps it hidden after a reload', async ({ page }) => {
  await openRealm(page);
  const coach = page.locator('#coach');
  await expect(coach).toBeVisible();
  await expect(page.locator('#coach-text')).toContainText('Pick a tool');

  // Arming a terrain tool completes the first step.
  await page.getByRole('button', { name: 'Raise', exact: true }).click();
  await expect(page.locator('#coach-text')).toContainText('Drag across the map');

  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  await expect(coach).toBeHidden();
  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as { __sr?: unknown }).__sr));
  await expect(page.locator('#realm-name')).toContainText('Realm');
  await expect(coach).toBeHidden();
});

test('All powers: the catalogue filters to available powers and a tap arms one', async ({ page }) => {
  await openRealm(page);
  await page.getByRole('tab', { name: 'Powers', exact: true }).click();
  await page.getByRole('button', { name: 'All powers', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Power catalogue' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Available', exact: true }).click();
  // The list is virtualised, so search for the row rather than rely on scroll position.
  await dialog.getByRole('searchbox', { name: 'Search Powers' }).fill('Bomb');
  await dialog.locator('.power-row').filter({ hasText: 'Bomb' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('tab', { name: 'Powers: Havoc' }).click();
  await expect(page.getByRole('button', { name: 'Bomb', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
