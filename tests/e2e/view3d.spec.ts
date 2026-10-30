import { expect, test, type Page } from '@playwright/test';
import { settleFirstTown } from './helpers.ts';

/**
 * The 3D view (src/render3d) in the real page. Opt-in: `?view=3d` selects the 3D renderer, and the rest of the e2e
 * suite stays on 2D. `__sr.rendererKind()` is added to the hook by the view-choice task.
 */

type Hooks = Record<string, (...args: unknown[]) => unknown>;

async function open3D(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('/?view=3d&seed=42&size=4');
  await page.waitForFunction(() => Boolean((window as unknown as { __sr?: unknown }).__sr));
  await expect(page.locator('#realm-name')).toContainText('Realm');
  await settleFirstTown(page);
  return errors;
}

/** Number of distinct colours in a 32x32 downscale of the WebGL canvas. A blank canvas gives 1. */
function distinctColours(page: Page): Promise<number> {
  return page.evaluate(() => {
    const src = [...document.querySelectorAll('canvas')].find((c) => c.getContext('webgl2') !== null);
    if (!src) return 0;
    const probe = document.createElement('canvas');
    probe.width = 32;
    probe.height = 32;
    const ctx = probe.getContext('2d');
    if (!ctx) return 0;
    ctx.drawImage(src, 0, 0, 32, 32);
    const px = ctx.getImageData(0, 0, 32, 32).data;
    const seen = new Set<string>();
    for (let i = 0; i < px.length; i += 4) seen.add(`${px[i]},${px[i + 1]},${px[i + 2]}`);
    return seen.size;
  });
}

test('boots in 3D', async ({ page }) => {
  const errors = await open3D(page);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __sr: Hooks }).__sr.rendererKind?.()))
    .toBe('3d');
  await expect.poll(() => distinctColours(page), { timeout: 20_000 }).toBeGreaterThan(1);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('restores after context loss', async ({ page }) => {
  const errors = await open3D(page);
  await expect.poll(() => distinctColours(page), { timeout: 20_000 }).toBeGreaterThan(1);

  await page.evaluate(() => {
    const src = [...document.querySelectorAll('canvas')].find((c) => c.getContext('webgl2') !== null);
    const ext = src?.getContext('webgl2')?.getExtension('WEBGL_lose_context');
    if (!ext) throw new Error('WEBGL_lose_context unavailable');
    (window as unknown as { __loseExt: { restoreContext(): void } }).__loseExt = ext;
    ext.loseContext();
    setTimeout(() => ext.restoreContext(), 200);
  });

  await expect.poll(() => distinctColours(page), { timeout: 20_000 }).toBeGreaterThan(1);
  expect(errors, errors.join('\n')).toEqual([]);
});
