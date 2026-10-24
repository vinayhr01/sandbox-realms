/**
 * Sparse set of tile indices (01 section 3). Membership changes only through add/remove, so
 * activity-proportional sweeps stay consistent with the tile arrays. O(1) everything, no allocation
 * after construction.
 */
export class SparseSet {
  private readonly members: Uint32Array;
  private readonly slot: Int32Array;
  private count = 0;

  constructor(capacity: number) {
    this.members = new Uint32Array(capacity);
    this.slot = new Int32Array(capacity).fill(-1);
  }

  get size(): number {
    return this.count;
  }

  has(i: number): boolean {
    return (this.slot[i] ?? -1) !== -1;
  }

  add(i: number): void {
    if (this.slot[i] !== -1) return;
    this.slot[i] = this.count;
    this.members[this.count++] = i;
  }

  remove(i: number): void {
    const s = this.slot[i];
    if (s === undefined || s === -1) return;
    const last = this.members[--this.count] ?? 0;
    this.members[s] = last;
    this.slot[last] = s;
    this.slot[i] = -1;
  }

  /** Member at position k (0 <= k < size). Iteration order is insertion-with-swap, deterministic. */
  at(k: number): number {
    return this.members[k] ?? 0;
  }

  clear(): void {
    for (let k = 0; k < this.count; k++) this.slot[this.members[k] ?? 0] = -1;
    this.count = 0;
  }
}
