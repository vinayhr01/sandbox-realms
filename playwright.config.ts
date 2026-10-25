import { defineConfig, devices } from '@playwright/test';

// SR_E2E_PORT lets parallel checkouts run their own preview server without sharing one.
const PORT = Number(process.env['SR_E2E_PORT'] ?? 4173);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  // WebGL runs in software in CI containers, so keep parallelism low to keep frames moving.
  workers: 2,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}/`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
    { name: 'phone-portrait', use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: 'phone-landscape', use: { ...devices['Pixel 5'], viewport: { width: 844, height: 390 }, hasTouch: true } },
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 }, hasTouch: true } },
    // Platform matrix (PLATFORM-REQUIREMENTS section 6): each engine at the smallest phone and the
    // full HD desktop viewport. These run only the platform-*.spec.ts smoke tests.
    { name: 'chromium-360x640', testMatch: /platform-.*\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 640 }, hasTouch: true } },
    { name: 'chromium-1920x1080', testMatch: /platform-.*\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } } },
    { name: 'webkit-360x640', testMatch: /platform-.*\.spec\.ts/, use: { ...devices['Desktop Safari'], viewport: { width: 360, height: 640 }, hasTouch: true } },
    { name: 'webkit-1920x1080', testMatch: /platform-.*\.spec\.ts/, use: { ...devices['Desktop Safari'], viewport: { width: 1920, height: 1080 } } },
  ],
});
