import { GROUND_BY_ELEVATION, G, ground } from '../content/grounds.ts';
import { DEFAULT_SIZE_STEP, SIZE_UNIT } from '../shared/constants.ts';
import { hash3 } from '../shared/rng.ts';
import { SparseSet } from './sparse-set.ts';

/** Flag bits in `flags` (01 section 3; bits 5..15 reserved). */
export const FLAG = {
  frozen: 1 << 0,
  burning: 1 << 1,
  edgeOfRealm: 1 << 2,
  hasFlora: 1 << 4,
} as const;

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
  readonly region: Uint32Array;

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
    this.region = new Uint32Array(n);
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
  }

  get tileCount(): number {
    return this.side * this.side;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.side && y < this.side;
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
    if (this.ground[i] === id) return;
    this.ground[i] = id;
    const layer = ground(id).layer;
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
    this.flora[i] = kind;
    this.floraSince[i] = since;
    this.setFlag(i, FLAG.hasFlora, kind !== 0);
  }

  markDirty(i: number): void {
    const row = Math.floor(i / this.side);
    if (row < this.minRow) this.minRow = row;
    if (row > this.maxRow) this.maxRow = row;
  }

  markAllDirty(): void {
    this.minRow = 0;
    this.maxRow = this.side - 1;
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
  }
}

/** Kinds that are not chosen by elevation: molten, slime, hollows and explosive or placed grounds. */
function isSpecial(id: number): boolean {
  const g = ground(id);
  return g.band === null;
}

