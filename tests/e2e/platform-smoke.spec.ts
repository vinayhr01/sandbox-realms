import { expect, test, type Page } from '@playwright/test';

/**
 * Cross-engine smoke test for PLATFORM-REQUIREMENTS section 6. It runs in every platform project
 * (Chromium, Firefox, WebKit at 360x640 and 1920x1080). It uses only the DOM that exists today and
 * the read-only `window.__sr.tick` hook from main.ts, so it does not depend on any UI still in progress.
 */

async function openRealm(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('/?seed=42&size=4');
  // Software WebGL in headless engines can take a while to build the first frame with two workers running.
  await page.waitForFunction(() => Boolean((window as unknown as { __sr?: unknown }).__sr), null, { timeout: 60_000 });
  await expect(page.locator('#realm-name')).toContainText('Realm');
  return errors;
}

function tickOf(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __sr: { tick: () => number } }).__sr.tick());
}

test('loads, runs the clock, and stays inside the viewport width', async ({ page }, testInfo) => {
  const errors = await openRealm(page);
  const t0 = await tickOf(page);
  await expect.poll(() => tickOf(page), { timeout: 15_000 }).toBeGreaterThan(t0);

  // No horizontal page scroll at this width (16 px gutters, no fixed-width overflow).
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `horizontal overflow at ${testInfo.project.name}`).toBeLessThanOrEqual(1);

  // The fatal dialog stays hidden on a healthy start.
  await expect(page.locator('#fatal')).toBeHidden();

  await page.screenshot({ path: testInfo.outputPath(`platform-${testInfo.project.name}.png`) });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the status line answers a tap on the map', async ({ page }) => {
  const errors = await openRealm(page);
  const box = await page.locator('#map').boundingBox();
  expect(box).not.toBeNull();
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('#status')).not.toHaveText('Tap the map to inspect a tile.', { timeout: 15_000 });
  expect(errors, errors.join('\n')).toEqual([]);
});
