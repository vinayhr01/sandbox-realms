// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { TopPills } from '../../src/ui/shell/TopPills.tsx';
import { createStore, type ShellActions, type UiStore } from '../../src/ui/shell/store.ts';

type Spy = ReturnType<typeof vi.fn>;

/** Preact renders signal changes on a microtask. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function button(root: HTMLElement, name: string): HTMLButtonElement {
  const el = root.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  if (!el) throw new Error(`no button named ${name}`);
  return el;
}

describe('TopPills', () => {
  let host: HTMLElement;
  let store: UiStore;
  let actions: { setSpeed: Spy; togglePause: Spy; activatePower: Spy; openWindow: Spy; disarm: Spy; setBrushSize: Spy; setBrushShape: Spy };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore();
    store.realm.value = { name: 'Realm 16', year: 3, month: 4, creatures: 142, hamlets: 2 };
    actions = { setSpeed: vi.fn(), togglePause: vi.fn(), activatePower: vi.fn(), openWindow: vi.fn(), disarm: vi.fn(), setBrushSize: vi.fn(), setBrushShape: vi.fn() };
    render(<TopPills store={store} actions={actions as unknown as ShellActions} />, host);
  });

  afterEach(() => {
    render(null, host);
    host.remove();
  });

  it('shows the realm name, the year and the creature and hamlet counts', () => {
    expect(host.querySelector('#realm-name')?.textContent).toBe('Realm 16');
    expect(host.textContent).toContain('Year 3');
    expect(host.textContent).toContain('142 creatures');
    expect(host.textContent).toContain('2 hamlets');
  });

  it('the realm pill pulses once when a rule switch changes, and the pulse ends', async () => {
    const pill = () => host.querySelector<HTMLButtonElement>('.realm-pill');
    expect(pill()?.classList.contains('is-pulsing')).toBe(false);
    store.rulePulses.value += 1;
    await tick();
    expect(pill()?.classList.contains('is-pulsing')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(pill()?.classList.contains('is-pulsing')).toBe(false);
  });

  it('no pulse under reduced motion', async () => {
    document.documentElement.setAttribute('data-reduce-motion', '');
    try {
      store.rulePulses.value += 1;
      await tick();
      expect(host.querySelector('.realm-pill')?.classList.contains('is-pulsing')).toBe(false);
    } finally {
      document.documentElement.removeAttribute('data-reduce-motion');
    }
  });

  it('clicking x5 sets speed 5', () => {
    button(host, 'x5').click();
    expect(actions.setSpeed).toHaveBeenCalledWith(5);
  });

  it('clicking Pause calls togglePause, and the button then offers Resume', async () => {
    button(host, 'Pause').click();
    expect(actions.togglePause).toHaveBeenCalledTimes(1);
    store.paused.value = true;
    await tick();
    expect(button(host, 'Resume').getAttribute('aria-pressed')).toBe('true');
  });

  it('marks the current speed as pressed, and none while paused', async () => {
    expect(button(host, 'x1').getAttribute('aria-pressed')).toBe('true');
    expect(button(host, 'x5').getAttribute('aria-pressed')).toBe('false');
    store.paused.value = true;
    await tick();
    expect(button(host, 'x1').getAttribute('aria-pressed')).toBe('false');
  });
});
