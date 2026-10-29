/**
 * Deploy effects (UX redesign, spec F): a short burst on the map where a power is deployed. Particles are pooled sprites
 * of a few shared textures, capped at MAX_PARTICLES; over the cap the oldest slot is reused. Each particle is placed in
 * tile space, so the effect stays on its tile while the camera moves. Reduce motion turns every recipe into one fading
 * ring; reduce flash drops the white flash of blasts and meteors. The degradation ladder (map.effects) makes play a no-op.
 */
import { Container, Graphics, Rectangle, Sprite, Texture, type Application } from 'pixi.js';
import type { RecipeId } from './effectRecipes.ts';
import type { MarkView } from './marks.ts';

/** Most particles alive at once (spec F, call 5 of the review focus). */
export const MAX_PARTICLES = 256;
/** Reduce motion: every recipe becomes one ring that fades in this long (ms). */
export const FADE_MS = 250;
/** Texture size of the shared shapes, px. */
const TEX_PX = 32;

type Shape = 'dot' | 'ring' | 'streak' | 'puff' | 'sparkle';
export type EffectTextures = Readonly<Record<Shape, Texture>>;

/**
 * One group of particles in a recipe. `count` particles start at the tile centre, spread up to `spread` px out, and live
 * `lifeMs` (after `delayMs`). Their size grows from `size0` to `size1` px and they drift `dy` px down over their life.
 * A flash is a full-tile white disc that the reduce-flash setting skips.
 */
export interface Burst {
  shape: Shape;
  colour: number;
  count: number;
  delayMs: number;
  lifeMs: number;
  size0: number;
  size1: number;
  spread: number;
  dy: number;
  flash?: boolean;
}

export interface Recipe {
  durationMs: number;
  bursts: readonly Burst[];
}

const WHITE = 0xffffff;

/** The recipe table. 'rule' has no map effect. */
export const RECIPES: Readonly<Record<RecipeId, Recipe>> = {
  spawn: {
    durationMs: 600,
    bursts: [
      { shape: 'puff', colour: 0xd8c8a0, count: 6, delayMs: 0, lifeMs: 500, size0: 14, size1: 22, spread: 18, dy: -10 },
      { shape: 'sparkle', colour: 0xfff0a0, count: 6, delayMs: 80, lifeMs: 420, size0: 6, size1: 2, spread: 22, dy: -20 },
    ],
  },
  brush: {
    durationMs: 400,
    bursts: [
      { shape: 'ring', colour: 0x9fd3a0, count: 1, delayMs: 0, lifeMs: 350, size0: 8, size1: 36, spread: 0, dy: 0 },
      { shape: 'dot', colour: 0xcfeecf, count: 10, delayMs: 0, lifeMs: 300, size0: 4, size1: 1, spread: 14, dy: 0 },
    ],
  },
  weather: {
    durationMs: 700,
    bursts: [
      { shape: 'streak', colour: 0x8fc7ff, count: 8, delayMs: 0, lifeMs: 600, size0: 10, size1: 10, spread: 18, dy: 40 },
      { shape: 'puff', colour: 0xdfe9f5, count: 3, delayMs: 0, lifeMs: 500, size0: 22, size1: 30, spread: 14, dy: 0 },
    ],
  },
  blast: {
    durationMs: 600,
    bursts: [
      { shape: 'dot', colour: WHITE, count: 1, delayMs: 0, lifeMs: 120, size0: 160, size1: 160, spread: 0, dy: 0, flash: true },
      { shape: 'ring', colour: 0xffb347, count: 1, delayMs: 0, lifeMs: 500, size0: 10, size1: 90, spread: 0, dy: 0 },
      { shape: 'dot', colour: 0xff7a3d, count: 16, delayMs: 0, lifeMs: 450, size0: 6, size1: 2, spread: 40, dy: 0 },
      { shape: 'puff', colour: 0x555555, count: 4, delayMs: 100, lifeMs: 500, size0: 14, size1: 36, spread: 12, dy: -6 },
    ],
  },
  meteor: {
    durationMs: 900,
    bursts: [
      { shape: 'streak', colour: 0xffe08a, count: 3, delayMs: 0, lifeMs: 350, size0: 8, size1: 8, spread: 8, dy: 80 },
      { shape: 'dot', colour: WHITE, count: 1, delayMs: 380, lifeMs: 140, size0: 180, size1: 180, spread: 0, dy: 0, flash: true },
      { shape: 'ring', colour: 0xff8a3d, count: 1, delayMs: 380, lifeMs: 500, size0: 12, size1: 90, spread: 0, dy: 0 },
      { shape: 'dot', colour: 0xff7a3d, count: 14, delayMs: 380, lifeMs: 450, size0: 6, size1: 2, spread: 46, dy: 0 },
    ],
  },
  bless: {
    durationMs: 600,
    bursts: [
      { shape: 'sparkle', colour: 0xffd76a, count: 10, delayMs: 0, lifeMs: 520, size0: 6, size1: 2, spread: 26, dy: -24 },
      { shape: 'ring', colour: 0xffd76a, count: 1, delayMs: 0, lifeMs: 450, size0: 6, size1: 40, spread: 0, dy: 0 },
    ],
  },
  curse: {
    durationMs: 600,
    bursts: [
      { shape: 'puff', colour: 0x7b4fa0, count: 8, delayMs: 0, lifeMs: 550, size0: 14, size1: 26, spread: 22, dy: 0 },
      { shape: 'ring', colour: 0x5a3d7a, count: 1, delayMs: 0, lifeMs: 500, size0: 10, size1: 44, spread: 0, dy: 0 },
    ],
  },
  rule: { durationMs: 0, bursts: [] },
};

/** The one-ring recipe reduce motion plays instead: a fade in the recipe's own colour. */
function fadeRecipe(id: RecipeId): Recipe {
  const colour = RECIPES[id].bursts[0]?.colour ?? WHITE;
  if (id === 'rule') return RECIPES.rule;
  return { durationMs: FADE_MS, bursts: [{ shape: 'ring', colour, count: 1, delayMs: 0, lifeMs: FADE_MS, size0: 20, size1: 20, spread: 0, dy: 0 }] };
}

/** A small deterministic generator, so the spread of each burst is the same on every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Particle {
  sprite: Sprite;
  shape: Shape;
  active: boolean;
  tx: number;
  ty: number;
  /** The play's size in tiles, which scales the burst on screen. */
  sizeTiles: number;
  /** Offset from the tile centre at birth, px. */
  ox: number;
  oy: number;
  /** Milliseconds since birth; negative while the burst is delayed. */
  age: number;
  delayMs: number;
  lifeMs: number;
  size0: number;
  size1: number;
  dy: number;
  flash: boolean;
}

export interface EffectsOptions {
  /** Reads the reduce-motion setting (defaults to the `data-reduce-motion` attribute). */
  reduceMotion?: () => boolean;
  /** Reads the reduce-flash setting (defaults to the `data-reduce-flash` attribute). */
  reduceFlash?: () => boolean;
  /** Shared textures (tests pass their own; the default is generated from the renderer). */
  textures?: EffectTextures;
}

function domFlag(name: string): boolean {
  return typeof document !== 'undefined' && document.documentElement.hasAttribute(name);
}

export class EffectsLayer {
  private readonly root = new Container();
  private readonly slots: Particle[] = [];
  private readonly reduceMotion: () => boolean;
  private readonly reduceFlash: () => boolean;
  private textures: EffectTextures;
  private readonly renderer: Application['renderer'];
  private readonly random = rng(0x5eed);
  /** Next slot to reuse when every slot is busy. */
  private next = 0;
  private live = 0;
  private enabled = true;

  constructor(app: Application, options: EffectsOptions = {}) {
    this.reduceMotion = options.reduceMotion ?? (() => domFlag('data-reduce-motion'));
    this.reduceFlash = options.reduceFlash ?? (() => domFlag('data-reduce-flash'));
    this.renderer = app.renderer;
    this.textures = options.textures ?? makeTextures(app.renderer);
    app.stage.addChild(this.root);
    // A lost WebGL context leaves generated textures empty, so they are drawn again on restore (as creatures.ts does).
    app.renderer.canvas.addEventListener('webglcontextrestored', () => this.regenerate());
  }

  /** Turns the layer on or off (the degradation ladder's map.effects step). Off clears what is showing. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.clear();
  }

  /**
   * Plays a recipe at a tile. `sizeTiles` scales the burst on screen (the brush radius for a brush power). Called only where
   * the client sends the command, never on cooldown (spec call 6).
   */
  play(id: RecipeId, tileX: number, tileY: number, sizeTiles: number): void {
    if (!this.enabled) return;
    const recipe = this.reduceMotion() ? fadeRecipe(id) : RECIPES[id];
    if (recipe.bursts.length === 0) return;
    const reduceFlash = this.reduceFlash();
    for (const burst of recipe.bursts) {
      if (burst.flash && reduceFlash) continue;
      for (let i = 0; i < burst.count; i++) {
        const p = this.acquire(burst.shape);
        const angle = this.random() * Math.PI * 2;
        const reach = this.random() * burst.spread;
        p.tx = tileX;
        p.ty = tileY;
        p.ox = Math.cos(angle) * reach;
        p.oy = Math.sin(angle) * reach;
        p.age = -burst.delayMs;
        p.delayMs = burst.delayMs;
        p.lifeMs = burst.lifeMs;
        p.size0 = burst.size0;
        p.size1 = burst.size1;
        p.dy = burst.dy;
        p.flash = burst.flash === true;
        p.sprite.tint = burst.colour;
        p.sprite.visible = false;
        p.sprite.scale.set(1);
        p.sprite.alpha = 1;
        p.sizeTiles = sizeTiles;
      }
    }
  }

  /** Moves and ages the live particles to the camera in `view`. Hides the ones past their life. */
  update(dtMs: number, view: MarkView): void {
    if (this.live === 0) return;
    for (const p of this.slots) {
      if (!p.active) continue;
      p.age += dtMs;
      if (p.age >= p.lifeMs) {
        p.active = false;
        p.sprite.visible = false;
        this.live--;
        continue;
      }
      if (p.age < 0) continue;
      const k = p.age / p.lifeMs;
      const cx = view.offX + (p.tx + 0.5) * view.zoom;
      const cy = view.offY + (p.ty + 0.5) * view.zoom;
      const grow = Math.max(0.6, Math.min(3, (view.zoom * Math.max(1, p.sizeTiles)) / 6));
      const reach = 0.3 + 0.7 * k;
      p.sprite.position.set(cx + p.ox * reach * grow, cy + p.oy * reach * grow + p.dy * k);
      const px = p.size0 + (p.size1 - p.size0) * k;
      p.sprite.scale.set((px * grow) / TEX_PX);
      p.sprite.alpha = (p.flash ? 0.45 : 1) * (1 - k);
      p.sprite.visible = true;
    }
  }

  /** Particles alive now (the cap is MAX_PARTICLES). */
  liveCount(): number {
    return this.live;
  }

  /** Hides and frees every particle. */
  clear(): void {
    for (const p of this.slots) {
      p.active = false;
      p.sprite.visible = false;
    }
    this.live = 0;
  }

  /** Gets a free particle of the shape, or reuses the next slot over the cap. */
  private acquire(shape: Shape): Particle {
    let p: Particle | undefined;
    if (this.slots.length < MAX_PARTICLES) {
      p = this.newSlot(shape);
    } else {
      for (let n = 0; n < this.slots.length; n++) {
        const candidate = this.slots[(this.next + n) % this.slots.length];
        if (candidate && !candidate.active) {
          p = candidate;
          break;
        }
      }
      p ??= this.slots[this.next % this.slots.length];
      this.next = (this.next + 1) % MAX_PARTICLES;
    }
    if (!p) throw new Error('effects pool is empty');
    if (p.shape !== shape) {
      p.shape = shape;
      p.sprite.texture = this.textures[shape];
    }
    if (!p.active) {
      p.active = true;
      this.live++;
    }
    return p;
  }

  private newSlot(shape: Shape): Particle {
    const sprite = new Sprite(this.textures[shape]);
    sprite.anchor.set(0.5);
    sprite.visible = false;
    this.root.addChild(sprite);
    const p: Particle = { sprite, shape, active: false, tx: 0, ty: 0, sizeTiles: 1, ox: 0, oy: 0, age: 0, delayMs: 0, lifeMs: 1, size0: 0, size1: 0, dy: 0, flash: false };
    this.slots.push(p);
    return p;
  }

  private regenerate(): void {
    for (const tex of Object.values(this.textures)) tex.destroy(true);
    this.textures = makeTextures(this.renderer);
    for (const p of this.slots) p.sprite.texture = this.textures[p.shape];
  }
}

/** The shared shapes, drawn once in white so each burst tints them. */
function makeTextures(renderer: Application['renderer']): EffectTextures {
  const make = (draw: (g: Graphics) => void): Texture => {
    const g = new Graphics();
    draw(g);
    const tex = renderer.textureGenerator.generateTexture({
      target: g,
      resolution: 1,
      antialias: true,
      frame: new Rectangle(0, 0, TEX_PX, TEX_PX),
      textureSourceOptions: { scaleMode: 'linear' },
    });
    g.destroy(true);
    return tex;
  };
  const c = TEX_PX / 2;
  return {
    dot: make((g) => g.circle(c, c, 6).fill(WHITE)),
    ring: make((g) => g.circle(c, c, c - 3).stroke({ width: 3, color: WHITE })),
    streak: make((g) => g.roundRect(c - 2, 2, 4, TEX_PX - 4, 2).fill(WHITE)),
    puff: make((g) => g.circle(c, c, c - 2).fill({ color: WHITE, alpha: 0.7 })),
    sparkle: make((g) => g.poly([c, 0, c + 4, c - 4, TEX_PX, c, c + 4, c + 4, c, TEX_PX, c - 4, c + 4, 0, c, c - 4, c - 4]).fill(WHITE)),
  };
}
