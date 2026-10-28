import { expect, test, type Page } from '@playwright/test';
import { openPowerSheet } from './helpers.ts';

/**
 * The bottom power sheet (UX redesign, spec B): the starter chips, search arming a power, and the expanded sheet staying
 * clear of the top pills on a short landscape phone and a small phone, where a map tap still inspects.
 */

async function openRealm(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('/?seed=42&size=4');
  await page.waitForFunction(() => Boolean((window as unknown as { __sr?: unknown }).__sr));
  await expect(page.locator('#realm-name')).toContainText('Realm');
  (page as unknown as { __errors: string[] }).__errors = errors;
}

test.afterEach(async ({ page }, testInfo) => {
  const errors = (page as unknown as { __errors?: string[] }).__errors ?? [];
  if (testInfo.status === 'passed') expect(errors, errors.join('\n')).toEqual([]);
});

test('first launch: the sheet shows exactly three chips, Land, Nature and Creatures', async ({ page }) => {
  await openRealm(page);
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(3);
  await expect(tabs).toHaveText(['Land', 'Nature', 'Creatures']);
  await expect(page.getByRole('button', { name: /^More/ })).toBeVisible();
});

test('search arms a power from the expanded sheet', async ({ page }) => {
  await openRealm(page);
  await openPowerSheet(page);
  await page.getByRole('searchbox', { name: 'Search powers' }).fill('wolf');
  const wolf = page.getByRole('group', { name: 'Search results' }).getByRole('button', { name: 'Call Wolf', exact: true });
  await wolf.click();
  await expect(wolf).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#status')).toContainText('Call Wolf is armed');
});

for (const viewport of [
  { width: 844, height: 390 },
  { width: 360, height: 640 },
]) {
  test(`expanded sheet at ${viewport.width}x${viewport.height} stays clear of the top pills and a map tap inspects`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openRealm(page);
    await openPowerSheet(page);

    const pills = await page.locator('.top-pills').boundingBox();
    const sheet = await page.locator('.power-sheet').boundingBox();
    if (!pills || !sheet) throw new Error('pills or sheet not laid out');
    expect(sheet.y).toBeGreaterThanOrEqual(pills.y + pills.height);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    // A tap on the map in the gap between the pills and the sheet still inspects the tile under it.
    const map = await page.locator('#map canvas').first().boundingBox();
    if (!map) throw new Error('no map canvas');
    const gapY = (pills.y + pills.height + sheet.y) / 2;
    await page.mouse.click(map.x + map.width / 2, gapY);
    await expect(page.locator('#status')).toContainText('Tile ');
  });
}
