import { expect, test, type Page } from '@playwright/test';
import { openChip, powerButton } from './helpers.ts';

/** The one keymap (UX redesign, spec G) in the real page. */

async function openRealm(page: Page): Promise<void> {
  await page.goto('/?seed=42&size=4');
  await page.waitForFunction(() => Boolean((window as unknown as { __sr?: unknown }).__sr));
  await expect(page.locator('#realm-name')).toContainText('Realm');
}

test('pressing 1 after arming two powers arms the most recent', async ({ page }) => {
  await openRealm(page);
  await openChip(page, 'Land');
  await powerButton(page, 'Raise').click();
  await powerButton(page, 'Lower').click();
  // Esc closes the top layer first (the expanded sheet), the next Esc disarms. Key 1 then arms the most recent power (Lower).
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Digit1');
  await expect(page.getByRole('button', { name: 'Disarm Lower', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Disarm Raise', exact: true })).toHaveCount(0);
});

test('Q opens and closes the power sheet', async ({ page }) => {
  await openRealm(page);
  const sheet = page.locator('.power-sheet');
  await page.keyboard.press('KeyQ');
  await expect(sheet).toHaveAttribute('data-sheet', 'expanded');
  await page.keyboard.press('KeyQ');
  await expect(sheet).toHaveAttribute('data-sheet', 'collapsed');
});

test('/ opens the sheet and focuses its search', async ({ page }) => {
  await openRealm(page);
  await page.keyboard.press('Slash');
  await expect(page.getByRole('searchbox', { name: 'Search powers' })).toBeFocused();
});

test('typing in the sheet search does not fire shortcuts', async ({ page }) => {
  await openRealm(page);
  await page.keyboard.press('KeyQ');
  const search = page.getByRole('searchbox', { name: 'Search powers' });
  await search.click();
  await page.keyboard.type('1q');
  await expect(search).toHaveValue('1q');
  await expect(page.locator('.power-sheet')).toHaveAttribute('data-sheet', 'expanded');
  await expect(page.locator('[data-power-id][aria-pressed="true"]')).toHaveCount(0);
});

test('Esc closes the Atlas', async ({ page }) => {
  await openRealm(page);
  await page.getByRole('button', { name: /open Atlas/ }).click();
  await expect(page.locator('.atlas-scrim')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.atlas-scrim')).toHaveCount(0);
});
