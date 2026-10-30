import { expect, test } from '@playwright/test';
import { settleFirstTown } from './helpers.ts';

/**
 * 3D smoke perf (3D part 1 plan, Task 9 step 6). CI runs WebGL in software (SwiftShader), so this is no fps gate: it
 * only fails on a long stall, a frame over STALL_MS after warm-up. Measured locally, software GL draws every frame in
 * about 300 ms in 3D (about 250 ms in 2D), all of it in the GL rasteriser, not in our code; 1 s still catches a real hang
 * such as rebuilding every chunk each frame. The 60/30 fps targets are checked by hand on a phone.
 */

const STALL_MS = 1_000;
const WARM_UP_MS = 3_000;
const SAMPLE_MS = 10_000;

test('3D view runs 10 s with no frame over 1 s after warm-up', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?view=3d&seed=42&size=4');
  await page.waitForFunction(() => Boolean((window as unknown as { __sr?: unknown }).__sr));
  await expect(page.locator('#realm-name')).toContainText('Realm');
  await settleFirstTown(page);
  expect(await page.evaluate(() => (window as unknown as { __sr: { rendererKind(): string } }).__sr.rendererKind())).toBe('3d');
  await page.waitForTimeout(WARM_UP_MS);
  const worst = await page.evaluate(
    (sampleMs) =>
      new Promise<number>((resolve) => {
        let last = performance.now();
        const end = last + sampleMs;
        let max = 0;
        const step = (now: number): void => {
          max = Math.max(max, now - last);
          last = now;
          if (now < end) requestAnimationFrame(step);
          else resolve(max);
        };
        requestAnimationFrame(step);
      }),
    SAMPLE_MS,
  );
  expect(worst, `worst frame gap ${worst.toFixed(0)} ms`).toBeLessThanOrEqual(STALL_MS);
});
