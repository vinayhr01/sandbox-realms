/**
 * Deploy effects (UX redesign, spec F): a short burst on the map where a power is deployed. Particles are pooled sprites
 * of a few shared textures, capped at MAX_PARTICLES; over the cap the oldest slot is reused. Each particle is placed in
 * tile space, so the effect stays on its tile while the camera moves. Reduce motion turns every recipe into one fading
 * ring; reduce flash drops the white flash of blasts and meteors. The degradation ladder (map.effects) makes play a no-op.
 */
import { Container, Graphics, Rectangle, Sprite, Texture, type Application } from 'pixi.js';
import type { RecipeId } from './effectRecipes.ts';
import { FADE_MS, MAX_PARTICLES, RECIPES, STROKE_PUFF_MS, WHITE, type Recipe, type Shape } from './effect-table.ts';
import type { MarkView } from './marks.ts';

// The particle cap, the timings and the recipe table live in effect-table.ts (pixi-free, shared with the 3D layer).
export { FADE_MS, MAX_PARTICLES, RECIPES, STROKE_PUFF_MS, type Burst, type Recipe } from './effect-table.ts';
/** Texture size of the shared shapes, px. */
const TEX_PX = 32;

export type EffectTextures = Readonly<Record<Shape, Texture>>;

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
  /** Frame time summed from update(); the stroke puff throttle reads it, so tests need no clock. */
  private clockMs = 0;
  private lastStrokePuffMs = -STROKE_PUFF_MS;

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

  /**
   * Plays a stroke puff while a brush drag is sent (spec F: dust puffs along the stroke). At most one per STROKE_PUFF_MS,
   * and none under reduce motion: a trail of rings is motion the setting asks to drop. Called only where the client sends.
   */
  playStroke(id: RecipeId, tileX: number, tileY: number, sizeTiles: number): void {
    if (!this.enabled || this.reduceMotion()) return;
    if (this.clockMs - this.lastStrokePuffMs < STROKE_PUFF_MS) return;
    this.lastStrokePuffMs = this.clockMs;
    this.play(id, tileX, tileY, sizeTiles);
  }

  /** Moves and ages the live particles to the camera in `view`. Hides the ones past their life. */
  update(dtMs: number, view: MarkView): void {
    this.clockMs += dtMs;
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
