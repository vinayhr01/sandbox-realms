// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { PowerSheet } from '../../src/ui/shell/PowerSheet.tsx';
import { createStore, type ShellActions, type UiStore } from '../../src/ui/shell/store.ts';

type Spy = ReturnType<typeof vi.fn>;

/** Preact renders signal changes on a microtask. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function powerButtons(root: HTMLElement): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>('button[data-power-id]')];
}

function chipLabels(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>('[role="tab"]')].map((el) => (el.textContent ?? '').trim());
}

function moreButton(root: HTMLElement): HTMLButtonElement {
  const el = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').includes('More'));
  if (!el) throw new Error('no More button');
  return el;
}

describe('PowerSheet', () => {
  let host: HTMLElement;
  let store: UiStore;
  let actions: { setSpeed: Spy; togglePause: Spy; activatePower: Spy; openWindow: Spy; disarm: Spy; setBrushSize: Spy; setBrushShape: Spy };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore();
    actions = {
      setSpeed: vi.fn(),
      togglePause: vi.fn(),
      activatePower: vi.fn(),
      openWindow: vi.fn(),
      disarm: vi.fn(),
      setBrushSize: vi.fn(),
      setBrushShape: vi.fn(),
    };
    render(<PowerSheet store={store} actions={actions as ShellActions} />, host);
  });

  afterEach(() => {
    render(null, host);
    host.remove();
  });

  it('collapsed, shows only the discovered chips and More', () => {
    expect(store.sheet.value).toBe('collapsed');
    expect(chipLabels(host)).toEqual(['Land', 'Nature', 'Creatures']);
    expect(moreButton(host)).toBeTruthy();
    expect(host.querySelector('input[type="search"]')).toBeNull();
  });

  it('expanding the sheet shows the search box', async () => {
    store.sheet.value = 'expanded';
    await tick();
    const search = host.querySelector<HTMLInputElement>('input[type="search"]');
    expect(search?.getAttribute('aria-label')).toBe('Search powers');
  });

  it('typing wolf filters the grid to the Wolf power', async () => {
    store.sheet.value = 'expanded';
    await tick();
    const search = host.querySelector<HTMLInputElement>('input[type="search"]');
    if (!search) throw new Error('no search box');
    search.value = 'wolf';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    const ids = powerButtons(host).map((b) => b.dataset['powerId']);
    expect(ids).toContain('spawn_beast_gloamfang');
    expect(ids).not.toContain('spawn_beast_thistlehart');
  });

  it('clicking a power calls activatePower with its id', async () => {
    store.sheet.value = 'expanded';
    await tick();
    const creatures = [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find((el) => el.textContent?.trim() === 'Creatures');
    creatures?.click();
    await tick();
    const wolf = host.querySelector<HTMLButtonElement>('button[data-power-id="spawn_beast_gloamfang"]');
    if (!wolf) throw new Error('no wolf button');
    expect(wolf.getAttribute('aria-label')).toBe('Call Wolf');
    wolf.click();
    expect(actions.activatePower).toHaveBeenCalledWith('spawn_beast_gloamfang');
  });

  it('the brush control appears only when a brush power is armed', async () => {
    const brushControl = () => host.querySelector<HTMLInputElement>('input[type="range"][aria-label="Brush size"]');
    expect(brushControl()).toBeNull();

    store.armed.value = { powerId: 'shape_raise', brush: { index: 5, radius: 4, shape: 'circle' } };
    await tick();
    expect(brushControl()?.value).toBe('5');
    expect(host.querySelector('[role="radio"][data-shape="square"]')).not.toBeNull();

    store.armed.value = { powerId: 'spawn_beast_gloamfang', brush: { index: 5, radius: 4, shape: 'circle' } };
    await tick();
    expect(brushControl()).toBeNull();
  });

  it('moving the brush slider and choosing a shape call the shell', async () => {
    store.armed.value = { powerId: 'shape_raise', brush: { index: 5, radius: 4, shape: 'circle' } };
    await tick();
    const slider = host.querySelector<HTMLInputElement>('input[type="range"][aria-label="Brush size"]');
    if (!slider) throw new Error('no slider');
    slider.value = '7';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(actions.setBrushSize).toHaveBeenCalledWith(7);
    host.querySelector<HTMLButtonElement>('[role="radio"][data-shape="diamond"]')?.click();
    expect(actions.setBrushShape).toHaveBeenCalledWith('diamond');
  });

  it('the armed power shows aria-pressed', async () => {
    store.sheet.value = 'expanded';
    store.armed.value = { powerId: 'shape_raise', brush: { index: 5, radius: 4, shape: 'circle' } };
    await tick();
    const raise = host.querySelector<HTMLButtonElement>('button[data-power-id="shape_raise"]');
    expect(raise?.getAttribute('aria-pressed')).toBe('true');
  });

  it('right-click pins a favourite, and a second right-click unpins it', async () => {
    store.sheet.value = 'expanded';
    await tick();
    const raise = host.querySelector<HTMLButtonElement>('button[data-power-id="shape_raise"]');
    if (!raise) throw new Error('no raise button');
    raise.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(store.favourites.value).toEqual(['shape_raise']);
    raise.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(store.favourites.value).toEqual([]);
  });
});
