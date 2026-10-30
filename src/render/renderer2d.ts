/**
 * The 2D world view behind WorldRenderer: today's Pixi terrain, creature, mark, effect and insight layers, with no
 * behaviour change. main.ts drives it through frame() from the ticker, in the order the layers drew before.
 */
import { TerrainRenderer } from './terrain.ts';
import { Camera } from './camera.ts';
import { CreatureLayer } from './creatures.ts';
import { MarkLayer } from './marks.ts';
import { EffectsLayer } from './effects.ts';
import { InsightLayer } from './insight-layers.ts';
import type { Atlas } from './atlas.ts';
import type { DrawBeing } from './feed-interp.ts';
import type { RecipeId } from './effectRecipes.ts';
import type { FrameRows, MapBoat, MapBuilding } from '../shared/protocol.ts';
import { nearestLivePoint } from '../ui/powerSupport.ts';
import type { CameraControl, FrameInput, ScreenPoint, TilePoint, WorldRenderer } from './world-renderer.ts';

/** Recent per-frame ms kept for the perf gate (__sr.renderCost). */
const COST_RING = 600;

/**
 * The 2D camera behind CameraControl. It owns the current realm's Camera, which does not exist until the first setSide,
 * so a call before then does nothing or answers "no tile". The viewport comes from the caller, the Pixi screen size.
 */
export class Camera2D implements CameraControl {
  private cam: Camera | null = null;

  constructor(private readonly viewport: () => { w: number; h: number }) {}

  /** The current realm's camera, or null before the first setSide. */
  current(): Camera | null {
    return this.cam;
  }

  /** Starts a fresh camera for a new realm, fitted to the viewport. */
  reset(side: number): void {
    const v = this.viewport();
    this.cam = new Camera(side, v.w, v.h);
  }

  /** Re-clamps the camera to the viewport (the map element resized). */
  resize(): void {
    const v = this.viewport();
    this.cam?.resize(v.w, v.h);
  }

  /** Canvas point of a tile's centre, or null before the camera exists. */
  toScreen(x: number, y: number): ScreenPoint | null {
    const c = this.cam;
    if (!c) return null;
    return { sx: c.offX + (x + 0.5) * c.zoom, sy: c.offY + (y + 0.5) * c.zoom };
  }

  /** Continuous tile point under a canvas point, or null before the camera exists. */
  toTile(sx: number, sy: number): TilePoint | null {
    const c = this.cam;
    if (!c) return null;
    return c.screenToTile(sx, sy);
  }

  panBy(dxPx: number, dyPx: number): void {
    this.cam?.panBy(dxPx, dyPx);
  }

  zoomAt(factor: number, sx: number, sy: number): void {
    this.cam?.zoomAt(factor, sx, sy);
  }

  /** 2D has no yaw: rotation does nothing. */
  rotateBy(_radians: number): void {}

  /** Puts a tile's centre on the middle of the viewport, as the minimap and Follow do. */
  centreOn(tile: TilePoint): void {
    const c = this.cam;
    if (!c) return;
    const v = this.viewport();
    c.offX = v.w / 2 - (tile.x + 0.5) * c.zoom;
    c.offY = v.h / 2 - (tile.y + 0.5) * c.zoom;
    c.panBy(0, 0);
  }

  visibleTiles(): { x0: number; y0: number; x1: number; y1: number } {
    const c = this.cam;
    if (!c) return { x0: 0, y0: 0, x1: 0, y1: 0 };
    const v = this.viewport();
    const tl = c.screenToTile(0, 0);
    const br = c.screenToTile(v.w, v.h);
    return { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y };
  }

  zoom01(): number {
    const c = this.cam;
    if (!c) return 0;
    return (c.zoom - c.minZoom) / (c.maxZoom - c.minZoom);
  }

  centreTile(): TilePoint {
    const c = this.cam;
    if (!c) return { x: 0, y: 0 };
    const v = this.viewport();
    return c.screenToTile(v.w / 2, v.h / 2);
  }
}

class Renderer2D implements WorldRenderer {
  readonly kind = '2d' as const;
  readonly canvas: HTMLCanvasElement;
  readonly camera: Camera2D;
  /** The feed sample of the latest frame, for beingAt (taps and hover). */
  private beings: readonly DrawBeing[] = [];
  private beingCount = 0;
  /** Effects on or off as last given to the layer: setEnabled(false) clears it, so it is called on change only. */
  private effectsOn = true;
  /**
   * Main-thread ms of each Pixi render() call, from the renderer's prerender and postrender runners. Pixi builds one
   * instruction set for the whole stage, so the creature containers cannot be timed apart from the rest; this is the
   * whole render, where the dots' and icons' batching and draw submission land (outside creatureCost, which ends at draw()).
   */
  private readonly renderRing = new Float64Array(COST_RING);
  private renderWritten = 0;
  private renderT0 = 0;

  constructor(
    private readonly terrain: TerrainRenderer,
    private readonly creatures: CreatureLayer,
    private readonly marks: MarkLayer,
    private readonly effects: EffectsLayer,
    private readonly insight: InsightLayer,
  ) {
    const app = terrain.app;
    this.canvas = app.canvas;
    this.camera = new Camera2D(() => ({ w: app.screen.width, h: app.screen.height }));
    app.renderer.runners.prerender.add({ prerender: () => { this.renderT0 = performance.now(); } });
    app.renderer.runners.postrender.add({ postrender: () => { this.renderRing[this.renderWritten++ % COST_RING] = performance.now() - this.renderT0; } });
  }

  setSide(side: number): void {
    this.terrain.setSide(side);
    this.camera.reset(side);
    // The creature sprites and the effects of the old realm go too: being ids are reused across realms.
    this.creatures.clear();
    this.effects.clear();
    this.beings = [];
    this.beingCount = 0;
  }

  applyRows(rows: FrameRows): void {
    this.terrain.applyRows(rows);
  }

  setBuildings(list: readonly MapBuilding[]): void {
    this.creatures.setBuildings(list);
  }

  setBoats(list: readonly MapBoat[]): void {
    this.creatures.setBoats(list);
  }

  playEffect(id: RecipeId, x: number, y: number, sizeTiles: number, stroke: boolean): void {
    if (stroke) this.effects.playStroke(id, x, y, sizeTiles);
    else this.effects.play(id, x, y, sizeTiles);
  }

  liveEffects(): number {
    return this.effects.liveCount();
  }

  screenToTile(sx: number, sy: number): TilePoint | null {
    return this.camera.toTile(sx, sy);
  }

  tileToScreen(x: number, y: number): ScreenPoint | null {
    return this.camera.toScreen(x, y);
  }

  /** Hit test against the beings of the latest frame: they are what is on screen. */
  beingAt(sx: number, sy: number, slopPx: number): DrawBeing | null {
    const cam = this.camera.current();
    if (!cam || this.beingCount === 0) return null;
    return nearestLivePoint(this.beings, this.beingCount, cam, sx, sy, slopPx);
  }

  frame(input: FrameInput): number {
    this.beings = input.beings;
    this.beingCount = input.beingCount;
    // The degradation ladder's steps, in memory only: the effects step and the two terrain detail ramps.
    const off = input.degradedOff;
    const effectsOn = !off.has('map.effects');
    if (effectsOn !== this.effectsOn) {
      this.effectsOn = effectsOn;
      this.effects.setEnabled(effectsOn);
    }
    this.terrain.setDetailToggles(!off.has('map.terrainMedium'), !off.has('map.terrainClose'));
    const cam = this.camera.current();
    if (!cam) return 0;
    this.creatures.setToggles({
      shadows: input.map.shadows,
      boats: input.map.boats,
      particles: input.map.particles,
      crowdAnim: input.map.crowdAnim,
      dust: input.map.dust,
      creatureAnim: input.map.creatureAnim,
    });
    const view = { offX: cam.offX, offY: cam.offY, zoom: cam.zoom, viewW: this.terrain.app.screen.width, viewH: this.terrain.app.screen.height };
    const drawT0 = performance.now();
    this.creatures.draw(input.beings, input.beingCount, view, input.nowMs);
    const drawMs = performance.now() - drawT0;
    this.effects.update(input.dtMs, view);
    this.marks.update(input.snapshot, input.marks, view);
    this.insight.update(input.snapshot, { ...input.insight, hoverId: input.hoverId }, { offX: cam.offX, offY: cam.offY, zoom: cam.zoom });
    this.terrain.setView({ offX: cam.offX, offY: cam.offY, zoom: cam.zoom, dpr: this.terrain.app.renderer.resolution }, input.cursor);
    return drawMs;
  }

  setRenderScale(percent: number): void {
    this.terrain.setRenderScale(percent);
  }

  setFpsCap(fps: number): void {
    this.terrain.app.ticker.maxFPS = fps;
  }

  onFrame(cb: (dtMs: number) => void): void {
    this.terrain.app.ticker.add((ticker) => cb(ticker.deltaMS));
  }

  resize(): void {
    this.camera.resize();
  }

  stats(): { drawn: number; dots: number; atlas: ReturnType<Atlas['stats']> | null } {
    return { drawn: this.creatures.drawnCount(), dots: this.creatures.dotCount(), atlas: this.creatures.atlasStats() };
  }

  destroy(): void {
    this.creatures.dispose();
    this.terrain.destroy();
  }

  /** The last render() ms, oldest first, at most COST_RING. */
  recentRenderMs(): number[] {
    const n = Math.min(this.renderWritten, COST_RING);
    const out: number[] = [];
    for (let i = this.renderWritten - n; i < this.renderWritten; i++) out.push(this.renderRing[i % COST_RING]!);
    return out;
  }
}

/** The recent Pixi render() ms of a renderer, for the perf gate (__sr.renderCost). Empty for other views. */
export function renderCostMs(renderer: WorldRenderer): number[] {
  return renderer instanceof Renderer2D ? renderer.recentRenderMs() : [];
}

/** The 2D world view: terrain, creatures, marks, effects and insight layers, stacked in that order. */
export async function createRenderer2D(host: HTMLElement): Promise<WorldRenderer> {
  const terrain = await TerrainRenderer.create(host);
  // Creatures (beings, buildings, boats) and map marks: added after the terrain so they draw on top of it, marks over creatures.
  const creatures = new CreatureLayer(terrain.app);
  const marks = new MarkLayer(terrain.app);
  // Deploy effects sit above the beings and marks (spec F).
  const effects = new EffectsLayer(terrain.app);
  // Insight layers and overlays: added after the marks, so the tints and icons draw over them.
  const insight = new InsightLayer(terrain.app);
  return new Renderer2D(terrain, creatures, marks, effects, insight);
}
