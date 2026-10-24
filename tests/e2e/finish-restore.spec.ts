import { expect, test, type Page } from '@playwright/test';
import { encodeChronicle } from '../../src/sim/chronicle.ts';
import { generateRealm } from '../../src/sim/worldgen.ts';
import { fnv1a32 } from '../../src/app/saves.ts';

/**
 * Restore last autosave (19 section 7, step 4). The autosave is written into the real save store
 * (IndexedDB 'sandbox-realms') before the app loads, so the dialogs find it on their own. The seed
 * is written from a static JSON file on the same origin, so no app code runs during the seeding.
 * Realm 9 is the seeded realm; the app's default realm for ?seed=42 is Realm 16.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

function autosaveBytes(): number[] {
  return Array.from(encodeChronicle(generateRealm({ seed: 9, sizeStep: 2, template: 'continent' }).sim));
}

/** Writes autosave:1 into the save store. Runs on the same origin, before the app is loaded. */
async function seedAutosave(page: Page, bytes: number[]): Promise<void> {
  await page.goto('/manifest.webmanifest');
  await page.evaluate(
    async ({ bytes, checksum }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('sandbox-realms', 1);
        req.onupgradeneeded = () => {
          for (const name of ['slots', 'blobs', 'prev']) {
            if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: 'slotId' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const data = new Uint8Array(bytes);
      const tx = db.transaction(['slots', 'blobs'], 'readwrite');
      tx.objectStore('blobs').put({ slotId: 'auto:1', bytes: data.buffer, checksum, byteSize: data.byteLength });
      tx.objectStore('slots').put({
        slotId: 'auto:1',
        kind: 'auto',
        seq: 1,
        realmName: 'Realm 9',
        tick: 0,
        year: 1,
        byteSize: data.byteLength,
        checksum,
        savedAtMs: Date.now(),
        valid: 'unknown',
      });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      db.close();
    },
    { bytes, checksum: fnv1a32(new Uint8Array(bytes)) },
  );
}

test('the crash dialog restores the newest valid autosave into the live realm', async ({ page }) => {
  await seedAutosave(page, autosaveBytes());
  await page.goto('/?seed=42&size=4');
  await page.waitForFunction(() => Boolean((window as unknown as { __sr?: unknown }).__sr));
  await expect(page.locator('#realm-name')).toHaveText('Realm 16');

  await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'simulated crash' })));
  await expect(page.locator('#fatal')).toBeVisible();

  const restore = page.getByRole('button', { name: 'Restore last autosave', exact: true });
  await expect(restore).toBeEnabled();
  await restore.click();

  await expect(page.locator('#fatal')).toBeHidden();
  await expect(page.locator('#realm-name')).toHaveText('Realm 9');
});

test('the boot-loop dialog restores the newest valid autosave and clears the loop', async ({ page }) => {
  await seedAutosave(page, autosaveBytes());
  // Two unclean boots a minute or two ago plus this one make a boot loop.
  await page.evaluate(() => {
    const now = Date.now();
    localStorage.setItem('sr.boots', JSON.stringify([now - 120_000, now - 60_000]));
    localStorage.setItem('sr.session', 'running');
  });
  const errors = collectErrors(page);
  await page.goto('/?seed=42&size=4');

  const dialog = page.locator('#fatal');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#fatal-title')).toHaveText('Stopped several times in a row');
  const restore = page.getByRole('button', { name: 'Restore last autosave', exact: true });
  await expect(restore).toBeEnabled();
  await restore.click();

  await expect(dialog).toBeHidden();
  await expect(page.locator('#realm-name')).toHaveText('Realm 9');
  expect(await page.evaluate(() => localStorage.getItem('sr.boots'))).toBe('[]');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('with no valid autosave the restore button is shown but disabled', async ({ page }) => {
  await page.goto('/?seed=42&size=4');
  await page.waitForFunction(() => Boolean((window as unknown as { __sr?: unknown }).__sr));

  await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'simulated crash' })));
  await expect(page.locator('#fatal')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore last autosave', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Start in Safe Mode', exact: true })).toBeEnabled();
});
