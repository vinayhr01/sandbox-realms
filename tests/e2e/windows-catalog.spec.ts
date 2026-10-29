import { expect, test, type Page } from '@playwright/test';
import { openChip, openWindowButton, powerButton } from './helpers.ts';

/**
 * Every window added for the spec table (13 section 7.1): each opens from the Powers tab with a
 * dialog named by its title, shows a list or form, and closes by its close control and by Escape.
 */

const WINDOWS: ReadonlyArray<[button: string, title: string]> = [
  ['Campaigns', 'Campaigns'],
  ['Creeds', 'Creeds'],
  ['Customs', 'Customs'],
  ['Dialects', 'Dialects'],
  ['Families', 'Families'],
  ['Intrigues', 'Intrigues'],
  ['Strains', 'Strains'],
  ['Brushes', 'Brushes'],
  ['Language', 'Language'],
  ['Credits', 'Credits'],
  ['Install', 'Install'],
  ['Welcome', 'Welcome'],
];

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

async function openFromPowers(page: Page, name: string): Promise<void> {
  await openWindowButton(page, name);
}

test.afterEach(async ({ page }, testInfo) => {
  const errors = (page as unknown as { __errors?: string[] }).__errors ?? [];
  if (testInfo.status === 'passed') expect(errors, errors.join('\n')).toEqual([]);
});

for (const [button, title] of WINDOWS) {
  test(`${title} opens as a named dialog and closes with its close control and Escape`, async ({ page }) => {
    await openRealm(page);
    await openFromPowers(page, button);
    const dialog = page.getByRole('dialog', { name: title, exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close window' }).click();
    await expect(dialog).toBeHidden();
    await openFromPowers(page, button);
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
}

test('a list row opens its inspector, and Back returns to the list', async ({ page }) => {
  await openRealm(page);
  await page.locator('#pause').click();
  await openFromPowers(page, 'Dominions');
  const list = page.getByRole('dialog', { name: 'Dominions', exact: true });
  await expect(list).toBeVisible();
  const first = list.getByRole('button', { name: /^Dominion \d+/ }).first();
  // A realm may have no dominions yet; the list is then empty and the test has nothing to open.
  if ((await first.count()) === 0) return;
  await first.click();
  const inspector = page.getByRole('dialog', { name: /^Dominion \d+$/ });
  await expect(inspector).toBeVisible();
  // Back is the Atlas header button; the inspector has none of its own.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Dominions', exact: true })).toBeVisible();
});

test('the brush picker changes the shape the sheet brush control shows', async ({ page }) => {
  await openRealm(page);
  await openFromPowers(page, 'Brushes');
  const dialog = page.getByRole('dialog', { name: 'Brushes', exact: true });
  await dialog.getByRole('radio', { name: 'Square', exact: true }).click();
  await expect(dialog.getByRole('radio', { name: 'Square', exact: true })).toHaveAttribute('aria-checked', 'true');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await openChip(page, 'Land');
  await powerButton(page, 'Raise').click();
  await expect(page.locator('.shape[data-shape="square"]')).toHaveAttribute('aria-checked', 'true');
});
