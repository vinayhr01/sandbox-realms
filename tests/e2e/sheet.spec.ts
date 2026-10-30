import { expect, test, type Page } from '@playwright/test';
import { openAtlasTab, openChip, openPowerSheet, openWindowButton } from './helpers.ts';

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
  // Seed 42 can grow a hamlet within the first snapshots, so Peoples joins the three exactly when "first-town" is found.
  await expect
    .poll(async () => {
      const found = await page.evaluate(
        () => (JSON.parse(localStorage.getItem('sr.discovery.v1') ?? '{}') as { found?: string[] }).found ?? [],
      );
      const expected = ['Land', 'Nature', 'Creatures', ...(found.includes('first-town') ? ['Peoples'] : [])];
      return JSON.stringify(await page.getByRole('tab').allTextContents()) === JSON.stringify(expected);
    })
    .toBe(true);
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
    // Seed 42 can grow its first hamlet mid-test, and the "New" toast it raises is centred at the top, over the gap this
    // test taps: settle the discovery first and let its toast go, so the tap reaches the map.
    await page.evaluate(() => (window as unknown as { __sr: { forceDiscovery: (id: string) => void } }).__sr.forceDiscovery('first-town'));
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
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

test('no horizontal overflow at 1920x1080 with the sheet expanded, then with the Atlas open', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openRealm(page);
  // Seed 42 can grow its first hamlet mid-test on fast runners, which brings Peoples forward and re-lays the chips; settle it first.
  await page.evaluate(() => (window as unknown as { __sr: { forceDiscovery: (id: string) => void } }).__sr.forceDiscovery('first-town'));
  // The discovery's 'New' toast can sit over the sheet controls; let it go. Peoples may then be a front chip or under
  // More, so openChip picks whichever it is.
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 20_000 });
  await openChip(page, 'Peoples');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const sheet = await page.locator('.power-sheet').boundingBox();
  expect(sheet?.width ?? 0).toBeLessThanOrEqual(720);

  await openWindowButton(page, 'Dominions');
  const atlasOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(atlasOverflow).toBeLessThanOrEqual(1);
});

/** Asserts that the Atlas fits the viewport: no page overflow, and every tab, Back and close button is a 44 px target. */
async function expectAtlasFitsPhone(page: Page, withBody: boolean): Promise<void> {
  const doc = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(doc.sw, 'page scrollWidth vs clientWidth').toBeLessThanOrEqual(doc.cw);
  if (withBody) {
    const body = await page.locator('.atlas-body').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    expect(body.sw, 'atlas body scrollWidth vs clientWidth').toBeLessThanOrEqual(body.cw);
  }
  for (const control of await page.locator('.atlas-tab, .atlas-head button').all()) {
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    const name = (await control.textContent())?.trim() || '(icon)';
    expect(box?.width ?? 0, `${name} width`).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0, `${name} height`).toBeGreaterThanOrEqual(44);
  }
}

test('the Atlas fits a 360x640 phone: Settings and a World page have no overflow and 44 px tabs, Back and close', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await openRealm(page);
  await openAtlasTab(page, 'Settings');
  await expectAtlasFitsPhone(page, false);

  await openWindowButton(page, 'Realm Rules');
  await expect(page.locator('.atlas-body')).toBeVisible();
  await expectAtlasFitsPhone(page, true);
});
