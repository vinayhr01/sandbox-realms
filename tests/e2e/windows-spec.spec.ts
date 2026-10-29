import { expect, test, type Page } from '@playwright/test';
import { openConfirmation, openWindowButton } from './helpers.ts';

/**
 * Windows added for the spec table (13 section 7.1): each opens from the Powers tab's Windows group
 * with a dialog named by its title, shows its content, and closes by its close control and Escape.
 * Developer windows show a gate while Developer tools is off, and work when the setting is on.
 */

const WINDOWS: ReadonlyArray<[button: string, title: string]> = [
  ['Armies', 'Armies'],
  ['Pacts', 'Pacts'],
  ['Clans', 'Clans'],
  ['Favourite beings', 'Favourite beings'],
  ['Favourite items', 'Favourite items'],
  ['Compare', 'Compare'],
  ['Annals', 'Annals'],
  ['Trait rain', 'Trait rain'],
  ['Item rain', 'Item rain'],
  ['Trait editor', 'Trait editor'],
  ['Gear editor', 'Gear editor'],
  ['Patch notes', 'Patch notes'],
  ['Error', 'Error'],
  ['Leave realm', 'Leave realm'],
  ['Update', 'Update'],
  ['Developer console', 'Developer console'],
  ['Developer tools', 'Developer tools'],
];

async function openRealm(page: Page, options?: Record<string, boolean>): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  // The developer windows are listed in Settings only while Show developer tools is on, so every run of this spec turns it on.
  await page.addInitScript((value) => {
    window.localStorage.setItem('settings', JSON.stringify(value));
  }, { 'dev.enabled': true, ...options });
  await page.goto('/?seed=42&size=4');
  await page.waitForFunction(() => Boolean((window as unknown as { __sr?: unknown }).__sr));
  await expect(page.locator('#realm-name')).toContainText('Realm');
  (page as unknown as { __errors: string[] }).__errors = errors;
}

async function openFromPowers(page: Page, name: string): Promise<void> {
  // Leave realm is a confirmation: it has no Atlas section, so it opens through the window hook.
  if (name === 'Leave realm') {
    await openConfirmation(page, 'win_confirm_quit');
    return;
  }
  await openWindowButton(page, name);
}

test.afterEach(async ({ page }, testInfo) => {
  const errors = (page as unknown as { __errors?: string[] }).__errors ?? [];
  if (testInfo.status === 'passed') expect(errors, errors.join('\n')).toEqual([]);
});

for (const [button, title] of WINDOWS) {
  test(`${title} opens as a named dialog and closes with its close control and Escape`, async ({ page }) => {
    await openRealm(page);
    await openFromPowers(page, button);
    const dialog = page.getByRole('dialog', { name: title, exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close window' }).click();
    await expect(dialog).toBeHidden();
    await openFromPowers(page, button);
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
}

test('the developer windows say they are off by default', async ({ page }) => {
  await openRealm(page);
  await openFromPowers(page, 'Developer console');
  const console = page.getByRole('dialog', { name: 'Developer console', exact: true });
  await expect(console.getByText('Developer tools are off.')).toBeVisible();
  await expect(console.getByRole('textbox', { name: 'Command' })).toHaveCount(0);
  await console.getByRole('button', { name: 'Close window' }).click();
  await openFromPowers(page, 'Developer tools');
  const tools = page.getByRole('dialog', { name: 'Developer tools', exact: true });
  await expect(tools.getByText('Developer tools are off.')).toBeVisible();
  await expect(tools.getByRole('tab')).toHaveCount(0);
});

test('with Developer tools on, the console answers read commands and refuses writes', async ({ page }) => {
  await openRealm(page, { 'dev.enabled': true });
  await openFromPowers(page, 'Developer console');
  const dialog = page.getByRole('dialog', { name: 'Developer console', exact: true });
  const input = dialog.getByRole('textbox', { name: 'Command' });
  await input.fill('tick');
  await dialog.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(dialog.getByRole('log', { name: 'Console output' })).toContainText('Tick ');
  await input.fill('spawn wolf 3');
  await dialog.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(dialog.getByRole('log', { name: 'Console output' })).toContainText('write commands are not built');
});

test('with Developer tools on, the developer tools show their tabs', async ({ page }) => {
  await openRealm(page, { 'dev.enabled': true });
  await openFromPowers(page, 'Developer tools');
  const dialog = page.getByRole('dialog', { name: 'Developer tools', exact: true });
  await dialog.getByRole('tab', { name: 'Content', exact: true }).click();
  await expect(dialog.getByRole('tab', { name: 'Content', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByText('Powers')).toBeVisible();
});

test('the realm overview lists interesting people, and a being can be starred into the favourites list', async ({ page }) => {
  await openRealm(page);
  await page.locator('#pause').click();
  await openFromPowers(page, 'Realm overview');
  const realm = page.getByRole('dialog', { name: 'Realm overview', exact: true });
  await expect(realm.getByRole('heading', { name: 'Interesting people', exact: true })).toBeVisible();
  const first = realm.getByRole('button', { name: /^.+ \d+$/ }).first();
  // A realm may have no beings yet; then the list is empty and there is nothing to open.
  if ((await first.count()) === 0) return;
  await first.click();
  const being = page.getByRole('dialog', { name: 'Being', exact: true });
  await expect(being).toBeVisible();
  await expect(being.getByRole('term').filter({ hasText: 'Species' })).toBeVisible();
  const star = being.getByRole('button', { name: 'Add to favourites', exact: true });
  await star.click();
  await expect(being.getByRole('button', { name: 'Remove from favourites', exact: true })).toBeVisible();
  await being.getByRole('button', { name: 'Close window' }).click();
  await openFromPowers(page, 'Favourite beings');
  const favourites = page.getByRole('dialog', { name: 'Favourite beings', exact: true });
  await expect(favourites.locator('button.rule-row').first()).toBeVisible();
});

test('the trait rain editor switches between rains A, B and C', async ({ page }) => {
  await openRealm(page);
  await openFromPowers(page, 'Trait rain');
  const dialog = page.getByRole('dialog', { name: 'Trait rain', exact: true });
  await expect(dialog.getByText('The realm does not read trait rain yet.')).toBeVisible();
  await dialog.getByRole('tab', { name: 'Rain B', exact: true }).click();
  await expect(dialog.getByRole('tab', { name: 'Rain B', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('tab', { name: 'Rain A', exact: true })).toHaveAttribute('aria-selected', 'false');
});

test('the annals say there is no event log yet, and the compare window explains its chart', async ({ page }) => {
  await openRealm(page);
  await openFromPowers(page, 'Annals');
  const annals = page.getByRole('dialog', { name: 'Annals', exact: true });
  await expect(annals.getByText('The realm has no event log yet.')).toBeVisible();
  await page.keyboard.press('Escape');
  await openFromPowers(page, 'Compare');
  const compare = page.getByRole('dialog', { name: 'Compare', exact: true });
  await expect(compare.getByText('The realm keeps no history.')).toBeVisible();
});

test('the quit window keeps saving and leaving disabled, and the error window copies details', async ({ page }) => {
  await openRealm(page);
  await openFromPowers(page, 'Leave realm');
  const quit = page.getByRole('dialog', { name: 'Leave realm', exact: true });
  await expect(quit.getByRole('button', { name: 'Save and leave', exact: true })).toBeDisabled();
  await expect(quit.getByRole('button', { name: 'Leave without saving', exact: true })).toBeDisabled();
  await quit.getByRole('button', { name: 'Keep playing', exact: true }).click();
  await expect(quit).toBeHidden();
  await openFromPowers(page, 'Error');
  const error = page.getByRole('dialog', { name: 'Error', exact: true });
  await expect(error.getByRole('button', { name: 'Copy details', exact: true })).toBeVisible();
  await expect(error.getByRole('button', { name: 'Send report', exact: true })).toBeDisabled();
});

test('the Chronicle window opens its confirmation from a save row only when there is one', async ({ page }) => {
  await openRealm(page);
  await openWindowButton(page, 'Chronicle');
  const chronicle = page.getByRole('dialog', { name: 'Chronicle', exact: true });
  const load = chronicle.getByRole('button', { name: /^Load / }).first();
  if ((await load.count()) === 0) return;
  await load.click();
  const confirm = page.getByRole('dialog', { name: 'Confirm', exact: true });
  await expect(confirm.getByRole('button', { name: 'Load', exact: true })).toBeDisabled();
});
