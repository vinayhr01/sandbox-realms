import { GROUND_BY_ELEVATION, G, ground, type GroundLayer } from '../content/grounds.ts';
import { DEFAULT_SIZE_STEP, PARCEL_SHIFT, PATCH_SHIFT, SIZE_UNIT } from '../shared/constants.ts';
import { hash3 } from '../shared/rng.ts';
import { SparseSet } from './sparse-set.ts';

/** Flag bits in `flags` (01 section 3; bits 5..15 reserved). */
export const FLAG = {
  frozen: 1 << 0,
  burning: 1 << 1,
  edgeOfRealm: 1 << 2,
  hasFlora: 1 << 4,
} as const;

/** Bits of `patchDirty` (01 section 12.1). */
export const PATCH_DIRTY = {
  render: 1 << 0,
  connectivity: 1 << 1,
  minimap: 1 << 2,
} as const;

/**
 * Per-Parcel counters (01 section 2), kept by the mutators. Tree, plant, fungus, mineral and
 * structure counts are not kept here yet: flora kinds are looked up in sim/flora.ts, which this
 * release does not change, so only the total flora count is maintained.
 */
export interface ParcelCounters {
  /** Tiles on a Water-layer ground (sea and hollows-with-sea are counted by layer, hollows are Land). */
  liquidTiles: Uint16Array;
  /** Tiles on a Land-layer ground. */
  groundTiles: Uint16Array;
  /** Tiles on a Molten-layer ground. */
  lavaCount: Uint16Array;
  /** Burning tiles (flags bit burning). */
  fireCount: Uint16Array;
  /** Tiles carrying any flora. */
  floraCount: Uint16Array;
}

function newCounters(n: number): ParcelCounters {
  return {
    liquidTiles: new Uint16Array(n),
    groundTiles: new Uint16Array(n),
    lavaCount: new Uint16Array(n),
    fireCount: new Uint16Array(n),
    floraCount: new Uint16Array(n),
  };
}

/** Hollow ground (pits) and the sea band each one refills to. */
const HOLLOW_FOR_SEA: Readonly<Record<number, number>> = { [G.deepmere]: G.dug_deepmere, [G.midmere]: G.dug_midmere, [G.shoal]: G.dug_shoal };

/**
 * The tile grid as struct-of-arrays (01 section 3). Every write goes through the mutators below
 * so the sparse sets and dirty rows cannot drift from the arrays.
 */
export class Realm {
  readonly seed: number;
  readonly sizeStep: number;
  readonly side: number;
  readonly elevation: Uint8Array;
  readonly ground: Uint8Array;
  readonly cover: Uint8Array;
  readonly flags: Uint16Array;
  readonly hp: Uint8Array;
  readonly scar: Uint8Array;
  readonly fireStart: Uint32Array;
  readonly heat: Uint16Array;
  readonly lavaSince: Uint32Array;
  readonly variant: Uint8Array;
  /** Flora kind index + 1 per tile, 0 = none (18d). */
  readonly flora: Uint8Array;
  /** Tick the flora on the tile was planted; age = now - floraSince. */
  readonly floraSince: Uint32Array;
  /** Tick before which the tile may not re-seed flora after a grazer cleared it (TUNE regrowDelay). */
  readonly floraBlockedUntil: Uint32Array;
  /** Land-component ids used by worldgen and culture (realm.region, not the connectivity layer). */
  readonly region: Uint32Array;
  /** Connectivity region id per tile (01 section 11): (patchId << 8) | local index; see connectivity.ts. */
  readonly connRegion: Uint32Array;
  /** Per-Patch dirty bits (PATCH_DIRTY). */
  readonly patchDirty: Uint8Array;
  /** Patches whose connectivity the scheduler must rebuild (01 section 10). */
  readonly connDirty: Set<number> = new Set<number>();
  readonly patchesPerAxis: number;
  readonly parcelsPerAxis: number;
  readonly parcel: ParcelCounters;

  readonly burning: SparseSet;
  readonly molten: SparseSet;
  readonly heated: SparseSet;
  readonly scarred: SparseSet;
  readonly slime: SparseSet;
  readonly hollow: SparseSet;
  readonly frozen: SparseSet;

  /** Inclusive row range changed since the last takeDirtyRows(); empty when minRow > maxRow. */
  private minRow = Number.POSITIVE_INFINITY;
  private maxRow = -1;

  constructor(seed: number, sizeStep: number = DEFAULT_SIZE_STEP) {
    this.seed = seed >>> 0;
    this.sizeStep = sizeStep;
    this.side = SIZE_UNIT * sizeStep;
    const n = this.side * this.side;
    this.elevation = new Uint8Array(n);
    this.ground = new Uint8Array(n);
    this.cover = new Uint8Array(n);
    this.flags = new Uint16Array(n);
    this.hp = new Uint8Array(n).fill(10);
    this.scar = new Uint8Array(n);
    this.fireStart = new Uint32Array(n);
    this.heat = new Uint16Array(n);
    this.lavaSince = new Uint32Array(n);
    this.variant = new Uint8Array(n);
    this.flora = new Uint8Array(n);
    this.floraSince = new Uint32Array(n);
    this.floraBlockedUntil = new Uint32Array(n);
    this.region = new Uint32Array(n);
    this.connRegion = new Uint32Array(n);
    this.patchesPerAxis = this.side >> PATCH_SHIFT;
    this.parcelsPerAxis = this.side >> PARCEL_SHIFT;
    this.patchDirty = new Uint8Array(this.patchesPerAxis * this.patchesPerAxis);
    this.parcel = newCounters(this.parcelsPerAxis * this.parcelsPerAxis);
    this.burning = new SparseSet(n);
    this.molten = new SparseSet(n);
    this.heated = new SparseSet(n);
    this.scarred = new SparseSet(n);
    this.slime = new SparseSet(n);
    this.hollow = new SparseSet(n);
    this.frozen = new SparseSet(n);
    for (let y = 0; y < this.side; y++) {
      for (let x = 0; x < this.side; x++) {
        this.variant[y * this.side + x] = hash3(this.seed ^ 0x9e3779b9, x, y) & 0xff;
      }
    }
    this.markAllDirty();
    // Edge ring belongs to the realm border for every template (03 section 5).
    for (let x = 0; x < this.side; x++) {
      this.flags[x] = (this.flags[x] ?? 0) | FLAG.edgeOfRealm;
      this.flags[(this.side - 1) * this.side + x] = (this.flags[(this.side - 1) * this.side + x] ?? 0) | FLAG.edgeOfRealm;
    }
    for (let y = 0; y < this.side; y++) {
      this.flags[y * this.side] = (this.flags[y * this.side] ?? 0) | FLAG.edgeOfRealm;
      this.flags[y * this.side + this.side - 1] = (this.flags[y * this.side + this.side - 1] ?? 0) | FLAG.edgeOfRealm;
    }
    this.recountParcels();
    this.markAllConnectivity();
  }

  get tileCount(): number {
    return this.side * this.side;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.side && y < this.side;
  }

  /** Patch id of tile (x, y): `pi = py * (side/16) + px` (01 section 2). */
  patchAt(x: number, y: number): number {
    return (y >> PATCH_SHIFT) * this.patchesPerAxis + (x >> PATCH_SHIFT);
  }

  /** Parcel id of tile (x, y): `ci = cy * (side/8) + cx` (01 section 2). */
  parcelAt(x: number, y: number): number {
    return (y >> PARCEL_SHIFT) * this.parcelsPerAxis + (x >> PARCEL_SHIFT);
  }

  /** Patch id of tile index i. */
  patchOf(i: number): number {
    const x = i % this.side;
    return this.patchAt(x, (i - x) / this.side);
  }

  /** Parcel id of tile index i. */
  parcelOf(i: number): number {
    const x = i % this.side;
    return this.parcelAt(x, (i - x) / this.side);
  }

  /** Counters recomputed from the arrays (01 section 14 test 4 compares against the incremental ones). */
  computeParcelCounters(): ParcelCounters {
    const c = newCounters(this.parcelsPerAxis * this.parcelsPerAxis);
    for (let i = 0; i < this.tileCount; i++) {
      const p = this.parcelOf(i);
      const layer = ground(this.ground[i] ?? 0).layer;
      if (layer === 'water') c.liquidTiles[p] = (c.liquidTiles[p] ?? 0) + 1;
      else if (layer === 'land') c.groundTiles[p] = (c.groundTiles[p] ?? 0) + 1;
      else if (layer === 'molten') c.lavaCount[p] = (c.lavaCount[p] ?? 0) + 1;
      if (this.hasFlag(i, FLAG.burning)) c.fireCount[p] = (c.fireCount[p] ?? 0) + 1;
      if ((this.flora[i] ?? 0) !== 0) c.floraCount[p] = (c.floraCount[p] ?? 0) + 1;
    }
    return c;
  }

  /** Replaces the incremental counters with a full recount (after bulk writes, and at construction). */
  recountParcels(): void {
    const c = this.computeParcelCounters();
    this.parcel.liquidTiles.set(c.liquidTiles);
    this.parcel.groundTiles.set(c.groundTiles);
    this.parcel.lavaCount.set(c.lavaCount);
    this.parcel.fireCount.set(c.fireCount);
    this.parcel.floraCount.set(c.floraCount);
  }

  /** True when the incremental counters equal a fresh recount (01 section 14 test 4). */
  parcelCountersAgree(): boolean {
    const c = this.computeParcelCounters();
    const pairs: [Uint16Array, Uint16Array][] = [
      [c.liquidTiles, this.parcel.liquidTiles],
      [c.groundTiles, this.parcel.groundTiles],
      [c.lavaCount, this.parcel.lavaCount],
      [c.fireCount, this.parcel.fireCount],
      [c.floraCount, this.parcel.floraCount],
    ];
    return pairs.every(([a, b]) => a.length === b.length && a.every((v, k) => v === b[k]));
  }

  /** Adds `delta` to the counter of a Ground layer in one Parcel. */
  private bumpLayer(p: number, layer: GroundLayer, delta: number): void {
    if (layer === 'water') this.parcel.liquidTiles[p] = (this.parcel.liquidTiles[p] ?? 0) + delta;
    else if (layer === 'land') this.parcel.groundTiles[p] = (this.parcel.groundTiles[p] ?? 0) + delta;
    else if (layer === 'molten') this.parcel.lavaCount[p] = (this.parcel.lavaCount[p] ?? 0) + delta;
  }

  /**
   * Marks the Patch of tile i and its eight neighbour Patches connectivity-dirty (01 section 10).
   * The neighbours are needed because a corner tile can change a diagonal link in a Patch next door.
   */
  markConnectivity(i: number): void {
    const x = i % this.side;
    const y = (i - x) / this.side;
    const px = x >> PATCH_SHIFT;
    const py = y >> PATCH_SHIFT;
    const ppa = this.patchesPerAxis;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const qx = px + dx;
        const qy = py + dy;
        if (qx < 0 || qy < 0 || qx >= ppa || qy >= ppa) continue;
        const q = qy * ppa + qx;
        this.connDirty.add(q);
        this.patchDirty[q] = (this.patchDirty[q] ?? 0) | PATCH_DIRTY.connectivity;
      }
    }
  }

  /** Marks every Patch connectivity-dirty (generation, load, bulk writes). */
  markAllConnectivity(): void {
    const count = this.patchesPerAxis * this.patchesPerAxis;
    for (let p = 0; p < count; p++) {
      this.connDirty.add(p);
      this.patchDirty[p] = (this.patchDirty[p] ?? 0) | PATCH_DIRTY.connectivity;
    }
  }

  /**
   * Writes elevation (clamped 0..255). Ground follows the band table unless the tile is a sea
   * tile being lowered (it becomes a hollow, 04 section 2) or a hollow not yet above the sea band
   * (it stays a pit until raised to land).
   */
  setElevation(i: number, value: number): void {
    const clamped = value < 0 ? 0 : value > 255 ? 255 : value;
    const before = this.elevation[i] ?? 0;
    if (before === clamped) return;
    const g = this.ground[i] ?? 0;
    this.elevation[i] = clamped;
    const derived = GROUND_BY_ELEVATION[clamped] ?? 0;
    if (this.hollow.has(i)) {
      // A pit stays a pit until raised above the shoal band.
      if (clamped >= 101) this.setGround(i, derived);
    } else if (isSpecial(g)) {
      // Molten, slime and charge grounds keep their kind; systems change them.
    } else if (clamped < before && HOLLOW_FOR_SEA[g] !== undefined) {
      // Lowering a sea tile digs a pit of the matching depth (04 section 2).
      this.setGround(i, HOLLOW_FOR_SEA[g] ?? g);
    } else if (derived !== g) {
      this.setGround(i, derived);
    }
    this.markDirty(i);
  }

  /** Sets the ground id and keeps the sparse sets in step (molten, slime, hollow, heated). */
  setGround(i: number, id: number): void {
    const prev = this.ground[i] ?? 0;
    if (prev === id) return;
    this.ground[i] = id;
    const layer = ground(id).layer;
    const prevLayer = ground(prev).layer;
    if (prevLayer !== layer) {
      const p = this.parcelOf(i);
      this.bumpLayer(p, prevLayer, -1);
      this.bumpLayer(p, layer, 1);
      this.markConnectivity(i);
    }
    if (layer === 'molten') this.molten.add(i);
    else this.molten.remove(i);
    if (layer === 'slime') this.slime.add(i);
    else this.slime.remove(i);
    if (id === G.dug_deepmere || id === G.dug_midmere || id === G.dug_shoal) this.hollow.add(i);
    else this.hollow.remove(i);
    this.markDirty(i);
  }

  setCover(i: number, coverId: number): void {
    if (this.cover[i] === coverId) return;
    this.cover[i] = coverId;
    this.markDirty(i);
  }

  setFlag(i: number, bit: number, on: boolean): void {
    const before = this.flags[i] ?? 0;
    const after = on ? before | bit : before & ~bit;
    if (after === before) return;
    this.flags[i] = after;
    if (bit === FLAG.burning) {
      if (on) this.burning.add(i);
      else this.burning.remove(i);
      const p = this.parcelOf(i);
      this.parcel.fireCount[p] = (this.parcel.fireCount[p] ?? 0) + (on ? 1 : -1);
    }
    if (bit === FLAG.frozen) {
      if (on) this.frozen.add(i);
      else this.frozen.remove(i);
    }
    this.markDirty(i);
  }

  hasFlag(i: number, bit: number): boolean {
    return ((this.flags[i] ?? 0) & bit) !== 0;
  }

  setHeat(i: number, value: number): void {
    const v = value < 0 ? 0 : value > 400 ? 400 : value;
    this.heat[i] = v;
    if (v > 0) this.heated.add(i);
    else this.heated.remove(i);
  }

  setScar(i: number, stage: number): void {
    const v = stage < 0 ? 0 : stage > 15 ? 15 : stage;
    this.scar[i] = v;
    if (v > 0) this.scarred.add(i);
    else this.scarred.remove(i);
  }

  setFlora(i: number, kind: number, since: number): void {
    const before = this.flora[i] ?? 0;
    this.flora[i] = kind;
    this.floraSince[i] = since;
    if ((before !== 0) !== (kind !== 0)) {
      const p = this.parcelOf(i);
      this.parcel.floraCount[p] = (this.parcel.floraCount[p] ?? 0) + (kind !== 0 ? 1 : -1);
    }
    this.setFlag(i, FLAG.hasFlora, kind !== 0);
  }

  markDirty(i: number): void {
    const row = Math.floor(i / this.side);
    if (row < this.minRow) this.minRow = row;
    if (row > this.maxRow) this.maxRow = row;
    const p = this.patchOf(i);
    this.patchDirty[p] = (this.patchDirty[p] ?? 0) | PATCH_DIRTY.render | PATCH_DIRTY.minimap;
  }

  markAllDirty(): void {
    this.minRow = 0;
    this.maxRow = this.side - 1;
    this.patchDirty.fill(PATCH_DIRTY.render | PATCH_DIRTY.minimap);
  }

  /** Returns the dirty row range and clears it, or null when nothing changed. */
  takeDirtyRows(): { y0: number; y1: number } | null {
    if (this.maxRow < this.minRow) return null;
    const range = { y0: this.minRow, y1: this.maxRow };
    this.minRow = Number.POSITIVE_INFINITY;
    this.maxRow = -1;
    return range;
  }

  /** Rebuilds every sparse set from the arrays (used after bulk generation writes). */
  rebuildSets(): void {
    for (const s of [this.burning, this.molten, this.heated, this.scarred, this.slime, this.hollow, this.frozen]) s.clear();
    for (let i = 0; i < this.tileCount; i++) {
      if (this.hasFlag(i, FLAG.burning)) this.burning.add(i);
      if (this.hasFlag(i, FLAG.frozen)) this.frozen.add(i);
      if ((this.heat[i] ?? 0) > 0) this.heated.add(i);
      if ((this.scar[i] ?? 0) > 0) this.scarred.add(i);
      const layer = ground(this.ground[i] ?? 0).layer;
      if (layer === 'molten') this.molten.add(i);
      if (layer === 'slime') this.slime.add(i);
      const g = this.ground[i] ?? 0;
      if (g === G.dug_deepmere || g === G.dug_midmere || g === G.dug_shoal) this.hollow.add(i);
    }
    // Bulk writes bypass the mutators, so the counters and connectivity are rebuilt from scratch.
    this.recountParcels();
    this.markAllConnectivity();
  }
}

/** Kinds that are not chosen by elevation: molten, slime, hollows and explosive or placed grounds. */
function isSpecial(id: number): boolean {
  const g = ground(id);
  return g.band === null;
}

