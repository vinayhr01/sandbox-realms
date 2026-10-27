// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Atlas } from '../../src/render/atlas.ts';
import { CanvasSource, Texture, type Renderer } from 'pixi.js';

// Pixi probes for canvas support when it is imported; jsdom has no canvas, so it logs "not implemented". The probe
// needs no context, so a null context stands in for it here (hoisted above the imports).
vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

// Every species and building gets this one-part rig, so each species bakes its frames without real art.
vi.mock('../../src/art/load.ts', () => ({
  artFor: () =>
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><g id="leg-fl" data-pivot="40 80"><rect x="36" y="80" width="7" height="24"/></g></svg>',
  artForBuilding: () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect x="0" y="0" width="128" height="128"/></svg>',
  chunkOf: () => 'beast',
  loadArt: () => Promise.resolve({}),
}));

/** The atlas internals the tests read and drive. */
interface Internals {
  pages: Map<number, { next: number; source: CanvasSource }[]>;
  cells: Map<number, Texture>;
  buildingCells: Map<string, Texture>;
  pending: unknown[];
  queue: unknown[];
  ready: unknown[];
  inflight: number;
  work: () => void;
}

const internals = (a: Atlas): Internals => a as unknown as Internals;
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const renderer = { canvas: new EventTarget() } as unknown as Renderer;
const SLOTS_PER_128_PAGE = 225;

/** A decoder that resolves at once. */
const immediate = (): Promise<HTMLImageElement> => Promise.resolve({} as HTMLImageElement);

/** A decoder whose results the test releases in batches. */
function manualDecode() {
  const waiting: (() => void)[] = [];
  const decode = (): Promise<HTMLImageElement> =>
    new Promise((resolve) => {
      waiting.push(() => resolve({} as HTMLImageElement));
    });
  return {
    decode,
    release(n: number): void {
      for (const f of waiting.splice(0, n)) f();
    },
  };
}

/** Runs idle callbacks until nothing is queued, decoding or ready. */
async function drain(atlas: Atlas): Promise<void> {
  const a = internals(atlas);
  for (let i = 0; i < 5000; i++) {
    await tick();
    a.work();
    if (a.queue.length === 0 && a.inflight === 0 && a.ready.length === 0) return;
  }
  throw new Error('atlas did not drain');
}

function requestSpecies(atlas: Atlas, count: number): void {
  for (let s = 0; s < count; s++) atlas.request(s);
}

const originalCreate = document.createElement.bind(document);

/** A canvas stand-in: a 2D context that records calls, enough for a page. */
function fakeCanvas(): HTMLCanvasElement {
  const ctx = { clearRect: vi.fn(), drawImage: vi.fn(), imageSmoothingQuality: 'low' };
  return { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
}

beforeEach(() => {
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
    tag === 'canvas' ? fakeCanvas() : originalCreate(tag)) as typeof document.createElement);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Atlas pages', () => {
  it('fills page 0 before it opens page 1', async () => {
    const atlas = new Atlas(renderer, { decode: immediate, now: () => 0, schedule: () => {} });
    requestSpecies(atlas, 40);
    await drain(atlas);
    const pages = internals(atlas).pages.get(128) ?? [];
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(pages[0]?.next).toBe(SLOTS_PER_128_PAGE);
  });

  it('after rebuild drops the old pages, destroys every old texture, and reuses no slots', async () => {
    const atlas = new Atlas(renderer, { decode: immediate, now: () => 0, schedule: () => {} });
    requestSpecies(atlas, 40);
    await drain(atlas);
    const a = internals(atlas);
    const pagesBefore = a.pages.get(128)?.length ?? 0;
    const pagesTotalBefore = [...a.pages.values()].reduce((n, list) => n + list.length, 0);
    const texturesBefore = a.cells.size + a.buildingCells.size + a.pending.length;
    const destroy = vi.spyOn(Texture.prototype, 'destroy');
    const pageDestroy = vi.spyOn(CanvasSource.prototype, 'destroy');

    atlas.rebuild();
    expect(a.pages.size).toBe(0);
    expect(destroy).toHaveBeenCalledTimes(texturesBefore);
    expect(pageDestroy).toHaveBeenCalledTimes(pagesTotalBefore);

    await drain(atlas);
    const pagesAfter = a.pages.get(128) ?? [];
    expect(pagesAfter.length).toBe(pagesBefore);
    expect(pagesAfter[0]?.next).toBe(SLOTS_PER_128_PAGE);
    // The first frame of the new bake starts at the first slot of a new page, not after the old ones.
    const firstCell = [...a.cells.values()].find((t) => t.frame.x === 2 && t.frame.y === 2);
    expect(firstCell).toBeDefined();
  });

  it('coalesces uploads: a second idle callback within 100 ms uploads nothing', async () => {
    const m = manualDecode();
    let clock = 0;
    const atlas = new Atlas(renderer, { decode: m.decode, now: () => clock, schedule: () => {} });
    const a = internals(atlas);
    const update = vi.spyOn(CanvasSource.prototype, 'update');
    requestSpecies(atlas, 40);

    // Callback 1 at t=0: eight frames decode and place, the queue is not drained, so the first upload is due at once.
    a.work();
    m.release(8);
    await tick();
    a.work();
    const uploadsAfterFirst = update.mock.calls.length;
    expect(uploadsAfterFirst).toBeGreaterThan(0);
    const liveAfterFirst = a.cells.size;
    expect(liveAfterFirst).toBeGreaterThan(0);

    // Callback 2 at t=30: eight more frames are placed but the upload waits for its 100 ms interval.
    clock = 30;
    m.release(8);
    await tick();
    a.work();
    expect(a.queue.length).toBeGreaterThan(0);
    expect(update.mock.calls.length).toBe(uploadsAfterFirst);
    expect(a.cells.size).toBe(liveAfterFirst);
    expect(a.pending.length).toBeGreaterThan(0);

    // At t=120 the interval has passed and the waiting frames go up.
    clock = 120;
    a.work();
    expect(update.mock.calls.length).toBeGreaterThan(uploadsAfterFirst);
    expect(a.cells.size).toBeGreaterThan(liveAfterFirst);
  });
});
