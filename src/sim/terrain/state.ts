import type { Sim } from '../sim.ts';

/**
 * Per-sim state of the round-2 terrain systems (vents, quakes, creep hubs, flora spread jobs).
 * Kept outside Sim so sim.ts only needs hook lines. Saved: vents, the quake in progress and the shape
 * cycle (terrain section, terrain/save.ts); creep hubs and creep guards (hamlet section). Not saved yet:
 * flora spread jobs (see DECISIONS.md).
 */
export interface Vent {
  tile: number;
  kind: 'volcano' | 'water' | 'acid';
  /** Landing radius range in tiles (inclusive min, exclusive max for random draws). */
  rMin: number;
  rMax: number;
  /** Ticks between eruptions, or a [min, max] draw when `intervalMax` > 0. */
  interval: number;
  intervalMax: number;
  /** Drops per eruption. */
  burst: number;
  next: number;
}

export interface Quake {
  ox: number;
  oy: number;
  /** Packed step offsets (dx, dy pairs), already deduplicated and shuffled. */
  steps: number[];
  pos: number;
  mode: 'lower' | 'raise' | 'small';
}

export interface CreepHub {
  tile: number;
  def: string;
  /** Creep tiles this hub has grown (not cleared by decay). */
  tiles: Set<number>;
  nextPulse: number;
  alive: boolean;
}

export interface FloraJob {
  /** Tick of the next expiry. */
  next: number;
  /** Tiles of the kind queued for spread, processed in chunks. */
  queue: number[];
  cursor: number;
}

export interface TerrainState {
  vents: Vent[];
  quake: Quake | null;
  shapeOrder: number[];
  shapeCursor: number;
  hubs: CreepHub[];
  /** Tile -> tick until which it may not re-spread creep (acid guard). */
  creepGuard: Map<number, number>;
  floraJobs: Map<string, FloraJob>;
}

const states = new WeakMap<Sim, TerrainState>();

/** The terrain state of a sim, created on first use. */
export function terrainState(sim: Sim): TerrainState {
  let s = states.get(sim);
  if (!s) {
    s = { vents: [], quake: null, shapeOrder: [], shapeCursor: 0, hubs: [], creepGuard: new Map(), floraJobs: new Map() };
    states.set(sim, s);
  }
  return s;
}
