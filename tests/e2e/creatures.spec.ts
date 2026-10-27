import { expect, test, type Page } from '@playwright/test';

/**
 * Creature layer (src/render/creatures.ts) in the real page: beings come from the being feed, not the
 * 96-entry snapshot sample. Spawns go through the `window.__sr` hooks (spawnMany) instead of clicks.
 */

type Hook = <T>(fn: string, ...args: unknown[]) => Promise<T>;

/** Calls a method of window.__sr in the page and returns its result. */
function sr(page: Page): Hook {
  return <T>(fn: string, ...args: unknown[]) =>
    page.evaluate(
      ({ fn, args }) => {
        const hooks = (window as unknown as { __sr: Record<string, (...a: unknown[]) => unknown> }).__sr;
        const target = hooks[fn];
        if (!target) throw new Error(`no hook ${fn}`);
        return target(...args);
      },
      { fn, args },
    ) as Promise<T>;
}

async function openRealm(page: Page): Promise<Hook> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('/?seed=42&size=4');
  await page.waitForFunction(() => Boolean((window as unknown as { __sr?: unknown }).__sr));
  await expect(page.locator('#realm-name')).toContainText('Realm');
  (page as unknown as { __errors: string[] }).__errors = errors;
  return sr(page);
}

test.afterEach(async ({ page }, testInfo) => {
  const errors = (page as unknown as { __errors?: string[] }).__errors ?? [];
  if (testInfo.status === 'passed') expect(errors, errors.join('\n')).toEqual([]);
});

test('more than 96 beings are drawn', async ({ page }) => {
  const call = await openRealm(page);
  await call('spawnMany', 'burrfleece', 200);
  // The whole realm is in view at the fit zoom, so every spawned Being is drawn (the old snapshot sample held 96).
  await expect.poll(() => call<number>('creatureCount'), { timeout: 20_000 }).toBeGreaterThan(96);
});

test('zoomed in, beings are drawn as icons', async ({ page }) => {
  const call = await openRealm(page);
  await call('spawnMany', 'burrfleece', 20);
  // The spawns land near the Being nearest the realm centre: zoom in there, so they stay on screen.
  const pts = await call<{ x: number; y: number }[]>('beingPoints');
  const near = pts.reduce((a, b) => ((b.x - 128) ** 2 + (b.y - 128) ** 2 < (a.x - 128) ** 2 + (a.y - 128) ** 2 ? b : a));
  const centre = await call<{ x: number; y: number }>('tileToScreen', Math.round(near.x), Math.round(near.y));
  await page.mouse.move(centre.x, centre.y);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -300);
  await expect.poll(() => call<number>('creatureCount'), { timeout: 20_000 }).toBeGreaterThan(0);
});

test('new world clears creatures', async ({ page }) => {
  const call = await openRealm(page);
  await call('spawnMany', 'burrfleece', 200);
  await expect.poll(() => call<number>('creatureCount'), { timeout: 20_000 }).toBeGreaterThan(96);
  // setRealmSide runs resetCreatureView once per realm: the New World must add exactly one reset.
  const resetsBefore = await call<number>('resets');
  await call('newWorld');
  await expect.poll(() => call<number>('resets'), { timeout: 30_000 }).toBe(resetsBefore + 1);
  // The new realm starts at tick 0. Stale tracks from the old realm would keep the 200 spawned Beings in the
  // feed sample, so the sample must match the new realm's snapshot: its Beings only, the snapshot capped at 96.
  // Keys are not compared across realms: generations restart, so an old key can recur in the new realm.
  await expect.poll(() => call<number>('tick'), { timeout: 30_000 }).toBeLessThan(200);
  await expect
    .poll(
      async () => {
        const sample = (await call<unknown[]>('beingPoints')).length;
        const snap = await call<{ mapPoints?: unknown[] } | null>('snapshot');
        return sample - (snap?.mapPoints?.length ?? -1);
      },
      { timeout: 30_000 },
    )
    .toBe(0);
});

test('follow a being beyond the old sample', async ({ page }) => {
  const call = await openRealm(page);
  await call('spawnMany', 'burrfleece', 200);
  await expect.poll(() => call<number>('creatureCount'), { timeout: 20_000 }).toBeGreaterThan(150);
  // Arm Follow from the Insight tab, then tap the 150th Being of the feed sample.
  await page.getByRole('tab', { name: 'Powers', exact: true }).click();
  // Insight is the last power group (TABS in src/content/powers.ts).
  await page.locator('#power-tabs .power-tab').last().click();
  await page.locator('[data-power-id="ins_follow"]').click();
  const being = (await call<{ x: number; y: number }[]>('beingPoints'))[149];
  expect(being).toBeDefined();
  const at = await call<{ x: number; y: number }>('tileToScreen', Math.round(being!.x), Math.round(being!.y));
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('#status')).toContainText('Following that being');
  await page.waitForTimeout(3000);
  await expect(page.locator('#status')).not.toContainText('Lost sight');
});
