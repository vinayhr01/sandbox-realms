/**
 * Procedural map sprites: one vector silhouette per species group (Folk, beast, sea, insect, undead,
 * monster, divine) and per hamlet building group, drawn with Graphics and rendered once to a texture.
 * No binary art: every texture is generated from the shapes below and cached by key.
 *
 * Colours are the group's own (the spec gives no per-group colour; see DECISIONS.md, Art round 6).
 * A 1 px dark outline is drawn in a darker tint of the group colour, never pure black (16 A3).
 * Silhouettes are drawn with the feet at the bottom centre of the texture, so the layer can place a
 * sprite on its tile by its anchor. Sizes are fixed CSS px per size class: sprites never scale with zoom.
 *
 * UNVERIFIED (node_modules absent in the worktree; written from the Pixi v8 documented API):
 * `renderer.textureGenerator.generateTexture({ target, resolution, antialias, frame, textureSourceOptions })`,
 * `Graphics.circle/ellipse/poly/rect().fill().stroke()` chaining on one path, and `Texture.destroy(true)`.
 */
import { Graphics, Rectangle, type Renderer, type Texture } from 'pixi.js';
import type { MapKindGroup, MapSizeClass } from '../shared/protocol.ts';

/** Building sprite groups (09 section 7 catalogue ids, grouped by look). `other` is a generic box. */
export type BuildingSpriteKind = 'house' | 'granary' | 'well' | 'quarry' | 'garrison' | 'other';

/** Fill colour of each species group. Folk keeps the colour the dots used before. */
export const GROUP_COLOUR: Record<MapKindGroup, number> = {
  folk: 0xf2d18b,
  beast: 0xde9650,
  sea: 0x3b7dd4,
  insect: 0x7fbf3f,
  undead: 0xa3a3a3,
  monster: 0xf2331a,
  divine: 0xffe04a,
};

const BUILDING_COLOUR: Record<BuildingSpriteKind, number> = {
  house: 0xc98b55,
  granary: 0xe7d08a,
  well: 0x7ea7c9,
  quarry: 0x8f8f8f,
  garrison: 0xa34b3a,
  other: 0xb9b0a0,
};

/** Body height in CSS px per size class (18a size classes T, S, M, L, H, C). */
const SIZE_HEIGHT_PX: Record<MapSizeClass, number> = { T: 4, S: 5, M: 7, L: 10, H: 13, C: 16 };
const SIZE_RANK: Record<MapSizeClass, number> = { T: 0, S: 1, M: 2, L: 3, H: 4, C: 5 };

/** Building sprite size in CSS px (width and height of the body box). */
const BUILDING_PX = 8;

/** A cached sprite: its texture and the anchor that puts the feet on the tile centre. */
export interface SpriteTex {
  texture: Texture;
  anchorX: number;
  anchorY: number;
}

/** Darker tint of a colour, for outlines and detail patches. */
function darken(colour: number, f: number): number {
  const r = Math.round(((colour >> 16) & 0xff) * f);
  const g = Math.round(((colour >> 8) & 0xff) * f);
  const b = Math.round((colour & 0xff) * f);
  return (r << 16) | (g << 8) | b;
}

/** Buildings catalogue id (09 section 7) to a sprite group. Every id not listed is the generic box. */
export function buildingKindOf(id: string): BuildingSpriteKind {
  if (id === 'lean_to' || id.startsWith('dwelling_')) return 'house';
  if (id === 'granary') return 'granary';
  if (id === 'springwell') return 'well';
  if (id === 'quarry' || id === 'quarry_lodge') return 'quarry';
  if (id === 'garrison') return 'garrison';
  return 'other';
}

/** Draws one fill-then-outline shape. `outline` is the darker tint of `colour`. */
function solid(g: Graphics, colour: number, draw: (g: Graphics) => void): void {
  const outline = darken(colour, 0.45);
  draw(g);
  g.fill(colour).stroke({ width: 1, color: outline });
}

/**
 * Silhouette of one species group at height `s` px, feet at (cx, base). Larger size classes get a dark
 * patch on the body (L and up), so the size reads apart from the silhouette alone.
 */
function drawBeing(g: Graphics, group: MapKindGroup, s: number, cx: number, base: number, rank: number): void {
  const col = GROUP_COLOUR[group];
  switch (group) {
    case 'folk': {
      solid(g, col, (p) => p.roundRect(cx - s * 0.25, base - s * 0.62, s * 0.5, s * 0.62, s * 0.12));
      solid(g, col, (p) => p.circle(cx, base - s * 0.82, s * 0.2));
      break;
    }
    case 'beast': {
      solid(g, col, (p) => p.ellipse(cx, base - s * 0.45, s * 0.7, s * 0.34));
      solid(g, col, (p) => p.circle(cx + s * 0.62, base - s * 0.6, s * 0.22));
      solid(g, col, (p) => p.rect(cx - s * 0.5, base - s * 0.2, s * 0.18, s * 0.2).rect(cx + s * 0.3, base - s * 0.2, s * 0.18, s * 0.2));
      break;
    }
    case 'sea': {
      solid(g, col, (p) => p.ellipse(cx + s * 0.1, base - s * 0.5, s * 0.75, s * 0.32));
      solid(g, col, (p) => p.poly([cx - s * 0.6, base - s * 0.5, cx - s * 1.0, base - s * 0.8, cx - s * 1.0, base - s * 0.2]));
      break;
    }
    case 'insect': {
      g.moveTo(cx - s * 0.5, base - s * 0.2).lineTo(cx + s * 0.5, base - s * 0.2).stroke({ width: 1, color: darken(col, 0.45) });
      solid(g, col, (p) => p.ellipse(cx, base - s * 0.4, s * 0.5, s * 0.3));
      solid(g, col, (p) => p.circle(cx + s * 0.5, base - s * 0.42, s * 0.2));
      break;
    }
    case 'undead': {
      solid(g, col, (p) => p.roundRect(cx - s * 0.3, base - s, s * 0.6, s * 0.8, s * 0.3));
      solid(g, col, (p) =>
        p.poly([cx - s * 0.3, base - s * 0.2, cx - s * 0.18, base, cx - s * 0.06, base - s * 0.2, cx + s * 0.06, base, cx + s * 0.18, base - s * 0.2, cx + s * 0.3, base, cx + s * 0.3, base - s * 0.2]),
      );
      break;
    }
    case 'monster': {
      solid(g, col, (p) => p.ellipse(cx, base - s * 0.5, s * 0.8, s * 0.42));
      solid(g, col, (p) => p.poly([cx - s * 0.5, base - s * 0.75, cx - s * 0.35, base - s * 1.1, cx - s * 0.2, base - s * 0.75]));
      solid(g, col, (p) => p.poly([cx - s * 0.1, base - s * 0.85, cx + s * 0.05, base - s * 1.2, cx + s * 0.2, base - s * 0.85]));
      solid(g, col, (p) => p.poly([cx + s * 0.3, base - s * 0.75, cx + s * 0.45, base - s * 1.1, cx + s * 0.6, base - s * 0.75]));
      break;
    }
    case 'divine': {
      g.circle(cx, base - s * 0.6, s * 0.46).stroke({ width: 1, color: col });
      solid(g, col, (p) => p.circle(cx, base - s * 0.6, s * 0.22));
      break;
    }
  }
  if (rank >= 3) {
    g.circle(cx, base - s * 0.5, s * 0.12).fill(darken(col, 0.6));
  }
}

/** Silhouette of one hamlet building in a BUILDING_PX box, feet at (cx, base). */
function drawBuilding(g: Graphics, kind: BuildingSpriteKind, s: number, cx: number, base: number): void {
  const col = BUILDING_COLOUR[kind];
  switch (kind) {
    case 'house': {
      solid(g, col, (p) => p.rect(cx - s * 0.4, base - s * 0.55, s * 0.8, s * 0.55));
      solid(g, col, (p) => p.poly([cx - s * 0.5, base - s * 0.5, cx, base - s, cx + s * 0.5, base - s * 0.5]));
      break;
    }
    case 'granary': {
      solid(g, col, (p) => p.roundRect(cx - s * 0.4, base - s * 0.8, s * 0.8, s * 0.8, s * 0.35));
      break;
    }
    case 'well': {
      g.circle(cx, base - s * 0.45, s * 0.4).stroke({ width: 2, color: col });
      solid(g, darken(col, 0.6), (p) => p.circle(cx, base - s * 0.45, s * 0.22));
      break;
    }
    case 'quarry': {
      solid(g, col, (p) => p.poly([cx - s * 0.45, base, cx - s * 0.45, base - s * 0.6, cx - s * 0.1, base - s * 0.9, cx + s * 0.45, base - s * 0.6, cx + s * 0.45, base]));
      break;
    }
    case 'garrison': {
      solid(g, col, (p) => p.rect(cx - s * 0.45, base - s * 0.7, s * 0.9, s * 0.7));
      solid(g, col, (p) => p.rect(cx - s * 0.45, base - s * 0.95, s * 0.2, s * 0.25).rect(cx - s * 0.1, base - s * 0.95, s * 0.2, s * 0.25).rect(cx + s * 0.25, base - s * 0.95, s * 0.2, s * 0.25));
      break;
    }
    case 'other': {
      solid(g, col, (p) => p.rect(cx - s * 0.4, base - s * 0.7, s * 0.8, s * 0.7));
      break;
    }
  }
}

/** Renders each silhouette once to a texture and returns the cached result. */
export class SpriteFactory {
  private readonly beings = new Map<string, SpriteTex>();
  private readonly buildings = new Map<BuildingSpriteKind, SpriteTex>();

  constructor(private readonly renderer: Renderer) {}

  /** Texture of a being of this group and size class (cached by group and size). */
  being(group: MapKindGroup, size: MapSizeClass): SpriteTex {
    const key = `${group}:${size}`;
    let entry = this.beings.get(key);
    if (!entry) {
      const s = SIZE_HEIGHT_PX[size];
      const w = Math.ceil(s * 2) + 2;
      const h = Math.ceil(s * 1.3) + 2;
      const cx = w / 2;
      const base = h - 1;
      entry = this.render(w, h, base / h, (g) => drawBeing(g, group, s, cx, base, SIZE_RANK[size]));
      this.beings.set(key, entry);
    }
    return entry;
  }

  /** Texture of a hamlet building of this sprite group (cached). */
  building(kind: BuildingSpriteKind): SpriteTex {
    let entry = this.buildings.get(kind);
    if (!entry) {
      const s = BUILDING_PX;
      const w = s + 2;
      const h = s + 2;
      const cx = w / 2;
      const base = h - 1;
      entry = this.render(w, h, base / h, (g) => drawBuilding(g, kind, s, cx, base));
      this.buildings.set(kind, entry);
    }
    return entry;
  }

  /** Frees every cached texture. */
  destroy(): void {
    for (const e of this.beings.values()) e.texture.destroy(true);
    for (const e of this.buildings.values()) e.texture.destroy(true);
    this.beings.clear();
    this.buildings.clear();
  }

  private render(w: number, h: number, anchorY: number, draw: (g: Graphics) => void): SpriteTex {
    const g = new Graphics();
    draw(g);
    const texture = this.renderer.textureGenerator.generateTexture({
      target: g,
      resolution: 1,
      antialias: false,
      frame: new Rectangle(0, 0, w, h),
      textureSourceOptions: { scaleMode: 'nearest' },
    });
    g.destroy(true);
    return { texture, anchorX: 0.5, anchorY };
  }
}
