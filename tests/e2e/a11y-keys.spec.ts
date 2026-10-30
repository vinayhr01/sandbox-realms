import { expect, test, type Page } from '@playwright/test';
import { powerButton, settleFirstTown } from './helpers.ts';

/**
 * Keyboard-only walkthrough (UX redesign, spec H, Task 8): the sheet, the chip tablist and a power, the Atlas, its tabs,
 * a settings search, and Esc. No pointer is used after the page loads; focus is checked at each step.
 */

async function openRealm(page: Page): Promise<void> {
  await page.goto('/?seed=42&size=4');
  await page.waitForFunction(() => Boolean((window as unknown as { __sr?: unknown }).__sr));
  await expect(page.locator('#realm-name')).toContainText('Realm');
  // Seed 42 can grow its first hamlet mid-test on fast runners, which brings Peoples forward and re-lays the chips; settle it first.
  await settleFirstTown(page);
}

test('keyboard only: sheet, chip tablist, arm, Atlas tabs, settings search, Esc', async ({ page }) => {
  await openRealm(page);

  // 1. Q opens the power sheet.
  await page.keyboard.press('KeyQ');
  await expect(page.locator('.power-sheet')).toHaveAttribute('data-sheet', 'expanded');

  // 2. The chip tablist moves with the arrows; a power arms with Enter.
  await page.getByRole('tab', { name: 'Land' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Nature' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Land' })).toBeFocused();
  await powerButton(page, 'Raise').focus();
  await expect(powerButton(page, 'Raise')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(powerButton(page, 'Raise')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');

  // 3. The realm pill opens the Atlas with Enter.
  const realmPill = page.getByRole('button', { name: /open Atlas/ });
  await realmPill.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.atlas-scrim')).toBeVisible();

  // 4. The Atlas tabs move with the arrows: World, Peoples, History, Discoveries, Settings.
  // The sheet's chips stay in the DOM under the modal Atlas, so the tabs are read inside the Atlas only.
  const atlas = page.locator('.atlas');
  const world = atlas.getByRole('tab', { name: 'World' });
  await world.focus();
  await page.keyboard.press('ArrowRight');
  await expect(atlas.getByRole('tab', { name: 'Peoples' })).toBeFocused();
  await expect(atlas.getByRole('tab', { name: 'Peoples' })).toHaveAttribute('aria-selected', 'true');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await expect(atlas.getByRole('tab', { name: 'Settings' })).toBeFocused();
  await page.keyboard.press('Enter');

  // 5. The settings search finds a setting.
  const search = page.getByRole('searchbox', { name: 'Search settings' });
  await search.focus();
  await expect(search).toBeFocused();
  await page.keyboard.type('minimap');
  await expect(page.getByLabel('Minimap', { exact: true })).toBeVisible();

  // 6. Esc closes the Atlas, from the search field too.
  await page.keyboard.press('Escape');
  await expect(page.locator('.atlas-scrim')).toHaveCount(0);
  await expect(realmPill).toBeFocused();
});
