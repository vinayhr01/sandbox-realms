/**
 * Per-frame feed of living beings for the map (src/render). The worker encodes every Being into one pooled buffer of
 * Uint16 words, FEED_STRIDE words each, and posts it with Ev.Beings. Reads only: the encoder never changes the sim,
 * the RNG or the state hash.
 */
import { GROUNDS } from '../content/grounds.ts';
import type { Sim } from '../sim/sim.ts';
import type { MapBoat, MapBuilding } from './protocol.ts';

/** How a Being is drawn on the map: a sprite row per state (Sleep, Hit and Swim take precedence over movement). */
export const enum BeingState {
  Idle = 0,
  Walk = 1,
  Run = 2,
  Swim = 3,
  Sleep = 4,
  Hit = 5,
}

/** Uint16 words per Being: slot, generation & 0xffff, x, y, species, state | child << 8. */
export const FEED_STRIDE = 6;

/** One frame of the being feed. `buildings` is null when unchanged since the last feed. */
export interface BeingFeed {
  tick: number;
  count: number;
  data: Uint16Array;
  buildings: MapBuilding[] | null;
  boats: MapBoat[];
}

export interface FeedBeing {
  slot: number;
  gen: number;
  x: number;
  y: number;
  species: number;
  state: BeingState;
  child: number;
}

/** Remembers each Being's last tile between calls, so Walk and Run can be told from Idle. One per Sim. */
export class BeingFeedEncoder {
  /** Generation last seen in each slot (-1 before the first sighting), so a reused slot starts fresh. */
  private readonly seenGen: Float64Array;
  private readonly lastX: Uint16Array;
  private readonly lastY: Uint16Array;

  constructor(capacity: number) {
    this.seenGen = new Float64Array(capacity).fill(-1);
    this.lastX = new Uint16Array(capacity);
    this.lastY = new Uint16Array(capacity);
  }

  /** Writes every living Being that fits in `out` and returns how many were written. */
  encode(sim: Sim, out: Uint16Array): number {
    const s = sim.beings.store;
    const realm = sim.realm;
    const tick = sim.tick;
    const room = Math.floor(out.length / FEED_STRIDE);
    const count = Math.min(s.size, room);
    for (let k = 0; k < count; k++) {
      const slot = s.at(k);
      const gen = s.generation[slot] ?? 0;
      const x = s.x[slot] ?? 0;
      const y = s.y[slot] ?? 0;
      // A slot seen for the first time, or reused by a new Being, has no last tile: it is not moving yet.
      const fresh = this.seenGen[slot] !== gen;
      const dist = fresh ? 0 : Math.max(Math.abs(x - (this.lastX[slot] ?? 0)), Math.abs(y - (this.lastY[slot] ?? 0)));
      this.seenGen[slot] = gen;
      this.lastX[slot] = x;
      this.lastY[slot] = y;

      let state = BeingState.Idle;
      if ((s.sleepUntil[slot] ?? 0) > tick) state = BeingState.Sleep;
      else if ((sim.combat.hitUntil[slot] ?? 0) > tick) state = BeingState.Hit;
      else if (GROUNDS[realm.ground[y * realm.side + x] ?? 0]?.sea) state = BeingState.Swim;
      else if (dist >= 2) state = BeingState.Run;
      else if (dist === 1) state = BeingState.Walk;

      const o = k * FEED_STRIDE;
      out[o] = slot;
      out[o + 1] = gen & 0xffff;
      out[o + 2] = x;
      out[o + 3] = y;
      out[o + 4] = s.species[slot] ?? 0;
      out[o + 5] = state | ((s.baby[slot] ? 1 : 0) << 8);
    }
    return count;
  }
}

/** Encoders by Sim, so each world keeps its own movement history and a new world starts fresh. */
const encoders = new WeakMap<Sim, BeingFeedEncoder>();

/** Encodes the beings of `sim` into `out` (see BeingFeedEncoder.encode). Returns the count written. */
export function encodeBeings(sim: Sim, out: Uint16Array): number {
  let encoder = encoders.get(sim);
  if (!encoder) {
    encoder = new BeingFeedEncoder(sim.beings.store.capacity);
    encoders.set(sim, encoder);
  }
  return encoder.encode(sim, out);
}

/** Reads the i-th Being of a feed. Index i must be below feed.count. */
export function readBeing(feed: BeingFeed, i: number): FeedBeing {
  const o = i * FEED_STRIDE;
  const d = feed.data;
  const packed = d[o + 5] ?? 0;
  return {
    slot: d[o] ?? 0,
    gen: d[o + 1] ?? 0,
    x: d[o + 2] ?? 0,
    y: d[o + 3] ?? 0,
    species: d[o + 4] ?? 0,
    state: (packed & 0xff) as BeingState,
    child: packed >> 8,
  };
}

/** A cheap fingerprint of a building list (count, ids and kinds), to see whether it changed since the last feed. */
export function buildingsFingerprint(list: readonly MapBuilding[]): number {
  let h = list.length;
  for (const b of list) {
    h = Math.imul(h ^ b.id, 16777619);
    for (let c = 0; c < b.kind.length; c++) h = Math.imul(h ^ b.kind.charCodeAt(c), 16777619);
  }
  return h >>> 0;
}
