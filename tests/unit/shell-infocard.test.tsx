// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { clampCardAnchor, feedFacts, hamletFacts, InfoCard, onScreen } from '../../src/ui/shell/InfoCard.tsx';
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
  let locateInfo: ReturnType<typeof vi.fn>;
  let actions: {
    locateInfo: ReturnType<typeof vi.fn>;
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
    locateInfo = vi.fn(() => ({ x: 120, y: 240, name: 'Burrfleece', facts: 'Adult, Walking', detailed: true }));
    actions = { locateInfo, followBeing: vi.fn(), possessBeing: vi.fn(), openWindow: vi.fn() };
  });

  afterEach(() => {
    render(null, host);
    host.remove();
    vi.unstubAllGlobals();
  });

  it('renders nothing without a target', async () => {
    render(<InfoCard store={store} actions={actions as unknown as ShellActions} />, host);
    await settle();
    await vi.waitFor(() => {
      expect(host.querySelector('.info-card')).toBeNull();
    });
  });

  it('shows the plain species name and the Follow, Possess and More actions', async () => {
    store.info.value = { kind: 'being', id: '7' };
    render(<InfoCard store={store} actions={actions as unknown as ShellActions} />, host);
    await settle();
    await vi.waitFor(() => {
      expect(host.querySelector('.info-card-name')?.textContent).toContain('Burrfleece');
      expect(buttonNamed(host, 'Follow')).toBeTruthy();
      expect(buttonNamed(host, 'Possess')).toBeTruthy();
      expect(buttonNamed(host, 'More')).toBeTruthy();
    });
  });

  it('shows the feed key facts of the being', async () => {
    store.info.value = { kind: 'being', id: '7' };
    render(<InfoCard store={store} actions={actions as unknown as ShellActions} />, host);
    await settle();
    await vi.waitFor(() => {
      expect(host.querySelector('.info-card-facts')?.textContent).toBe('Adult, Walking');
    });
  });

  it('More is off for a being the latest snapshot does not sample, and does not open its page', async () => {
    locateInfo.mockReturnValue({ x: 1, y: 2, name: 'Burrfleece', facts: 'Child, Idle', detailed: false });
    store.info.value = { kind: 'being', id: '7' };
    render(<InfoCard store={store} actions={actions as unknown as ShellActions} />, host);
    await vi.waitFor(() => buttonNamed(host, 'More'));
    const more = buttonNamed(host, 'More');
    expect(more.disabled).toBe(true);
    more.click();
    expect(actions.openWindow).not.toHaveBeenCalled();
  });

  it('feedFacts reads stage and state from the feed', () => {
    expect(feedFacts({ child: true, state: 5 })).toBe('Child, Hurt');
    expect(feedFacts({ child: false, state: 1 })).toBe('Adult, Walking');
  });

  it('calls the shell actions with the being id', async () => {
    store.info.value = { kind: 'being', id: '7' };
    render(<InfoCard store={store} actions={actions as unknown as ShellActions} />, host);
    // More is enabled once the frame loop has located the being in the detail sample.
    await vi.waitFor(() => expect(buttonNamed(host, 'More').disabled).toBe(false));
    buttonNamed(host, 'Follow').click();
    buttonNamed(host, 'Possess').click();
    buttonNamed(host, 'More').click();
    expect(actions.followBeing).toHaveBeenCalledWith(7);
    expect(actions.possessBeing).toHaveBeenCalledWith(7);
    expect(actions.openWindow).toHaveBeenCalledWith('win_being', { id: 7 });
  });

  it('shows Gone once the being has left the feed', async () => {
    locateInfo.mockReturnValue(null);
    store.info.value = { kind: 'being', id: '9' };
    render(<InfoCard store={store} actions={actions as unknown as ShellActions} />, host);
    await settle();
    await vi.waitFor(() => {
      expect(host.querySelector('.info-card-gone')).not.toBeNull();
      expect(host.textContent).toContain('Gone');
      expect(host.querySelector('.info-card-actions')).toBeNull();
    });
  });

  it('stops the frame loop once the target is gone', async () => {
    locateInfo.mockReturnValue(null);
    store.info.value = { kind: 'being', id: '9' };
    render(<InfoCard store={store} actions={actions as unknown as ShellActions} />, host);
    await vi.waitFor(() => {
      expect(host.querySelector('.info-card-gone')).not.toBeNull();
    });
    const calls = locateInfo.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    await settle();
    await settle();
    expect(locateInfo.mock.calls.length).toBe(calls);
  });

  it('Close clears the info target', async () => {
    store.info.value = { kind: 'being', id: '7' };
    render(<InfoCard store={store} actions={actions as unknown as ShellActions} />, host);
    await vi.waitFor(() => buttonNamed(host, 'Close'));
    buttonNamed(host, 'Close').click();
    expect(store.info.value).toBeNull();
  });

  it('a hamlet card shows its name and tier facts, with no Follow or Possess, and More opens its page', async () => {
    locateInfo.mockReturnValue({ x: 50, y: 60, name: 'Riverside', facts: 'Town, 40 folk', detailed: true });
    store.info.value = { kind: 'hamlet', id: '2' };
    render(<InfoCard store={store} actions={actions as unknown as ShellActions} />, host);
    await settle();
    await vi.waitFor(() => {
      expect(host.querySelector('.info-card-name')?.textContent).toContain('Riverside');
      expect(host.querySelector('.info-card-facts')?.textContent).toBe('Town, 40 folk');
      expect(locateInfo).toHaveBeenCalledWith({ kind: 'hamlet', id: '2' });
      expect([...host.querySelectorAll('button')].map((b) => b.textContent?.trim())).not.toContain('Follow');
    });
    buttonNamed(host, 'More').click();
    expect(actions.openWindow).toHaveBeenCalledWith('win_hamlet', { id: 2 });
  });

  it('a building card shows its kind and owner hamlet, and More opens the structure page', async () => {
    locateInfo.mockReturnValue({ x: 50, y: 60, name: 'House', facts: 'House, in Riverside', detailed: true });
    store.info.value = { kind: 'building', id: '3077' };
    render(<InfoCard store={store} actions={actions as unknown as ShellActions} />, host);
    await settle();
    await vi.waitFor(() => {
      expect(host.querySelector('.info-card-facts')?.textContent).toBe('House, in Riverside');
      expect(host.querySelector('.info-card-actions .btn')?.textContent).toBe('More');
    });
    buttonNamed(host, 'More').click();
    expect(actions.openWindow).toHaveBeenCalledWith('win_structure', { id: 3077 });
  });

  it('a hamlet card whose target is gone says so and stops', async () => {
    locateInfo.mockReturnValue(null);
    store.info.value = { kind: 'hamlet', id: '5' };
    render(<InfoCard store={store} actions={actions as unknown as ShellActions} />, host);
    await settle();
    await vi.waitFor(() => {
      expect(host.textContent).toContain('Gone: this hamlet has left the realm.');
    });
  });

  it('writes the anchor clamped inside the viewport', async () => {
    locateInfo.mockReturnValue({ x: 2, y: 240, name: 'Burrfleece', facts: 'Adult, Walking', detailed: true });
    store.info.value = { kind: 'being', id: '7' };
    render(<InfoCard store={store} actions={actions as unknown as ShellActions} />, host);
    // jsdom measures 0 x 0, so the left clamp is the margin (8px) and the top clamp is the margin plus the gap (20px).
    await vi.waitFor(() => {
      const card = host.querySelector<HTMLElement>('.info-card');
      expect(card?.style.getPropertyValue('--card-x')).toBe('8px');
      expect(card?.style.getPropertyValue('--card-y')).toBe('240px');
    });
  });

  it('is hidden while its target is off-screen, and shown again when it is back', async () => {
    locateInfo.mockReturnValue({ x: -40, y: 240, name: 'Burrfleece', facts: 'Adult, Walking', detailed: true });
    store.info.value = { kind: 'being', id: '7' };
    render(<InfoCard store={store} actions={actions as unknown as ShellActions} />, host);
    await settle();
    await vi.waitFor(() => {
      expect(host.querySelector('.info-card-off')).not.toBeNull();
    });
    locateInfo.mockReturnValue({ x: 120, y: 240, name: 'Burrfleece', facts: 'Adult, Walking', detailed: true });
    await settle();
    await vi.waitFor(() => {
      expect(host.querySelector('.info-card-off')).toBeNull();
    });
  });
});

describe('clampCardAnchor and onScreen', () => {
  const view = { w: 800, h: 600 };
  const card = { w: 260, h: 80 };

  it('leaves an anchor that already fits unchanged', () => {
    expect(clampCardAnchor({ x: 400, y: 300 }, card, view)).toEqual({ x: 400, y: 300 });
  });

  it('pulls the anchor in by half the card width on each side', () => {
    expect(clampCardAnchor({ x: 0, y: 300 }, card, view).x).toBe(8 + 130);
    expect(clampCardAnchor({ x: 2000, y: 300 }, card, view).x).toBe(800 - 8 - 130);
  });

  it('keeps the card clear of the top edge: its height and the gap sit above the anchor', () => {
    expect(clampCardAnchor({ x: 400, y: 10 }, card, view).y).toBe(8 + 80 + 12);
    expect(clampCardAnchor({ x: 400, y: 900 }, card, view).y).toBe(600 - 8);
  });

  it('lets the left edge win when the card is wider than the viewport', () => {
    expect(clampCardAnchor({ x: 100, y: 300 }, { w: 2000, h: 80 }, view).x).toBe(8 + 1000);
  });

  it('reports whether a screen point is inside the viewport', () => {
    expect(onScreen({ x: 0, y: 0 }, view)).toBe(true);
    expect(onScreen({ x: 801, y: 10 }, view)).toBe(false);
    expect(onScreen({ x: 10, y: -1 }, view)).toBe(false);
  });
});

describe('hamletFacts', () => {
  it('names the tier and the folk of a hamlet row', () => {
    expect(hamletFacts({ folk: 12 })).toBe('Hamlet, 12 folk');
    expect(hamletFacts({ tier: 'hamlet', folk: 12 })).toBe('Hamlet, 12 folk');
    expect(hamletFacts({ tier: 'town', folk: 40 })).toBe('Town, 40 folk');
  });
});
