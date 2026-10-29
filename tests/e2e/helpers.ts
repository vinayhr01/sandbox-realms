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

const ATLAS_TABS = ['World', 'Peoples', 'History', 'Discoveries', 'Settings'] as const;

/** Closes the Atlas when it is open. Esc pops a page first, then closes. */
export async function closeAtlas(page: Page): Promise<void> {
  const atlas = page.locator('.atlas-scrim');
  for (let i = 0; i < 4 && (await atlas.isVisible()); i++) await page.keyboard.press('Escape');
  await expect(atlas).toBeHidden();
}

/** Opens the Atlas from the realm pill, closing it first so it starts on its tab view. */
export async function openAtlas(page: Page): Promise<void> {
  await closeAtlas(page);
  await page.getByRole('button', { name: /open Atlas$/ }).click();
}

/** Opens the Atlas on one of its tabs (World, Peoples, History, Discoveries or Settings). */
export async function openAtlasTab(page: Page, tab: string): Promise<void> {
  await openAtlas(page);
  await page.locator('.atlas').getByRole('tab', { name: tab, exact: true }).click();
}

/**
 * Opens a window from the Atlas: the realm pill opens it, then the tab that lists the section `name` (its window title)
 * and the section button. The developer windows are listed in Settings only while Show developer tools is on.
 */
export async function openWindowButton(page: Page, name: string): Promise<void> {
  await openAtlas(page);
  for (const tab of ATLAS_TABS) {
    await page.locator('.atlas').getByRole('tab', { name: tab, exact: true }).click();
    const section = page.locator('.atlas').getByRole('button', { name, exact: true });
    if ((await section.count()) > 0) {
      await section.first().click();
      return;
    }
  }
  throw new Error(`no Atlas section named ${name}`);
}

/**
 * Opens a confirmation (the modal dialogs of spec C). They have no section in the Atlas, so the test asks the window
 * hook for them, as a player action would.
 */
export async function openConfirmation(page: Page, kind: string): Promise<void> {
  await page.evaluate(
    (k) => (window as unknown as { __sr: Record<string, (...a: unknown[]) => unknown> }).__sr['showWindow']?.(k),
    kind,
  );
}
