import { expect, test, type Page } from '@playwright/test';
import { collapsePowerSheet, openChip, powerButton, settleFirstTown } from './helpers.ts';

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

/** The camera's height above the ground under the focus, from the rig hook (-1 when there is no 3D rig). */
function rigHeight(page: Page): Promise<number> {
  return page.evaluate(() => {
    const sr = (window as unknown as { __sr: { rig(): { height: number } | null } }).__sr;
    return sr.rig()?.height ?? -1;
  });
}

/** The realm's side in tiles, from the hook. */
function realmSide(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __sr: { side(): number } }).__sr.side());
}

/** How many commands the sim client has sent so far (the command log grows with each power or stroke). */
function commandCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __sr: { commands(): number[] } }).__sr.commands().length);
}

/** The screen centre of the WebGL canvas, in page pixels. */
async function canvasCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('.map canvas[data-engine]').boundingBox();
  if (!box) throw new Error('the map canvas has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('boots in 3D', async ({ page }) => {
  const errors = await open3D(page);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __sr: Hooks }).__sr.rendererKind?.()))
    .toBe('3d');
  await expect.poll(() => distinctColours(page), { timeout: 20_000 }).toBeGreaterThan(1);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('info card opens on a 3D being tap', async ({ page }) => {
  const errors = await open3D(page);
  await expect.poll(() => distinctColours(page), { timeout: 20_000 }).toBeGreaterThan(1);
  const card = page.locator('.info-card');
  // Beings walk, so each try reads the snapshot's points again and taps one whose tile centre is on the canvas.
  await expect(async () => {
    const points = await page.evaluate(() => {
      const snap = (window as unknown as { __sr: { snapshot(): { mapPoints?: { x: number; y: number }[] } | null } }).__sr.snapshot();
      return (snap?.mapPoints ?? []).slice(0, 50);
    });
    for (const p of points) {
      const at = await page.evaluate(
        ({ x, y }) => (window as unknown as { __sr: { tileToScreen(x: number, y: number): { x: number; y: number } | null } }).__sr.tileToScreen(x, y),
        { x: p.x, y: p.y },
      );
      if (!at) continue;
      const onMap = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', at);
      if (!onMap) continue;
      await page.mouse.click(at.x, at.y);
      break;
    }
    await expect(card).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
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

test('zoom to ground and back', async ({ page }) => {
  const errors = await open3D(page);
  const at = await canvasCentre(page);
  await page.mouse.move(at.x, at.y);

  // Wheel in until the eye is near the ground (under 2 tiles up).
  for (let i = 0; i < 60 && (await rigHeight(page)) >= 2; i++) await page.mouse.wheel(0, -400);
  expect(await rigHeight(page)).toBeLessThan(2);

  // Wheel back out to the overview, which is 1.1 times the side.
  const overview = (await realmSide(page)) * 1.1;
  for (let i = 0; i < 60 && (await rigHeight(page)) < overview * 0.99; i++) await page.mouse.wheel(0, 400);
  expect(await rigHeight(page)).toBeGreaterThanOrEqual(overview * 0.99);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('armed click casts on the hit tile', async ({ page }) => {
  const errors = await open3D(page);
  await openChip(page, 'Land');
  await powerButton(page, 'Raise').click();
  // The expanded sheet covers the lower map; collapse it so the centre click reaches the canvas.
  await collapsePowerSheet(page);
  const before = await commandCount(page);
  // A click at the screen centre casts at the tile the ray hits there; the power command is sent once per click.
  const at = await canvasCentre(page);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => commandCount(page)).toBeGreaterThan(before);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('phone: at ground level the joystick shows above the power sheet, not on it', async ({ page }) => {
  test.skip(!(page.viewportSize()?.width && page.viewportSize()!.width < 900), 'phone layouts only');
  const errors = await open3D(page);
  const at = await canvasCentre(page);
  await page.mouse.move(at.x, at.y);
  for (let i = 0; i < 60 && (await rigHeight(page)) >= 2; i++) await page.mouse.wheel(0, -400);
  const stick = page.locator('.joystick');
  await expect(stick).toBeVisible();
  await expect
    .poll(async () => {
      const s = await stick.boundingBox();
      const sheet = await page.locator('.power-sheet').boundingBox();
      return s && sheet ? s.y + s.height <= sheet.y : false;
    })
    .toBe(true);
  expect(errors, errors.join('\n')).toEqual([]);
});
