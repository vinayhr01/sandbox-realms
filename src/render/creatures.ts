/**
 * Creature layer: draws the beings of the feed (feed-interp.ts), the hamlet buildings and the
 * boats, at world scale. A being's icon is as tall as its size class in tiles times the zoom, so it grows with the map.
 * Zoomed out, the beings become dots in their group colour; zoomed in, icons. Between 3 and 5 px per tile the two
 * cross over. Sprites are pooled, and only what is in the view plus a margin is placed. Icons are baked rig frames
 * (atlas.ts) when they exist, else the group silhouette. A crowded screen steps its icons at a lower rate (animStep),
 * and fast beings kick up footfall dust (dust.ts).
 */
import { Application, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
// Pixi is imported for the sprites and the shadow texture only; no sim state is read here.
import { SPECIES } from '../content/beasts.ts';
import { speciesGroup } from '../content/species-group.ts';
import { SPECIES_GAIT, type PoseMode, type SpeciesGait } from '../art/gaits.ts';
import type { MapBoat, MapBuilding, MapSizeClass } from '../shared/protocol.ts';
import type { DrawBeing, FeedInterp } from './feed-interp.ts';
import type { MarkView } from './marks.ts';
import { clamp } from './camera.ts';
import { Atlas } from './atlas.ts';
import { framesOf, frameIndex, gaitFor, PhaseByKey, RUN_SCREEN_TILES_PER_S, type Pose } from './anim.ts';
import { DustPool } from './dust.ts';
import { buildingKindOf, GROUP_COLOUR, SpriteFactory, type SpriteTex } from './sprites.ts';

/** Zoom (CSS px per tile) where dots give way to icons: dots fade out from LOD_TO_PX down, icons fade in from LOD_FROM_PX. */
const LOD_FROM_PX = 3;
const LOD_TO_PX = 5;
/** Beings this many tiles outside the view are still placed, so a sprite whose anchor is just off screen does not pop. */
const VIEW_MARGIN_TILES = 2;
/** Buildings and boats are placed within this many CSS px outside the view. */
const SPRITE_MARGIN_PX = 16;
const DOT_RADIUS_PX = 2;
const BOAT_RADIUS_PX = 3;
/** Tiles tall per size class (18a size classes T, S, M, L, H, C). */
const TILES_BY_SIZE: Readonly<Record<MapSizeClass, number>> = { T: 0.5, S: 0.7, M: 1.0, L: 1.4, H: 2.0, C: 3.0 };
/** A young being is drawn at this fraction of its size. */
const CHILD_SCALE = 0.6;
/** A being drawn taller than this many CSS px uses the 128 px frame; at or below it, the 48 px frame (framePxFor). */
const FULL_FRAME_HEIGHT_PX = 56;
/** Beings on screen above which the crowd is animated at a reduced rate (animStep). */
export const CROWD_LIMIT = 1500;
/** Shadow ellipse texture size in px; its sprite is scaled to the being's width and a fifth of its height. */
const SHADOW_W = 16;
const SHADOW_H = 8;
const SHADOW_ALPHA = 0.35;
const BOAT_COLOUR: Readonly<Record<MapBoat['kind'], number>> = { trading: 0x7fd3ff, fishing: 0xa8e6a1, transport: 0xffd27f };

/**
 * Drops the feed sample and the creature sprites, and counts the reset in `count`. Called when a new, loaded or respawned
 * realm replaces the old one.
 */
export function resetCreatureView(interp: Pick<FeedInterp, 'reset'>, layer: { clear(): void }, count: { resets: number }): void {
  interp.reset();
  layer.clear();
  count.resets++;
}

/** Dot and icon weights for a zoom: 0 to 1 each. Dots fall to 0 at LOD_TO_PX, icons rise from 0 at LOD_FROM_PX. */
export function lodOf(zoomPx: number): { dots: number; icons: number } {
  const span = LOD_TO_PX - LOD_FROM_PX;
  return { dots: clamp((LOD_TO_PX - zoomPx) / span, 0, 1), icons: clamp((zoomPx - LOD_FROM_PX) / span, 0, 1) };
}

/** Height of a being on screen in CSS px: its size class in tiles times the zoom, and 0.6 of that when young. */
export function worldHeightPx(size: MapSizeClass, zoomPx: number, child: boolean): number {
  return TILES_BY_SIZE[size] * zoomPx * (child ? CHILD_SCALE : 1);
}

/** The frame size for a sprite drawn `drawnHeightPx` CSS px tall: 128 px above FULL_FRAME_HEIGHT_PX, else 48 px. */
export function framePxFor(drawnHeightPx: number): 48 | 128 {
  return drawnHeightPx > FULL_FRAME_HEIGHT_PX ? 128 : 48;
}

/**
 * How often a being's stride advances, given its rank by distance from the view centre (0 is the nearest) and the number
 * of beings on screen. 1: every frame. 2: every other frame. 0: the frame is held. Up to CROWD_LIMIT all beings get 1; above
 * it the furthest third gets 2, and past twice the limit the furthest sixth holds.
 */
export function animStep(rankFromCentre: number, onScreen: number): 1 | 2 | 0 {
  if (onScreen <= CROWD_LIMIT) return 1;
  const share = rankFromCentre / onScreen;
  if (onScreen > 2 * CROWD_LIMIT && share >= 5 / 6) return 0;
  return share >= 2 / 3 ? 2 : 1;
}

/** The number of entries of `sorted` (the first n) below d2: a being's rank by distance. */
function rankOf(sorted: Float64Array, n: number, d2: number): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! < d2) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Supplies the baked frame of a being: its species, the gait and mode it plays (from gaits.ts), the frame index within
 * that mode, and the frame size. Null until the frame is baked; the layer then draws the group silhouette.
 */
export interface FrameSource {
  frame(species: number, gait: string, mode: PoseMode, frameIndex: number, px: 48 | 128): Texture | null;
}

/** Shows or hides the layer's optional parts (settings `map.shadows`, `marks.boats`, `map.particles`). */
export interface CreatureToggles {
  shadows: boolean;
  boats: boolean;
  particles: boolean;
}

/** Places a sprite on (sx, sy) with its anchor at the feet, reusing it from the pool. */
function placeSprite(pool: Sprite[], parent: Container, i: number, tex: Texture, anchorX: number, anchorY: number): Sprite {
  let sprite = pool[i];
  if (!sprite) {
    sprite = new Sprite();
    pool.push(sprite);
    parent.addChild(sprite);
  }
  sprite.texture = tex;
  sprite.anchor.set(anchorX, anchorY);
  sprite.visible = true;
  return sprite;
}

/** The species' gait table entry, or undefined for an id the table does not know. */
function gaitOfSpecies(species: number): SpeciesGait | undefined {
  const id = SPECIES[species]?.id;
  return id === undefined ? undefined : SPECIES_GAIT[id];
}

function inView(sx: number, sy: number, view: MarkView, margin: number): boolean {
  return sx >= -margin && sy >= -margin && sx <= view.viewW + margin && sy <= view.viewH + margin;
}

export class CreatureLayer {
  private readonly root = new Container();
  private readonly shadowLayer = new Container();
  private readonly buildingLayer = new Container();
  private readonly dustLayer = new Container();
  private readonly iconLayer = new Container();
  private readonly dots = new Graphics();
  private readonly boatMarks = new Graphics();
  private readonly shadowPool: Sprite[] = [];
  private readonly iconPool: Sprite[] = [];
  private readonly buildingPool: Sprite[] = [];
  private readonly sprites: SpriteFactory;
  private readonly silhouettes = new Map<number, SpriteTex>();
  private readonly shadowTexture: Texture;
  private readonly atlas: Atlas;
  private readonly phases = new PhaseByKey();
  private readonly dust: DustPool;
  private lastNowMs = -1;
  private frameNo = 0;
  /** Squared distances from the view centre of the beings on screen, and the same sorted (for ranks). Grown, never shrunk. */
  private dist2 = new Float64Array(0);
  private sorted = new Float64Array(0);
  private buildings: readonly MapBuilding[] = [];
  private boats: readonly MapBoat[] = [];
  private frameSource: FrameSource | null;
  private toggles: CreatureToggles = { shadows: true, boats: false, particles: true };
  private placed = 0;

  constructor(app: Application) {
    // Buildings under the shadows, shadows and dust under the beings, dots and boats over the beings.
    this.root.addChild(this.buildingLayer);
    this.root.addChild(this.shadowLayer);
    this.root.addChild(this.dustLayer);
    this.root.addChild(this.iconLayer);
    this.root.addChild(this.dots);
    this.root.addChild(this.boatMarks);
    app.stage.addChild(this.root);
    this.sprites = new SpriteFactory(app.renderer);
    this.atlas = new Atlas(app.renderer);
    this.frameSource = this.atlas;
    this.dust = new DustPool(this.dustLayer, Texture.WHITE);
    const shadow = new Graphics().ellipse(SHADOW_W / 2, SHADOW_H / 2, SHADOW_W / 2, SHADOW_H / 2).fill({ color: 0x000000, alpha: SHADOW_ALPHA });
    this.shadowTexture = app.renderer.textureGenerator.generateTexture({
      target: shadow,
      resolution: 1,
      antialias: false,
      frame: new Rectangle(0, 0, SHADOW_W, SHADOW_H),
      textureSourceOptions: { scaleMode: 'nearest' },
    });
    shadow.destroy(true);
  }

  /** Draws the first `count` beings of `beings` on the view, plus the buildings and boats. */
  draw(beings: readonly DrawBeing[], count: number, view: MarkView, nowMs: number): void {
    const zoom = view.zoom;
    const lod = lodOf(zoom);
    const margin = VIEW_MARGIN_TILES * zoom;
    const dtMs = this.lastNowMs < 0 ? 0 : nowMs - this.lastNowMs;
    this.lastNowMs = nowMs;
    this.frameNo++;
    this.dots.clear();
    // Phases and crowd ranks only matter while icons show: with the dot level fully on, nothing steps.
    const iconsOn = lod.icons > 0;
    const onScreen = iconsOn ? this.measureCrowd(beings, count, view, margin) : 0;
    let icons = 0;
    let shadows = 0;
    let placed = 0;
    for (let i = 0; i < count; i++) {
      const b = beings[i];
      if (!b) continue;
      const sg = gaitOfSpecies(b.species);
      const sx = view.offX + (b.x + 0.5) * zoom;
      const sy = view.offY + (b.y + 0.5) * zoom;
      if (!inView(sx, sy, view, margin)) {
        // Off screen, a being still steps its phase so a being that comes back keeps its stride.
        if (iconsOn && sg) this.phases.step(b.key, b.state, b.x, b.y, sg.strideTiles, dtMs);
        continue;
      }
      placed++;
      if (lod.dots > 0 && b.alpha * lod.dots > 0) {
        this.dots.circle(sx, sy, DOT_RADIUS_PX).fill({ color: GROUP_COLOUR[speciesGroup(b.species)], alpha: b.alpha * lod.dots });
      }
      if (!iconsOn) continue;
      const size = SPECIES[b.species]?.size ?? 'S';
      const height = worldHeightPx(size, zoom, b.child);
      const alpha = b.alpha * lod.icons;
      let pose: Pose | null = null;
      let phase = 0;
      if (sg) {
        // Speed is read before this frame's step: it is the speed of the last step.
        const fast = this.phases.speedOf(b.key) >= RUN_SCREEN_TILES_PER_S;
        const before = this.phases.phaseOf(b.key);
        const rank = onScreen > CROWD_LIMIT ? rankOf(this.sorted, onScreen, this.distFromCentre(view, sx, sy)) : 0;
        phase = this.stepIcon(b, sg, animStep(rank, onScreen), dtMs);
        pose = gaitFor(sg, b.state, fast);
        // A footfall (the stride phase wrapped) of a fast being kicks up dust.
        if (fast && this.toggles.particles && phase < before) this.dust.emit(sx, sy, b.facing);
      }
      const silhouette = this.silhouette(b.species, size);
      const frame = pose && this.frameSource ? this.bakedFrame(b.species, pose, phase, framePxFor(height)) : null;
      if (frame) this.placeIcon(icons, frame, 0.5, 1, b.facing, height, sx, sy, alpha);
      else this.placeIcon(icons, silhouette.texture, silhouette.anchorX, silhouette.anchorY, b.facing, height, sx, sy, alpha);
      icons++;
      if (this.toggles.shadows) this.placeShadow(shadows++, height, sx, sy, alpha);
    }
    this.phases.endFrame();
    this.placed = placed;
    this.hideFrom(this.iconPool, icons);
    this.hideFrom(this.shadowPool, shadows);
    this.shadowLayer.visible = this.toggles.shadows;
    if (this.toggles.particles) this.dust.update(dtMs);
    else this.dust.clear();
    this.placeBuildings(view);
    this.drawBoats(view);
  }

  /** Records the latest building list. Null is not passed: the caller keeps the last list while the feed sends none. */
  setBuildings(list: readonly MapBuilding[]): void {
    this.buildings = list;
  }

  /** Records the latest boats. */
  setBoats(list: readonly MapBoat[]): void {
    this.boats = list;
  }

  setToggles(toggles: CreatureToggles): void {
    this.toggles = toggles;
  }

  setFrameSource(src: FrameSource | null): void {
    this.frameSource = src;
  }

  /** Beings drawn as icons or dots in the latest draw. */
  drawnCount(): number {
    return this.placed;
  }

  /** Forgets the buildings and boats and hides every sprite, e.g. when a new world starts. */
  clear(): void {
    this.buildings = [];
    this.boats = [];
    this.placed = 0;
    this.dots.clear();
    this.boatMarks.clear();
    this.dust.clear();
    this.hideFrom(this.iconPool, 0);
    this.hideFrom(this.shadowPool, 0);
    this.hideFrom(this.buildingPool, 0);
  }

  /** Counts the beings on screen and, when there are more than CROWD_LIMIT, sorts their squared distances for ranks. */
  private measureCrowd(beings: readonly DrawBeing[], count: number, view: MarkView, margin: number): number {
    if (this.dist2.length < count) this.dist2 = new Float64Array(count * 2);
    let n = 0;
    for (let i = 0; i < count; i++) {
      const b = beings[i];
      if (!b) continue;
      const sx = view.offX + (b.x + 0.5) * view.zoom;
      const sy = view.offY + (b.y + 0.5) * view.zoom;
      if (!inView(sx, sy, view, margin)) continue;
      this.dist2[n++] = this.distFromCentre(view, sx, sy);
    }
    if (n > CROWD_LIMIT) {
      if (this.sorted.length < n) this.sorted = new Float64Array(this.dist2.length);
      this.sorted.set(this.dist2.subarray(0, n));
      this.sorted.subarray(0, n).sort();
    }
    return n;
  }

  /** Squared screen distance of (sx, sy) from the view centre. */
  private distFromCentre(view: MarkView, sx: number, sy: number): number {
    const dx = sx - view.viewW / 2;
    const dy = sy - view.viewH / 2;
    return dx * dx + dy * dy;
  }

  /**
   * Steps a being's stride phase for this frame at the crowd's rate. A held frame (rate 0) keeps the phase; a half rate
   * (2) steps every other frame, staggered by key, at twice the time.
   */
  private stepIcon(b: DrawBeing, sg: SpeciesGait, rate: 1 | 2 | 0, dtMs: number): number {
    if (rate === 0 || (rate === 2 && ((this.frameNo + b.key) & 1) !== 0)) {
      return this.phases.hold(b.key, b.x, b.y, sg.strideTiles);
    }
    return this.phases.step(b.key, b.state, b.x, b.y, sg.strideTiles, dtMs * rate);
  }

  /** The group silhouette of a species at its size class, looked up once per species. */
  private silhouette(species: number, size: MapSizeClass): SpriteTex {
    let tex = this.silhouettes.get(species);
    if (!tex) {
      tex = this.sprites.being(speciesGroup(species), size);
      this.silhouettes.set(species, tex);
    }
    return tex;
  }

  /** The baked frame of a being's pose at a stride phase, or null until it is baked. */
  private bakedFrame(species: number, pose: Pose, phase: number, px: 48 | 128): Texture | null {
    const src = this.frameSource;
    if (!src) return null;
    this.atlas.request(species);
    return src.frame(species, pose.gait, pose.mode, frameIndex(phase, framesOf(pose.gait, pose.mode)), px);
  }

  /** A being's icon, scaled so it is `height` CSS px tall and faces its direction of travel. */
  private placeIcon(
    i: number,
    tex: Texture,
    anchorX: number,
    anchorY: number,
    facing: -1 | 1,
    height: number,
    sx: number,
    sy: number,
    alpha: number,
  ): void {
    const sprite = placeSprite(this.iconPool, this.iconLayer, i, tex, anchorX, anchorY);
    const k = height / tex.height;
    sprite.scale.set(facing * k, k);
    sprite.position.set(sx, sy);
    sprite.alpha = alpha;
  }

  /** The shared shadow ellipse under a being, `height` CSS px tall, wide as the being is tall. */
  private placeShadow(i: number, height: number, sx: number, sy: number, alpha: number): void {
    const sprite = placeSprite(this.shadowPool, this.shadowLayer, i, this.shadowTexture, 0.5, 0.5);
    sprite.scale.set((height * 0.8) / SHADOW_W, (height * 0.2) / SHADOW_H);
    sprite.position.set(sx, sy);
    sprite.alpha = alpha;
  }

  /**
   * Buildings as their baked still when there is one, else their sprite, at the tile centre, culled to the view. A baked
   * still is scaled to the silhouette's height so the building keeps its footprint, and its frame size follows that height.
   */
  private placeBuildings(view: MarkView): void {
    let n = 0;
    for (const b of this.buildings) {
      const sx = view.offX + (b.x + 0.5) * view.zoom;
      const sy = view.offY + (b.y + 0.5) * view.zoom;
      if (!inView(sx, sy, view, SPRITE_MARGIN_PX)) continue;
      this.atlas.requestBuilding(b.kind);
      const silhouette = this.sprites.building(buildingKindOf(b.kind));
      const baked = this.atlas.building(b.kind, framePxFor(silhouette.texture.height));
      const sprite = baked
        ? placeSprite(this.buildingPool, this.buildingLayer, n++, baked, 0.5, 1)
        : placeSprite(this.buildingPool, this.buildingLayer, n++, silhouette.texture, silhouette.anchorX, silhouette.anchorY);
      sprite.position.set(sx, sy);
      sprite.scale.set(baked ? silhouette.texture.height / baked.height : 1);
    }
    this.hideFrom(this.buildingPool, n);
  }

  /** Boats as dots in their kind's colour, when `marks.boats` is on. */
  private drawBoats(view: MarkView): void {
    this.boatMarks.clear();
    if (!this.toggles.boats) return;
    for (const b of this.boats) {
      const sx = view.offX + (b.x + 0.5) * view.zoom;
      const sy = view.offY + (b.y + 0.5) * view.zoom;
      if (!inView(sx, sy, view, SPRITE_MARGIN_PX)) continue;
      this.boatMarks.circle(sx, sy, BOAT_RADIUS_PX).fill(BOAT_COLOUR[b.kind]);
    }
  }

  /** Hides pool sprites from index `from` on; they are kept for reuse. */
  private hideFrom(pool: Sprite[], from: number): void {
    for (let i = from; i < pool.length; i++) pool[i]!.visible = false;
  }
}
