/**
 * Lineage code (genome) of a strain (05 section 5): Strands of Slots that hold Segments, budget decomposition
 * (5.3), resonance totals (5.4), slot mutation (5.5) and the code step of `mutateFrom` (6.3).
 *
 * The totals are computed here but not applied to stats. 05 section 6.2 adds them to the species base, and the
 * species budget used by `speciesBudget` is read from the species base, so applying them would double it. Until
 * the data holds a real budget table, the genome is state that mutation and persistence carry (DECISIONS.md,
 * "Beings round 7"). Pure apart from the rng the caller passes in (named stream `lineage`).
 */
import type { SpeciesDef } from '../../content/beasts.ts';
import { createRng, hash3, type Rng } from '../../shared/rng.ts';

/** Stats a Segment can carry (05 section 1 keys, plus the gated tempo and scale). */
export type SegmentStat =
  | 'vitality'
  | 'endurance'
  | 'pace'
  | 'span'
  | 'might'
  | 'plating'
  | 'litter'
  | 'rapport'
  | 'valor'
  | 'husbandry'
  | 'wit'
  | 'brood'
  | 'tempo'
  | 'scale';

export interface SegmentKind {
  id: string;
  stat: SegmentStat | null;
  value: number;
  /** Connects to any non-empty neighbour and never doubles (05 section 5.4). */
  alwaysResonant: boolean;
  flaw: boolean;
  /** Pairing kinds add their neighbours' stats to one sex-only block (05 section 5.4). */
  pairing: 'male' | 'female' | null;
  /** Volatile kinds add 1 to the strain meta mutation total (05 section 5.1). */
  volatile: boolean;
  /** Gated kinds are never placed by decomposition or mutation until unlocked (05 section 5.2, 10). */
  gated: boolean;
}

/** Tier ladder per stat (05 section 5.2, TUNE). Gated rows exist from day one and are never placed. */
const LADDER: readonly [SegmentStat, readonly number[], boolean][] = [
  ['vitality', [2, 10, 50, 120, 300], false],
  ['endurance', [10, 50, 100], false],
  ['pace', [1, 2, 5], false],
  ['span', [5, 20, 50, 100], false],
  ['might', [1, 6, 10], false],
  ['plating', [1, 6, 10], false],
  ['litter', [1, 3, 5, 10], false],
  ['rapport', [1, 2, 3], false],
  ['valor', [1, 2, 3], false],
  ['husbandry', [1, 2, 3], false],
  ['wit', [1, 2, 3], false],
  ['tempo', [1], true],
  ['scale', [0.03, -0.01], true],
  ['brood', [1], false],
];

const statKind = (s: SegmentStat, value: number, gated: boolean): SegmentKind => ({
  id: `${s}:${value}`,
  stat: s,
  value,
  alwaysResonant: false,
  flaw: false,
  pairing: null,
  volatile: false,
  gated,
});

/** Every Segment kind, in library order. A kind's index is its code in saves and its key in resonance. */
export const SEGMENT_KINDS: readonly SegmentKind[] = [
  ...LADDER.flatMap(([s, values, gated]) => values.map((v) => statKind(s, v, gated))),
  { id: 'pair:male', stat: null, value: 0, alwaysResonant: true, flaw: false, pairing: 'male', volatile: false, gated: false },
  { id: 'pair:female', stat: null, value: 0, alwaysResonant: true, flaw: false, pairing: 'female', volatile: false, gated: false },
  { id: 'flaw', stat: null, value: 0, alwaysResonant: false, flaw: true, pairing: null, volatile: false, gated: false },
  { id: 'volatile', stat: null, value: 0, alwaysResonant: true, flaw: false, pairing: null, volatile: true, gated: false },
];

const SEGMENT_BY_ID = new Map(SEGMENT_KINDS.map((k) => [k.id, k]));
const SEGMENT_INDEX = new Map(SEGMENT_KINDS.map((k, i) => [k.id, i]));

/** Fillers (05 section 5.2): the smallest rung of vitality, endurance, might, plating and each Attribute, plus the flaw. */
const FILLERS: readonly string[] = ['vitality:2', 'endurance:10', 'might:1', 'plating:1', 'rapport:1', 'valor:1', 'husbandry:1', 'wit:1', 'flaw'];

/** Kinds that random mutation may write (05 section 5.5: any kind except the gated ones). */
const MUTATION_POOL: readonly string[] = SEGMENT_KINDS.filter((k) => !k.gated).map((k) => k.id);

/** Kinds decomposition may place for a stat, gated kinds excluded. */
const CANDIDATES = new Map<string, SegmentKind[]>();
for (const k of SEGMENT_KINDS) {
  if (k.stat === null || k.gated) continue;
  const list = CANDIDATES.get(k.stat) ?? [];
  list.push(k);
  CANDIDATES.set(k.stat, list);
}

/** Strand shapes (05 section 5.1, 5.3). Capacity is a multiple of the 6 columns; the special counts are the 5.3 ranges. */
export const STRAND_TYPES = ['tiny', 'short', 'mid', 'long'] as const;
export type StrandType = (typeof STRAND_TYPES)[number];
const SHAPE: Record<StrandType, { capacity: number; boosters: readonly [number, number]; blocked: readonly [number, number] }> = {
  tiny: { capacity: 12, boosters: [0, 1], blocked: [1, 2] },
  short: { capacity: 18, boosters: [1, 2], blocked: [2, 3] },
  mid: { capacity: 24, boosters: [1, 2], blocked: [3, 4] },
  long: { capacity: 30, boosters: [1, 3], blocked: [4, 7] },
};
const COLUMNS = 6;

export type Special = 'booster' | 'blocked' | null;

export interface Strand {
  type: StrandType;
  /** Segment kind id, or null when empty. Blocked slots are always null. */
  slots: (string | null)[];
  specials: Special[];
}

export interface Genome {
  strands: Strand[];
  /** Salt the code was seeded with (05 sections 5.3 and 6.3, range 0..55555). */
  seedSalt: number;
}

export const SEED_SALT_RANGE = 55556;

/** Budget per stat (05 section 5.1). Pseudo-stats `pairing`, `flaw` and `volatile` place those kinds directly. */
export type GenomeBudget = Partial<Record<SegmentStat | 'pairing' | 'flaw' | 'volatile', number>>;

const PSEUDO = new Set(['pairing', 'flaw', 'volatile']);

/**
 * The species budget. The data holds no budget table, so it is read from the species base stats (a TUNE
 * stand-in; see the module comment).
 */
export function speciesBudget(def: SpeciesDef): GenomeBudget {
  return {
    vitality: def.vitality,
    endurance: def.endurance,
    might: def.might,
    pace: def.pace,
    span: def.span,
    plating: def.plating,
    litter: def.litter,
  };
}

/** Fisher-Yates on a copy; draws from the given rng only. */
function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}

/** Budget -> Segment ids (05 section 5.3). Pseudo-stats first, then up to 300 rounds over the stats. */
function decompose(budget: GenomeBudget, rng: Rng): string[] {
  const segs: string[] = [];
  for (let n = 0; n < (budget.pairing ?? 0); n++) segs.push(rng.int(2) === 0 ? 'pair:male' : 'pair:female');
  for (let n = 0; n < (budget.flaw ?? 0); n++) segs.push('flaw');
  for (let n = 0; n < (budget.volatile ?? 0); n++) segs.push('volatile');

  const left: Record<string, number> = {};
  for (const [key, value] of Object.entries(budget)) {
    if (!PSEUDO.has(key) && typeof value === 'number' && value > 0) left[key] = value;
  }
  for (let round = 0; round < 300; round++) {
    let progressed = false;
    for (const key of Object.keys(left)) {
      const remaining = left[key] ?? 0;
      if (remaining <= 0) continue;
      const cands = CANDIDATES.get(key) ?? [];
      // Descending by value with 80% chance, else shuffled (5.3).
      const ordered = rng.next() < 0.8 ? [...cands].sort((a, b) => b.value - a.value) : shuffle(cands, rng);
      const pick = ordered.find((k) => k.value <= remaining);
      if (pick) {
        left[key] = remaining - pick.value;
        segs.push(pick.id);
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return shuffle(segs, rng);
}

/** A new Strand of the given type: blocked slots first, then boosters from the usable ones (5.3). */
function makeStrand(type: StrandType, rng: Rng): Strand {
  const shape = SHAPE[type];
  const n = shape.capacity;
  const order = shuffle(
    Array.from({ length: n }, (_, i) => i),
    rng,
  );
  const blockedCount = Math.min(shape.blocked[0] + rng.int(shape.blocked[1] - shape.blocked[0] + 1), n - 1);
  const boosterCount = shape.boosters[0] + rng.int(shape.boosters[1] - shape.boosters[0] + 1);
  const specials: Special[] = Array.from({ length: n }, () => null);
  for (let k = 0; k < blockedCount; k++) specials[order[k] as number] = 'blocked';
  const usable = order.slice(blockedCount);
  for (let k = 0; k < Math.min(boosterCount, usable.length - 1); k++) specials[usable[k] as number] = 'booster';
  return { type, slots: Array.from({ length: n }, () => null), specials };
}

/** First empty usable slot of a strand, or -1. */
function freeSlot(strand: Strand): number {
  return strand.slots.findIndex((kind, i) => kind === null && strand.specials[i] !== 'blocked');
}

/**
 * Builds a fresh code for one strain (05 section 5.3). The seed is hash(worldSeed, speciesIndex, salt), so a
 * strain's code is a function of the world, its species and its salt only.
 */
export function newGenome(budget: GenomeBudget, worldSeed: number, speciesIndex: number, salt: number): Genome {
  const rng = createRng(hash3(worldSeed, speciesIndex, salt));
  const segs = decompose(budget, rng);
  const strands: Strand[] = [makeStrand(STRAND_TYPES[rng.int(STRAND_TYPES.length)] ?? 'mid', rng)];
  for (const id of segs) {
    let strand = strands[strands.length - 1] as Strand;
    let slot = freeSlot(strand);
    if (slot < 0) {
      strand = makeStrand(STRAND_TYPES[rng.int(STRAND_TYPES.length)] ?? 'mid', rng);
      strands.push(strand);
      slot = freeSlot(strand);
    }
    strand.slots[slot] = id;
  }
  // Fill every empty usable slot with a filler (the flaw among them).
  for (const strand of strands) {
    for (let i = 0; i < strand.slots.length; i++) {
      if (strand.slots[i] === null && strand.specials[i] !== 'blocked') strand.slots[i] = FILLERS[rng.int(FILLERS.length)] ?? null;
    }
  }
  // Final shuffle: lift every kind out and redistribute it over the usable slots of all strands.
  const positions: [Strand, number][] = [];
  for (const strand of strands) {
    for (let i = 0; i < strand.slots.length; i++) if (strand.specials[i] !== 'blocked') positions.push([strand, i]);
  }
  const kinds = shuffle(
    positions.map(([s, i]) => s.slots[i] ?? null),
    rng,
  );
  positions.forEach(([s, i], k) => {
    s.slots[i] = kinds[k] ?? null;
  });
  return { strands, seedSalt: salt };
}

/** Mutates one random usable slot of a strand to a uniformly random kind (05 section 5.5). Booster and blocked slots are skipped. */
export function mutateSlot(strand: Strand, rng: Rng): void {
  const usable: number[] = [];
  for (let i = 0; i < strand.slots.length; i++) if (strand.specials[i] === null) usable.push(i);
  if (usable.length === 0) return;
  const slot = usable[rng.int(usable.length)] as number;
  strand.slots[slot] = MUTATION_POOL[rng.int(MUTATION_POOL.length)] ?? null;
}

/**
 * The code step of `mutateFrom` (05 section 6.3): a copy with `k + 1` slot mutations per Strand, and a new seed
 * salt for the child. The parent's code is not changed.
 */
export function mutateGenome(genome: Genome, k: number, rng: Rng): Genome {
  const strands: Strand[] = genome.strands.map((s) => ({ type: s.type, slots: [...s.slots], specials: [...s.specials] }));
  for (const strand of strands) for (let n = 0; n <= k; n++) mutateSlot(strand, rng);
  return { strands, seedSalt: rng.int(SEED_SALT_RANGE) };
}

/** Totals by block (05 section 5.4). Computed on demand; not saved. */
export interface GenomeTotals {
  base: Partial<Record<SegmentStat, number>>;
  meta: { mutation: number };
  male: Partial<Record<SegmentStat, number>>;
  female: Partial<Record<SegmentStat, number>>;
}

/** Edge key of a kind on one side (05 5.4): hash(worldSeed, kindIndex, side) mod 4. Sides: 0 left, 1 right, 2 up, 3 down. */
function edgeKey(worldSeed: number, kindIndex: number, side: number): number {
  return hash3(worldSeed ^ 0x2545f491, kindIndex, side) & 3;
}

/** Scales a value for a flaw (half, floored for integers) or full resonance (double). */
function scaled(value: number, factor: 'half' | 'one' | 'double'): number {
  if (factor === 'double') return value * 2;
  if (factor === 'one') return value;
  return Number.isInteger(value) ? Math.floor(value / 2) : value / 2;
}

/**
 * Resonance and flaw totals of a code (05 section 5.4). The sides of a slot are its usable 4-neighbours inside
 * the same strand; edges and blocked slots are not required sides.
 */
export function genomeTotals(genome: Genome, worldSeed: number): GenomeTotals {
  const totals: GenomeTotals = { base: {}, meta: { mutation: 0 }, male: {}, female: {} };
  const add = (block: Partial<Record<SegmentStat, number>>, key: SegmentStat, value: number): void => {
    block[key] = (block[key] ?? 0) + value;
  };
  for (const strand of genome.strands) {
    const n = strand.slots.length;
    const kindAt = (i: number): SegmentKind | undefined => {
      const id = strand.slots[i];
      return id ? SEGMENT_BY_ID.get(id) : undefined;
    };
    const neighbours = (i: number): { side: number; j: number }[] => {
      const out: { side: number; j: number }[] = [];
      const c = i % COLUMNS;
      if (c > 0) out.push({ side: 0, j: i - 1 });
      if (c < COLUMNS - 1) out.push({ side: 1, j: i + 1 });
      if (i >= COLUMNS) out.push({ side: 2, j: i - COLUMNS });
      if (i + COLUMNS < n) out.push({ side: 3, j: i + COLUMNS });
      return out.filter(({ j }) => strand.specials[j] !== 'blocked');
    };
    const connects = (i: number, ki: SegmentKind, side: number, j: number, kj: SegmentKind): boolean => {
      const spA = strand.specials[i] === 'booster' || ki.alwaysResonant;
      const spB = strand.specials[j] === 'booster' || kj.alwaysResonant;
      if (spA && spB) return ki.flaw || kj.flaw;
      if (spA || spB) return true;
      const ia = SEGMENT_INDEX.get(ki.id) ?? 0;
      const ib = SEGMENT_INDEX.get(kj.id) ?? 0;
      return edgeKey(worldSeed, ia, side) === edgeKey(worldSeed, ib, side ^ 1);
    };
    for (let i = 0; i < n; i++) {
      const kind = kindAt(i);
      if (!kind || strand.specials[i] === 'blocked') continue;
      const nb = neighbours(i);
      const flawNear = nb.some(({ j }) => kindAt(j)?.flaw === true);
      let factor: 'half' | 'one' | 'double' = 'one';
      if (flawNear) factor = 'half';
      else if (!kind.alwaysResonant && nb.length > 0) {
        const all = nb.every(({ side, j }) => {
          const kj = kindAt(j);
          return kj !== undefined && connects(i, kind, side, j, kj);
        });
        if (all) factor = 'double';
      }
      if (kind.stat !== null && kind.value !== 0) add(totals.base, kind.stat, scaled(kind.value, factor));
      if (kind.volatile) totals.meta.mutation += scaled(1, factor);
      if (kind.pairing !== null) {
        const block = kind.pairing === 'male' ? totals.male : totals.female;
        const pf = flawNear ? 'half' : 'one';
        for (const { j } of nb) {
          const kj = kindAt(j);
          if (kj?.stat) add(block, kj.stat, scaled(kj.value, pf));
        }
      }
    }
  }
  return totals;
}

/** Index of a Segment kind id in the library, or -1 when unknown. The save code is index + 1. */
export function segmentIndex(id: string): number {
  return SEGMENT_INDEX.get(id) ?? -1;
}

/** Usable slot count of a strand type before specials are placed (its capacity). */
export function strandCapacity(type: StrandType): number {
  return SHAPE[type].capacity;
}
