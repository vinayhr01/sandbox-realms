/**
 * Atlas of baked creature frames (map-graphics, Task 7). A species' rig (art/rig.ts) is posed at each frame of each
 * (gait, mode) it can play, rasterised, and drawn into 2048 px pages. Each frame is kept at 128 px and at 48 px, on
 * separate page sets, each page mipmapped. Frames bake in idle callbacks, at most BUDGET_MS of work per callback.
 *
 * Uploads: a page is uploaded to the GPU at most once per FLUSH_INTERVAL_MS, or at once when the bake queue drains.
 * A frame is handed out (frame() / building()) only after the flush that uploads its page; until then the layer draws
 * its group silhouette.
 *
 * Decoding: a posed SVG is decoded as an <img> (img.decode()), not with createImageBitmap(Blob). Measured in headless
 * Chromium: createImageBitmap rejects an SVG blob (InvalidStateError), while <img>.decode() decodes it at 128 x 128.
 */
import { CanvasSource, Rectangle, Texture, type Renderer } from 'pixi.js';
import { SPECIES } from '../content/beasts.ts';
import { GAITS, SPECIES_GAIT, type GaitDef, type GaitId, type PoseMode, type SpeciesGait } from '../art/gaits.ts';
import { artFor, artForBuilding, chunkOf, loadArt } from '../art/load.ts';
import { parseRig, poseRig, type Rig } from '../art/rig.ts';
import { BeingState } from '../shared/being-feed.ts';
import { framesOf, gaitFor } from './anim.ts';
import type { FrameSource } from './creatures.ts';

export type FramePx = 48 | 128;
const SIZES: readonly FramePx[] = [128, 48];
const PAGE = 2048;
/** Transparent gutter around each frame, so mip levels do not bleed a neighbour's pixels in. */
const PAD = 2;
/** Most frames a (species, gait, mode) plays. Must cover the largest GAITS frame count (6). */
const MAX_FRAMES = 8;
const MODE_INDEX: Readonly<Record<PoseMode, number>> = { idle: 0, walk: 1, run: 2 };
const GAIT_IDS = Object.keys(GAITS) as GaitId[];
const BUDGET_MS = 4;
const MAX_INFLIGHT = 8;
/** Pages are uploaded at most this often while the bake queue has work left. */
const FLUSH_INTERVAL_MS = 100;
const IDLE_TIMEOUT_MS = 200;
const FALLBACK_DELAY_MS = 16;
const STATES = [BeingState.Idle, BeingState.Walk, BeingState.Run, BeingState.Swim, BeingState.Sleep, BeingState.Hit];

/** A frame's key: species index, gait, mode, frame and size, packed into one number. */
function cellKey(species: number, gait: GaitId, mode: PoseMode, frame: number, px: FramePx): number {
  const g = GAIT_IDS.indexOf(gait);
  return (((species * GAIT_IDS.length + g) * 3 + MODE_INDEX[mode]) * MAX_FRAMES + frame) * 2 + (px === 128 ? 1 : 0);
}

/** The (gait, mode) pairs a species can be drawn in: one per state, deduplicated. */
function bakePairs(sp: SpeciesGait): { gait: GaitId; mode: PoseMode }[] {
  const seen = new Map<string, { gait: GaitId; mode: PoseMode }>();
  for (const state of STATES) {
    const p = gaitFor(sp, state);
    seen.set(`${p.gait}:${p.mode}`, p);
  }
  return [...seen.values()];
}

type Target = { species: number; gait: GaitId; mode: PoseMode; frame: number } | { building: string };

/** One frame to rasterise: its rig (shared by a species' frames), the pose to set and where the result goes. */
interface Job {
  rig: Rig;
  gait: GaitDef;
  mode: PoseMode;
  phase: number;
  target: Target;
}

/** A frame drawn on a page but not yet uploaded: it is handed out by `apply` after the next flush. */
interface Pending {
  tex: Texture;
  apply: () => void;
}

/** A 2048 px canvas holding frames of one size, with its texture source. `next` is the next free slot. */
class Page {
  readonly canvas = document.createElement('canvas');
  readonly ctx: CanvasRenderingContext2D;
  readonly source: CanvasSource;
  next = 0;

  constructor() {
    this.canvas.width = PAGE;
    this.canvas.height = PAGE;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('atlas: no 2D context');
    ctx.imageSmoothingQuality = 'high';
    this.ctx = ctx;
    this.source = new CanvasSource({ resource: this.canvas, autoGenerateMipmaps: true, transparent: true });
  }

  /** Frees the GPU copy. The canvas is left to the garbage collector with the page. */
  destroy(): void {
    this.source.destroy();
  }
}

function slotOf(px: FramePx): { slot: number; cols: number; capacity: number } {
  const slot = px + 2 * PAD;
  const cols = Math.floor(PAGE / slot);
  return { slot, cols, capacity: cols * cols };
}

/** Decodes an SVG source as an <img> (see the module comment). The object URL is revoked once decoded. */
function decodeSvg(svg: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const img = new Image();
  img.src = url;
  return img.decode().then(() => img).finally(() => URL.revokeObjectURL(url));
}

function defaultSchedule(work: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(work, { timeout: IDLE_TIMEOUT_MS });
  else setTimeout(work, FALLBACK_DELAY_MS);
}

function parseOrWarn(svg: string, id: string): Rig | null {
  try {
    return parseRig(svg);
  } catch (err) {
    console.warn(`atlas: ${id} art rejected`, err);
    return null;
  }
}

/** Test seams: the decoder, the clock and the idle scheduler. The defaults are the browser's. */
export interface AtlasOptions {
  decode?: (svg: string) => Promise<HTMLImageElement>;
  now?: () => number;
  schedule?: (work: () => void) => void;
}

export class Atlas implements FrameSource {
  private readonly pages = new Map<FramePx, Page[]>();
  private readonly cells = new Map<number, Texture>();
  private readonly buildingCells = new Map<string, Texture>();
  private readonly pending: Pending[] = [];
  private readonly requestedSpecies = new Set<number>();
  private readonly requestedBuildings = new Set<string>();
  private readonly queue: Job[] = [];
  private readonly ready: { job: Job; img: HTMLImageElement }[] = [];
  private readonly dirty = new Set<Page>();
  private readonly decodeSvg: (svg: string) => Promise<HTMLImageElement>;
  private readonly now: () => number;
  private readonly schedule: (work: () => void) => void;
  private inflight = 0;
  /** Bumped by rebuild: decodes started before it are dropped when they land. */
  private gen = 0;
  private scheduled = false;
  private lastFlush = Number.NEGATIVE_INFINITY;

  constructor(renderer: Renderer, opts: AtlasOptions = {}) {
    this.decodeSvg = opts.decode ?? decodeSvg;
    this.now = opts.now ?? (() => performance.now());
    this.schedule = opts.schedule ?? defaultSchedule;
    renderer.canvas.addEventListener('webglcontextrestored', () => this.rebuild());
  }

  /** Queues the bake of a species' frames. Idempotent; the art is loaded first when its chunk has not loaded. */
  request(species: number): void {
    if (this.requestedSpecies.has(species)) return;
    this.requestedSpecies.add(species);
    this.startSpecies(species);
  }

  /** Queues the bake of a building's still frame (buildings have no gait). Idempotent. */
  requestBuilding(kind: string): void {
    if (this.requestedBuildings.has(kind)) return;
    this.requestedBuildings.add(kind);
    this.startBuilding(kind);
  }

  frame(species: number, gait: string, mode: PoseMode, frameIndex: number, px: FramePx): Texture | null {
    if (!GAIT_IDS.includes(gait as GaitId) || frameIndex < 0 || frameIndex >= MAX_FRAMES) return null;
    return this.cells.get(cellKey(species, gait as GaitId, mode, frameIndex, px)) ?? null;
  }

  /** The baked still of a building kind, or null until it is baked and uploaded. */
  building(kind: string, px: FramePx): Texture | null {
    return this.buildingCells.get(`${kind}|${px}`) ?? null;
  }

  /**
   * Drops every page and every frame texture, then queues every species and building requested so far. Called on
   * webglcontextrestored. The old textures are destroyed (a texture registers with its page source, so an undestroyed
   * one would be kept alive by the source) and the old pages' sources are destroyed; new frames start on new pages.
   */
  rebuild(): void {
    this.gen++;
    this.queue.length = 0;
    this.ready.length = 0;
    for (const t of this.cells.values()) t.destroy();
    for (const t of this.buildingCells.values()) t.destroy();
    for (const p of this.pending) p.tex.destroy();
    this.cells.clear();
    this.buildingCells.clear();
    this.pending.length = 0;
    this.dirty.clear();
    for (const list of this.pages.values()) for (const page of list) page.destroy();
    this.pages.clear();
    for (const species of this.requestedSpecies) this.startSpecies(species);
    for (const kind of this.requestedBuildings) this.startBuilding(kind);
    this.kick();
  }

  private startSpecies(species: number): void {
    const id = SPECIES[species]?.id;
    if (id === undefined) return;
    const gen = this.gen;
    if (artFor(id) !== null) {
      this.bakeSpecies(species, id);
      return;
    }
    loadArt(chunkOf(id)).then(
      () => {
        if (gen === this.gen) this.bakeSpecies(species, id);
      },
      () => {
        this.requestedSpecies.delete(species);
      },
    );
  }

  private startBuilding(kind: string): void {
    const gen = this.gen;
    if (artForBuilding(kind) !== null) {
      this.bakeBuilding(kind);
      return;
    }
    loadArt('buildings').then(
      () => {
        if (gen === this.gen) this.bakeBuilding(kind);
      },
      () => {
        this.requestedBuildings.delete(kind);
      },
    );
  }

  private bakeSpecies(species: number, id: string): void {
    const svg = artFor(id);
    const sp = SPECIES_GAIT[id];
    if (svg === null || !sp) return;
    const rig = parseOrWarn(svg, id);
    if (!rig) return;
    for (const { gait, mode } of bakePairs(sp)) {
      const n = framesOf(gait, mode);
      for (let frame = 0; frame < n; frame++) {
        // The middle of each frame's slice of the stride, so frameIndex(phase, n) lands on `frame`.
        this.queue.push({ rig, gait: GAITS[gait], mode, phase: (frame + 0.5) / n, target: { species, gait, mode, frame } });
      }
    }
    this.kick();
  }

  private bakeBuilding(kind: string): void {
    const svg = artForBuilding(kind);
    if (svg === null) return;
    const rig = parseOrWarn(svg, kind);
    if (!rig) return;
    this.queue.push({ rig, gait: GAITS.static, mode: 'idle', phase: 0, target: { building: kind } });
    this.kick();
  }

  private kick(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    this.schedule(this.work);
  }

  /**
   * One idle callback: place decoded frames and start decodes for at most BUDGET_MS, then upload the dirty pages if
   * they are due. While uploads are waiting for their interval, the callback keeps itself scheduled.
   */
  private readonly work = (): void => {
    this.scheduled = false;
    const t0 = this.now();
    for (;;) {
      const done = this.ready.shift();
      if (done) {
        this.place(done.job, done.img);
      } else if (this.queue.length > 0 && this.inflight < MAX_INFLIGHT) {
        const job = this.queue.shift();
        if (job) this.startDecode(job);
      } else {
        break;
      }
      if (this.now() - t0 >= BUDGET_MS) break;
    }
    this.flushIfDue();
    if (this.ready.length > 0 || (this.queue.length > 0 && this.inflight < MAX_INFLIGHT) || this.pending.length > 0) this.kick();
  };

  /**
   * Uploads the dirty pages and hands out their pending frames. Due when the last upload was FLUSH_INTERVAL_MS ago, or at
   * once when the bake has drained (nothing queued, decoding or ready).
   */
  private flushIfDue(): void {
    if (this.dirty.size === 0) return;
    const drained = this.queue.length === 0 && this.inflight === 0 && this.ready.length === 0;
    const t = this.now();
    if (!drained && t - this.lastFlush < FLUSH_INTERVAL_MS) return;
    for (const page of this.dirty) page.source.update();
    this.dirty.clear();
    for (const p of this.pending.splice(0)) p.apply();
    this.lastFlush = t;
  }

  private startDecode(job: Job): void {
    const gen = this.gen;
    this.inflight++;
    const svg = poseRig(job.rig, job.gait, job.phase, job.mode);
    this.decodeSvg(svg)
      .then(
        (img) => {
          if (gen === this.gen) this.ready.push({ job, img });
        },
        (err: unknown) => {
          console.warn('atlas: frame not decoded', err);
        },
      )
      .finally(() => {
        this.inflight--;
        this.kick();
      });
  }

  /** Draws a decoded frame into a free slot of the 128 px page set and of the 48 px page set. */
  private place(job: Job, img: HTMLImageElement): void {
    for (const px of SIZES) {
      const { page, x, y } = this.alloc(px);
      page.ctx.drawImage(img, x, y, px, px);
      const tex = new Texture({ source: page.source, frame: new Rectangle(x, y, px, px) });
      const t = job.target;
      if ('building' in t) {
        const key = `${t.building}|${px}`;
        this.pending.push({ tex, apply: () => this.buildingCells.set(key, tex) });
      } else {
        const key = cellKey(t.species, t.gait, t.mode, t.frame, px);
        this.pending.push({ tex, apply: () => this.cells.set(key, tex) });
      }
      this.dirty.add(page);
    }
  }

  /** The next free slot of the newest page of this size; a full page (or none) is followed by a new one. */
  private alloc(px: FramePx): { page: Page; x: number; y: number } {
    const list = this.pages.get(px) ?? [];
    this.pages.set(px, list);
    const { slot, cols, capacity } = slotOf(px);
    let page = list[list.length - 1];
    if (!page || page.next >= capacity) {
      page = new Page();
      list.push(page);
    }
    const i = page.next++;
    return { page, x: (i % cols) * slot + PAD, y: Math.floor(i / cols) * slot + PAD };
  }
}
