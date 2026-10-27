import { expect, test, type Page } from '@playwright/test';

/**
 * Creature pipeline cost in the real page (desktop-chromium only, see playwright.config.ts). 3,000 beings are spread over
 * land at 10x speed, and the view is zoomed so that most of them are drawn as icons. The gate is the main-thread cost of
 * the creature pipeline per frame (feed push + sample + CreatureLayer.draw with its dust), read from `__sr.creatureCost()`:
 * P95 of 4 ms or less over at least 10 s. The whole-frame time on CI's software WebGL is dominated by the full-screen
 * terrain fill, which is not the creature layer's cost, so it is logged for information and not asserted.
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

const BEINGS = 3000;
/** CSS px per tile: at 4 and above the beings are icons, not dots. */
const ZOOM_PX = 6;
const MEASURE_MS = 10_000;
const COST_P95_GATE_MS = 4;
const MIN_ICONS_IN_VIEW = 1000;
const MIN_ICON_ZOOM_PX = 4;
/** The spawn area: a square of tiles around the realm centre, tried on a 2-tile grid (a spawn needs a walkable tile). */
const AREA_TILES = 120;

/** The 95th percentile of `values` (nearest-rank). */
function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)] ?? NaN;
}

test('3000 creatures at 10x: creature pipeline P95 <= 4 ms with 1000+ icons in view', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('/?seed=42&size=4');
  await page.waitForFunction(() => Boolean((window as unknown as { __sr?: unknown }).__sr));
  await expect(page.locator('#realm-name')).toContainText('Realm');
  const call = sr(page);

  // Spread the spawns over land: one being on every second tile of the area (the sim refuses non-walkable tiles), then
  // top up to BEINGS on the tiles that took one.
  const side = await call<number>('side');
  const mid = Math.floor(side / 2);
  const x0 = mid - AREA_TILES / 2;
  const before = await call<number>('beingTotal');
  await page.evaluate(
    ({ x0, area }) => {
      const hooks = (window as unknown as { __sr: { spawnMany(id: string, n: number, x: number, y: number): void } }).__sr;
      for (let y = 0; y < area; y += 2) for (let x = 0; x < area; x += 2) hooks.spawnMany('burrfleece', 1, x0 + x, x0 + y);
    },
    { x0, area: AREA_TILES },
  );
  await expect
    .poll(async () => (await call<number>('beingTotal')) - before, { timeout: 60_000, intervals: [500] })
    .toBeGreaterThan(300);
  await page.waitForTimeout(1500);
  const land = (await call<{ x: number; y: number }[]>('beingPoints')).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  const have = (await call<number>('beingTotal')) - before;
  expect(land.length).toBeGreaterThan(0);
  await page.evaluate(
    ({ land, n }) => {
      const hooks = (window as unknown as { __sr: { spawnMany(id: string, n: number, x: number, y: number): void } }).__sr;
      for (let i = 0; i < n; i++) hooks.spawnMany('burrfleece', 1, land[i % land.length]!.x, land[i % land.length]!.y);
    },
    { land, n: BEINGS - have },
  );
  await expect
    .poll(() => call<number>('beingTotal'), { timeout: 90_000, intervals: [500] })
    .toBeGreaterThanOrEqual(BEINGS);

  await call('speed', 10);

  // Zoom in on the spawn area: the wheel keeps the tile under the pointer fixed.
  const at = await call<{ x: number; y: number } | null>('tileToScreen', mid, mid);
  expect(at).not.toBeNull();
  await page.mouse.move(at!.x, at!.y);
  for (let i = 0; i < 40 && (await call<number>('zoom')) < ZOOM_PX; i++) await page.mouse.wheel(0, -100);
  const zoom = await call<number>('zoom');
  expect(zoom).toBeGreaterThanOrEqual(MIN_ICON_ZOOM_PX);
  await page.waitForTimeout(1000);

  // 10 s of play: rAF deltas for information, the icon count sampled twice a second.
  const run = page.evaluate(
    (ms) =>
      new Promise<{ deltas: number[]; icons: number[] }>((resolve) => {
        const hooks = (window as unknown as { __sr: { creatureCount(): number } }).__sr;
        const deltas: number[] = [];
        const icons: number[] = [];
        const start = performance.now();
        let last = start;
        let lastIcons = start;
        const frame = (t: number): void => {
          deltas.push(t - last);
          last = t;
          if (t - lastIcons >= 500) {
            lastIcons = t;
            icons.push(hooks.creatureCount());
          }
          if (t - start < ms) requestAnimationFrame(frame);
          else resolve({ deltas: deltas.slice(1), icons });
        };
        requestAnimationFrame(frame);
      }),
    MEASURE_MS,
  );
  const { deltas, icons } = await run;
  const costs = (await call<number[]>('creatureCost')).slice(-Math.min(deltas.length, 600));
  const costP95 = p95(costs);
  const minIcons = Math.min(...icons);
  console.log(
    `perf: zoom ${zoom.toFixed(1)} px/tile, ${deltas.length} frames, creature cost P95 ${costP95.toFixed(2)} ms ` +
      `(p50 ${[...costs].sort((a, b) => a - b)[Math.floor(costs.length / 2)]!.toFixed(2)}, ${costs.length} samples), ` +
      `icons in view min ${minIcons} max ${Math.max(...icons)}, frame P95 ${p95(deltas).toFixed(1)} ms (not asserted)`,
  );

  expect(deltas.length).toBeGreaterThan(0);
  expect(costs.length, 'cost samples').toBeGreaterThanOrEqual(Math.min(deltas.length, 600) * 0.9);
  expect(minIcons, `fewest beings drawn in view over the window: ${minIcons}`).toBeGreaterThanOrEqual(MIN_ICONS_IN_VIEW);
  expect(costP95, `creature pipeline P95 ${costP95.toFixed(2)} ms over ${costs.length} frames`).toBeLessThanOrEqual(COST_P95_GATE_MS);
  expect(errors, errors.join('\n')).toEqual([]);
});
