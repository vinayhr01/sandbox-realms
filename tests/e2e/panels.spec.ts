import { expect, test, type Page } from '@playwright/test';
import { collapsePowerSheet, openAtlasTab, openChip, openPowerSheet, powerButton, settleFirstTown } from './helpers.ts';

/**
 * Options panel and power bar: the settings dialog persists UI scale and reduce motion, and arming
 * a power shows the armed state and lets a drag on the map apply it through the existing brush.
 */

type Hook = <T>(fn: string, ...args: unknown[]) => Promise<T>;

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
  // Seed 42 can grow its first hamlet mid-test on fast runners, which re-lays the chips and pushes a toast; settle it first.
  await settleFirstTown(page);
  (page as unknown as { __errors: string[] }).__errors = errors;
  return sr(page);
}

test.afterEach(async ({ page }, testInfo) => {
  const errors = (page as unknown as { __errors?: string[] }).__errors ?? [];
  if (testInfo.status === 'passed') expect(errors, errors.join('\n')).toEqual([]);
});

const uiScale = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim());

test('options: UI scale and reduce motion apply and persist across reload', async ({ page }) => {
  await openRealm(page);
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeHidden();

  await openAtlasTab(page, 'Settings');
  await expect(dialog).toBeVisible();

  // Range input: the arrow key steps by 5 (100 to 105) and fires the input event.
  const scale = page.getByRole('slider', { name: /UI scale/ });
  await scale.focus();
  await page.keyboard.press('ArrowRight');
  await expect(scale).toHaveValue('105');
  await expect.poll(() => uiScale(page)).toBe('1.05');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe('16.8px');

  await page.getByRole('checkbox', { name: 'Reduce motion' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-reduce-motion', '');

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as { __sr?: unknown }).__sr));
  await expect.poll(() => uiScale(page)).toBe('1.05');
  await expect(page.locator('html')).toHaveAttribute('data-reduce-motion', '');

  await openAtlasTab(page, 'Settings');
  await expect(page.getByRole('slider', { name: /UI scale/ })).toHaveValue('105');
  await expect(page.getByRole('checkbox', { name: 'Reduce motion' })).toBeChecked();
});

test('powers: arming Raise shows the armed state and a drag on the map raises terrain', async ({ page }) => {
  const call = await openRealm(page);
  await openChip(page, 'Land');

  const raise = powerButton(page, 'Raise');
  await expect(raise).toHaveAttribute('aria-pressed', 'false');
  await raise.click();
  await expect(raise).toHaveAttribute('aria-pressed', 'true');
  await collapsePowerSheet(page);

  const start = await call<{ x: number; y: number }>('tileToScreen', 90, 90);
  const end = await call<{ x: number; y: number }>('tileToScreen', 100, 90);
  const before = await call<{ elevation: number }>('query', 95, 90);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(async () => (await call<{ elevation: number }>('query', 95, 90)).elevation, { timeout: 15000 })
    .toBeGreaterThan(before.elevation);

  // Tapping the armed power again disarms it.
  await openPowerSheet(page);
  await raise.click();
  await expect(raise).toHaveAttribute('aria-pressed', 'false');
});

test('powers: a sim power arms, a tap sends it to the sim, and an unbuilt power is disabled with a note', async ({ page }) => {
  const call = await openRealm(page);
  await openChip(page, 'Disasters');
  const bomb = powerButton(page, 'Charge');
  await expect(bomb).toBeVisible();

  await bomb.click();
  await expect(bomb).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#status')).toContainText('Charge is armed');
  await collapsePowerSheet(page);

  // A tap on the map applies the armed power: the sim gets a Power command (kind 7).
  const target = await call<{ x: number; y: number }>('tileToScreen', 100, 100);
  await page.mouse.click(target.x, target.y);
  await expect.poll(() => call<number[]>('commands')).toContain(7);

  // Bless is built (rituals powers), so it is enabled. It is not tapped: that would disarm Bomb below.
  await openChip(page, 'Blessings');
  const bless = powerButton(page, 'Bless');
  await expect(bless).not.toHaveAttribute('aria-disabled', 'true');
  await expect(bless).toHaveAttribute('aria-pressed', 'false');
  await openChip(page, 'Disasters');
  await expect(bomb).toHaveAttribute('aria-pressed', 'true');

  await collapsePowerSheet(page);
  // An armed power that is not a brush must not block panning. The default view fits the whole
  // realm, so zoom in first to leave room to pan.
  const center = await call<{ x: number; y: number }>('tileToScreen', 128, 128);
  const zoomed0 = await call<{ x: number; y: number }>('tileToScreen', 0, 0);
  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, -300);
  await expect
    .poll(async () => (await call<{ x: number; y: number }>('tileToScreen', 0, 0)).x, { timeout: 15000 })
    .not.toBe(zoomed0.x);
  const origin = await call<{ x: number; y: number }>('tileToScreen', 128, 128);
  const from = origin;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 60, from.y - 30, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => JSON.stringify(await call<{ x: number; y: number }>('tileToScreen', 128, 128)), { timeout: 15000 })
    .not.toBe(JSON.stringify(origin));
});
