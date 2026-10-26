import { expect, test, type Page } from '@playwright/test';

/**
 * Recovery dialog (19 sections 4 and 7). A boot loop is forced by seeding the boot history and an
 * unclean-exit sentinel before the app starts. The seed runs once per tab, so the reload that
 * Safe Mode causes does not seed again.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

async function seedBootLoop(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('finish-test-seeded')) return;
    sessionStorage.setItem('finish-test-seeded', '1');
    const now = Date.now();
    localStorage.setItem('sr.boots', JSON.stringify([now - 120_000, now - 60_000]));
    localStorage.setItem('sr.session', 'running');
  });
}

test('three unclean boots in a few minutes offer Safe Mode, and Keep going normally closes the dialog', async ({ page }) => {
  const errors = collectErrors(page);
  await seedBootLoop(page);
  await page.goto('/?seed=42&size=4');

  const dialog = page.locator('#fatal');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#fatal-title')).toHaveText('Stopped several times in a row');
  await expect(page.getByRole('button', { name: 'Start in Safe Mode', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Keep going normally', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Start in Safe Mode reloads into Safe Mode for this tab', async ({ page }) => {
  const errors = collectErrors(page);
  await seedBootLoop(page);
  await page.goto('/?seed=42&size=4');

  await expect(page.locator('#fatal')).toBeVisible();
  await page.getByRole('button', { name: 'Start in Safe Mode', exact: true }).click();

  await page.waitForFunction(() => sessionStorage.getItem('sr.safeMode') === '1');
  await page.waitForFunction(() => Boolean((window as unknown as { __sr?: unknown }).__sr));
  await expect(page.locator('#status')).toContainText('Safe Mode');
  await expect(page.locator('#fatal')).toBeHidden();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('an uncaught error opens the crash dialog with reload and Safe Mode', async ({ page }) => {
  await page.goto('/?seed=42&size=4');
  await page.waitForFunction(() => Boolean((window as unknown as { __sr?: unknown }).__sr));

  await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'simulated crash' })));

  await expect(page.locator('#fatal')).toBeVisible();
  await expect(page.locator('#fatal-title')).toHaveText('Something went wrong');
  await expect(page.locator('#fatal-detail')).toContainText('simulated crash');
  await expect(page.getByRole('button', { name: 'Start in Safe Mode', exact: true })).toBeVisible();
  await expect(page.locator('#fatal-reload')).toBeVisible();
});
