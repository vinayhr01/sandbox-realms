// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { InfoCard } from '../../src/ui/shell/InfoCard.tsx';
import { createStore, type ShellActions, type UiStore } from '../../src/ui/shell/store.ts';

/** The card's frame loop runs on rAF; a 0 ms timer stands in for it, and a short wait lets Preact re-render. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

function buttonNamed(root: HTMLElement, label: string): HTMLButtonElement {
  const el = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label);
  if (!el) throw new Error(`no button ${label}`);
  return el;
}

describe('InfoCard', () => {
  let host: HTMLElement;
  let store: UiStore;
  let locateBeing: ReturnType<typeof vi.fn>;
  let actions: {
    locateBeing: ReturnType<typeof vi.fn>;
    followBeing: ReturnType<typeof vi.fn>;
    possessBeing: ReturnType<typeof vi.fn>;
    openWindow: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore();
    locateBeing = vi.fn(() => ({ x: 120, y: 240, name: 'Burrfleece' }));
    actions = { locateBeing, followBeing: vi.fn(), possessBeing: vi.fn(), openWindow: vi.fn() };
  });

  afterEach(() => {
    render(null, host);
    host.remove();
    vi.unstubAllGlobals();
  });

  it('renders nothing without a being target', async () => {
    render(<InfoCard store={store} actions={actions as unknown as ShellActions} />, host);
    await settle();
    expect(host.querySelector('.info-card')).toBeNull();
  });

  it('shows the plain species name and the Follow, Possess and More actions', async () => {
    store.info.value = { kind: 'being', id: '7' };
    render(<InfoCard store={store} actions={actions as unknown as ShellActions} />, host);
    await settle();
    expect(host.querySelector('.info-card-name')?.textContent).toContain('Burrfleece');
    expect(buttonNamed(host, 'Follow')).toBeTruthy();
    expect(buttonNamed(host, 'Possess')).toBeTruthy();
    expect(buttonNamed(host, 'More')).toBeTruthy();
  });

  it('calls the shell actions with the being id', async () => {
    store.info.value = { kind: 'being', id: '7' };
    render(<InfoCard store={store} actions={actions as unknown as ShellActions} />, host);
    await settle();
    buttonNamed(host, 'Follow').click();
    buttonNamed(host, 'Possess').click();
    buttonNamed(host, 'More').click();
    expect(actions.followBeing).toHaveBeenCalledWith(7);
    expect(actions.possessBeing).toHaveBeenCalledWith(7);
    expect(actions.openWindow).toHaveBeenCalledWith('win_being', { id: 7 });
  });

  it('shows Gone once the being has left the feed', async () => {
    locateBeing.mockReturnValue(null);
    store.info.value = { kind: 'being', id: '9' };
    render(<InfoCard store={store} actions={actions as unknown as ShellActions} />, host);
    await settle();
    expect(host.querySelector('.info-card-gone')).not.toBeNull();
    expect(host.textContent).toContain('Gone');
    expect(host.querySelector('.info-card-actions')).toBeNull();
  });

  it('Close clears the info target', async () => {
    store.info.value = { kind: 'being', id: '7' };
    render(<InfoCard store={store} actions={actions as unknown as ShellActions} />, host);
    await settle();
    buttonNamed(host, 'Close').click();
    expect(store.info.value).toBeNull();
  });
});
