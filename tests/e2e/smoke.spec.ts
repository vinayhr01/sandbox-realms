import { expect, test, type Page } from '@playwright/test';
import { collapsePowerSheet, openChip, powerButton } from './helpers.ts';

/**
 * Smoke tests for every layout class in PLATFORM-REQUIREMENTS section 6. They drive the real
 * UI with pointer input and read results through the `window.__sr` test hooks in main.ts.
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
  // Error list is checked by each test through the closure below.
  (page as unknown as { __errors: string[] }).__errors = errors;
  return sr(page);
}

test.afterEach(async ({ page }, testInfo) => {
  const errors = (page as unknown as { __errors?: string[] }).__errors ?? [];
  if (testInfo.status === 'passed') expect(errors, errors.join('\n')).toEqual([]);
});

test('loads and the sim runs at 20 ticks per second', async ({ page }, testInfo) => {
  const call = await openRealm(page);
  const t0 = await call<number>('tick');
  await page.waitForTimeout(1000);
  const t1 = await call<number>('tick');
  expect(t1 - t0).toBeGreaterThan(10);
  expect(await call<number>('side')).toBe(256);
  await page.screenshot({ path: testInfo.outputPath(`shell-${testInfo.project.name}.png`) });
});

test('inspect: tapping a tile reports its elevation and ground', async ({ page }) => {
  const call = await openRealm(page);
  const pt = await call<{ x: number; y: number }>('tileToScreen', 60, 60);
  const expected = await call<{ elevation: number }>('query', 60, 60);
  await page.mouse.click(pt.x, pt.y);
  await expect(page.locator('#status')).toContainText(`elevation ${expected.elevation}`);
});

test('raise: dragging with the Raise tool changes terrain and the sim hash', async ({ page }) => {
  const call = await openRealm(page);
  await openChip(page, 'Land');
  await powerButton(page, 'Raise').click();
  await collapsePowerSheet(page);
  const start = await call<{ x: number; y: number }>('tileToScreen', 90, 90);
  const end = await call<{ x: number; y: number }>('tileToScreen', 100, 90);
  const before = await call<{ elevation: number }>('query', 95, 90);
  const hashBefore = await call<number>('hash');

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(async () => (await call<{ elevation: number }>('query', 95, 90)).elevation, { timeout: 15000 })
    .toBeGreaterThan(before.elevation);
  // The UI hash is a checkpoint refreshed every 20 ticks (worker.ts HASH_EVERY_TICKS), so it can lag the
  // elevation change by up to a second. Poll for it instead of reading it once.
  await expect
    .poll(() => call<number>('hash'), { timeout: 15000 })
    .not.toBe(hashBefore);
});

test('paused edits still apply and the clock stays put', async ({ page }) => {
  const call = await openRealm(page);
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.waitForTimeout(200);
  const t0 = await call<number>('tick');
  await openChip(page, 'Land');
  await powerButton(page, 'Raise').click();
  await collapsePowerSheet(page);
  const pt = await call<{ x: number; y: number }>('tileToScreen', 40, 40);
  const before = await call<{ elevation: number }>('query', 40, 40);
  await page.mouse.click(pt.x, pt.y);
  await expect
    .poll(async () => (await call<{ elevation: number }>('query', 40, 40)).elevation, { timeout: 15000 })
    .not.toBe(before.elevation);
  expect(await call<number>('tick')).toBe(t0);
});

test('wheel zoom moves the camera without scrolling the page', async ({ page }) => {
  const call = await openRealm(page);
  const center = await call<{ x: number; y: number }>('tileToScreen', 128, 128);
  const before = await call<{ x: number; y: number }>('tileToScreen', 0, 0);
  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, -300);
  await expect
    .poll(async () => (await call<{ x: number; y: number }>('tileToScreen', 0, 0)).x, { timeout: 15000 })
    .not.toBe(before.x);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('terrain shader compiles at all zoom levels', async ({ page }) => {
  const shaderErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /shader|WebGL/i.test(msg.text())) shaderErrors.push(msg.text());
  });
  const call = await openRealm(page);
  const centre = await call<{ x: number; y: number }>('tileToScreen', 128, 128);
  // Tile pitch in CSS px, read from two neighbouring tile centres.
  const pitch = async () => {
    const a = await call<{ x: number }>('tileToScreen', 0, 0);
    const b = await call<{ x: number }>('tileToScreen', 1, 0);
    return b.x - a.x;
  };
  const sampleCentre = async (): Promise<[number, number, number]> => {
    const png = (await page.screenshot({ clip: { x: centre.x - 2, y: centre.y - 2, width: 4, height: 4 } })).toString('base64');
    return page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = img.width;
      cv.height = img.height;
      const ctx = cv.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(Math.floor(img.width / 2), Math.floor(img.height / 2), 1, 1).data;
      return [d[0]!, d[1]!, d[2]!] as [number, number, number];
    }, png);
  };
  const BACKDROP: [number, number, number] = [18, 20, 26];

  // Zoom out to the minimum.
  await page.mouse.move(centre.x, centre.y);
  for (let i = 0; i < 25; i++) await page.mouse.wheel(0, 300);
  await page.waitForTimeout(300);
  expect(await sampleCentre()).not.toEqual(BACKDROP);

  // Zoom in to about 12 CSS px per tile.
  for (let i = 0; i < 60 && (await pitch()) < 12; i++) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(30);
  }
  expect(await pitch()).toBeGreaterThanOrEqual(12);
  expect(await sampleCentre()).not.toEqual(BACKDROP);

  // Zoom in to the real maximum: 96 CSS px per tile on every realm.
  for (let i = 0; i < 150 && (await pitch()) < 95.5; i++) {
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(300);
  expect(await pitch()).toBeGreaterThanOrEqual(64);
  expect(await sampleCentre()).not.toEqual(BACKDROP);

  expect(shaderErrors).toEqual([]);
});
