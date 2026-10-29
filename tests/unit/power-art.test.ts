// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { POWER_BY_ID, type PowerDef } from '../../src/content/powers.ts';
import { powerArtFor, powerArtGroup } from '../../src/art/load.ts';
import { PowerSheet } from '../../src/ui/shell/PowerSheet.tsx';
import { createStore, type ShellActions, type UiStore } from '../../src/ui/shell/store.ts';

// Stubbed groups: land and nature always load; weather fails to import while the flag is set (an offline download).
const flags = vi.hoisted(() => ({ weatherFail: false }));
const RAISE_SVG = '<svg id="shape_raise"></svg>';
const IDEA_SVG = '<svg id="lm_idea_seed"></svg>';
const RAIN_SVG = '<svg id="sky_rain"></svg>';

vi.mock('../../src/art/powers/land/index.ts', () => ({ ART: { shape_raise: RAISE_SVG } }));
vi.mock('../../src/art/powers/nature/index.ts', () => ({ ART: { lm_idea_seed: IDEA_SVG } }));
vi.mock('../../src/art/powers/weather/index.ts', () => {
  if (flags.weatherFail) throw new Error('offline');
  return { ART: { sky_rain: RAIN_SVG } };
});

/** Preact renders and runs effects on a later task: a few macrotask turns let the chunk imports settle. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function power(id: string): PowerDef {
  const p = POWER_BY_ID.get(id);
  if (p === undefined) throw new Error(`no power ${id}`);
  return p;
}

describe('powerArtGroup', () => {
  it('maps a Land paint to land, Inspect to land, and a Realm power to world', () => {
    expect(powerArtGroup(power('shape_raise'))).toBe('land');
    expect(powerArtGroup(power('ins_inspect'))).toBe('land');
    expect(powerArtGroup(power('realm_pause'))).toBe('world');
  });
});

describe('power art loading', () => {
  it('returns null before its group has loaded, and the art after', async () => {
    // A fresh module instance, so no earlier test's load can have filled the cache first.
    vi.resetModules();
    const fresh = await import('../../src/art/load.ts');
    expect(fresh.powerArtFor(power('shape_raise'))).toBeNull();
    await fresh.loadPowerArt('land');
    expect(fresh.powerArtFor(power('shape_raise'))).toBe(RAISE_SVG);
  });

  it('leaves the glyph in place when a group import fails, and a second load retries', async () => {
    vi.resetModules();
    const fresh = await import('../../src/art/load.ts');
    const rain = power('sky_rain');
    flags.weatherFail = true;
    await expect(fresh.loadPowerArt('weather')).rejects.toThrow();
    expect(fresh.powerArtFor(rain)).toBeNull();
    flags.weatherFail = false;
    await expect(fresh.loadPowerArt('weather')).resolves.toEqual({ sky_rain: RAIN_SVG });
    expect(fresh.powerArtFor(rain)).toBe(RAIN_SVG);
  });
});

describe('PowerSheet power art', () => {
  let host: HTMLElement;
  let store: UiStore;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    store = createStore();
  });

  afterEach(() => {
    render(null, host);
    host.remove();
  });

  it('shows the glyph first, then swaps in the art of every category in a mixed search result', async () => {
    store.sheet.value = 'expanded';
    const actions = { activatePower: vi.fn(), disarm: vi.fn(), setBrushSize: vi.fn(), setBrushShape: vi.fn() };
    render(h(PowerSheet, { store, actions: actions as unknown as ShellActions }), host);
    const search = host.querySelector<HTMLInputElement>('input[type="search"]');
    if (!search) throw new Error('no search box');
    // "i" matches Raise (land), Idea Seed (nature) and Rain (weather).
    search.value = 'i';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    for (const id of ['shape_raise', 'lm_idea_seed', 'sky_rain']) {
      const button = host.querySelector(`button[data-power-id="${id}"]`);
      expect(button, id).not.toBeNull();
      expect(button?.querySelector('img.power-art'), id).not.toBeNull();
    }
  });

  it('keeps the glyph for a power whose group is not loaded', async () => {
    store.sheet.value = 'expanded';
    const actions = { activatePower: vi.fn(), disarm: vi.fn(), setBrushSize: vi.fn(), setBrushShape: vi.fn() };
    render(h(PowerSheet, { store, actions: actions as unknown as ShellActions }), host);
    // Realm powers are in the world group, which is not stubbed: they keep the glyph.
    const search = host.querySelector<HTMLInputElement>('input[type="search"]');
    if (!search) throw new Error('no search box');
    search.value = 'pause';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    const button = host.querySelector('button[data-power-id="realm_pause"]');
    expect(button?.querySelector('.glyph')).not.toBeNull();
    expect(button?.querySelector('img.power-art')).toBeNull();
    expect(powerArtFor(power('realm_pause'))).toBeNull();
  });
});
