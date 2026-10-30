import { defineConfig, devices } from '@playwright/test';

// SR_E2E_PORT lets parallel checkouts run their own preview server without sharing one.
const PORT = Number(process.env['SR_E2E_PORT'] ?? 4173);

// The creature perf gate measures frame time on software WebGL, so it runs once, on desktop-chromium only: the other
// projects set testMatch, which already leaves it out. CI's sharded job sets SR_SKIP_PERF=1 and the perf gate runs in its
// own job, alone, so a shard's other tests cannot steal its CPU.
const SKIP_PERF = process.env['SR_SKIP_PERF'] === '1';
// The 3D specs draw with software WebGL too: two of them on one shard's two workers starve each other and their
// neighbours (CI, 2026-10-30). CI's sharded job sets SR_SKIP_3D=1 and runs them in their own job, one worker.
const SKIP_3D = process.env['SR_SKIP_3D'] === '1';
const SPECS_3D = /(view3d|view-switch|perf-3d|day-night)\.spec\.ts/;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  // WebGL runs in software in CI containers, so keep parallelism low to keep frames moving.
  workers: 2,
  // Shards split by test, not by file: one slow file (windows-catalog, ~6 min) no longer pins a whole shard.
  fullyParallel: true,
  // CI runners draw WebGL in software and vary in speed; one retry absorbs a slow frame or a mid-test hamlet. A retried
  // pass is still listed as "flaky" in the report, and a test that fails twice still fails the run. Local runs: no retry.
  retries: process.env['CI'] ? 1 : 0,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}/`,
    trace: 'retain-on-failure',
    // Existing specs run in 2D: the saved view is pinned to 2d. Specs that want 3D opt in with ?view=3d.
    storageState: {
      cookies: [],
      origins: [{ origin: `http://localhost:${PORT}`, localStorage: [{ name: 'sr.view', value: '2d' }] }],
    },
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: 'desktop-chromium', testIgnore: [...(SKIP_PERF ? [/perf-creatures\.spec\.ts/] : []), ...(SKIP_3D ? [SPECS_3D] : [])], use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
    // Phone and tablet run only the layout specs; everything else is viewport-independent and runs on desktop-chromium.
    { name: 'phone-portrait', testMatch: /(platform-smoke|smoke|panels)\.spec\.ts/, use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 }, hasTouch: true } },
    // The 3D boot check on a phone in portrait: only `boots in 3D` from view3d.spec.ts.
    { name: 'phone-portrait-3d', testMatch: /view3d\.spec\.ts/, grep: /boots in 3D|phone: /, use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: 'phone-landscape', testMatch: /(platform-smoke|smoke|panels)\.spec\.ts/, use: { ...devices['Pixel 5'], viewport: { width: 844, height: 390 }, hasTouch: true } },
    { name: 'tablet', testMatch: /(platform-smoke|smoke|panels)\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 }, hasTouch: true } },
    // Platform matrix (PLATFORM-REQUIREMENTS section 6): each engine at the smallest phone and the
    // full HD desktop viewport. These run only the platform-*.spec.ts smoke tests.
    { name: 'chromium-360x640', testMatch: /platform-.*\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 640 }, hasTouch: true } },
    { name: 'chromium-1920x1080', testMatch: /platform-.*\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } } },
  ],
});
