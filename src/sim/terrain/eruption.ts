import type { Sim } from '../sim.ts';
import { acidTerraform } from './acid.ts';
import { addMagma } from './magma.ts';
import { rainDrop } from './water.ts';
import { terrainState, type Vent } from './state.ts';

/** Volcano cone (04 section 7.2): 6x6 molten_4 footprint, one magma drop every 2 ticks. */
const CONE = { side: 6, level: 3, rMin: 2, rMax: 8, interval: 2, intervalMax: 0, burst: 1 } as const;
/** Small volcano (18e section 2 / 12 lm_fire_vent): 3x3 molten_3, bursts every 60-180 s. */
const SMALL = { side: 3, level: 2, rMin: 2, rMax: 6, interval: 1200, intervalMax: 3600, burst: 6 } as const;
/** Geyser cadence in ticks (04 section 7.2: smoke every 2.5 ss; the drop cadence is TUNE). */
const GEYSER_INTERVAL = 50;
const WATER_RADIUS = { rMin: 2, rMax: 17 } as const;
const ACID_RADIUS = { rMin: 2, rMax: 15 } as const;
/** Missed eruptions caught up in one tick, so a long pause cannot stall the sim (04 section 7.2). */
const CATCH_UP = 8;
/** Random landing draws per drop before it is dropped. */
const LAND_TRIES = 32;

/** Places a volcano (`small` = 3x3 vent, else the 6x6 cone) at the centre (cx, cy). */
export function startVolcano(sim: Sim, cx: number, cy: number, small: boolean): boolean {
  const realm = sim.realm;
  // The centre is the vent tile, so it must lie in the realm. An off-map centre would write a vent that the chronicle
  // check refuses (chronicle.ts checkTerrain), so nothing is placed.
  if (!realm.inBounds(cx, cy)) return false;
  const spec = small ? SMALL : CONE;
  const from = -Math.floor(spec.side / 2);
  let placed = false;
  for (let dy = from; dy < from + spec.side; dy++) {
    for (let dx = from; dx < from + spec.side; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (!realm.inBounds(x, y)) continue;
      addMagma(sim, y * realm.side + x, spec.level);
      placed = true;
    }
  }
  if (!placed) return false;
  const tile = cy * realm.side + cx;
  const interval = spec.interval;
  const vent: Vent = { tile, kind: 'volcano', rMin: spec.rMin, rMax: spec.rMax, interval, intervalMax: spec.intervalMax, burst: spec.burst, next: sim.tick + interval };
  terrainState(sim).vents.push(vent);
  return true;
}

/**
 * Places a geyser on a tile: `water` drops rain (fills hollows, douses fire) and `acid` drops acid,
 * landing within their radius of the vent (04 section 7.2).
 */
export function startGeyser(sim: Sim, x: number, y: number, kind: 'water' | 'acid'): boolean {
  if (!sim.realm.inBounds(x, y)) return false;
  const radius = kind === 'water' ? WATER_RADIUS : ACID_RADIUS;
  const tile = y * sim.realm.side + x;
  terrainState(sim).vents.push({ tile, kind, rMin: radius.rMin, rMax: radius.rMax, interval: GEYSER_INTERVAL, intervalMax: 0, burst: 1, next: sim.tick + GEYSER_INTERVAL });
  return true;
}

/** Picks a landing tile at a random distance in [rMin, rMax] of the vent, or -1. */
function landing(sim: Sim, v: Vent): number {
  const realm = sim.realm;
  const rng = sim.rng('eruption');
  const cx = v.tile % realm.side;
  const cy = Math.floor(v.tile / realm.side);
  for (let t = 0; t < LAND_TRIES; t++) {
    const dx = rng.int(2 * v.rMax + 1) - v.rMax;
    const dy = rng.int(2 * v.rMax + 1) - v.rMax;
    const d = Math.hypot(dx, dy);
    if (d < v.rMin || d > v.rMax) continue;
    const x = cx + dx;
    const y = cy + dy;
    if (realm.inBounds(x, y)) return y * realm.side + x;
  }
  return -1;
}

/** One eruption of a vent: `burst` drops, each landing by its kind's rule. */
function erupt(sim: Sim, v: Vent): void {
  for (let k = 0; k < v.burst; k++) {
    const t = landing(sim, v);
    if (t < 0) continue;
    if (v.kind === 'volcano') addMagma(sim, t, 3);
    else if (v.kind === 'water') rainDrop(sim, t);
    else acidTerraform(sim, t);
  }
}

/**
 * One acid drop from a fixed tile (18e 2.1 acid_font, 04 section 7.2 fall_acid): lands 2..15 tiles from `tile`
 * by the acid vent rule. Used by the acid font's pulse; the drop draws from the 'eruption' stream.
 */
export function fallAcid(sim: Sim, tile: number): void {
  const v: Vent = { tile, kind: 'acid', rMin: ACID_RADIUS.rMin, rMax: ACID_RADIUS.rMax, interval: 0, intervalMax: 0, burst: 1, next: 0 };
  erupt(sim, v);
}

/** Next eruption tick after `now` for a vent: fixed, or a draw from [interval, intervalMax]. */
function nextAfter(sim: Sim, v: Vent, now: number): number {
  if (v.intervalMax <= v.interval) return now + v.interval;
  return now + v.interval + sim.rng('eruption').int(v.intervalMax - v.interval + 1);
}

/**
 * Vent step (04 section 7.2 and 11 phase 'drops/effects'): fires every vent whose eruption is due,
 * catching up missed intervals up to CATCH_UP per tick. Vents stop under sanctuary_seal.
 */
export function eruptionStep(sim: Sim): void {
  const vents = terrainState(sim).vents;
  if (vents.length === 0 || sim.rules.isOn('sanctuary_seal')) return;
  for (const v of vents) {
    for (let k = 0; k < CATCH_UP && sim.tick >= v.next; k++) {
      erupt(sim, v);
      v.next = nextAfter(sim, v, v.next);
    }
  }
}
