/**
 * Being store (17 section 4): struct-of-arrays with a dense alive list, a free-slot stack and
 * generation counters so stale references resolve to nothing. Capacity is fixed per quality tier.
 */
export const MAX_BEINGS = 4096;

export class BeingStore {
  readonly capacity: number;
  readonly alive: Uint8Array;
  readonly species: Uint8Array;
  readonly x: Uint16Array;
  readonly y: Uint16Array;
  readonly vit: Int16Array;
  readonly maxVit: Uint16Array;
  /** Fuel 0..100 (06 section 2). */
  readonly fuel: Uint8Array;
  readonly female: Uint8Array;
  /** Tick of birth; negative for adults spawned with an adult age. */
  readonly born: Int32Array;
  readonly generation: Uint32Array;
  readonly nextDecision: Uint32Array;
  /** Tick before which the being will not mate again (06 `lull`). */
  readonly lull: Uint32Array;
  /** Pregnancy: 1 while expecting; the tick it ends and the brood size. */
  readonly expecting: Uint8Array;
  readonly expectUntil: Uint32Array;
  readonly brood: Uint8Array;
  readonly moveAcc: Float32Array;
  /** Slot of the mate chosen this decision, or -1. */
  readonly mate: Int32Array;
  readonly mateGen: Uint32Array;
  /** Strain id (strains.ts), 0 for none. */
  readonly strain: Uint32Array;
  /** Parent (bearer) slot and its generation at link time; parent -1 for founders (06 section 6.1). */
  readonly parent: Int32Array;
  readonly parentGen: Uint32Array;
  /** Living children linked to this slot; kept by kill() and rebuilt on load (06 section 9). */
  readonly childCount: Uint16Array;
  /** Stored aptitudes rapport, valor, husbandry, wit (05 section 4): 4 per slot. */
  readonly attrs: Uint16Array;
  /** Marks (18b being traits): 5 words of 32 bits per slot (144 traits). */
  readonly marks: Uint32Array;
  /** 1 while the Being is a child (06 section 3.2). */
  readonly baby: Uint8Array;
  /** Assembled stats (05 section 3), recomputed by refreshStats; not saved. */
  readonly paceA: Float32Array;
  readonly mightA: Float32Array;
  readonly spanA: Float32Array;
  readonly litterA: Float32Array;
  readonly broodA: Float32Array;
  readonly metabolismA: Float32Array;
  readonly adultA: Float32Array;
  readonly gestationA: Float32Array;

  private readonly list: Uint32Array;
  private readonly slotPos: Int32Array;
  private readonly freeStack: Uint32Array;
  private freeTop: number;
  private count = 0;

  constructor(capacity: number = MAX_BEINGS) {
    this.capacity = capacity;
    this.alive = new Uint8Array(capacity);
    this.species = new Uint8Array(capacity);
    this.x = new Uint16Array(capacity);
    this.y = new Uint16Array(capacity);
    this.vit = new Int16Array(capacity);
    this.maxVit = new Uint16Array(capacity);
    this.fuel = new Uint8Array(capacity);
    this.female = new Uint8Array(capacity);
    this.born = new Int32Array(capacity);
    this.generation = new Uint32Array(capacity);
    this.nextDecision = new Uint32Array(capacity);
    this.lull = new Uint32Array(capacity);
    this.expecting = new Uint8Array(capacity);
    this.expectUntil = new Uint32Array(capacity);
    this.brood = new Uint8Array(capacity);
    this.moveAcc = new Float32Array(capacity);
    this.mate = new Int32Array(capacity).fill(-1);
    this.mateGen = new Uint32Array(capacity);
    this.strain = new Uint32Array(capacity);
    this.parent = new Int32Array(capacity).fill(-1);
    this.parentGen = new Uint32Array(capacity);
    this.childCount = new Uint16Array(capacity);
    this.attrs = new Uint16Array(capacity * 4);
    this.marks = new Uint32Array(capacity * 5);
    this.baby = new Uint8Array(capacity);
    this.paceA = new Float32Array(capacity);
    this.mightA = new Float32Array(capacity);
    this.spanA = new Float32Array(capacity);
    this.litterA = new Float32Array(capacity);
    this.broodA = new Float32Array(capacity);
    this.metabolismA = new Float32Array(capacity);
    this.adultA = new Float32Array(capacity);
    this.gestationA = new Float32Array(capacity);
    this.list = new Uint32Array(capacity);
    this.slotPos = new Int32Array(capacity).fill(-1);
    this.freeStack = new Uint32Array(capacity);
    this.freeTop = capacity;
    for (let s = 0; s < capacity; s++) this.freeStack[s] = capacity - 1 - s;
  }

  /** Number of living beings. */
  get size(): number {
    return this.count;
  }

  /** Slot of the k-th living being (0 <= k < size). */
  at(k: number): number {
    return this.list[k] ?? 0;
  }

  /** Allocates a slot and makes the being alive; returns -1 when the store is full. */
  spawn(species: number, x: number, y: number, born: number, vit: number, fuel: number, female: number): number {
    if (this.freeTop === 0) return -1;
    const slot = this.freeStack[--this.freeTop] ?? 0;
    this.alive[slot] = 1;
    this.species[slot] = species;
    this.x[slot] = x;
    this.y[slot] = y;
    this.maxVit[slot] = vit;
    this.vit[slot] = vit;
    this.fuel[slot] = fuel;
    this.female[slot] = female;
    this.born[slot] = born;
    this.nextDecision[slot] = 0;
    this.lull[slot] = 0;
    this.expecting[slot] = 0;
    this.expectUntil[slot] = 0;
    this.brood[slot] = 0;
    this.moveAcc[slot] = 0;
    this.mate[slot] = -1;
    this.strain[slot] = 0;
    this.parent[slot] = -1;
    this.parentGen[slot] = 0;
    this.childCount[slot] = 0;
    this.attrs.fill(0, slot * 4, slot * 4 + 4);
    this.marks.fill(0, slot * 5, slot * 5 + 5);
    this.baby[slot] = 0;
    this.slotPos[slot] = this.count;
    this.list[this.count++] = slot;
    return slot;
  }

  /** Links a child to its bearer (06 section 6.1). The bearer's living-children count goes up. */
  setParent(child: number, parent: number): void {
    this.parent[child] = parent;
    this.parentGen[child] = this.generation[parent] ?? 0;
    this.childCount[parent] = (this.childCount[parent] ?? 0) + 1;
  }

  /** True when the child's parent link names a living parent (the stored generation still matches). */
  hasLiveParent(child: number): boolean {
    const p = this.parent[child] ?? -1;
    return p >= 0 && this.isCurrent(p, this.parentGen[child] ?? 0);
  }

  hasMark(slot: number, index: number): boolean {
    return ((this.marks[slot * 5 + (index >> 5)] ?? 0) & (1 << (index & 31))) !== 0;
  }

  setMark(slot: number, index: number, on: boolean): void {
    const k = slot * 5 + (index >> 5);
    const bit = 1 << (index & 31);
    this.marks[k] = on ? (this.marks[k] ?? 0) | bit : (this.marks[k] ?? 0) & ~bit;
  }

  /** Removes a being: the slot returns to the free stack and its generation advances. */
  kill(slot: number): void {
    if (this.alive[slot] !== 1) return;
    if (this.hasLiveParent(slot)) {
      const p = this.parent[slot] ?? -1;
      if ((this.childCount[p] ?? 0) > 0) this.childCount[p] = (this.childCount[p] ?? 0) - 1;
    }
    this.alive[slot] = 0;
    this.generation[slot] = (this.generation[slot] ?? 0) + 1;
    const pos = this.slotPos[slot] ?? -1;
    const last = this.list[--this.count] ?? 0;
    this.list[pos] = last;
    this.slotPos[last] = pos;
    this.slotPos[slot] = -1;
    this.freeStack[this.freeTop++] = slot;
  }

  /** Saved layout: the alive list in iteration order and the free-slot stack (bottom to top). */
  layout(): { list: number[]; free: number[] } {
    const list: number[] = [];
    for (let k = 0; k < this.count; k++) list.push(this.list[k] ?? 0);
    const free: number[] = [];
    for (let k = 0; k < this.freeTop; k++) free.push(this.freeStack[k] ?? 0);
    return { list, free };
  }

  /**
   * Restores a layout from layout(). The caller has already set alive[], generation[] and the
   * per-being fields. Iteration order and future slot allocation then match the saved sim exactly.
   */
  restoreLayout(list: readonly number[], free: readonly number[]): void {
    // Checked before anything is touched: every slot in range, named once, and a free slot is never live.
    const seen = new Uint8Array(this.capacity);
    const inRange = (slot: number): boolean => Number.isInteger(slot) && slot >= 0 && slot < this.capacity;
    for (const slot of list) {
      if (!inRange(slot) || seen[slot] === 1) throw new Error(`beings: layout names bad live slot ${slot}`);
      seen[slot] = 1;
    }
    for (const slot of free) {
      if (!inRange(slot) || seen[slot] === 1) throw new Error(`beings: layout names bad free slot ${slot}`);
      seen[slot] = 1;
    }
    if (list.length + free.length > this.capacity) throw new Error('beings: layout larger than capacity');
    this.alive.fill(0);
    this.slotPos.fill(-1);
    for (let k = 0; k < list.length; k++) {
      const slot = list[k] ?? 0;
      this.alive[slot] = 1;
      this.list[k] = slot;
      this.slotPos[slot] = k;
    }
    this.count = list.length;
    for (let k = 0; k < free.length; k++) this.freeStack[k] = free[k] ?? 0;
    this.freeTop = free.length;
  }

  /** Recounts living children from the parent links (after a load; 06 section 9). */
  rebuildChildCounts(): void {
    this.childCount.fill(0);
    for (let k = 0; k < this.count; k++) {
      const slot = this.at(k);
      if (this.hasLiveParent(slot)) {
        const p = this.parent[slot] ?? -1;
        this.childCount[p] = (this.childCount[p] ?? 0) + 1;
      }
    }
  }

  /** True when a stored (slot, generation) pair still names a living being. */
  isCurrent(slot: number, gen: number): boolean {
    return slot >= 0 && this.alive[slot] === 1 && this.generation[slot] === gen;
  }
}
