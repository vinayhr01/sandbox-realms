import { expect, type Locator, type Page } from '@playwright/test';

/** Expands the power sheet when it is collapsed (its handle then reads "Expand powers"). */
export async function openPowerSheet(page: Page): Promise<void> {
  const expand = page.getByRole('button', { name: 'Expand powers', exact: true });
  if (await expand.isVisible()) await expand.click();
  await expect(page.getByRole('button', { name: 'Collapse powers', exact: true })).toBeVisible();
}

/** Collapses the power sheet, so a map gesture reaches the map (the expanded sheet covers the lower part of it). */
export async function collapsePowerSheet(page: Page): Promise<void> {
  const collapse = page.getByRole('button', { name: 'Collapse powers', exact: true });
  if (await collapse.isVisible()) await collapse.click();
  await expect(page.getByRole('button', { name: 'Expand powers', exact: true })).toBeVisible();
}

/** Selects a chip of the power sheet. The chips past the first three sit under "More". */
export async function openChip(page: Page, label: string): Promise<void> {
  await openPowerSheet(page);
  const chip = page.getByRole('tab', { name: label, exact: true });
  if (!(await chip.isVisible())) await page.getByRole('button', { name: /^More/ }).click();
  await chip.click();
}

/** A power's icon button in the sheet's grid. Call openChip first; the recent row repeats some powers, so it is not searched. */
export function powerButton(page: Page, name: string): Locator {
  return page.locator('.power-sheet .power-grid').getByRole('button', { name, exact: true });
}

/**
 * Opens a window from the temporary "Windows" chip (spec call 8). Task 3 moves the windows into the Atlas, and only
 * this helper changes.
 */
export async function openWindowButton(page: Page, name: string): Promise<void> {
  await openChip(page, 'Windows');
  await page.getByRole('group', { name: 'Windows' }).getByRole('button', { name, exact: true }).click();
}
