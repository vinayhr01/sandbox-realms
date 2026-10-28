/**
 * Creature layer: draws the beings of the feed (feed-interp.ts), the hamlet buildings and the
 * boats, at world scale. A being's icon is as tall as its size class in tiles times the zoom, so it grows with the map.
 * Zoomed out, the beings become dots in their group colour (pooled sprites of one shared circle texture, so they batch);
 * zoomed in, icons. Between 3 and 5 px per tile the two
 * cross over. Sprites are pooled, and only what is in the view plus a margin is placed. Icons are baked rig frames
 * (atlas.ts) when they exist, else the group silhouette. A crowded screen steps its icons at a lower rate (animStep),
 * and fast beings kick up footfall dust (dust.ts).
 */
import { Application, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
// Pixi is imported for the sprites and the shadow texture only; no sim state is read here.
import { SPECIES } from '../content/beasts.ts';
import { speciesGroup } from '../content/species-group.ts';
import { SPECIES_GAIT, type GaitId, type PoseMode, type SpeciesGait } from '../art/gaits.ts';
import type { MapBoat, MapBuilding, MapSizeClass } from '../shared/protocol.ts';
import type { DrawBeing, FeedInterp } from './feed-interp.ts';
import type { MarkView } from './marks.ts';
import { clamp } from './camera.ts';
import { Atlas } from './atlas.ts';
import { framesOf, frameIndex, gaitFor, PhaseByKey, type PhaseEntry, type Pose } from './anim.ts';
import { BeingState } from '../shared/being-feed.ts';
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
/** The shared dot texture: a white disc this many px across, tinted per group and scaled to the dot's diameter. */
const DOT_TEX_PX = 8;
/** A building is drawn this many tiles tall, but never under BUILDING_MIN_PX CSS px (so it still reads when zoomed far out). */
const BUILDING_TILES = 1.25;
const BUILDING_MIN_PX = 8;
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

/** Height of a building on screen in CSS px: BUILDING_TILES tiles at the zoom, at least BUILDING_MIN_PX. */
export function buildingHeightPx(zoomPx: number): number {
  return Math.max(BUILDING_MIN_PX, BUILDING_TILES * zoomPx);
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
export function animStep(rankFromCentre: number, onScreen: number, crowdAnim = true): 1 | 2 | 0 {
  const share = rankFromCentre / onScreen;
  // Crowd LOD off (degraded): the furthest third holds, whatever the count.
  if (!crowdAnim) return share >= 2 / 3 ? 0 : 1;
  if (onScreen <= CROWD_LIMIT) return 1;
  if (onScreen > 2 * CROWD_LIMIT && share >= 5 / 6) return 0;
  return share >= 2 / 3 ? 2 : 1;
}

/** Buckets of the squared-distance histogram that ranks the beings on screen. */
const RANK_BUCKETS = 1024;

/**
 * Supplies the baked frame of a being: its species, the gait and mode it plays (from gaits.ts), the frame index within
 * that mode, and the frame size. Null until the frame is baked; the layer then draws the group silhouette.
 */
export interface FrameSource {
  frame(species: number, gait: string, mode: PoseMode, frameIndex: number, px: 48 | 128): Texture | null;
}

/**
 * Shows or hides the layer's optional parts (settings `map.shadows`, `marks.boats`, `map.particles`) and the
 * runtime-only quality flags of the degradation ladder (`map.crowdAnim`, `map.dust`, `map.creatureAnim`).
 */
export interface CreatureToggles {
  shadows: boolean;
  boats: boolean;
  particles: boolean;
  /** Off: beings beyond the crowding rank hold a frame, whatever the count. */
  crowdAnim: boolean;
  /** Off: no footfall dust. */
  dust: boolean;
  /** Off: every creature shows frame 0 of its current gait. */
  creatureAnim: boolean;
}

/** A pooled sprite that remembers the anchor it was given, so placing it can skip the anchor's observable getters and setter. */
class PooledSprite extends Sprite {
  ax = Number.NaN;
  ay = Number.NaN;
  /** The tint last written (dots only), so an unchanged tint is not written again. */
  tintValue = -1;
}

/** Places a sprite on (sx, sy) with its anchor at the feet, reusing it from the pool. */
function placeSprite(pool: PooledSprite[], parent: Container, i: number, tex: Texture, anchorX: number, anchorY: number): PooledSprite {
  let sprite = pool[i];
  if (!sprite) {
    sprite = new PooledSprite();
    pool.push(sprite);
    parent.addChild(sprite);
  }
  // Pixi marks a sprite dirty on every set, so only the changes are written.
  if (sprite.texture !== tex) sprite.texture = tex;
  if (sprite.ax !== anchorX || sprite.ay !== anchorY) {
    sprite.ax = anchorX;
    sprite.ay = anchorY;
    sprite.anchor.set(anchorX, anchorY);
  }
  if (!sprite.visible) sprite.visible = true;
  return sprite;
}

/** The species' gait table entry, or undefined for an id the table does not know. */
function gaitOfSpecies(species: number): SpeciesGait | undefined {
  const id = SPECIES[species]?.id;
  return id === undefined ? undefined : SPECIES_GAIT[id];
}

/** Per-species facts the draw loop needs for every being, looked up once per species and not once per being per frame. */
interface SpeciesDraw {
  gait: SpeciesGait | undefined;
  size: MapSizeClass;
  /** True once the atlas has been asked to bake this species. */
  requested: boolean;
}

/** Footfall dust is kicked up by walkers and runners on the ground: not by swimmers, flyers or static art. */
function kicksDust(state: BeingState, gait: GaitId): boolean {
  return (state === BeingState.Walk || state === BeingState.Run) && gait !== 'flyer' && gait !== 'static';
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
  private readonly dotLayer = new Container();
  private readonly boatMarks = new Graphics();
  private readonly dotPool: PooledSprite[] = [];
  private readonly shadowPool: PooledSprite[] = [];
  private readonly iconPool: PooledSprite[] = [];
  private readonly buildingPool: PooledSprite[] = [];
  private readonly sprites: SpriteFactory;
  private readonly silhouettes = new Map<number, SpriteTex>();
  private readonly speciesDraw: (SpeciesDraw | undefined)[] = [];
  private shadowTexture: Texture;
  private dotTexture: Texture;
  private readonly renderer: Application['renderer'];
  private readonly atlas: Atlas;
  private readonly phases = new PhaseByKey();
  private readonly dust: DustPool;
  private lastNowMs = -1;
  private frameNo = 0;
  /**
   * The beings in view this frame (indices into the feed sample, screen position, squared distance from the view centre),
   * filled by one pass over the sample. Grown, never shrunk.
   */
  private inIdx = new Int32Array(0);
  private inX = new Float64Array(0);
  private inY = new Float64Array(0);
  private inD2 = new Float64Array(0);
  /** Rank histogram: `below[b]` is the number of beings in view whose distance bucket is under b. */
  private readonly below = new Int32Array(RANK_BUCKETS + 1);
  private rankScale = 0;
  /** Sprites shown by the last draw, so the next one hides only the stale tail of each pool. */
  private shownDots = 0;
  private shownIcons = 0;
  private shownShadows = 0;
  private buildings: readonly MapBuilding[] = [];
  private boats: readonly MapBoat[] = [];
  private frameSource: FrameSource | null;
  private toggles: CreatureToggles = { shadows: true, boats: false, particles: true, crowdAnim: true, dust: true, creatureAnim: true };
  private placed = 0;
  private dotsDrawn = 0;

  constructor(app: Application) {
    // Buildings under the shadows, shadows and dust under the beings, dots and boats over the beings.
    this.root.addChild(this.buildingLayer);
    this.root.addChild(this.shadowLayer);
    this.root.addChild(this.dustLayer);
    this.root.addChild(this.iconLayer);
    this.root.addChild(this.dotLayer);
    this.root.addChild(this.boatMarks);
    app.stage.addChild(this.root);
    this.renderer = app.renderer;
    this.sprites = new SpriteFactory(app.renderer);
    this.atlas = new Atlas(app.renderer);
    this.frameSource = this.atlas;
    this.dust = new DustPool(this.dustLayer, Texture.WHITE);
    this.shadowTexture = this.makeShadowTexture();
    this.dotTexture = this.makeDotTexture();
    // A lost WebGL context leaves a texture that was rendered into (not uploaded from a resource) empty on restore, so the
    // generated textures are drawn again. The pooled sprites pick the new ones up on the next draw.
    app.renderer.canvas.addEventListener('webglcontextrestored', () => this.regenerateTextures());
  }

  private makeShadowTexture(): Texture {
    const shadow = new Graphics().ellipse(SHADOW_W / 2, SHADOW_H / 2, SHADOW_W / 2, SHADOW_H / 2).fill({ color: 0x000000, alpha: SHADOW_ALPHA });
    const tex = this.renderer.textureGenerator.generateTexture({
      target: shadow,
      resolution: 1,
      antialias: false,
      frame: new Rectangle(0, 0, SHADOW_W, SHADOW_H),
      textureSourceOptions: { scaleMode: 'nearest' },
    });
    shadow.destroy(true);
    return tex;
  }

  private makeDotTexture(): Texture {
    const dot = new Graphics().circle(DOT_TEX_PX / 2, DOT_TEX_PX / 2, DOT_TEX_PX / 2).fill(0xffffff);
    const tex = this.renderer.textureGenerator.generateTexture({
      target: dot,
      resolution: 1,
      antialias: true,
      frame: new Rectangle(0, 0, DOT_TEX_PX, DOT_TEX_PX),
      textureSourceOptions: { scaleMode: 'linear' },
    });
    dot.destroy(true);
    return tex;
  }

  /** Draws the shadow, dot and silhouette textures again, after a context restore. */
  private regenerateTextures(): void {
    this.shadowTexture.destroy(true);
    this.dotTexture.destroy(true);
    this.shadowTexture = this.makeShadowTexture();
    this.dotTexture = this.makeDotTexture();
    this.sprites.destroy();
    this.silhouettes.clear();
  }

  /** Draws the first `count` beings of `beings` on the view, plus the buildings and boats. */
  draw(beings: readonly DrawBeing[], count: number, view: MarkView, nowMs: number): void {
    const zoom = view.zoom;
    const lod = lodOf(zoom);
    const margin = VIEW_MARGIN_TILES * zoom;
    const dtMs = this.lastNowMs < 0 ? 0 : nowMs - this.lastNowMs;
    this.lastNowMs = nowMs;
    this.frameNo++;
    // Phases and crowd ranks only matter while icons show: with the dot level fully on, nothing steps.
    const iconsOn = lod.icons > 0;
    const visible = this.collectInView(beings, count, view, margin);
    const ranked = iconsOn && this.crowdRanked(visible);
    if (ranked) this.buildRanks(visible);
    const dustOn = this.toggles.particles && this.toggles.dust;
    let icons = 0;
    let shadows = 0;
    let dots = 0;
    for (let k = 0; k < visible; k++) {
      const b = beings[this.inIdx[k]!]!;
      const sx = this.inX[k]!;
      const sy = this.inY[k]!;
      if (lod.dots > 0 && b.alpha * lod.dots > 0) {
        this.placeDot(dots++, GROUP_COLOUR[speciesGroup(b.species)], sx, sy, b.alpha * lod.dots);
      }
      if (!iconsOn) continue;
      const info = this.infoOf(b.species);
      const sg = info.gait;
      const size = info.size;
      const height = worldHeightPx(size, zoom, b.child);
      const alpha = b.alpha * lod.icons;
      let pose: Pose | null = null;
      let phase = 0;
      if (sg) {
        const entry = this.phases.entry(b.key, b.x, b.y);
        // The run flag is as of the last step (with hysteresis, see anim.ts).
        const fast = entry.fast;
        const rank = ranked ? this.rankOf(this.inD2[k]!) : 0;
        const stepped = this.stepIcon(entry, b, sg, animStep(rank, visible, this.toggles.crowdAnim), dtMs);
        pose = gaitFor(sg, b.state, fast);
        // A footfall (the stride phase wrapped) of a fast walker or runner kicks up dust. With creature animation off the
        // frames hold still, so no dust either.
        if (fast && dustOn && this.toggles.creatureAnim && entry.wrapped && kicksDust(b.state, pose.gait)) this.dust.emit(sx, sy, b.facing);
        // Creature animation off: frame 0 of the gait. The stride still ticks, so the gait choice keeps its speed.
        phase = this.toggles.creatureAnim ? stepped : 0;
      }
      const frame = pose && this.frameSource ? this.bakedFrame(b.species, pose, phase, framePxFor(height)) : null;
      if (frame) this.placeIcon(icons, frame, 0.5, 1, b.facing, height, sx, sy, alpha);
      else {
        const silhouette = this.silhouette(b.species, size);
        this.placeIcon(icons, silhouette.texture, silhouette.anchorX, silhouette.anchorY, b.facing, height, sx, sy, alpha);
      }
      icons++;
      if (this.toggles.shadows) this.placeShadow(shadows++, height, sx, sy, alpha);
    }
    this.phases.endFrame();
    this.placed = visible;
    this.hideRange(this.dotPool, dots, this.shownDots);
    this.shownDots = dots;
    this.dotsDrawn = dots;
    this.hideRange(this.iconPool, icons, this.shownIcons);
    this.hideRange(this.shadowPool, shadows, this.shownShadows);
    this.shownIcons = icons;
    this.shownShadows = shadows;
    this.shadowLayer.visible = this.toggles.shadows;
    // Both do nothing while no puff is alive.
    if (dustOn) this.dust.update(dtMs);
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

  /** Dot sprites shown by the latest draw. */
  dotCount(): number {
    return this.dotsDrawn;
  }

  /** The baked-art atlas's page and frame counts (Atlas.stats). */
  atlasStats(): ReturnType<Atlas['stats']> {
    return this.atlas.stats();
  }

  /** Stops the baked-art pipeline for good (Atlas.dispose). Called when the layer's owner goes away. */
  dispose(): void {
    this.atlas.dispose();
  }

  /** Forgets the buildings and boats and hides every sprite, e.g. when a new world starts. */
  clear(): void {
    this.buildings = [];
    this.boats = [];
    this.placed = 0;
    this.dotsDrawn = 0;
    this.boatMarks.clear();
    this.dust.clear();
    this.hideFrom(this.dotPool, 0);
    this.hideFrom(this.iconPool, 0);
    this.hideFrom(this.shadowPool, 0);
    this.hideFrom(this.buildingPool, 0);
    this.shownDots = 0;
    this.shownIcons = 0;
    this.shownShadows = 0;
  }

  /**
   * One pass over the sample: the beings in the view plus margin are listed with their screen position and squared distance
   * from the view centre. Returns how many.
   */
  private collectInView(beings: readonly DrawBeing[], count: number, view: MarkView, margin: number): number {
    if (this.inIdx.length < count) {
      const cap = count * 2;
      this.inIdx = new Int32Array(cap);
      this.inX = new Float64Array(cap);
      this.inY = new Float64Array(cap);
      this.inD2 = new Float64Array(cap);
    }
    const zoom = view.zoom;
    const lo = -margin;
    const hiX = view.viewW + margin;
    const hiY = view.viewH + margin;
    let n = 0;
    for (let i = 0; i < count; i++) {
      const b = beings[i];
      if (!b) continue;
      const sx = view.offX + (b.x + 0.5) * zoom;
      const sy = view.offY + (b.y + 0.5) * zoom;
      if (sx < lo || sy < lo || sx > hiX || sy > hiY) continue;
      this.inIdx[n] = i;
      this.inX[n] = sx;
      this.inY[n] = sy;
      this.inD2[n] = this.distFromCentre(view, sx, sy);
      n++;
    }
    return n;
  }

  /** Fills the rank histogram from the first `n` squared distances: O(n), no sort. */
  private buildRanks(n: number): void {
    let max = 0;
    for (let k = 0; k < n; k++) if (this.inD2[k]! > max) max = this.inD2[k]!;
    this.rankScale = max > 0 ? (RANK_BUCKETS - 1) / max : 0;
    const below = this.below;
    below.fill(0);
    for (let k = 0; k < n; k++) below[((this.inD2[k]! * this.rankScale) | 0) + 1]!++;
    for (let b = 1; b <= RANK_BUCKETS; b++) below[b]! += below[b - 1]!;
  }

  /** A being's rank by distance from the view centre (0 is the nearest): the beings in the buckets nearer than its own. */
  private rankOf(d2: number): number {
    return this.below[(d2 * this.rankScale) | 0]!;
  }

  /** True when beings are ranked by distance: above CROWD_LIMIT, or always while the crowd LOD is degraded off. */
  private crowdRanked(onScreen: number): boolean {
    return onScreen > CROWD_LIMIT || !this.toggles.crowdAnim;
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
  private stepIcon(e: PhaseEntry, b: DrawBeing, sg: SpeciesGait, rate: 1 | 2 | 0, dtMs: number): number {
    if (rate === 0 || (rate === 2 && ((this.frameNo + b.key) & 1) !== 0)) {
      e.wrapped = false;
      return e.phase;
    }
    return this.phases.advance(e, b.state, b.x, b.y, sg.strideTiles, dtMs * rate);
  }

  /** The gait and size class of a species, cached by species index. */
  private infoOf(species: number): SpeciesDraw {
    let info = this.speciesDraw[species];
    if (!info) {
      info = { gait: gaitOfSpecies(species), size: SPECIES[species]?.size ?? 'S', requested: false };
      this.speciesDraw[species] = info;
    }
    return info;
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
    const info = this.infoOf(species);
    if (!info.requested) {
      info.requested = true;
      this.atlas.request(species);
    }
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

  /** A dot: the shared disc, tinted in the group colour and scaled to DOT_RADIUS_PX. */
  private placeDot(i: number, colour: number, sx: number, sy: number, alpha: number): void {
    const sprite = placeSprite(this.dotPool, this.dotLayer, i, this.dotTexture, 0.5, 0.5);
    if (sprite.tintValue !== colour) {
      sprite.tintValue = colour;
      sprite.tint = colour;
    }
    const k = (DOT_RADIUS_PX * 2) / DOT_TEX_PX;
    if (sprite.scale.x !== k) sprite.scale.set(k);
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
   * Buildings at world scale: buildingHeightPx(zoom) tall, feet on the tile centre, culled to the view. The baked still
   * is used when there is one (its frame size follows the height), else the building's silhouette stretched to the same height.
   */
  private placeBuildings(view: MarkView): void {
    let n = 0;
    const height = buildingHeightPx(view.zoom);
    for (const b of this.buildings) {
      const sx = view.offX + (b.x + 0.5) * view.zoom;
      const sy = view.offY + (b.y + 0.5) * view.zoom;
      if (!inView(sx, sy, view, SPRITE_MARGIN_PX)) continue;
      this.atlas.requestBuilding(b.kind);
      const baked = this.atlas.building(b.kind, framePxFor(height));
      const silhouette = baked ? null : this.sprites.building(buildingKindOf(b.kind));
      const sprite = baked
        ? placeSprite(this.buildingPool, this.buildingLayer, n++, baked, 0.5, 1)
        : placeSprite(this.buildingPool, this.buildingLayer, n++, silhouette!.texture, silhouette!.anchorX, silhouette!.anchorY);
      sprite.position.set(sx, sy);
      sprite.scale.set(height / (baked ? baked.height : silhouette!.texture.height));
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

  /** Hides pool sprites from `from` up to `to` (those the last draw showed and this one did not). */
  private hideRange(pool: PooledSprite[], from: number, to: number): void {
    for (let i = from; i < to; i++) pool[i]!.visible = false;
  }

  /** Hides pool sprites from index `from` on; they are kept for reuse. */
  private hideFrom(pool: PooledSprite[], from: number): void {
    for (let i = from; i < pool.length; i++) pool[i]!.visible = false;
  }
}
