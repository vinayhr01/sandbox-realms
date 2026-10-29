import { expect, test, type Page } from '@playwright/test';
import { openAtlasTab, openChip, openWindowButton, powerButton } from './helpers.ts';

/**
 * Windows and the first-run tutorial (13 section 7, 15, 17): the Realm Rules toggles reach the sim,
 * the achievements list searches, the settings groups show, the coach strip advances and stays
 * dismissed across reloads, and the power catalogue arms a power.
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
  (page as unknown as { __errors: string[] }).__errors = errors;
  return sr(page);
}

test.afterEach(async ({ page }, testInfo) => {
  const errors = (page as unknown as { __errors?: string[] }).__errors ?? [];
  if (testInfo.status === 'passed') expect(errors, errors.join('\n')).toEqual([]);
});

test('Realm Rules: search, then a toggle changes the rule and sends it to the sim', async ({ page }) => {
  const call = await openRealm(page);
  await openWindowButton(page, 'Realm Rules');

  const dialog = page.getByRole('dialog', { name: 'Realm Rules' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('searchbox', { name: 'Search Realm rules' }).fill('clouds');
  const sky = dialog.getByRole('switch', { name: 'Clouds' });
  await expect(sky).toHaveAttribute('aria-checked', 'true');
  await sky.click();
  await expect(sky).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => call<boolean>('rule', 'sky_clouds')).toBe(false);
  // Kind 8 is SetRule (src/shared/protocol.ts).
  await expect.poll(() => call<number[]>('commands')).toContain(8);
});

test('Achievements: the catalogue lists all 63 and search narrows it', async ({ page }) => {
  await openRealm(page);
  await openWindowButton(page, 'Achievements');
  const dialog = page.getByRole('dialog', { name: 'Achievements' });
  await expect(dialog.getByText('63 of 63')).toBeVisible();
  await dialog.getByRole('searchbox', { name: 'Search Achievements' }).fill('cradle');
  await expect(dialog.getByText('1 of 63')).toBeVisible();
  await expect(dialog.getByRole('listitem').filter({ hasText: 'Cradle' })).toBeVisible();
});

test('Settings: the spec groups show and a setting that is not active yet says so', async ({ page }) => {
  await openRealm(page);
  await openAtlasTab(page, 'Settings');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByRole('group')).toHaveCount(11);
  await expect(dialog.getByRole('group', { name: 'Map' })).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: /Bloom/ })).toBeVisible();
  await expect(dialog.getByText('not active yet').first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
});

test('Tutorial: the coach shows the first step, and skipping keeps it hidden after a reload', async ({ page }) => {
  await openRealm(page);
  // The coach sits in the top-centre column (UX redesign, spec E): first step, then Skip.
  const coach = page.locator('.coach');
  await expect(coach).toBeVisible();
  await expect(coach.locator('.coach-title')).toHaveText('Shape the land');

  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  await expect(coach).toBeHidden();
  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as { __sr?: unknown }).__sr));
  await expect(page.locator('#realm-name')).toContainText('Realm');
  await expect(coach).toBeHidden();
});

test('All powers: the catalogue filters to available powers and a tap arms one', async ({ page }) => {
  await openRealm(page);
  await openWindowButton(page, 'Power catalogue');
  const dialog = page.getByRole('dialog', { name: 'Power catalogue' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Available', exact: true }).click();
  // The list is virtualised, so search for the row rather than rely on scroll position.
  await dialog.getByRole('searchbox', { name: 'Search Powers' }).fill('Charge');
  await dialog.locator('.power-row').filter({ hasText: /^Charge/ }).click();
  await expect(dialog).toBeHidden();

  await openChip(page, 'Disasters');
  await expect(powerButton(page, 'Charge')).toHaveAttribute('aria-pressed', 'true');
});

test('Esc order: a page pops to the tab list, the next Esc closes the Atlas, and focus returns to the realm pill', async ({ page }) => {
  await openRealm(page);
  await openWindowButton(page, 'Dominions');
  await expect(page.getByRole('dialog', { name: 'Dominions', exact: true })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.atlas [role="tablist"]')).toBeVisible();
  await expect(page.locator('.atlas-section[data-section="list_dominions"]')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(page.locator('.atlas-scrim')).toBeHidden();
  await expect(page.getByRole('button', { name: /open Atlas$/ })).toBeFocused();
});
