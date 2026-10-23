import type { Rng } from "../shared/rng.ts";

/**
 * Shuffled-permutation runner (01 section 12.3): visits every tile once per lap in a seeded random
 * order, a fixed budget per run. Cost per run is O(budget), not O(area).
 */
export class Runner {
  private readonly order: Uint32Array;
  private cursor = 0;

  constructor(size: number, rng: Rng) {
    this.order = new Uint32Array(size);
    for (let i = 0; i < size; i++) this.order[i] = i;
    for (let i = size - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      const t = this.order[i] ?? 0;
      this.order[i] = this.order[j] ?? 0;
      this.order[j] = t;
    }
  }

  /** Saved form: the lap order and the cursor. */
  snapshot(): { order: number[]; cursor: number } {
    return { order: Array.from(this.order), cursor: this.cursor };
  }

  /** Restores a snapshot taken from a runner of the same size. */
  restore(snap: { order: readonly number[]; cursor: number }): void {
    if (snap.order.length !== this.order.length) throw new RangeError("runner size mismatch");
    for (let i = 0; i < snap.order.length; i++) this.order[i] = snap.order[i] ?? 0;
    this.cursor = snap.cursor;
  }

  /** Next tile index in the lap order. */
  next(): number {
    const v = this.order[this.cursor] ?? 0;
    this.cursor = (this.cursor + 1) % this.order.length;
    return v;
  }
}
