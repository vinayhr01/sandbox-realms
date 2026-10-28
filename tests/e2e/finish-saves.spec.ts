import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { encodeChronicle } from '../../src/sim/chronicle.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';

/**
 * Save round trip through the real Chronicle window: a realm file is imported, listed, survives a
 * reload (IndexedDB, or the memory fallback for the same visit), exports back byte for byte, and is
 * deleted through the confirmation window. Saving and loading the live realm are not available in
 * this build (the sim worker has no Chronicle command yet), so those buttons say so.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

async function openChronicle(page: Page) {
  await page.getByRole('tab', { name: 'Powers', exact: true }).click();
  await page.getByRole('group', { name: 'Windows' }).getByRole('button', { name: 'Chronicle', exact: true }).click();
  return page.getByRole('dialog', { name: 'Chronicle', exact: true });
}

function realmFile(): Buffer {
  return Buffer.from(encodeChronicle(generateRealm({ seed: 9, sizeStep: 2, template: 'continent' }).sim));
}

test('a realm file imports, survives a reload, exports byte for byte, and deletes', async ({ page }) => {
  // Two page loads plus a sim generation in Node: slower than a plain UI test on phone-sized software WebGL.
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  const bytes = realmFile();

  await page.goto('/?seed=42&size=4');
  await page.waitForFunction(() => Boolean((window as unknown as { __sr?: unknown }).__sr));
  await expect(page.locator('#realm-name')).toContainText('Realm');

  let chronicle = await openChronicle(page);
  await expect(chronicle.getByRole('button', { name: 'Save to a new slot', exact: true })).toBeEnabled();

  await chronicle.getByLabel('Import a realm file (.realm)').setInputFiles({
    name: 'Test Realm.realm',
    mimeType: 'application/octet-stream',
    buffer: bytes,
  });
  await expect(chronicle.getByText('Saved the imported realm in slot 1.')).toBeVisible();
  await expect(chronicle.getByRole('button', { name: 'Export Test Realm, slot', exact: true })).toBeVisible();

  // Load replaces the live realm: the confirmation's Load button is enabled and the save reports it.
  await chronicle.getByRole('button', { name: 'Load Test Realm, slot', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Confirm', exact: true });
  await expect(confirm.getByRole('button', { name: 'Load', exact: true })).toBeEnabled();
  await confirm.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(page.getByText('Loaded the save.')).toBeVisible();
  // The Chronicle window can stay open over the power bar after a load; close it before reopening.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Chronicle', exact: true })).toBeHidden();
  chronicle = await openChronicle(page);

  // The save is still there after a reload.
  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as { __sr?: unknown }).__sr));
  chronicle = await openChronicle(page);
  await expect(chronicle.getByRole('button', { name: 'Export Test Realm, slot', exact: true })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    chronicle.getByRole('button', { name: 'Export Test Realm, slot', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('test-realm-0.realm');
  const path = await download.path();
  if (!path) throw new Error('the export download has no file');
  expect(readFileSync(path).equals(bytes)).toBe(true);

  await chronicle.getByRole('button', { name: 'Delete Test Realm, slot', exact: true }).click();
  await page.getByRole('dialog', { name: 'Confirm', exact: true }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('No saved realms on this device yet.')).toBeVisible();

  expect(errors, errors.join('\n')).toEqual([]);
});

test('saving to a new slot updates the open Chronicle window without reopening it', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);

  await page.goto('/?seed=42&size=4');
  await page.waitForFunction(() => Boolean((window as unknown as { __sr?: unknown }).__sr));
  await expect(page.locator('#realm-name')).toContainText('Realm');

  const chronicle = await openChronicle(page);
  await expect(chronicle.getByText('No saved realms on this device yet.')).toBeVisible();

  await chronicle.getByRole('button', { name: 'Save to a new slot', exact: true }).click();

  // The window itself refreshes: the outcome shows in the window and the list counts the new slot.
  await expect(chronicle.getByText('Saved slot 1.')).toBeVisible();
  await expect(chronicle.locator('.list-count')).toHaveText('1 of 1');
  await expect(chronicle.getByText('No saved realms on this device yet.')).toBeHidden();
  await expect(chronicle.getByRole('button', { name: /^Export .*, slot/ })).toBeVisible();
  // One list only: a rebuild must replace the old list, not stack a second one under it.
  await expect(chronicle.getByRole('list', { name: 'Saved realms' })).toHaveCount(1);

  expect(errors, errors.join('\n')).toEqual([]);
});
