// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { RuleSet } from '../../src/sim/rules.ts';
import { DEFAULT_OPTIONS } from '../../src/ui/panels/options.ts';
import type { WindowDeps } from '../../src/ui/windowContent.ts';
import { atlasBack, closeAtlas, mountAtlas, openAtlas, showAtlas } from '../../src/ui/shell/Atlas.tsx';
import { createStore, type ShellActions, type UiStore } from '../../src/ui/shell/store.ts';

/** Preact renders signal changes on a microtask. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function esc(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

function deps(): WindowDeps {
  return {
    options: () => DEFAULT_OPTIONS,
    setOption: () => undefined,
    rules: new RuleSet(),
    setRule: () => true,
    realm: () => ({ seed: 42, side: 256, calendar: 'Y1 M1' }),
    newRealm: () => undefined,
    activate: () => undefined,
    tutorial: () => ({ state: { index: 0, skipped: false, done: false }, restart: () => undefined, skip: () => undefined }),
    saves: () => Promise.resolve([]),
    close: () => undefined,
    open: () => undefined,
    brush: () => ({ shape: 'circle', sizeIndex: 5, radii: [0, 1, 2, 3, 4, 5] }),
    setBrush: () => undefined,
  };
}

describe('Atlas', () => {
  let root: HTMLElement;
  let store: UiStore;
  let actions: { setSpeed: ReturnType<typeof vi.fn>; togglePause: ReturnType<typeof vi.fn>; activatePower: ReturnType<typeof vi.fn>; openWindow: ReturnType<typeof vi.fn>; disarm: ReturnType<typeof vi.fn>; setBrushSize: ReturnType<typeof vi.fn>; setBrushShape: ReturnType<typeof vi.fn> };
  let removeKeys: () => void;
  let pill: HTMLButtonElement;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    pill = document.createElement('button');
    pill.textContent = 'Realm';
    document.body.appendChild(pill);
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
    removeKeys = mountAtlas(root, store, actions as unknown as ShellActions, deps());
  });

  afterEach(() => {
    removeKeys();
    render(null, root);
    root.remove();
    pill.remove();
  });

  function dialog(): HTMLElement | null {
    return root.querySelector<HTMLElement>('[role="dialog"]');
  }

  it('is absent while closed', () => {
    expect(dialog()).toBeNull();
  });

  it('opening a kind selects its tab and pushes the stack', async () => {
    showAtlas(store, 'list_dominions');
    await tick();
    expect(store.atlas.value.open).toBe(true);
    expect(store.atlas.value.tab).toBe('peoples');
    expect(store.atlas.value.stack.map((p) => p.kind)).toEqual(['list_dominions']);
    expect(dialog()?.getAttribute('aria-labelledby')).toBe('atlas-title');
    expect(root.querySelector('#atlas-title')?.textContent).toBe('Dominions');
    expect(root.querySelector('.atlas-body')).not.toBeNull();
  });

  it('the tab view lists the sections of the tab as buttons', async () => {
    openAtlas(store, 'world');
    await tick();
    const names = [...root.querySelectorAll<HTMLButtonElement>('.atlas-section')].map((b) => b.textContent);
    expect(names).toContain('Realm overview');
    expect(names).toContain('Realm Rules');
    expect(names).not.toContain('Being');
  });

  it('Back pops the stack and returns to the tab view', async () => {
    showAtlas(store, 'list_dominions');
    await tick();
    atlasBack(store);
    await tick();
    expect(store.atlas.value.stack).toEqual([]);
    expect(root.querySelector('.atlas-section[data-section="list_dominions"]')).not.toBeNull();
  });

  it('Settings opens its tab with no page', () => {
    showAtlas(store, 'win_settings');
    expect(store.atlas.value).toMatchObject({ open: true, tab: 'settings', stack: [] });
  });

  it('a developer window opens as a page on the Settings tab', () => {
    showAtlas(store, 'win_error');
    expect(store.atlas.value).toMatchObject({ open: true, tab: 'settings', stack: [{ kind: 'win_error' }] });
  });

  it('opening the page already on top replaces it instead of stacking a copy', () => {
    showAtlas(store, 'win_chronicle', { notice: 'first' });
    showAtlas(store, 'win_chronicle', { notice: 'second' });
    expect(store.atlas.value.stack).toEqual([{ kind: 'win_chronicle', params: { notice: 'second' } }]);
  });

  it('opening the kind below the top pops back only when its params match too', () => {
    showAtlas(store, 'win_hamlet', { id: 1 });
    showAtlas(store, 'win_dominion', { id: 2 });
    showAtlas(store, 'win_hamlet', { id: 3 });
    expect(store.atlas.value.stack).toEqual([
      { kind: 'win_hamlet', params: { id: 1 } },
      { kind: 'win_dominion', params: { id: 2 } },
      { kind: 'win_hamlet', params: { id: 3 } },
    ]);
  });

  it('a confirmation is not an Atlas page', () => {
    showAtlas(store, 'win_confirm_quit');
    expect(store.atlas.value.open).toBe(false);
  });

  it('Esc pops the page, then closes the Atlas, then clears the info card; focus returns to the opener each step', async () => {
    pill.focus();
    openAtlas(store, 'peoples');
    await tick();
    const sectionButton = root.querySelector<HTMLButtonElement>('.atlas-section[data-section="list_dominions"]');
    if (!sectionButton) throw new Error('no Dominions section');
    sectionButton.focus();
    showAtlas(store, 'list_dominions');
    store.info.value = { kind: 'being', id: '7' };
    await tick();

    esc();
    await tick();
    expect(store.atlas.value.stack).toEqual([]);
    expect(store.atlas.value.open).toBe(true);
    expect(document.activeElement).toBe(root.querySelector('.atlas-section[data-section="list_dominions"]'));

    esc();
    await tick();
    expect(store.atlas.value.open).toBe(false);
    expect(document.activeElement).toBe(pill);

    esc();
    expect(store.info.value).toBeNull();
    expect(document.activeElement).toBe(pill);
  });

  it('a page close by its close control returns focus to the opener', async () => {
    pill.focus();
    openAtlas(store, 'world');
    await tick();
    closeAtlas(store);
    await tick();
    expect(store.atlas.value.open).toBe(false);
    expect(document.activeElement).toBe(pill);
  });

  it('Esc leaves a native dialog alone when one is open', async () => {
    openAtlas(store, 'world');
    await tick();
    const native = document.createElement('dialog');
    native.setAttribute('open', '');
    document.body.appendChild(native);
    esc();
    expect(store.atlas.value.open).toBe(true);
    native.remove();
  });
});
