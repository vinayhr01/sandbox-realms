import { expect, test } from '@playwright/test';

/**
 * Search and agent discoverability: the head metadata, the JSON-LD block, and the static files served from the
 * site root. Runs on desktop-chromium only (it is not in the platform-* matrix); none of it depends on the viewport.
 */

test('head metadata: title, description, canonical and social image', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Sandbox Realms – Free Browser God Game Sandbox');
  expect((await page.title()).length).toBeLessThanOrEqual(60);

  const description = await page.locator('meta[name="description"]').getAttribute('content');
  expect(description, 'meta description').toBeTruthy();
  expect(description!.length).toBeLessThanOrEqual(160);

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://vinayhr01.github.io/sandbox-realms/');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /^https:\/\/.+\/og-image\.(png|jpg)$/);
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'website');
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
});

test('JSON-LD parses and describes a VideoGame', async ({ page }) => {
  await page.goto('/');
  const raw = await page.locator('script[type="application/ld+json"]').textContent();
  const data = JSON.parse(raw ?? '{}') as { '@type'?: string | string[]; name?: string; offers?: { price?: string } };
  expect(data['@type']).toContain('VideoGame');
  expect(data.name).toBe('Sandbox Realms');
  expect(data.offers?.price).toBe('0');
});

test('crawlable text is in the page and the game root keeps its layout', async ({ page }) => {
  await page.goto('/');
  // The sr-only section is inside #app, and the game UI is still there.
  const about = page.locator('#app section[aria-label="About Sandbox Realms"]');
  await expect(about.locator('h1')).toHaveText(/Sandbox Realms/);
  await expect(page.locator('#map')).toBeVisible();
});

test('robots.txt, sitemap.xml and llms.txt are served', async ({ request }) => {
  const robots = await request.get('robots.txt');
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain('Sitemap: https://vinayhr01.github.io/sandbox-realms/sitemap.xml');

  const sitemap = await request.get('sitemap.xml');
  expect(sitemap.status()).toBe(200);
  expect(await sitemap.text()).toContain('<loc>https://vinayhr01.github.io/sandbox-realms/</loc>');

  const llms = await request.get('llms.txt');
  expect(llms.status()).toBe(200);
  expect(await llms.text()).toMatch(/^# Sandbox Realms/);
});
