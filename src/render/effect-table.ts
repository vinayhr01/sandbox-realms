/**
 * The deploy-effect table (spec F): the particle cap, the timings and the recipe of each power, as pure data. No Pixi and
 * no three.js import, so the 2D layer (effects.ts) and the 3D layer (render3d/effects3d.ts) read one table, and the 3D
 * chunk does not pull Pixi in.
 */
import type { RecipeId } from './effectRecipes.ts';

/** Most particles alive at once (spec F, call 5 of the review focus). */
export const MAX_PARTICLES = 256;
/** Reduce motion: every recipe becomes one ring that fades in this long (ms). */
export const FADE_MS = 250;
/** Least time between two stroke puffs, ms: a long or fast brush drag puffs at most about 12 times a second. */
export const STROKE_PUFF_MS = 80;

export type Shape = 'dot' | 'ring' | 'streak' | 'puff' | 'sparkle';

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

export const WHITE = 0xffffff;

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
