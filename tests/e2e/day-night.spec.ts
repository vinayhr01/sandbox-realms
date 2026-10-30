import { expect, test, type Page } from '@playwright/test';
import { settleFirstTown } from './helpers.ts';

/**
 * Day and night (spec 2026-10-30-day-night-design). The __sr.forcePhase hook pins the drawn time of day, so noon and
 * midnight are compared directly: the map must be clearly darker at midnight, in 3D (sky, sun and moon light) and in 2D
 * (night tint). Runs in the one-worker 3D job: it draws with software WebGL.
 */

async function open(page: Page, view: '2d' | '3d'): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto(`/?view=${view}&seed=42&size=4`);
  await page.waitForFunction(() => Boolean((window as unknown as { __sr?: unknown }).__sr));
  await expect(page.locator('#realm-name')).toContainText('Realm');
  await settleFirstTown(page);
  return errors;
}

/** Mean brightness (0..255) of a page screenshot, decoded in the page so no image library is needed. */
async function brightness(page: Page): Promise<number> {
  const png = (await page.screenshot()).toString('base64');
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 36;
    const ctx = c.getContext('2d');
    if (!ctx) return 0;
    ctx.drawImage(img, 0, 0, 64, 36);
    const px = ctx.getImageData(0, 0, 64, 36).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += (px[i]! + px[i + 1]! + px[i + 2]!) / 3;
    return sum / (px.length / 4);
  }, png);
}

/** Mean brightness with the drawn time of day pinned through the __sr.forcePhase hook. */
async function at(page: Page, phase: number): Promise<number> {
  await page.evaluate((p) => (window as unknown as { __sr: { forcePhase(p: number | null): void } }).__sr.forcePhase(p), phase);
  await page.waitForTimeout(1500);
  return brightness(page);
}

for (const view of ['3d', '2d'] as const) {
  test(`${view}: the map darkens at night and brightens by day`, async ({ page }) => {
    test.setTimeout(90_000);
    const errors = await open(page, view);
    const noon = await at(page, 0.5);
    const midnight = await at(page, 0.02);
    expect(midnight, `noon ${noon.toFixed(1)}, midnight ${midnight.toFixed(1)}`).toBeLessThan(noon * 0.85);
    expect(errors, errors.join('\n')).toEqual([]);
  });
}
