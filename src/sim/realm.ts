import { GROUND_BY_ELEVATION } from '../content/grounds.ts';
import { DEFAULT_SIZE_STEP, SIZE_UNIT } from '../shared/constants.ts';
import { createRng, hash3 } from '../shared/rng.ts';

/**
 * The tile grid as struct-of-arrays (01 section 3, reduced to the M0/M1 fields:
 * elevation, ground, cover, flags, variant). Every write goes through the mutators below
 * so dirty tracking cannot drift.
 */
export class Realm {
  readonly seed: number;
  readonly sizeStep: number;
  readonly side: number;
  readonly elevation: Uint8Array;
  readonly ground: Uint8Array;
  readonly cover: Uint8Array;
  readonly flags: Uint16Array;
  readonly variant: Uint8Array;

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
    this.variant = new Uint8Array(n);
    this.generateBase();
  }

  get tileCount(): number {
    return this.side * this.side;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.side && y < this.side;
  }

  /** Writes elevation (clamped to 0..255) and re-derives ground from it, marking the tile dirty. */
  setElevation(i: number, value: number): void {
    const clamped = value < 0 ? 0 : value > 255 ? 255 : value;
    if (this.elevation[i] === clamped) return;
    this.elevation[i] = clamped;
    this.ground[i] = GROUND_BY_ELEVATION[clamped] ?? 0;
    this.markDirty(i);
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

  /**
   * Seeded base terrain: two octaves of value noise over the grid, mapped to elevation.
   * Full worldgen templates arrive with milestone 2; this is a deterministic stand-in.
   */
  private generateBase(): void {
    const rng = createRng(this.seed);
    const cell = 32;
    const gridSide = Math.ceil(this.side / cell) + 2;
    const lattice = new Float32Array(gridSide * gridSide);
    for (let k = 0; k < lattice.length; k++) lattice[k] = rng.next();
    const sample = (x: number, y: number, scale: number): number => {
      const fx = x / scale;
      const fy = y / scale;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = smooth(fx - x0);
      const ty = smooth(fy - y0);
      const a = lattice[y0 * gridSide + x0] ?? 0;
      const b = lattice[y0 * gridSide + x0 + 1] ?? 0;
      const c = lattice[(y0 + 1) * gridSide + x0] ?? 0;
      const d = lattice[(y0 + 1) * gridSide + x0 + 1] ?? 0;
      return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    };
    for (let y = 0; y < this.side; y++) {
      for (let x = 0; x < this.side; x++) {
        const i = y * this.side + x;
        const h = sample(x, y, cell) * 0.7 + sample(x, y, cell / 4) * 0.3;
        const jitter = (hash3(this.seed, x, y) & 3) - 1.5;
        const e = Math.round(h * 255 + jitter);
        this.elevation[i] = e < 0 ? 0 : e > 255 ? 255 : e;
        this.ground[i] = GROUND_BY_ELEVATION[this.elevation[i] ?? 0] ?? 0;
        this.variant[i] = hash3(this.seed ^ 0x9e3779b9, x, y) & 0xff;
      }
    }
    this.markAllDirty();
  }
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
