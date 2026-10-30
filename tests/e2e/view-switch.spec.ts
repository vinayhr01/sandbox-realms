import { expect, test, type Page } from '@playwright/test';
import { openAtlasTab, settleFirstTown } from './helpers.ts';

/**
 * The 3D/2D view choice (spec "Renderer choice"). The Playwright config pins the saved view to 2d, so these specs opt
 * into 3D with ?view=3d. Part 1's 3D renderer is not built yet, so 3D always falls back to 2D here.
 */

async function openWorld(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => Boolean((window as unknown as { __sr?: unknown }).__sr));
  await expect(page.locator('#realm-name')).toContainText('Realm');
}

test('falls back to 2D when 3D fails, and says so in a toast', async ({ page }) => {
  await openWorld(page, '/?view=3d&seed=42&size=4');
  await expect(page.getByText('3D view unavailable, showing 2D.', { exact: true })).toBeVisible();
  const kind = await page.evaluate(() => (window as unknown as { __sr: { rendererKind(): string } }).__sr.rendererKind());
  expect(kind).toBe('2d');
});

test('the Settings View switch saves the choice and reloads into it', async ({ page }) => {
  await openWorld(page, '/?view=3d&seed=42&size=4');
  // A first-town discovery can re-lay the chips mid-test; settle it before driving Settings.
  await settleFirstTown(page);
  await openAtlasTab(page, 'Settings');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('group', { name: 'Map' }).getByRole('combobox', { name: /^View/ }).selectOption('2d');
  // The reload drops ?view=3d, so the saved choice decides the view after it.
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('sr.view'))).toBe('2d');
  await expect.poll(() => new URL(page.url()).searchParams.has('view')).toBe(false);
  await page.waitForFunction(() => Boolean((window as unknown as { __sr?: unknown }).__sr));
  await expect(page.locator('#realm-name')).toContainText('Realm');
  const kind = await page.evaluate(() => (window as unknown as { __sr: { rendererKind(): string } }).__sr.rendererKind());
  expect(kind).toBe('2d');
});
