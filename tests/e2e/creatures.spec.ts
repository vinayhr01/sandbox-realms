import { expect, test, type Page } from '@playwright/test';
import { openChip, powerButton } from './helpers.ts';
import { SPECIES } from '../../src/content/beasts.ts';
import { plainName } from '../../src/content/plain-names.ts';

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
  // Arm Follow from the Inspect chip, then tap the 150th Being of the feed sample.
  await openChip(page, 'Inspect');
  await powerButton(page, 'Follow').click();
  const being = (await call<{ x: number; y: number }[]>('beingPoints'))[149];
  expect(being).toBeDefined();
  const at = await call<{ x: number; y: number }>('tileToScreen', Math.round(being!.x), Math.round(being!.y));
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('#status')).toContainText('Following that being');
  await page.waitForTimeout(3000);
  await expect(page.locator('#status')).not.toContainText('Lost sight');
});

test('hover names a being beyond the snapshot sample', async ({ page }) => {
  test.slow(); // Software-GL runners are slow: triple the timeout as a margin.
  const call = await openRealm(page);
  // A grid of spawns around the first land Being near the centre; the sim refuses a spawn on water, so some are missed.
  await call('spawnMany', 'burrfleece', 1);
  const first = (await call<{ x: number; y: number }[]>('beingPoints'))[0];
  expect(first).toBeDefined();
  const cx = Math.round(first!.x);
  const cy = Math.round(first!.y);
  // The whole 17 x 17 grid runs inside the page: one round trip instead of 289.
  await page.evaluate(
    ({ cx, cy }) => {
      const hooks = (window as unknown as { __sr: { spawnMany: (...a: unknown[]) => unknown } }).__sr;
      for (let dy = -8; dy <= 8; dy += 1) {
        for (let dx = -8; dx <= 8; dx += 1) hooks.spawnMany('burrfleece', 1, cx + dx, cy + dy);
      }
    },
    { cx, cy },
  );
  await expect.poll(() => call<number>('creatureCount'), { timeout: 20_000 }).toBeGreaterThan(96);
  // Paused, the Beings hold still while the test zooms and hovers.
  await page.locator('#pause').click();
  // The snapshot holds at most 96 sampled rows: pick a Being whose sim id is not among them.
  let target: { id: number; x: number; y: number; species: number } | undefined;
  await expect
    .poll(
      async () => {
        const snap = await call<{ mapPoints?: { id: number }[] } | null>('snapshot');
        if (!snap?.mapPoints) return false;
        const listed = new Set(snap.mapPoints.map((p) => p.id));
        // Nearest the realm centre, so the zoomed view keeps it away from the edge pan. Alone on its tile (no other
        // Being within half a tile), since a Being sharing the tile would be the one the hover names.
        const mid = (await call<number>('side')) / 2;
        const all = await call<{ id: number; x: number; y: number; alpha: number; species: number }[]>('beingPoints');
        const alone = (b: { x: number; y: number }) => all.filter((o) => Math.hypot(o.x - b.x, o.y - b.y) < 0.5).length === 1;
        const live = all.filter((b) => !listed.has(b.id) && b.alpha === 1 && alone(b));
        const dist = (b: { x: number; y: number }) => (b.x - mid) ** 2 + (b.y - mid) ** 2;
        target = live.reduce<(typeof live)[number] | undefined>((a, b) => (a === undefined || dist(b) < dist(a) ? b : a), undefined);
        return target !== undefined;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  const picked = target!;
  // Zoom in on the Being so that its icon is clear of its neighbours.
  const at = await call<{ x: number; y: number }>('tileToScreen', picked.x, picked.y);
  await page.mouse.move(at.x, at.y);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -300);
  // The Being keeps walking, so each poll reads its current tile and hovers it again.
  const name = plainName('species', SPECIES[picked.species]?.id ?? '');
  await expect
    .poll(
      async () => {
        // One round trip: find the Being's current tile and its screen point inside the page.
        const screen = await page.evaluate(
          ({ id }) => {
            const hooks = (window as unknown as { __sr: Record<string, (...a: unknown[]) => unknown> }).__sr;
            const now = (hooks['beingPoints']!() as { id: number; x: number; y: number }[]).find((b) => b.id === id);
            if (!now) return null;
            return hooks['tileToScreen']!(now.x, now.y) as { x: number; y: number };
          },
          { id: picked.id },
        );
        if (!screen) return 'gone';
        await page.mouse.move(screen.x, screen.y);
        // The tooltip is drawn in the next frame after the pointer moves.
        await page.waitForTimeout(150);
        return (await page.locator('.insight-tip:not([hidden])').allTextContents()).join('|');
      },
      { timeout: 15_000 },
    )
    .toContain(name);
});

test('context loss rebuilds atlas', async ({ page }) => {
  const call = await openRealm(page);
  await call('spawnMany', 'burrfleece', 20);
  // Zoom in on the spawns so the beings are icons and the atlas bakes frames for them.
  const pts = await call<{ x: number; y: number }[]>('beingPoints');
  const near = pts.reduce((a, b) => ((b.x - 128) ** 2 + (b.y - 128) ** 2 < (a.x - 128) ** 2 + (a.y - 128) ** 2 ? b : a));
  const centre = await call<{ x: number; y: number }>('tileToScreen', Math.round(near.x), Math.round(near.y));
  await page.mouse.move(centre.x, centre.y);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -300);
  expect(await call<number>('zoom')).toBeGreaterThanOrEqual(5);
  await expect.poll(() => call<number>('creatureCount'), { timeout: 20_000 }).toBeGreaterThan(0);
  // Wait until baked frames exist, so the context loss really hits uploaded atlas pages.
  await expect.poll(async () => (await call<{ cells: number }>('atlasStats')).cells, { timeout: 60_000, intervals: [500] }).toBeGreaterThan(0);

  // Lose and restore the WebGL context. The atlas rebuilds on webglcontextrestored and the generated textures (shadow,
  // dot, silhouettes) are drawn again. No page or console error may follow (checked by afterEach), and the baked icons
  // must come back.
  await page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>('#map canvas');
    const gl = canvas?.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_lose_context');
    if (!ext) throw new Error('WEBGL_lose_context is not available');
    ext.loseContext();
    await new Promise((resolve) => setTimeout(resolve, 200));
    ext.restoreContext();
  });
  await expect.poll(async () => (await call<{ rebuilds: number }>('atlasStats')).rebuilds, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(async () => (await call<{ cells: number }>('atlasStats')).cells, { timeout: 60_000, intervals: [500] }).toBeGreaterThan(0);
  await expect.poll(() => call<number>('creatureCount'), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
});

test('tapping a being opens its info card; a pan keeps it; Esc closes it', async ({ page }) => {
  const call = await openRealm(page);
  await call('spawnMany', 'burrfleece', 20);
  await expect.poll(() => call<number>('creatureCount'), { timeout: 20_000 }).toBeGreaterThan(0);
  const first = (await call<{ x: number; y: number; species: number }[]>('beingPoints'))[0];
  expect(first).toBeDefined();
  const at = await call<{ x: number; y: number }>('tileToScreen', Math.round(first!.x), Math.round(first!.y));
  await page.mouse.click(at.x, at.y);
  const card = page.locator('.info-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.info-card-name')).toContainText(plainName('species', SPECIES[first!.species]!.id));
  // A pan (arrow key) moves the map but keeps the card open.
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(300);
  await page.keyboard.up('ArrowRight');
  await expect(card).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
});

test('zoom buttons are in the shell', async ({ page }) => {
  await openRealm(page);
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zoom out' })).toBeVisible();
});
