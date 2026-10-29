import { expect, test, type Page } from '@playwright/test';

/**
 * Progressive discovery (UX redesign, spec E) in the real page: a new player sees the starter chips and the coach; a
 * discovery brings its chip forward with one "New!" card; the chip survives a reload.
 */

async function openRealm(page: Page): Promise<(fn: string, ...args: unknown[]) => Promise<unknown>> {
  await page.goto('/?seed=42&size=4');
  await page.waitForFunction(() => Boolean((window as unknown as { __sr?: unknown }).__sr));
  await expect(page.locator('#realm-name')).toContainText('Realm');
  return (fn, ...args) =>
    page.evaluate(
      ({ fn, args }) => {
        const hooks = (window as unknown as { __sr: Record<string, (...a: unknown[]) => unknown> }).__sr;
        const target = hooks[fn];
        if (!target) throw new Error(`no hook ${fn}`);
        return target(...args);
      },
      { fn, args },
    ) as Promise<unknown>;
}

test('first launch: the three starter chips and the coach', async ({ page }) => {
  await openRealm(page);
  await expect(page.getByRole('tab', { name: 'Land' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Nature' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Creatures' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Peoples' })).toHaveCount(0);
  await expect(page.locator('.coach')).toBeVisible();
});

test('a discovery brings its chip forward with one New card, and the chip survives a reload', async ({ page }) => {
  const call = await openRealm(page);
  await call('forceDiscovery', 'first-town');
  await expect(page.locator('.toast-new')).toContainText('Peoples');
  await expect(page.getByRole('tab', { name: 'Peoples' })).toBeVisible();

  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as { __sr?: unknown }).__sr));
  await expect(page.locator('#realm-name')).toContainText('Realm');
  await expect(page.getByRole('tab', { name: 'Peoples' })).toBeVisible();
});
