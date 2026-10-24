import { SIZE_RANK, SPECIES, speciesIndex, type SpeciesDef } from '../../content/beasts.ts';
import { ground } from '../../content/grounds.ts';
import { BEING_TRAITS, BEING_TRAIT_INDEX, BIRTH_POT } from '../../content/traits.ts';
import { FLORA, FLORA_BY_ID, grazeFlora } from '../flora.ts';
import type { Realm } from '../realm.ts';
import type { Sim } from '../sim.ts';
import { recordStat } from '../stats-hooks.ts';
import { assemble, type Assembled } from './assembly.ts';
import { BeingStore } from './store.ts';
import { strainMutation, Strains, addStrainTrait } from './strains.ts';
import { TUNING } from './tuning.ts';
import { MONTH_TICKS, YEAR_TICKS } from '../../shared/constants.ts';

export type { BeingStore };

/** Ticks between fuel passes (06 section 2.1: 100 passes fill a 100-point bar at metabolism 1). */
const FUEL_PASS = 300;
/** Ticks between natural-death rolls (06 section 3.5). */
const DEATH_ROLL = 20;
/** Ticks between vitality regeneration steps when fed; also the cadence of the growing-up check. */
const REGEN = 60;
/** Mating lull after a birth, in ticks (06 section 6.1). */
const LULL = 1800;
/** Fuel at or below which a being is hungry (06 section 2.1). */
const HUNGRY_AT = 50;
/** Cap on live beings (06 section 8, TUNE; the quality tier caps the array). */
const WORLD_CAP = 4096;
/** Spatial bucket side in tiles. */
const BUCKET = 8;
/** Beasts breed only with fewer than this many other beings in their 16x16 patch (06 section 6.1). */
const BREEDING_CROWD = 6;
/** Same-species members within this many tiles share a strain (05 section 6.1, strainJoinRadius). */
const STRAIN_JOIN_RADIUS = 40;
/** Ticks per simulated Year (02 section 1). */
const YEAR = YEAR_TICKS;

const DIRS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

/** Counters read by the HUD and tests. */
export interface BeingStats {
  /** Newborn children (06 6.6 counters.born). Adults are counted in newAdults (05 section 2). */
  births: number;
  newAdults: number;
  deaths: number;
  starved: number;
  eaten: number;
  aged: number;
}

/** Per-species derived values. */
interface SpeciesRuntime {
  def: SpeciesDef;
  hunters: number[];
  prey: number[];
}

/**
 * Beings subsystem: the store, a spatial bucket grid, strains, and the life cycle (fuel, regeneration,
 * ageing and death, decisions and movement, mating and births). One instance per Sim.
 */
export class Beings {
  readonly store = new BeingStore();
  readonly strains = new Strains();
  readonly stats: BeingStats = { births: 0, newAdults: 0, deaths: 0, starved: 0, eaten: 0, aged: 0 };
  readonly runtime: readonly SpeciesRuntime[];
  private readonly cellsPerRow: number;
  private readonly head: Int32Array;
  private readonly link: Int32Array;

  constructor(side: number) {
    this.cellsPerRow = Math.ceil(side / BUCKET);
    this.head = new Int32Array(this.cellsPerRow * this.cellsPerRow).fill(-1);
    this.link = new Int32Array(this.store.capacity).fill(-1);
    this.runtime = SPECIES.map((def) => ({
      def,
      hunters: def.hunters.map((h) => speciesIndex(h)),
      prey: def.prey.map((p) => speciesIndex(p)),
    }));
  }

  species(index: number): SpeciesDef {
    return this.runtime[index]?.def ?? SPECIES[0]!;
  }

  /** Rebuilds the bucket grid from the alive list (17 section 5). */
  rebuildBuckets(): void {
    this.head.fill(-1);
    const s = this.store;
    for (let k = 0; k < s.size; k++) {
      const slot = s.at(k);
      const c = Math.floor((s.y[slot] ?? 0) / BUCKET) * this.cellsPerRow + Math.floor((s.x[slot] ?? 0) / BUCKET);
      this.link[slot] = this.head[c] ?? -1;
      this.head[c] = slot;
    }
  }

  /** Living beings other than `self` inside the 16x16 patch that contains (x,y). */
  crowdInPatch(self: number, x: number, y: number): number {
    const s = this.store;
    const px = Math.floor(x / 16) * 16;
    const py = Math.floor(y / 16) * 16;
    let n = 0;
    for (let k = 0; k < s.size; k++) {
      const o = s.at(k);
      if (o === self) continue;
      const ox = s.x[o] ?? 0;
      const oy = s.y[o] ?? 0;
      if (ox >= px && ox < px + 16 && oy >= py && oy < py + 16) n++;
    }
    return n;
  }

  /**
   * Nearest living being within `radius` tiles (Chebyshev) that passes `pred`, excluding `self`.
   * Returns the slot or -1. Ties resolve to the lower slot for determinism.
   */
  nearest(self: number, pred: (slot: number) => boolean, radius: number): number {
    const s = this.store;
    const x = s.x[self] ?? 0;
    const y = s.y[self] ?? 0;
    const c0x = Math.max(0, Math.floor((x - radius) / BUCKET));
    const c1x = Math.min(this.cellsPerRow - 1, Math.floor((x + radius) / BUCKET));
    const c0y = Math.max(0, Math.floor((y - radius) / BUCKET));
    const c1y = Math.min(this.cellsPerRow - 1, Math.floor((y + radius) / BUCKET));
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        for (let o = this.head[cy * this.cellsPerRow + cx] ?? -1; o !== -1; o = this.link[o] ?? -1) {
          if (o === self || !pred(o)) continue;
          const dx = (s.x[o] ?? 0) - x;
          const dy = (s.y[o] ?? 0) - y;
          if (Math.max(Math.abs(dx), Math.abs(dy)) > radius) continue;
          const dd = dx * dx + dy * dy;
          if (dd < bestD || (dd === bestD && o < best)) {
            bestD = dd;
            best = o;
          }
        }
      }
    }
    return best;
  }
}

function walkable(realm: Realm, i: number): boolean {
  const kind = ground(realm.ground[i] ?? 0);
  return kind.layer === 'land' && kind.damages === 0;
}

/** Whether a species eats at all (06 section 2.1: `none` never gets hungry). */
function needsFood(def: SpeciesDef): boolean {
  return def.diet !== 'none';
}

/** The being's trait ids, in index order (18b being traits). Scans the five mark words, skipping empty ones. */
function markIds(s: BeingStore, slot: number): string[] {
  const ids: string[] = [];
  for (let w = 0; w < 5; w++) {
    let bits = s.marks[slot * 5 + w] ?? 0;
    while (bits !== 0) {
      const low = bits & -bits;
      const k = w * 32 + (31 - Math.clz32(low));
      if (k < BEING_TRAITS.length) ids.push(BEING_TRAITS[k]!.id);
      bits &= bits - 1;
    }
  }
  return ids;
}

/**
 * Recomputes a being's assembled stats (05 section 3) and stores them. Called on spawn, on birth, on
 * growing up and after a load. A child is recomputed as a child until its age reaches its adult age.
 */
export function refreshStats(sim: Sim, slot: number): void {
  const b = sim.beings;
  const s = b.store;
  const def = b.species(s.species[slot] ?? 0);
  const strain = b.strains.get(s.strain[slot] ?? 0);
  const input = {
    species: def,
    strainTraits: strain?.traits ?? [],
    generation: strain?.generation ?? 0,
    beingTraits: markIds(s, slot),
    attrs: {
      rapport: s.attrs[slot * 4] ?? 0,
      valor: s.attrs[slot * 4 + 1] ?? 0,
      husbandry: s.attrs[slot * 4 + 2] ?? 0,
      wit: s.attrs[slot * 4 + 3] ?? 0,
    },
    // Items hook (08 section 6.1): flat sums of the worn gear; empty when the Being wears nothing.
    equipment: sim.items.fxOf(slot),
  };
  const age = (sim.tick - (s.born[slot] ?? 0)) / YEAR;
  let a: Assembled = assemble({ ...input, baby: false });
  const baby = age < a.adultYears;
  if (baby) a = assemble({ ...input, baby: true });
  s.baby[slot] = baby ? 1 : 0;
  s.maxVit[slot] = a.vitality;
  if ((s.vit[slot] ?? 0) > a.vitality) s.vit[slot] = a.vitality;
  s.paceA[slot] = a.pace;
  s.mightA[slot] = a.might;
  s.spanA[slot] = a.span;
  s.litterA[slot] = a.litter;
  s.broodA[slot] = a.brood;
  s.metabolismA[slot] = a.metabolism;
  s.adultA[slot] = a.adultYears;
  s.gestationA[slot] = a.gestationMonths;
}

/** Tile multiplier under a being (07 section 7.1): the ground's walk value, and x0.8 on a tree tile with `tangle_roots`. */
function tileMult(sim: Sim, slot: number): number {
  const s = sim.beings.store;
  const i = (s.y[slot] ?? 0) * sim.realm.side + (s.x[slot] ?? 0);
  let mult = ground(sim.realm.ground[i] ?? 0).walk;
  const code = sim.realm.flora[i] ?? 0;
  if (code > 0 && FLORA[code - 1]?.kind === 'tree' && sim.rules.isOn('tangle_roots')) mult *= 0.8;
  return Math.max(mult, 0.01);
}

/** Spends one movement unit; units accumulate at pace * 0.2 / 20 per tick (07 section 7.1). */
function takeStep(sim: Sim, slot: number): boolean {
  const s = sim.beings.store;
  if (sim.effects.flag(slot, 'immobile')) return false;
  if ((s.moveAcc[slot] ?? 0) < 1) return false;
  s.moveAcc[slot] = (s.moveAcc[slot] ?? 0) - 1;
  return true;
}

/** Moves one tile in direction d (0..7) when walkable and a move is available. */
function wander(sim: Sim, slot: number, d: number): void {
  const s = sim.beings.store;
  const realm = sim.realm;
  const [ox, oy] = DIRS[d] ?? [0, 0];
  const nx = (s.x[slot] ?? 0) + ox;
  const ny = (s.y[slot] ?? 0) + oy;
  if (nx < 0 || ny < 0 || nx >= realm.side || ny >= realm.side) return;
  if (!walkable(realm, ny * realm.side + nx)) return;
  if (!takeStep(sim, slot)) return;
  s.x[slot] = nx;
  s.y[slot] = ny;
}

/** Steps one tile toward (tx,ty) through the first walkable neighbour that gets closer. */
function stepToward(sim: Sim, slot: number, tx: number, ty: number): void {
  const s = sim.beings.store;
  const x = s.x[slot] ?? 0;
  const y = s.y[slot] ?? 0;
  const dx = Math.sign(tx - x);
  const dy = Math.sign(ty - y);
  const candidates: (readonly [number, number])[] = [
    [dx, dy],
    [dx, 0],
    [0, dy],
    [dx, -dy],
    [-dx, dy],
  ];
  for (const [ox, oy] of candidates) {
    if (ox === 0 && oy === 0) continue;
    const nx = x + ox;
    const ny = y + oy;
    if (nx < 0 || ny < 0 || nx >= sim.realm.side || ny >= sim.realm.side) continue;
    if (!walkable(sim.realm, ny * sim.realm.side + nx)) continue;
    if (!takeStep(sim, slot)) return;
    s.x[slot] = nx;
    s.y[slot] = ny;
    return;
  }
}

/** Flora food value for a diet on tile i (06 section 2.2): grass eats any flora, nectar eats flowers. */
function foodAt(sim: Sim, i: number, diet: SpeciesDef['diet']): number {
  const code = sim.realm.flora[i] ?? 0;
  if (code === 0) return 0;
  if (diet === 'grass' || diet === 'omni') return TUNING.grazeGain;
  if (diet === 'nectar') return code === (FLORA_BY_ID.get('fieldflower') ?? -2) + 1 ? TUNING.nectarGain : 0;
  return 0;
}

/** Litter size: first baby always, then for i = 0 .. brood-1 an extra with probability 0.5 * 0.85^i (06 section 6.4). */
export function litterRoll(sim: Sim, brood: number): number {
  const rng = sim.rng('beings');
  let babies = 1;
  for (let i = 0; i < brood; i++) {
    if (rng.next() < 0.5 * Math.pow(0.85, i)) babies++;
  }
  return babies;
}

/** Removes a being, counting the cause. */
export function killBeing(sim: Sim, slot: number, cause: 'eaten' | 'starved' | 'age' | 'combat'): void {
  const b = sim.beings;
  if (b.store.alive[slot] !== 1) return;
  b.store.kill(slot);
  sim.effects.clear(slot);
  b.stats.deaths++;
  recordStat(sim, { kind: 'being.died', cause });
  if (cause === 'eaten') b.stats.eaten++;
  if (cause === 'starved') b.stats.starved++;
  if (cause === 'age') b.stats.aged++;
}

/** Child-to-parent trait inheritance (18b `inh` percentages) and the birth mutation draw (05 section 7.4). */
function inheritMarks(sim: Sim, parent: number, child: number, strainId: number): void {
  const s = sim.beings.store;
  const rng = sim.rng('beings');
  const xgTaken = (id: string): boolean => {
    const xg = BEING_TRAITS[BEING_TRAIT_INDEX.get(id) ?? 0]?.xg ?? '';
    return xg !== '' && BEING_TRAITS.some((t) => t.xg === xg && s.hasMark(child, BEING_TRAIT_INDEX.get(t.id) ?? -1));
  };
  for (const id of markIds(s, parent)) {
    const k = BEING_TRAIT_INDEX.get(id) ?? -1;
    const trait = BEING_TRAITS[k];
    if (!trait || trait.inherit === null) continue;
    if (rng.next() * 100 < trait.inherit && !xgTaken(id)) s.setMark(child, k, true);
  }
  const mutation = strainMutation(sim.beings.strains.get(strainId)?.traits ?? []);
  if (mutation > 0 && BIRTH_POT.length > 0) {
    const extra = rng.int(mutation + 1);
    for (let n = 0; n < extra; n++) {
      const id = BIRTH_POT[rng.int(BIRTH_POT.length)] ?? '';
      const k = BEING_TRAIT_INDEX.get(id);
      if (k !== undefined && !s.hasMark(child, k) && !xgTaken(id)) s.setMark(child, k, true);
    }
  }
}

/**
 * Spawns a being at (x,y); returns its slot or -1 (store full, or the tile is not walkable).
 * A birth (`parent` >= 0) joins the parent's strain and links to the bearer (05 section 6.1, 06 section 6.6).
 * An adult spawn joins the nearest same-species strain within 40 tiles, else founds a new strain.
 */
export function spawnBeing(sim: Sim, speciesIdx: number, x: number, y: number, adult: boolean, parent = -1): number {
  // Folk come from the dominion layer (spawnFolk); aquatic and Architect-bound rows have no land behaviour yet.
  if (!sim.beings.species(speciesIdx).wild) return -1;
  return place(sim, speciesIdx, x, y, adult, parent, null);
}

/**
 * Folk founder (18a section 1.2): an adult of a Folk lineage in a new strain that holds the lineage's
 * strain traits and carries its being traits. Aptitudes come from the species row.
 */
export function spawnFolk(sim: Sim, speciesIdx: number, x: number, y: number): number {
  const def = sim.beings.species(speciesIdx);
  if (!def.folk || !def.startTraits) return -1;
  return place(sim, speciesIdx, x, y, true, -1, def.startTraits);
}

function place(
  sim: Sim,
  speciesIdx: number,
  x: number,
  y: number,
  adult: boolean,
  parent: number,
  founder: { being: readonly string[]; strain: readonly string[] } | null,
): number {
  const realm = sim.realm;
  if (x < 0 || y < 0 || x >= realm.side || y >= realm.side) return -1;
  if (!walkable(realm, y * realm.side + x)) return -1;
  const b = sim.beings;
  const s = b.store;
  const def = b.species(speciesIdx);
  const female = sim.rng('beings').next() < 0.5 ? 1 : 0;
  const slot = s.spawn(speciesIdx, x, y, sim.tick, def.vitality, adult ? 100 : 25, female);
  if (slot < 0) return -1;
  const bearer = parent >= 0 && s.alive[parent] === 1 ? parent : -1;

  // Strain: a birth inherits the bearer's strain; an adult joins a near member's strain or founds one.
  let strain = bearer >= 0 ? b.strains.get(s.strain[bearer] ?? 0) : undefined;
  if (!strain && !founder) {
    // A linear scan: the bucket grid is rebuilt only at the start of a tick, so it misses this tick's spawns.
    let near = -1;
    let nearD = Number.POSITIVE_INFINITY;
    for (let k = 0; k < s.size; k++) {
      const o = s.at(k);
      if (o === slot || s.species[o] !== speciesIdx) continue;
      const dx = (s.x[o] ?? 0) - x;
      const dy = (s.y[o] ?? 0) - y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > STRAIN_JOIN_RADIUS) continue;
      const d = dx * dx + dy * dy;
      if (d < nearD || (d === nearD && o < near)) {
        nearD = d;
        near = o;
      }
    }
    strain = near >= 0 ? b.strains.get(s.strain[near] ?? 0) : undefined;
  }
  if (!strain) {
    const traits: string[] = [];
    for (const id of founder?.strain ?? []) addStrainTrait(traits, id);
    strain = b.strains.create(speciesIdx, def.name, 0, 0, traits);
  }
  s.strain[slot] = strain.id;
  for (const id of founder?.being ?? []) {
    const k = BEING_TRAIT_INDEX.get(id);
    if (k !== undefined) s.setMark(slot, k, true);
  }
  if (def.aptitudes) {
    s.attrs[slot * 4] = def.aptitudes.rapport;
    s.attrs[slot * 4 + 1] = def.aptitudes.valor;
    s.attrs[slot * 4 + 2] = def.aptitudes.husbandry;
    s.attrs[slot * 4 + 3] = def.aptitudes.wit;
  }
  if (bearer >= 0) {
    s.setParent(slot, bearer);
    inheritMarks(sim, bearer, slot, strain.id);
  }

  refreshStats(sim, slot);
  if (adult) {
    // Spawned adults start at their adult age (06 section 3.1 ageBonusYears), so they can breed at once.
    s.born[slot] = sim.tick - Math.ceil(s.adultA[slot] ?? 1) * YEAR;
    refreshStats(sim, slot);
  }
  s.vit[slot] = s.maxVit[slot] ?? 0;

  if (adult) {
    b.stats.newAdults++;
    strain.counters.newAdults++;
    recordStat(sim, { kind: 'being.spawned', count: 1 });
  } else {
    b.stats.births++;
    strain.counters.born++;
    recordStat(sim, { kind: 'being.born', count: 1 });
  }
  if (bearer >= 0) {
    const bs = b.strains.get(s.strain[bearer] ?? 0);
    if (bs) bs.counters.reproduced++;
  }
  return slot;
}

/** One decision for a being (07 section 3, reduced to the beast core: flee, hunt or graze, mate, wander). */
function decide(sim: Sim, slot: number): void {
  const b = sim.beings;
  const s = b.store;
  const rng = sim.rng('beings');
  const tick = sim.tick;
  const rt = b.runtime[s.species[slot] ?? 0];
  if (!rt) return;
  const def = rt.def;
  const realm = sim.realm;
  const adult = (tick - (s.born[slot] ?? 0)) / YEAR >= (s.adultA[slot] ?? 1);
  const feeds = needsFood(def);
  const hungry = feeds && (s.fuel[slot] ?? 0) <= TUNING.hungryAt;

  // Flee the nearest hunter within four tiles.
  const hunter = b.nearest(slot, (o) => rt.hunters.includes(s.species[o] ?? -1), 4);
  if (hunter >= 0) {
    const x = s.x[slot] ?? 0;
    const y = s.y[slot] ?? 0;
    stepToward(sim, slot, x + Math.sign(x - (s.x[hunter] ?? 0)) * 3, y + Math.sign(y - (s.y[hunter] ?? 0)) * 3);
    s.nextDecision[slot] = tick + 2;
    return;
  }

  const localFood = foodAt(sim, (s.y[slot] ?? 0) * realm.side + (s.x[slot] ?? 0), def.diet) > 0;
  if (hungry && (def.diet === 'flesh' || (def.diet === 'omni' && !localFood))) {
    const prey = b.nearest(slot, (o) => rt.prey.includes(s.species[o] ?? -1) && SIZE_RANK[SPECIES[s.species[o] ?? 0]?.size ?? 'T'] <= SIZE_RANK[def.size], TUNING.huntRadius);
    if (prey >= 0) {
      const adjacent = Math.abs((s.x[prey] ?? 0) - (s.x[slot] ?? 0)) <= 1 && Math.abs((s.y[prey] ?? 0) - (s.y[slot] ?? 0)) <= 1;
      if (adjacent) {
        // Bite damage is floor(0.15 * victim max vitality) + 1, and fuel gains the damage dealt (06 section 2.2).
        const bite = Math.floor(0.15 * (s.maxVit[prey] ?? 0)) + 1;
        s.vit[prey] = (s.vit[prey] ?? 0) - bite;
        if ((s.vit[prey] ?? 0) <= 0) {
          killBeing(sim, prey, 'eaten');
          s.fuel[slot] = 100;
        } else {
          s.fuel[slot] = Math.min(100, (s.fuel[slot] ?? 0) + bite);
        }
      } else {
        stepToward(sim, slot, s.x[prey] ?? 0, s.y[prey] ?? 0);
      }
      s.nextDecision[slot] = tick + 3;
      return;
    }
  }

  if (hungry && def.diet !== 'flesh') {
    const here = (s.y[slot] ?? 0) * realm.side + (s.x[slot] ?? 0);
    const food = foodAt(sim, here, def.diet);
    if (food > 0) {
      s.fuel[slot] = Math.min(100, (s.fuel[slot] ?? 0) + food);
      if (def.diet === 'grass' || def.diet === 'omni') grazeFlora(sim, here);
      s.nextDecision[slot] = tick + 4;
      return;
    }
    const r = TUNING.forageRadius;
    const x0 = s.x[slot] ?? 0;
    const y0 = s.y[slot] ?? 0;
    let found = -1;
    for (let dy = -r; dy <= r && found < 0; dy++) {
      for (let dx = -r; dx <= r && found < 0; dx++) {
        const x = x0 + dx;
        const y = y0 + dy;
        if (x < 0 || y < 0 || x >= realm.side || y >= realm.side) continue;
        if (foodAt(sim, y * realm.side + x, def.diet) > 0) found = y * realm.side + x;
      }
    }
    if (found >= 0) {
      stepToward(sim, slot, found % realm.side, Math.floor(found / realm.side));
      s.nextDecision[slot] = tick + 2;
      return;
    }
  }

  // Mating (06 section 6.1): adult, fed when it needs food, not in a lull, not expecting, not barren,
  // and a female bearer below her living-children cap. Births also need the rule on and no crowd.
  const barren = BEING_TRAIT_INDEX.get('barren') ?? -1;
  const bearerRoom = (o: number): boolean => s.female[o] === 0 || (s.childCount[o] ?? 0) < Math.ceil(s.litterA[o] ?? 0);
  const canMate = (o: number): boolean => (!needsFood(b.species(s.species[o] ?? 0)) || (s.fuel[o] ?? 0) >= TUNING.matingFuel) && !s.hasMark(o, barren) && tick >= (s.lull[o] ?? 0) && !(s.expecting[o] ?? 0);
  // The crowd scan is linear in the population, so it runs only for a being that could breed now.
  const mayBreed = adult && canMate(slot) && bearerRoom(slot) && sim.rules.isOn('beast_births') && !sim.effects.flag(slot, 'noBreed');
  if (mayBreed && b.crowdInPatch(slot, s.x[slot] ?? 0, s.y[slot] ?? 0) < BREEDING_CROWD) {
    const sp = s.species[slot] ?? 0;
    const mate = b.nearest(
      slot,
      (o) =>
        s.species[o] === sp &&
        s.female[o] !== s.female[slot] &&
        (tick - (s.born[o] ?? 0)) / YEAR >= (s.adultA[o] ?? 1) &&
        canMate(o) &&
        bearerRoom(o),
      8,
    );
    if (mate >= 0) {
      const adjacent = Math.abs((s.x[mate] ?? 0) - (s.x[slot] ?? 0)) <= 1 && Math.abs((s.y[mate] ?? 0) - (s.y[slot] ?? 0)) <= 1;
      if (adjacent) {
        const bearer = s.female[slot] ? slot : mate;
        if (s.female[bearer] && !(s.expecting[bearer] ?? 0)) {
          s.expecting[bearer] = 1;
          s.expectUntil[bearer] = tick + Math.round((s.gestationA[bearer] ?? def.gestationMonths) * MONTH_TICKS);
          s.brood[bearer] = litterRoll(sim, Math.round(s.broodA[bearer] ?? def.litter));
          s.fuel[bearer] = Math.max(0, (s.fuel[bearer] ?? 0) - 50);
        }
        s.lull[slot] = tick + LULL;
        s.lull[mate] = tick + LULL;
      } else {
        stepToward(sim, slot, s.x[mate] ?? 0, s.y[mate] ?? 0);
      }
      s.nextDecision[slot] = tick + 3;
      return;
    }
  }

  // Wander: move on most decisions.
  if (rng.next() < 0.7) wander(sim, slot, rng.int(8));
  s.nextDecision[slot] = tick + 4 + rng.int(6);
}

/**
 * Per-tick being update (02 section 4 step 6): fuel and starvation, regeneration, natural death,
 * births from pregnancies, movement budget, and decisions when due.
 */
export function stepBeings(sim: Sim): void {
  const b = sim.beings;
  const s = b.store;
  const tick = sim.tick;
  const hungerRule = sim.rules.isOn('hunger');
  const agingRule = sim.rules.isOn('aging_toll');
  const fuelPass = tick % FUEL_PASS === 0;
  const regen = tick % REGEN === 0;
  const deathRoll = tick % DEATH_ROLL === 0;
  const rng = sim.rng('beings');
  b.rebuildBuckets();

  for (let k = s.size - 1; k >= 0; k--) {
    const slot = s.at(k);
    if (s.alive[slot] !== 1) continue;
    const rt = b.runtime[s.species[slot] ?? 0];
    if (!rt) continue;
    const def = rt.def;
    const feeds = needsFood(def);
    s.moveAcc[slot] = Math.min(2, (s.moveAcc[slot] ?? 0) + ((s.paceA[slot] ?? def.pace) * 0.2 * sim.effects.multiplier(slot, 'speed') * tileMult(sim, slot)) / 20);

    if (regen && s.baby[slot] === 1 && (tick - (s.born[slot] ?? 0)) / YEAR >= (s.adultA[slot] ?? 1)) {
      // Growing up: the stats are recomputed as an adult (06 section 3.2 GrewUp).
      refreshStats(sim, slot);
    }

    if (fuelPass && feeds) {
      if ((s.fuel[slot] ?? 0) > 0) {
        s.fuel[slot] = Math.max(0, (s.fuel[slot] ?? 0) - (s.metabolismA[slot] ?? 1));
      } else if (hungerRule) {
        s.vit[slot] = (s.vit[slot] ?? 0) - Math.max(1, Math.floor((s.maxVit[slot] ?? 0) * 0.05));
        if ((s.vit[slot] ?? 0) <= 0) {
          killBeing(sim, slot, 'starved');
          continue;
        }
      }
    }
    if (regen && (!feeds || (s.fuel[slot] ?? 0) >= HUNGRY_AT) && (s.vit[slot] ?? 0) < (s.maxVit[slot] ?? 0)) {
      s.vit[slot] = (s.vit[slot] ?? 0) + 1;
    }

    // Span 0 never dies of age (05 section 1, 06 section 3.5).
    const span = s.spanA[slot] ?? 0;
    if (deathRoll && agingRule && span > 0) {
      const age = (tick - (s.born[slot] ?? 0)) / YEAR;
      if (age > span) {
        const x = (age - span) / span;
        const p = Math.min(0.9, 1 / (1 + Math.exp(-5 * (x - 0.5))));
        if (rng.next() < p) {
          killBeing(sim, slot, 'age');
          continue;
        }
      }
    }

    if (s.expecting[slot] && tick >= (s.expectUntil[slot] ?? 0)) {
      s.expecting[slot] = 0;
      const brood = Math.max(1, s.brood[slot] ?? 1);
      for (let n = 0; n < brood && b.store.size < WORLD_CAP; n++) {
        spawnBeing(sim, s.species[slot] ?? 0, (s.x[slot] ?? 0) + rng.int(5) - 2, (s.y[slot] ?? 0) + rng.int(5) - 2, false, slot);
      }
    }

    if (tick >= (s.nextDecision[slot] ?? 0)) decide(sim, slot);
  }
}

/** Same-species groups keep this many tiles apart when seeding (03 section 8.3). */
const START_SPACING = 24;

/**
 * Starting beasts (03 section 8.3): a random land tile is drawn; if its biome lists a wild species, a
 * group of 2 to 4 adults of one such species is placed within radius 2. A group of the same species
 * must be START_SPACING tiles from earlier groups. Each group gets 6 tile draws before it is dropped.
 * Species are equally weighted: 18c gives beast pools without weights. Folk and Architect-bound rows
 * (`wild` false) are never seeded.
 */
export function seedStartingBeasts(sim: Sim, groups: number): number {
  const realm = sim.realm;
  const rng = sim.rng('start');
  const centres: { species: number; x: number; y: number }[] = [];
  let placed = 0;
  for (let g = 0; g < groups; g++) {
    let species = -1;
    let x0 = -1;
    let y0 = -1;
    for (let tries = 0; tries < 6 && species < 0; tries++) {
      const x = rng.int(realm.side);
      const y = rng.int(realm.side);
      const biome = sim.biomeAt(y * realm.side + x);
      if (!biome) continue;
      const eligible = SPECIES.flatMap((def, k) => (def.wild && def.biomes.includes(biome.id) ? [k] : []));
      if (eligible.length === 0) continue;
      const pick = eligible[rng.int(eligible.length)] ?? -1;
      const clear = centres.every((c) => c.species !== pick || Math.max(Math.abs(c.x - x), Math.abs(c.y - y)) >= START_SPACING);
      if (clear) {
        species = pick;
        x0 = x;
        y0 = y;
      }
    }
    if (species < 0) continue;
    centres.push({ species, x: x0, y: y0 });
    const size = 2 + rng.int(3);
    for (let n = 0; n < size; n++) {
      if (spawnBeing(sim, species, x0 + rng.int(5) - 2, y0 + rng.int(5) - 2, true) >= 0) placed++;
    }
  }
  return placed;
}
