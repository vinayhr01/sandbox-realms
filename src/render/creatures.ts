/**
 * Creature layer: draws the beings of the feed (feed-interp.ts), the hamlet buildings and the
 * boats, at world scale. A being's icon is as tall as its size class in tiles times the zoom, so it grows with the map.
 * Zoomed out, the beings become dots in their group colour; zoomed in, icons. Between 3 and 5 px per tile the two
 * cross over. Sprites are pooled, and only what is in the view plus a margin is placed.
 */
import { Application, Container, Graphics, Rectangle, Sprite, type Texture } from 'pixi.js';
// Pixi is imported for the sprites and the shadow texture only; no sim state is read here.
import { SPECIES } from '../content/beasts.ts';
import { speciesGroup } from '../content/species-group.ts';
import type { MapBoat, MapBuilding, MapSizeClass } from '../shared/protocol.ts';
import { BeingState } from '../shared/being-feed.ts';
import type { DrawBeing, FeedInterp } from './feed-interp.ts';
import type { MarkView } from './marks.ts';
import { clamp } from './camera.ts';
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
/** Shadow ellipse texture size in px; its sprite is scaled to the being's width and a fifth of its height. */
const SHADOW_W = 16;
const SHADOW_H = 8;
const SHADOW_ALPHA = 0.35;
const BOAT_COLOUR: Readonly<Record<MapBoat['kind'], number>> = { trading: 0x7fd3ff, fishing: 0xa8e6a1, transport: 0xffd27f };

/** Gait name of each drawn state, for the frame source. */
const GAIT_OF_STATE: Readonly<Record<BeingState, string>> = {
  [BeingState.Idle]: 'idle',
  [BeingState.Walk]: 'walk',
  [BeingState.Run]: 'run',
  [BeingState.Swim]: 'swim',
  [BeingState.Sleep]: 'sleep',
  [BeingState.Hit]: 'hit',
};

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

/**
 * Supplies the animated frame of a being (Task 7 implements it). Until one is set, the layer draws the group silhouette.
 * `gait` is a GaitId from Task 5, typed as a string here.
 */
export interface FrameSource {
  frame(species: number, gait: string, frameIndex: number, px: 48 | 128): Texture | null;
}

/** Shows or hides the layer's optional parts (settings `map.shadows`, `marks.boats`). */
export interface CreatureToggles {
  shadows: boolean;
  boats: boolean;
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

export class CreatureLayer {
  private readonly root = new Container();
  private readonly shadowLayer = new Container();
  private readonly buildingLayer = new Container();
  private readonly iconLayer = new Container();
  private readonly dots = new Graphics();
  private readonly boatMarks = new Graphics();
  private readonly shadowPool: Sprite[] = [];
  private readonly iconPool: Sprite[] = [];
  private readonly buildingPool: Sprite[] = [];
  private readonly sprites: SpriteFactory;
  private readonly shadowTexture: Texture;
  private buildings: readonly MapBuilding[] = [];
  private boats: readonly MapBoat[] = [];
  private frameSource: FrameSource | null = null;
  private toggles: CreatureToggles = { shadows: true, boats: false };
  private placed = 0;

  constructor(app: Application) {
    // Buildings under the shadows, shadows under the beings, dots and boats over the beings.
    this.root.addChild(this.buildingLayer);
    this.root.addChild(this.shadowLayer);
    this.root.addChild(this.iconLayer);
    this.root.addChild(this.dots);
    this.root.addChild(this.boatMarks);
    app.stage.addChild(this.root);
    this.sprites = new SpriteFactory(app.renderer);
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
  draw(beings: readonly DrawBeing[], count: number, view: MarkView, _nowMs: number): void {
    const zoom = view.zoom;
    const lod = lodOf(zoom);
    const margin = VIEW_MARGIN_TILES * zoom;
    this.dots.clear();
    let icons = 0;
    let shadows = 0;
    let placed = 0;
    for (let i = 0; i < count; i++) {
      const b = beings[i];
      if (!b) continue;
      const sx = view.offX + (b.x + 0.5) * zoom;
      const sy = view.offY + (b.y + 0.5) * zoom;
      if (sx < -margin || sy < -margin || sx > view.viewW + margin || sy > view.viewH + margin) continue;
      placed++;
      if (lod.dots > 0 && b.alpha * lod.dots > 0) {
        this.dots.circle(sx, sy, DOT_RADIUS_PX).fill({ color: GROUP_COLOUR[speciesGroup(b.species)], alpha: b.alpha * lod.dots });
      }
      if (lod.icons > 0) {
        const size = SPECIES[b.species]?.size ?? 'S';
        const height = worldHeightPx(size, zoom, b.child);
        this.placeIcon(icons++, b, size, height, sx, sy, b.alpha * lod.icons);
        if (this.toggles.shadows) this.placeShadow(shadows++, height, sx, sy, b.alpha * lod.icons);
      }
    }
    this.placed = placed;
    this.hideFrom(this.iconPool, icons);
    this.hideFrom(this.shadowPool, shadows);
    this.shadowLayer.visible = this.toggles.shadows;
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
    this.hideFrom(this.iconPool, 0);
    this.hideFrom(this.shadowPool, 0);
    this.hideFrom(this.buildingPool, 0);
  }

  /** A being's icon, scaled so it is `height` CSS px tall and faces its direction of travel. */
  private placeIcon(i: number, b: DrawBeing, size: MapSizeClass, height: number, sx: number, sy: number, alpha: number): void {
    const tex = this.textureOf(b, size);
    const sprite = placeSprite(this.iconPool, this.iconLayer, i, tex.texture, tex.anchorX, tex.anchorY);
    const k = height / tex.texture.height;
    sprite.scale.set(b.facing * k, k);
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

  /** The frame from the frame source when there is one, else the group silhouette. */
  private textureOf(b: DrawBeing, size: MapSizeClass): SpriteTex {
    const silhouette = this.sprites.being(speciesGroup(b.species), size);
    const src = this.frameSource;
    if (!src) return silhouette;
    const frame = src.frame(b.species, GAIT_OF_STATE[b.state] ?? 'idle', 0, 48);
    return frame ? { texture: frame, anchorX: 0.5, anchorY: 1 } : silhouette;
  }

  /** Buildings as their sprite at the tile centre, culled to the view. */
  private placeBuildings(view: MarkView): void {
    let n = 0;
    for (const b of this.buildings) {
      const sx = view.offX + (b.x + 0.5) * view.zoom;
      const sy = view.offY + (b.y + 0.5) * view.zoom;
      if (!inView(sx, sy, view, SPRITE_MARGIN_PX)) continue;
      const tex = this.sprites.building(buildingKindOf(b.kind));
      placeSprite(this.buildingPool, this.buildingLayer, n++, tex.texture, tex.anchorX, tex.anchorY).position.set(sx, sy);
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

function inView(sx: number, sy: number, view: MarkView, margin: number): boolean {
  return sx >= -margin && sy >= -margin && sx <= view.viewW + margin && sy <= view.viewH + margin;
}
