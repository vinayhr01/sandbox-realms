import { createRng, type Rng } from '../../shared/rng.ts';
import { RAISE_STEP } from '../brush.ts';
import { FLAG } from '../realm.ts';
import type { Sim } from '../sim.ts';
import { thaw } from './freeze.ts';
import { terrainState, type Quake } from './state.ts';
import { connectivityStep } from './connectivity.ts';

/** Fissure footprint box: 120x120 tiles centred on the origin (04 section 9). */
const HALF = 60;
const SIDE = HALF * 2;
/** Base shapes and the constant seed they are generated from (04 section 9). */
const BASE_SHAPES = 3;
const SHAPE_SEED = 0x5a1e;
/** Quake steps executed per tick (04 section 9). */
const STEPS_PER_TICK = 300;
/** Direction vectors for the random walk: east, south, west, north. */
const DX = [1, 0, -1, 0] as const;
const DY = [0, 1, 0, -1] as const;

/** Fissure shapes as flat (dx, dy) pairs. Index = base * 4 + rotation. */
const SHAPES: readonly number[][] = buildShapes();

/** Grows one base fissure: a branching random walk from near the centre (04 section 9). */
function growBase(rng: Rng): number[] {
  const cells = new Set<number>();
  const mark = (x: number, y: number, w: number): void => {
    for (let dy = -w; dy <= w; dy++) {
      for (let dx = -w; dx <= w; dx++) {
        const cx = x + dx;
        const cy = y + dy;
        if (Math.abs(cx) < HALF && Math.abs(cy) < HALF) cells.add((cx + HALF) + (cy + HALF) * SIDE);
      }
    }
  };
  interface Branch { x: number; y: number; dir: number; steps: number; width: number }
  const queue: Branch[] = [];
  const count = 6 + rng.int(7);
  for (let k = 0; k < count; k++) {
    queue.push({ x: rng.int(21) - 10, y: rng.int(21) - 10, dir: rng.int(4), steps: 40 + rng.int(51), width: 1 + rng.int(3) });
  }
  let budget = 64;
  while (queue.length > 0 && budget-- > 0) {
    const b = queue.shift();
    if (!b) break;
    const forkAt = rng.next() < 0.15 ? rng.int(b.steps) : -1;
    for (let s = 0; s < b.steps; s++) {
      if (rng.next() < 0.2) b.dir = (b.dir + (rng.int(2) === 0 ? 1 : 3)) % 4;
      mark(b.x, b.y, Math.floor(b.width / 2));
      if (s === forkAt) queue.push({ x: b.x, y: b.y, dir: rng.int(4), steps: Math.max(10, Math.floor(b.steps / 2)), width: b.width });
      b.x = Math.max(-HALF + 4, Math.min(HALF - 5, b.x + (DX[b.dir] ?? 0)));
      b.y = Math.max(-HALF + 4, Math.min(HALF - 5, b.y + (DY[b.dir] ?? 0)));
    }
  }
  const flat: number[] = [];
  for (const key of cells) {
    flat.push((key % SIDE) - HALF, Math.floor(key / SIDE) - HALF);
  }
  return flat;
}

/** Rotates a flat offset list by 90 degrees clockwise `turns` times. */
function rotate(flat: readonly number[], turns: number): number[] {
  let out = flat.slice();
  for (let t = 0; t < turns; t++) {
    const next: number[] = [];
    for (let k = 0; k < out.length; k += 2) next.push(-(out[k + 1] ?? 0), out[k] ?? 0);
    out = next;
  }
  return out;
}

/** The 12 fissure shapes (3 base x 4 rotations), generated once at module load from a constant seed. */
function buildShapes(): number[][] {
  const shapes: number[][] = [];
  for (let b = 0; b < BASE_SHAPES; b++) {
    const base = growBase(createRng(SHAPE_SEED + b));
    for (let r = 0; r < 4; r++) shapes.push(rotate(base, r));
  }
  return shapes;
}

/** Number of fissure shapes in the cycle (04 section 9: 12). */
export const QUAKE_SHAPE_COUNT = SHAPES.length;

/** Permutation of 0..n-1 drawn from the stream (Fisher-Yates). */
function permutation(rng: Rng, n: number): number[] {
  const out = Array.from({ length: n }, (_, k) => k);
  for (let k = n - 1; k > 0; k--) {
    const j = rng.int(k + 1);
    const t = out[k] ?? 0;
    out[k] = out[j] ?? 0;
    out[j] = t;
  }
  return out;
}

/** True while a quake is running. A second request is ignored (04 section 13). */
export function quakeActive(sim: Sim): boolean {
  return terrainState(sim).quake !== null;
}

/**
 * Starts an earthquake at (ox, oy) (04 section 9). `power` is 50% lowering and 50% raising; `small`
 * and `rite` clear cover, frost and scars instead. Returns false when another quake is running.
 */
export function startQuake(sim: Sim, ox: number, oy: number, type: 'power' | 'small' | 'rite'): boolean {
  const state = terrainState(sim);
  if (state.quake) return false;
  const rng = sim.rng('quake');
  if (state.shapeOrder.length === 0 || state.shapeCursor >= SHAPES.length) {
    state.shapeOrder = permutation(rng, SHAPES.length);
    state.shapeCursor = 0;
  }
  const shape = SHAPES[state.shapeOrder[state.shapeCursor++] ?? 0] ?? [];
  const units = permutation(rng, shape.length / 2);
  const steps: number[] = [];
  for (const u of units) steps.push(shape[2 * u] ?? 0, shape[2 * u + 1] ?? 0);
  let mode: Quake['mode'] = 'small';
  if (type === 'power') mode = rng.next() < 0.5 ? 'lower' : 'raise';
  state.quake = { ox, oy, steps, pos: 0, mode };
  return true;
}

/**
 * Per-tick terrain step that runs every tick (04 section 11 order 3 and 4): the quake, then the
 * connectivity scheduler. The scheduler rides here because sim.ts is not in this release's touch
 * list; it belongs in Sim.runTerrain next to the other periodic systems. While a quake runs the
 * scheduler is deferred (the "busy" flag of 01 section 11).
 */
export function quakeStep(sim: Sim): void {
  quakeTick(sim);
  connectivityStep(sim.realm, sim.tick, quakeActive(sim));
}

/**
 * Quake step (04 section 9, every tick): executes up to 300 fissure steps. Lowering and raising move
 * one step; small quakes strip cover and frost. Every touched tile loses its scar. Under
 * sanctuary_seal the quake shakes nothing and changes no tile.
 */
function quakeTick(sim: Sim): void {
  const state = terrainState(sim);
  const q = state.quake;
  if (!q) return;
  const realm = sim.realm;
  const sealed = sim.rules.isOn('sanctuary_seal');
  const total = q.steps.length / 2;
  const end = Math.min(total, q.pos + STEPS_PER_TICK);
  for (let p = q.pos; p < end; p++) {
    const x = q.ox + (q.steps[2 * p] ?? 0);
    const y = q.oy + (q.steps[2 * p + 1] ?? 0);
    if (!realm.inBounds(x, y) || sealed) continue;
    const i = y * realm.side + x;
    if (q.mode === 'lower') realm.setElevation(i, (realm.elevation[i] ?? 0) - RAISE_STEP);
    else if (q.mode === 'raise') realm.setElevation(i, (realm.elevation[i] ?? 0) + RAISE_STEP);
    else {
      realm.setCover(i, 0);
      if (realm.hasFlag(i, FLAG.frozen)) thaw(sim, i, 99);
    }
    realm.setScar(i, 0);
  }
  q.pos = end;
  if (q.pos >= total) state.quake = null;
}
