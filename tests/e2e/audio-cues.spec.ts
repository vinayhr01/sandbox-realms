import { expect, test, type Page } from '@playwright/test';

/**
 * Visual cues layer (16 B9, 13 section 14): the caption line and edge pulses are mounted once,
 * hidden while the visual cues option is off (its default), and the page raises no errors with
 * the audio and haptic hooks in place. The settings rows for the cue options are not built yet,
 * so this run cannot switch the layer on; the logic is covered by tests/unit/audio-cues-*.test.ts.
 */

async function openRealm(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('/?seed=42&size=4');
  await page.waitForFunction(() => Boolean((window as unknown as { __sr?: unknown }).__sr));
  await expect(page.locator('#realm-name')).toContainText('Realm');
  return errors;
}

test('cue layer is mounted, hidden by default, and its caption is a polite live region', async ({ page }) => {
  const errors = await openRealm(page);
  const layer = page.locator('.audio-cues');
  await expect(layer).toHaveCount(1);
  await expect(layer).toBeHidden();
  const caption = page.locator('.audio-cues .cue-caption');
  await expect(caption).toHaveAttribute('role', 'status');
  await expect(caption).toHaveAttribute('aria-live', 'polite');
  expect(errors).toEqual([]);
});

test('no haptic is requested when the page is not touched', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __vibrations: unknown[] }).__vibrations = [];
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: (p: unknown) => {
        (window as unknown as { __vibrations: unknown[] }).__vibrations.push(p);
        return true;
      },
    });
  });
  const errors = await openRealm(page);
  const count = await page.evaluate(() => (window as unknown as { __vibrations: unknown[] }).__vibrations.length);
  expect(count).toBe(0);
  expect(errors).toEqual([]);
});
