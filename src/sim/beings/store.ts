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
    this.slotPos[slot] = this.count;
    this.list[this.count++] = slot;
    return slot;
  }

  /** Removes a being: the slot returns to the free stack and its generation advances. */
  kill(slot: number): void {
    if (this.alive[slot] !== 1) return;
    this.alive[slot] = 0;
    this.generation[slot] = (this.generation[slot] ?? 0) + 1;
    const pos = this.slotPos[slot] ?? -1;
    const last = this.list[--this.count] ?? 0;
    this.list[pos] = last;
    this.slotPos[last] = pos;
    this.slotPos[slot] = -1;
    this.freeStack[this.freeTop++] = slot;
  }

  /** True when a stored (slot, generation) pair still names a living being. */
  isCurrent(slot: number, gen: number): boolean {
    return slot >= 0 && this.alive[slot] === 1 && this.generation[slot] === gen;
  }
}
