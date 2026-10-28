// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Atlas } from '../../src/render/atlas.ts';
import type { Texture, Renderer } from 'pixi.js';

vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

const RIG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><g id="leg-fl" data-pivot="40 80"><rect x="36" y="80" width="7" height="24"/></g></svg>';

/** What the mocked art module does: set by each test. */
const art = vi.hoisted(() => ({ loaded: false, loadCalls: 0, loadFails: true }));

vi.mock('../../src/art/load.ts', () => ({
  artFor: () => (art.loaded ? RIG : null),
  artForBuilding: () => RIG,
  chunkOf: () => 'beast',
  loadArt: () => {
    art.loadCalls++;
    if (art.loadFails) return Promise.reject(new Error('chunk failed'));
    art.loaded = true;
    return Promise.resolve({});
  },
}));

interface Internals {
  cells: Map<number, Texture>;
  buildingCells: Map<string, Texture>;
  queue: unknown[];
  ready: unknown[];
  inflight: number;
  work: () => void;
}
const internals = (a: Atlas): Internals => a as unknown as Internals;
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const renderer = { canvas: new EventTarget() } as unknown as Renderer;
const immediate = (): Promise<HTMLImageElement> => Promise.resolve({} as HTMLImageElement);

async function drain(atlas: Atlas): Promise<void> {
  const a = internals(atlas);
  for (let i = 0; i < 5000; i++) {
    await tick();
    a.work();
    if (a.queue.length === 0 && a.inflight === 0 && a.ready.length === 0) return;
  }
  throw new Error('atlas did not drain');
}

const originalCreate = document.createElement.bind(document);

beforeEach(() => {
  art.loaded = false;
  art.loadCalls = 0;
  art.loadFails = true;
  const ctx = { clearRect: vi.fn(), drawImage: vi.fn(), imageSmoothingQuality: 'low' };
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
    tag === 'canvas' ? ({ width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement) : originalCreate(tag)) as typeof document.createElement);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a failed art chunk load', () => {
  it('is not retried by later requests, only by a rebuild', async () => {
    const atlas = new Atlas(renderer, { decode: immediate, now: () => 0, schedule: () => {} });
    atlas.request(2);
    await tick();
    expect(art.loadCalls).toBe(1);
    // A draw asks again every frame: the species is still marked requested, so nothing loads again.
    for (let i = 0; i < 20; i++) atlas.request(2);
    await tick();
    expect(art.loadCalls).toBe(1);

    // A rebuild (context restored) retries, and a chunk that loads this time bakes.
    art.loadFails = false;
    atlas.rebuild();
    await drain(atlas);
    expect(art.loadCalls).toBe(2);
    expect(internals(atlas).cells.size).toBeGreaterThan(0);
  });
});

describe('bake warnings', () => {
  it('warn once per species whatever the number of frames that fail to decode', async () => {
    art.loaded = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const atlas = new Atlas(renderer, { decode: () => Promise.reject(new Error('decode')), now: () => 0, schedule: () => {} });
    atlas.request(0);
    atlas.request(1);
    await drain(atlas);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('building stills', () => {
  it('bake at 48 px and 128 px (buildings are drawn at world scale)', async () => {
    const atlas = new Atlas(renderer, { decode: immediate, now: () => 0, schedule: () => {} });
    atlas.requestBuilding('granary');
    await drain(atlas);
    const keys = [...internals(atlas).buildingCells.keys()];
    expect(keys.sort()).toEqual(['granary|128', 'granary|48']);
    expect(atlas.building('granary', 128)).not.toBeNull();
    expect(atlas.building('granary', 48)).not.toBeNull();
  });
});
