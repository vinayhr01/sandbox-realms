/**
 * The baking core of the atlas of creature frames (map-graphics, Task 7). A species' rig (art/rig.ts) is posed at
 * each frame of each (gait, mode) it can play, rasterised, and drawn into 2048 px pages, on separate page sets for 48 px and
 * 128 px frames, each page mipmapped. A species' 48 px set is baked as soon as it is requested; the 128 px frames of one
 * (species, gait, mode) only when frame(..., 128) is first asked for them (a close zoom), and until they are uploaded that
 * call returns the 48 px frame. Building stills are baked at both sizes. Frames bake in idle callbacks, at most BUDGET_MS of
 * work per callback.
 *
 * Uploads: a page is uploaded at most once per FLUSH_INTERVAL_MS, or at once when the bake queue drains. A frame is handed
 * out (frame() / building()) only after the flush that uploads its page; until then the layer draws its group silhouette.
 *
 * Decoding: a posed SVG is decoded as an <img> (img.decode()), not with createImageBitmap(Blob). Measured in headless
 * Chromium: createImageBitmap rejects an SVG blob (InvalidStateError), while <img>.decode() decodes it at 128 x 128.
 *
 * This module imports no renderer. A frame's stored value is the type parameter T: the 2D atlas (atlas.ts) stores a renderer-specific
 * Texture by overriding the texture hooks; the 3D view (beings3d.ts) uses AtlasCore with no texture and reads page rects.
 */
import { SPECIES } from '../content/beasts.ts';
import { GAITS, SPECIES_GAIT, type GaitDef, type GaitId, type PoseMode, type SpeciesGait } from '../art/gaits.ts';
import { artFor, artForBuilding, chunkOf, loadArt } from '../art/load.ts';
import { parseRig, poseRig, type Rig } from '../art/rig.ts';
import { BeingState } from '../shared/being-feed.ts';
import { framesOf, gaitFor } from './anim.ts';

export type FramePx = 48 | 128;
/** A species is baked at 48 px up front; its 128 px frames are baked on demand (see frame()). */
const BASE_SIZES: readonly FramePx[] = [48];
const FULL_SIZES: readonly FramePx[] = [128];
/** Buildings are drawn at world scale, so a still is baked at both sizes. */
const BUILDING_SIZES: readonly FramePx[] = [48, 128];
const PAGE = 2048;
/** Transparent gutter around each frame, so mip levels do not bleed a neighbour's pixels in. */
const PAD = 2;
/** Most frames a (species, gait, mode) plays. Must cover the largest GAITS frame count (6). */
const MAX_FRAMES = 8;
const MODE_INDEX: Readonly<Record<PoseMode, number>> = { idle: 0, walk: 1, run: 2 };
const GAIT_IDS = Object.keys(GAITS) as GaitId[];
const GAIT_INDEX: ReadonlyMap<string, number> = new Map(GAIT_IDS.map((g, i) => [g, i]));
const BUDGET_MS = 4;
const MAX_INFLIGHT = 8;
/** Pages are uploaded at most this often while the bake queue has work left. */
const FLUSH_INTERVAL_MS = 100;
const IDLE_TIMEOUT_MS = 200;
const FALLBACK_DELAY_MS = 16;
const STATES = [BeingState.Idle, BeingState.Walk, BeingState.Run, BeingState.Swim, BeingState.Sleep, BeingState.Hit];

/** A frame's key: species index, gait, mode, frame and size, packed into one number. */
function cellKey(species: number, gait: GaitId, mode: PoseMode, frame: number, px: FramePx): number {
  return (((species * GAIT_IDS.length + GAIT_INDEX.get(gait)!) * 3 + MODE_INDEX[mode]) * MAX_FRAMES + frame) * 2 + (px === 128 ? 1 : 0);
}

/** The (gait, mode) pairs a species can be drawn in: one per state, plus the fast walk's run cycle, deduplicated. */
function bakePairs(sp: SpeciesGait): { gait: GaitId; mode: PoseMode }[] {
  const seen = new Map<string, { gait: GaitId; mode: PoseMode }>();
  for (const state of STATES) {
    for (const fast of [false, true]) {
      const p = gaitFor(sp, state, fast);
      seen.set(`${p.gait}:${p.mode}`, p);
    }
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
  /** The frame sizes this job draws. */
  sizes: readonly FramePx[];
}

/** A frame drawn on a page but not yet uploaded: it is handed out by `apply` after the next flush. */
interface Pending<T> {
  tex: T;
  apply: () => void;
}

/**
 * Where a baked frame sits on its page, for renderers that keep no texture (the 3D view). `page` is the page
 * canvas (the one onPageFlush reports); the UVs are in [0, 1] with v0 at the top, as the canvas is drawn.
 */
export interface AtlasRect {
  page: HTMLCanvasElement;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** A 2048 px canvas holding frames of one size. `next` is the next free slot. */
export class Page {
  readonly canvas = document.createElement('canvas');
  readonly ctx: CanvasRenderingContext2D;
  next = 0;

  constructor() {
    this.canvas.width = PAGE;
    this.canvas.height = PAGE;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('atlas: no 2D context');
    ctx.imageSmoothingQuality = 'high';
    this.ctx = ctx;
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


/** Test seams: the decoder, the clock and the idle scheduler. The defaults are the browser's. */
export interface AtlasOptions {
  decode?: (svg: string) => Promise<HTMLImageElement>;
  now?: () => number;
  schedule?: (work: () => void) => void;
}

/**
 * The baking core. `T` is what a renderer keeps per frame (a texture for the 2D atlas); the default null is for a renderer
 * that reads the page rects only. Subclasses override the texture and page hooks below; the base versions do nothing.
 */
export class AtlasCore<T = null> {
  private readonly pages = new Map<FramePx, Page[]>();
  private readonly cells = new Map<number, T>();
  private readonly buildingCells = new Map<string, T>();
  /** The page rects of the same frames as `cells` and `buildingCells`, set on the same flush (frameRect, buildingRect). */
  private readonly rects = new Map<number, AtlasRect>();
  private readonly buildingRects = new Map<string, AtlasRect>();
  private readonly flushListeners: Array<(page: HTMLCanvasElement) => void> = [];
  private readonly pending: Pending<T>[] = [];
  private readonly requestedSpecies = new Set<number>();
  private readonly requestedBuildings = new Set<string>();
  /** The parsed rig of each baked species, so a 128 px set can be queued later without parsing again. */
  private readonly rigs = new Map<number, Rig>();
  /** (species, gait, mode) triples whose 128 px frames were asked for, keyed by the 128 px key of frame 0. */
  private readonly wanted128 = new Map<number, { species: number; gait: GaitId; mode: PoseMode }>();
  private readonly queue: Job[] = [];
  private readonly ready: { job: Job; img: HTMLImageElement }[] = [];
  private readonly dirty = new Set<Page>();
  /** Species ids and building kinds already warned about: a failing species warns once, not once per frame or rebuild. */
  private readonly warned = new Set<string>();
  private readonly decodeSvg: (svg: string) => Promise<HTMLImageElement>;
  private readonly now: () => number;
  private readonly schedule: (work: () => void) => void;
  private inflight = 0;
  /** Bumped by rebuild and dispose: loads and decodes started before it are dropped when they land. */
  private gen = 0;
  private disposed = false;
  /** Context restores handled so far. */
  private rebuilds = 0;
  private scheduled = false;
  private lastFlush = Number.NEGATIVE_INFINITY;

  /** Only the canvas is read: the 3D view passes its own canvas, the 2D view its renderer. */
  constructor(renderer: { readonly canvas: HTMLCanvasElement }, opts: AtlasOptions = {}) {
    this.decodeSvg = opts.decode ?? decodeSvg;
    this.now = opts.now ?? (() => performance.now());
    this.schedule = opts.schedule ?? defaultSchedule;
    renderer.canvas.addEventListener('webglcontextrestored', () => this.rebuild());
  }

  /** The texture of a frame drawn at (x, y) on `page`, made when it is placed. The base class stores nothing. */
  protected makeTexture(_page: Page, _x: number, _y: number, _px: FramePx): T {
    return null as T;
  }

  /** Frees a stored texture (on rebuild). The base class has none to free. */
  protected destroyTexture(_tex: T): void {}

  /** Uploads a page whose canvas changed, before the flush listeners run. The base class has no GPU copy. */
  protected uploadPage(_page: Page): void {}

  /** Frees a page's GPU copy (on rebuild). The base class has none to free. */
  protected destroyPage(_page: Page): void {}

  /** Queues the bake of a species' frames. Idempotent; the art is loaded first when its chunk has not loaded. */
  request(species: number): void {
    if (this.disposed || this.requestedSpecies.has(species)) return;
    this.requestedSpecies.add(species);
    this.startSpecies(species);
  }

  /** Queues the bake of a building's still frame (buildings have no gait). Idempotent. */
  requestBuilding(kind: string): void {
    if (this.disposed || this.requestedBuildings.has(kind)) return;
    this.requestedBuildings.add(kind);
    this.startBuilding(kind);
  }

  /**
   * The baked frame, or null until it is uploaded. The first ask for a 128 px frame queues the bake of that (species, gait,
   * mode)'s 128 px set; until it is uploaded the 48 px frame stands in, so a close zoom shows no flash of silhouette.
   */
  frame(species: number, gait: string, mode: PoseMode, frameIndex: number, px: FramePx): T | null {
    if (!GAIT_INDEX.has(gait) || frameIndex < 0 || frameIndex >= MAX_FRAMES) return null;
    const g = gait as GaitId;
    if (px === 128) {
      const full = this.cells.get(cellKey(species, g, mode, frameIndex, 128));
      if (full) return full;
      this.want128(species, g, mode);
    }
    return this.cells.get(cellKey(species, g, mode, frameIndex, 48)) ?? null;
  }

  /** The baked still of a building kind, or null until it is baked and uploaded. A 128 px still falls back to the 48 px one. */
  building(kind: string, px: FramePx): T | null {
    return this.buildingCells.get(`${kind}|${px}`) ?? (px === 128 ? (this.buildingCells.get(`${kind}|48`) ?? null) : null);
  }

  /**
   * frame() for renderers without a texture: the frame's page rect, or null until its page is flushed. The same 128 px to 48 px
   * fallback and the same first-ask bake as frame().
   */
  frameRect(species: number, gait: string, mode: PoseMode, frameIndex: number, px: FramePx): AtlasRect | null {
    if (!GAIT_INDEX.has(gait) || frameIndex < 0 || frameIndex >= MAX_FRAMES) return null;
    const g = gait as GaitId;
    if (px === 128) {
      const full = this.rects.get(cellKey(species, g, mode, frameIndex, 128));
      if (full) return full;
      this.want128(species, g, mode);
    }
    return this.rects.get(cellKey(species, g, mode, frameIndex, 48)) ?? null;
  }

  /** building() for renderers without a texture: the still's page rect, or null until it is flushed. 128 px falls back to 48 px. */
  buildingRect(kind: string, px: FramePx): AtlasRect | null {
    return this.buildingRects.get(`${kind}|${px}`) ?? (px === 128 ? (this.buildingRects.get(`${kind}|48`) ?? null) : null);
  }

  /** Calls `cb` with each page canvas after its upload (a renderer that copies pages to the GPU sets its texture stale here). */
  onPageFlush(cb: (page: HTMLCanvasElement) => void): void {
    this.flushListeners.push(cb);
  }

  /** Pages per frame size and frames held, for the memory estimate (a page is 2048 x 2048 RGBA with mips, about 22 MB). */
  stats(): { pages48: number; pages128: number; cells: number; cells48: number; cells128: number; buildings: number; rebuilds: number } {
    let cells128 = 0;
    for (const key of this.cells.keys()) cells128 += key & 1;
    return {
      pages48: this.pages.get(48)?.length ?? 0,
      pages128: this.pages.get(128)?.length ?? 0,
      cells: this.cells.size,
      cells48: this.cells.size - cells128,
      cells128,
      buildings: this.buildingCells.size,
      rebuilds: this.rebuilds,
    };
  }

  /** Notes that a (species, gait, mode) wants its 128 px frames and queues them if the species' rig is parsed. */
  private want128(species: number, gait: GaitId, mode: PoseMode): void {
    if (this.disposed) return;
    const pk = cellKey(species, gait, mode, 0, 128);
    if (this.wanted128.has(pk)) return;
    this.wanted128.set(pk, { species, gait, mode });
    const rig = this.rigs.get(species);
    if (rig) this.queueFrames(rig, species, gait, mode, FULL_SIZES);
  }

  private queueFrames(rig: Rig, species: number, gait: GaitId, mode: PoseMode, sizes: readonly FramePx[]): void {
    const n = framesOf(gait, mode);
    for (let frame = 0; frame < n; frame++) {
      // The middle of each frame's slice of the stride, so frameIndex(phase, n) lands on `frame`.
      this.queue.push({ rig, gait: GAITS[gait], mode, phase: (frame + 0.5) / n, target: { species, gait, mode, frame }, sizes });
    }
    this.kick();
  }

  /**
   * Drops every page and every frame texture, then queues every species and building requested so far. Called on
   * webglcontextrestored. The old textures are destroyed (a texture registers with its page source, so an undestroyed
   * one would be kept alive by the source) and the old pages' sources are destroyed; new frames start on new pages.
   */
  rebuild(): void {
    this.rebuilds++;
    this.gen++;
    this.queue.length = 0;
    this.ready.length = 0;
    for (const t of this.cells.values()) this.destroyTexture(t);
    for (const t of this.buildingCells.values()) this.destroyTexture(t);
    for (const p of this.pending) this.destroyTexture(p.tex);
    this.cells.clear();
    this.buildingCells.clear();
    this.rects.clear();
    this.buildingRects.clear();
    this.rigs.clear();
    this.pending.length = 0;
    this.dirty.clear();
    for (const list of this.pages.values()) for (const page of list) this.destroyPage(page);
    this.pages.clear();
    for (const species of this.requestedSpecies) this.startSpecies(species);
    for (const kind of this.requestedBuildings) this.startBuilding(kind);
    this.kick();
  }

  /**
   * Stops the atlas for good: queued and in-flight bakes are dropped, and a chunk load still pending when this is called
   * does nothing when it lands (no bake, so no warning after the owner is gone). Requests after this are ignored.
   */
  dispose(): void {
    this.disposed = true;
    this.gen++;
    this.queue.length = 0;
    this.ready.length = 0;
  }

  /** Warns once per species or building kind, whatever the number of frames or rebuilds that fail. */
  private warnOnce(id: string, message: string, err: unknown): void {
    if (this.warned.has(id)) return;
    this.warned.add(id);
    console.warn(`atlas: ${id} ${message}`, err);
  }

  private parseOrWarn(svg: string, id: string): Rig | null {
    try {
      return parseRig(svg);
    } catch (err) {
      this.warnOnce(id, 'art rejected', err);
      return null;
    }
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
        // A failed load stays requested, so a draw does not retry it every frame; a rebuild starts it again.
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
        // As for species: retried on rebuild only.
      },
    );
  }

  private bakeSpecies(species: number, id: string): void {
    const svg = artFor(id);
    const sp = SPECIES_GAIT[id];
    if (svg === null || !sp) return;
    const rig = this.parseOrWarn(svg, id);
    if (!rig) return;
    this.rigs.set(species, rig);
    for (const { gait, mode } of bakePairs(sp)) this.queueFrames(rig, species, gait, mode, BASE_SIZES);
    // 128 px sets asked for before the rig was ready (or before a rebuild) are queued now.
    for (const w of this.wanted128.values()) if (w.species === species) this.queueFrames(rig, species, w.gait, w.mode, FULL_SIZES);
  }

  private bakeBuilding(kind: string): void {
    const svg = artForBuilding(kind);
    if (svg === null) return;
    const rig = this.parseOrWarn(svg, kind);
    if (!rig) return;
    this.queue.push({ rig, gait: GAITS.static, mode: 'idle', phase: 0, target: { building: kind }, sizes: BUILDING_SIZES });
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
    for (const page of this.dirty) {
      this.uploadPage(page);
      for (const cb of this.flushListeners) cb(page.canvas);
    }
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
          const t = job.target;
          this.warnOnce('building' in t ? t.building : (SPECIES[t.species]?.id ?? String(t.species)), 'frame not decoded', err);
        },
      )
      .finally(() => {
        this.inflight--;
        this.kick();
      });
  }

  /** Draws a decoded frame into a free slot of the page set of each size the job asks for. */
  private place(job: Job, img: HTMLImageElement): void {
    for (const px of job.sizes) {
      const { page, x, y } = this.alloc(px);
      page.ctx.drawImage(img, x, y, px, px);
      const tex = this.makeTexture(page, x, y, px);
      const rect: AtlasRect = { page: page.canvas, u0: x / PAGE, v0: y / PAGE, u1: (x + px) / PAGE, v1: (y + px) / PAGE };
      const t = job.target;
      if ('building' in t) {
        const key = `${t.building}|${px}`;
        this.pending.push({
          tex,
          apply: () => {
            this.buildingCells.set(key, tex);
            this.buildingRects.set(key, rect);
          },
        });
      } else {
        const key = cellKey(t.species, t.gait, t.mode, t.frame, px);
        this.pending.push({
          tex,
          apply: () => {
            this.cells.set(key, tex);
            this.rects.set(key, rect);
          },
        });
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
