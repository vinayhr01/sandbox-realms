import { SIZE_RANK, SPECIES, speciesIndex, type SpeciesDef } from '../../content/beasts.ts';
import { ground } from '../../content/grounds.ts';
import { BEING_TRAITS, BEING_TRAIT_INDEX, BIRTH_POT as BIRTH_POT_IDS } from '../../content/traits.ts';
import { dropManure, FLORA, FLORA_BY_ID, grazeFlora } from '../flora.ts';
import { hamletsOf } from '../settlements/adapter.ts';
import { foodCapacity, PARCEL } from '../settlements/hamlet.ts';
import type { Realm } from '../realm.ts';
import type { Sim } from '../sim.ts';
import { recordStat } from '../stats-hooks.ts';
import { assemble, type Assembled } from './assembly.ts';
import { DECISION_INDEX, DECISION_ROWS, EMPTY_PAUSE } from '../../content/decisions.ts';
import { BeingStore } from './store.ts';
import { newGenome, SEED_SALT_RANGE, speciesBudget } from './genome.ts';
import { addStrainTrait, mutateFrom, strainMutation, Strains } from './strains.ts';
import { addMood, beginSleep, bondCheck, isAsleep, sleepCheck } from './social.ts';
import { ROUND6, ROUND8, TUNING } from './tuning.ts';
import { MONTH_TICKS, YEAR_TICKS } from '../../shared/constants.ts';
import { predate } from '../combat.ts';
import { chooseDecision, type CandidateContext } from './brain.ts';
import { addAggro, aggroFoes, dropAggro } from './aggro.ts';
import { factionOf, relation, type Faction, type Relation } from './hostility.ts';
import { findEnemy, scheduleSearch, searchDue, tileGap } from './perception.ts';
import {
  beingHas,
  breedMode,
  breedsInSeason,
  chimericBlood,
  chimericTrait,
  copiesMarks,
  counterChance,
  eatsFlesh,
  eatsKin,
  evergreen,
  fightStartScale,
  fleeAllowed,
  foodRangeMult,
  herds,
  jittery,
  mends,
  pregnancyPausesWhenHungry,
  popMultiplier,
  reflectDamage,
  roamsFar,
  strainHas,
  strikeScale,
  type BreedMode,
} from './trait-hooks.ts';
import { assignPalette, palettesFor, rollVenerable, rollWildVariant, variantFxOf } from './variants.ts';

export type { BeingStore };

/** Decision count: each Being keeps one cooldown per decision (07 section 3.4). */
const DECISIONS = DECISION_ROWS.length;
/** Ticks between bond checks (round 6, ROUND6.bondCheck). */
const BOND_CHECK = ROUND6.bondCheck;
/** Chance a grazing being drops a manure pile on the tile it ate from (09 section 8 manure collector; TUNE). */
const GRAZE_MANURE_CHANCE = 0.1;
/** Ticks between hunter checks, and the hunter's reach in tiles (09 section 8 hunter, patch radius 3). */
const HUNT_PERIOD = 100;
const HUNT_RADIUS = 3;
/** Prey must be at least this many years old for a hunter to take it (09 section 8 hunter, age 3 or more). */
const HUNT_MIN_YEARS = 3;
/** Meat a hunter's kill adds to the hamlet store (09 section 10.1 meat food; TUNE). */
const MEAT_FOOD = 2;
/** Folk a hamlet needs before it keeps a hunter (09 section 8 hunter, TUNE). */
const HUNT_MIN_FOLK = 4;

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
/** Fuel spent by a birth on the bearer (06 section 2.1 and 6.4). */
const BIRTH_FUEL = 50;
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
/** Strain trait ids of the rebirth group (18b REB; 06 section 7.4). */
const REBIRTH_TRAITS: readonly string[] = ['grave_bloom', 'ember_return', 'soul_seed', 'split_self', 'spore_return'];

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
  /** Sleeps started (round 6, 06 section 5). */
  sleeps: number;
  /** Bonds formed (round 6, bonds). */
  bonds: number;
  /** Blows struck in fights (round 8, 07 section 10). */
  blows: number;
  /** Deaths turned into rebirths: revivals, clones and re-formed children (round 8, 06 section 7.4). */
  rebirths: number;
}

/** Per-species derived values. */
interface SpeciesRuntime {
  def: SpeciesDef;
  hunters: number[];
  prey: number[];
  /** Faction (07 section 9.4), from the species' group and diet. */
  faction: Faction;
}

/** A decision task (07 section 4): runs one step and returns true while it continues. */
type TaskFn = (sim: Sim, slot: number) => boolean;

/** A spawn copy's identity and state (06 section 7.4 common template, 06 section 6.3 split). */
interface CopyOpts {
  vit: number;
  endurance: number;
  mood: number;
  fuel: number;
  /** A newborn (age 0) rather than a copy of the same age. */
  baby: boolean;
  /** Links the copy to `from` as its parent (06 section 6.1 child count). */
  link: boolean;
  /** Counts as a birth (06 section 6.6 counters). */
  birth: boolean;
  /** The copy may not rebirth again (06 section 7.4 "once"). Otherwise it inherits the source's flag. */
  reborn: boolean;
}

/**
 * Beings subsystem: the store, a spatial bucket grid, strains, and the life cycle (fuel, regeneration,
 * ageing and death, decisions and movement, mating and births). One instance per Sim.
 */
export class Beings {
  readonly store = new BeingStore();
  readonly strains = new Strains();
  readonly stats: BeingStats = {
    births: 0,
    newAdults: 0,
    deaths: 0,
    starved: 0,
    eaten: 0,
    aged: 0,
    sleeps: 0,
    bonds: 0,
    blows: 0,
    rebirths: 0,
  };
  readonly runtime: readonly SpeciesRuntime[];
  /** Decision cooldowns: the tick each decision is eligible again, by slot * DECISIONS + index (07 section 3.4). */
  readonly cooldown: Uint32Array;
  /** Index of the running decision task (DECISION_ROWS), or -1. Saved (round 6): a loaded Being resumes its task. */
  readonly task: Int8Array;
  /**
   * The target a fight search found during the current decision, or -1 (round 8). Written by the `fight` eligibility
   * check and read by the `fight` task in the same call; reset at the start of every decision. Not saved.
   */
  readonly scratch: Int32Array;
  /** Living Beings per strain, kept in step with births and deaths and rebuilt each tick (06 section 8, pop_cap). */
  private readonly strainCounts = new Map<number, number>();
  private readonly cellsPerRow: number;
  private readonly head: Int32Array;
  private readonly link: Int32Array;

  constructor(side: number) {
    this.cellsPerRow = Math.ceil(side / BUCKET);
    this.head = new Int32Array(this.cellsPerRow * this.cellsPerRow).fill(-1);
    this.link = new Int32Array(this.store.capacity).fill(-1);
    this.cooldown = new Uint32Array(this.store.capacity * DECISIONS);
    this.task = new Int8Array(this.store.capacity).fill(-1);
    this.scratch = new Int32Array(this.store.capacity).fill(-1);
    this.runtime = SPECIES.map((def, k) => ({
      def,
      hunters: def.hunters.map((h) => speciesIndex(h)),
      prey: def.prey.map((p) => speciesIndex(p)),
      faction: factionOf(def, k),
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

  /** Recounts the living Beings of each strain (called once per tick, before the Beings step). */
  countStrains(): void {
    this.strainCounts.clear();
    const s = this.store;
    for (let k = 0; k < s.size; k++) this.bumpStrain(s.strain[s.at(k)] ?? 0, 1);
  }

  /** Adds `d` (1 or -1) to a strain's living count. */
  bumpStrain(strain: number, d: number): void {
    this.strainCounts.set(strain, (this.strainCounts.get(strain) ?? 0) + d);
  }

  /** Living Beings of a strain as of the last count (exact after countStrains and every spawn and death). */
  strainCount(strain: number): number {
    return this.strainCounts.get(strain) ?? 0;
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
          // A Being killed earlier this tick stays in the grid until the next rebuild, so the alive check comes first.
          if (o === self || s.alive[o] !== 1 || !pred(o)) continue;
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

  /** Every living being within `radius` tiles (Chebyshev) of `self` that passes `pred`, excluding `self` (round 8). */
  within(self: number, pred: (slot: number) => boolean, radius: number): number[] {
    const s = this.store;
    const x = s.x[self] ?? 0;
    const y = s.y[self] ?? 0;
    const c0x = Math.max(0, Math.floor((x - radius) / BUCKET));
    const c1x = Math.min(this.cellsPerRow - 1, Math.floor((x + radius) / BUCKET));
    const c0y = Math.max(0, Math.floor((y - radius) / BUCKET));
    const c1y = Math.min(this.cellsPerRow - 1, Math.floor((y + radius) / BUCKET));
    const out: number[] = [];
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        for (let o = this.head[cy * this.cellsPerRow + cx] ?? -1; o !== -1; o = this.link[o] ?? -1) {
          if (o === self || s.alive[o] !== 1 || !pred(o)) continue;
          if (Math.max(Math.abs((s.x[o] ?? 0) - x), Math.abs((s.y[o] ?? 0) - y)) > radius) continue;
          out.push(o);
        }
      }
    }
    return out;
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
 * The morph and caste multipliers (18a section 3) apply here too.
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
    variant: variantFxOf(s.morph[slot] ?? 0, s.caste[slot] ?? 0),
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
  s.platingA[slot] = a.plating;
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

/** A walkable tile next to (x,y), chosen from a random start direction so the draw is seeded (07 section 2). */
function freeNeighbour(sim: Sim, x: number, y: number): { x: number; y: number } | null {
  const realm = sim.realm;
  const start = sim.rng('beings').int(8);
  for (let n = 0; n < 8; n++) {
    const [ox, oy] = DIRS[(start + n) % 8] ?? [0, 0];
    const nx = x + ox;
    const ny = y + oy;
    if (nx < 0 || ny < 0 || nx >= realm.side || ny >= realm.side) continue;
    if (!walkable(realm, ny * realm.side + nx)) continue;
    return { x: nx, y: ny };
  }
  return null;
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

/** The rebirth of a Being that dies (06 section 7.4, 18b REB), or null when none applies. Returns true if it lives on. */
function rebirth(sim: Sim, slot: number): boolean {
  const b = sim.beings;
  const s = b.store;
  if ((s.reborn[slot] ?? 0) === 1) return false;
  const strain = b.strains.get(s.strain[slot] ?? 0);
  const traits = (strain?.traits ?? []).filter((id) => REBIRTH_TRAITS.includes(id));
  if (traits.length === 0) return false;
  // isPrettyOld (06 section 7.4): age over 1, at least the adult age, and past 70% of the span.
  const span = s.spanA[slot] ?? 0;
  const age = (sim.tick - (s.born[slot] ?? 0)) / YEAR;
  if (span <= 0 || !(age > 1 && age >= (s.adultA[slot] ?? 1) && age / span > 0.7)) return false;
  const rng = sim.rng('beings');
  const x = s.x[slot] ?? 0;
  const y = s.y[slot] ?? 0;
  const maxV = s.maxVit[slot] ?? 1;
  for (const id of traits) {
    if (id === 'ember_return') {
      // 20% returns once at 25% hp, burning (18b REB). A revival is the Being living on, so nothing else happens.
      if (rng.next() < 0.2) {
        s.reborn[slot] = 1;
        s.vit[slot] = Math.max(1, Math.floor(maxV * 0.25));
        sim.effects.add(slot, 'scorched', sim.tick);
        b.stats.rebirths++;
        return true;
      }
    } else if (id === 'split_self') {
      for (let n = 0; n < 2; n++) {
        const at = freeNeighbour(sim, x, y);
        if (at)
          spawnCopy(sim, slot, at.x, at.y, {
            vit: Math.floor(maxV / 2),
            endurance: s.endurance[slot] ?? 0,
            mood: s.mood[slot] ?? 0,
            fuel: s.fuel[slot] ?? 0,
            baby: false,
            link: false,
            birth: false,
            reborn: true,
          });
      }
      b.stats.rebirths++;
    } else if (id === 'soul_seed') {
      const at = freeNeighbour(sim, x, y);
      if (at)
        spawnCopy(sim, slot, at.x, at.y, {
          vit: maxV,
          endurance: 0,
          mood: 0,
          fuel: 25,
          baby: true,
          link: false,
          birth: false,
          reborn: true,
        });
      b.stats.rebirths++;
    } else if (id === 'spore_return') {
      place(sim, speciesIndex('sporeant'), x, y, true, -1, null);
      b.stats.rebirths++;
    } else if (id === 'grave_bloom') {
      const tree = FLORA.findIndex((f) => f.kind === 'tree');
      const i = y * sim.realm.side + x;
      if (tree >= 0 && (sim.realm.flora[i] ?? 0) === 0) sim.realm.setFlora(i, tree + 1, sim.tick);
      b.stats.rebirths++;
    }
  }
  return false;
}

/**
 * Removes a being, counting the cause (06 section 7.2). A rebirth trait may keep it alive instead: then nothing is
 * removed. `killer` is the slot credited with the kill (round 8; -1 for none). Returns true when the Being died.
 */
export function killBeing(sim: Sim, slot: number, cause: 'eaten' | 'starved' | 'age' | 'combat', killer = -1): boolean {
  const b = sim.beings;
  const s = b.store;
  if (s.alive[slot] !== 1) return false;
  if (rebirth(sim, slot)) return false;
  // Death mood (06 section 7.2 step 2): the living parent gets child_died, the children kin_died, and a bond
  // partner friend_died (the bond ends). Read before the slot is freed.
  const gen = s.generation[slot] ?? 0;
  const parentSlot = s.hasLiveParent(slot) ? (s.parent[slot] ?? -1) : -1;
  for (let k = 0; k < s.size; k++) {
    const o = s.at(k);
    if (o === slot) continue;
    if (o === parentSlot) addMood(sim, o, 'child_died');
    else if (s.parent[o] === slot && s.hasLiveParent(o)) addMood(sim, o, 'kin_died');
    if (s.bondWith[o] === slot && s.bondGen[o] === gen) {
      s.bondWith[o] = -1;
      addMood(sim, o, 'friend_died');
    }
  }
  // Per-strain counters (05 section 5 gap, round 8): the victim's strain counts the death, the killer's the kill.
  const strainId = s.strain[slot] ?? 0;
  const strain = b.strains.get(strainId);
  if (strain) strain.counters.died++;
  if (killer >= 0 && s.alive[killer] === 1) {
    const ks = b.strains.get(s.strain[killer] ?? 0);
    if (ks) ks.counters.killed++;
  }
  b.bumpStrain(strainId, -1);
  s.kill(slot);
  sim.effects.clear(slot);
  b.stats.deaths++;
  recordStat(sim, { kind: 'being.died', cause });
  if (cause === 'eaten') b.stats.eaten++;
  if (cause === 'starved') b.stats.starved++;
  if (cause === 'age') b.stats.aged++;
  return true;
}

/**
 * Child-to-parent trait inheritance (18b `inh` percentages) and the birth mutation draw (05 section 7.4). A strain with
 * `likeness` copies the bearer's marks exactly instead of the inheritance draw; `chimeric_blood` adds one random trait.
 */
function inheritMarks(sim: Sim, parent: number, child: number, strainId: number): void {
  const s = sim.beings.store;
  const rng = sim.rng('beings');
  const xgTaken = (id: string): boolean => {
    const xg = BEING_TRAITS[BEING_TRAIT_INDEX.get(id) ?? 0]?.xg ?? '';
    return xg !== '' && BEING_TRAITS.some((t) => t.xg === xg && s.hasMark(child, BEING_TRAIT_INDEX.get(t.id) ?? -1));
  };
  if (copiesMarks(sim, parent)) {
    for (let w = 0; w < 5; w++) s.marks[child * 5 + w] = s.marks[parent * 5 + w] ?? 0;
  } else {
    for (const id of markIds(s, parent)) {
      const k = BEING_TRAIT_INDEX.get(id) ?? -1;
      const trait = BEING_TRAITS[k];
      if (!trait || trait.inherit === null) continue;
      if (rng.next() * 100 < trait.inherit && !xgTaken(id)) s.setMark(child, k, true);
    }
  }
  if (chimericBlood(sim, child)) {
    const id = chimericTrait(rng);
    const k = id === null ? undefined : BEING_TRAIT_INDEX.get(id);
    if (id !== null && k !== undefined && !xgTaken(id)) s.setMark(child, k, true);
  }
  const mutation = strainMutation(sim.beings.strains.get(strainId)?.traits ?? []);
  if (mutation > 0 && BIRTH_POT_IDS.length > 0) {
    const extra = rng.int(mutation + 1);
    for (let n = 0; n < extra; n++) {
      const id = BIRTH_POT_IDS[rng.int(BIRTH_POT_IDS.length)] ?? '';
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

/**
 * A copy of a being at (x,y) (round 8): the same species, strain, morph, palette and marks, with the given vitality,
 * endurance, mood and fuel. Used by split births (06 section 6.3), split-self and soul-seed rebirths (06 section 7.4).
 * Returns the slot or -1 (the store is full).
 */
function spawnCopy(sim: Sim, from: number, x: number, y: number, o: CopyOpts): number {
  const b = sim.beings;
  const s = b.store;
  if (s.size >= WORLD_CAP) return -1;
  const species = s.species[from] ?? 0;
  const female = sim.rng('beings').next() < 0.5 ? 1 : 0;
  const born = o.baby ? sim.tick : (s.born[from] ?? 0);
  const slot = s.spawn(species, x, y, born, s.maxVit[from] ?? 1, o.fuel, female);
  if (slot < 0) return -1;
  b.task[slot] = -1;
  b.cooldown.fill(0, slot * DECISIONS, slot * DECISIONS + DECISIONS);
  const strainId = s.strain[from] ?? 0;
  s.strain[slot] = strainId;
  s.morph[slot] = s.morph[from] ?? 0;
  s.caste[slot] = o.baby ? 0 : (s.caste[from] ?? 0);
  s.palette[slot] = s.palette[from] ?? 0;
  s.shade[slot] = s.shade[from] ?? 0;
  for (let k = 0; k < 4; k++) s.attrs[slot * 4 + k] = s.attrs[from * 4 + k] ?? 0;
  for (let k = 0; k < 5; k++) s.marks[slot * 5 + k] = s.marks[from * 5 + k] ?? 0;
  if (o.link) s.setParent(slot, from);
  b.bumpStrain(strainId, 1);
  refreshStats(sim, slot);
  s.vit[slot] = Math.min(o.vit, s.maxVit[slot] ?? 0);
  s.endurance[slot] = Math.min(b.species(species).endurance, o.endurance);
  s.mood[slot] = o.mood;
  s.reborn[slot] = o.reborn ? 1 : (s.reborn[from] ?? 0);
  s.nextDecision[slot] = 0;
  if (o.birth) {
    addMood(sim, slot, 'born');
    const st = b.strains.get(strainId);
    if (st) st.counters.born++;
    b.stats.births++;
    recordStat(sim, { kind: 'being.born', count: 1 });
    if (o.link) {
      const bs = b.strains.get(strainId);
      if (bs) bs.counters.reproduced++;
    }
  }
  return slot;
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
  b.task[slot] = -1;
  b.cooldown.fill(0, slot * DECISIONS, slot * DECISIONS + DECISIONS);
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
    // A new strain gets a lineage code decomposed from the species budget (05 section 5.3).
    const code = newGenome(speciesBudget(def), sim.realm.seed, speciesIdx, sim.rng('lineage').int(SEED_SALT_RANGE));
    strain = b.strains.create(speciesIdx, def.name, 0, 0, traits, code, palettesFor(def));
  }
  // Birth mutation (05 section 6.3): a bearer whose strain can mutate may give the newborn a mutant strain.
  // An unchanged trait set keeps the newborn in the parent's strain (mutateFrom returns null).
  if (bearer >= 0 && !founder && strain && strainMutation(strain.traits) > 0) {
    const mutant = mutateFrom(b.strains, strain, def.name, sim.rng('lineage'));
    if (mutant) strain = mutant;
  }
  s.strain[slot] = strain.id;
  // Variants (18a section 3): a wild adult rolls its morph, caste and rare colour; a birth inherits the bearer's morph.
  if (bearer >= 0) s.morph[slot] = s.morph[bearer] ?? 0;
  else if (!founder && adult) rollWildVariant(sim, slot, def);
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
  s.endurance[slot] = def.endurance;
  assignPalette(sim, slot, bearer, strain.phenotypes);
  if (!adult) addMood(sim, slot, 'born');
  b.bumpStrain(strain.id, 1);

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

function setNext(sim: Sim, slot: number, ticks: number): void {
  sim.beings.store.nextDecision[slot] = sim.tick + ticks;
}

function isAdult(sim: Sim, slot: number): boolean {
  const s = sim.beings.store;
  return (sim.tick - (s.born[slot] ?? 0)) / YEAR >= (s.adultA[slot] ?? 1);
}

/** Can this Being start a mating now (06 section 6.1, the Being-side gates; the crowd and the partner are checked apart). */
function canMate(sim: Sim, o: number): boolean {
  const s = sim.beings.store;
  const barren = BEING_TRAIT_INDEX.get('barren') ?? -1;
  return (
    (!needsFood(sim.beings.species(s.species[o] ?? 0)) || (s.fuel[o] ?? 0) >= TUNING.matingFuel) &&
    !s.hasMark(o, barren) &&
    sim.tick >= (s.lull[o] ?? 0) &&
    !(s.expecting[o] ?? 0) &&
    !isAsleep(sim, o)
  );
}

/** A female bearer below her living-children cap (06 section 6.1); males always have room. */
function bearerRoom(sim: Sim, o: number): boolean {
  const s = sim.beings.store;
  return s.female[o] === 0 || (s.childCount[o] ?? 0) < Math.ceil(s.litterA[o] ?? 0);
}

/**
 * Whether the strain of `slot` has room under its population cap (06 section 8, 18b POP). A strain with no POP trait is
 * uncapped. The rung is by size class (ROUND8.popRung), times the POP multiplier.
 */
function popRoom(sim: Sim, slot: number): boolean {
  const b = sim.beings;
  const strain = b.strains.get(b.store.strain[slot] ?? 0);
  if (!strain) return true;
  const mult = popMultiplier(strain.traits);
  if (mult === null) return true;
  const rung = ROUND8.popRung[b.species(b.store.species[slot] ?? 0).size] ?? 50;
  return b.strainCount(strain.id) < Math.round(rung * mult);
}

/** The breeding mode of a Being's strain (18b RST and RMT; trait-hooks `breedMode`). */
function modeOf(sim: Sim, slot: number): BreedMode {
  const b = sim.beings;
  return breedMode(b.strains.get(b.store.strain[slot] ?? 0)?.traits ?? []);
}

/** Mating gates for the deciding Being (06 section 6.1): adult, able, rule on, not sleeping, season, cap, and crowd below the cap. */
function mayBreed(sim: Sim, slot: number): boolean {
  const b = sim.beings;
  return (
    isAdult(sim, slot) &&
    canMate(sim, slot) &&
    bearerRoom(sim, slot) &&
    sim.rules.isOn('beast_births') &&
    !sim.effects.flag(slot, 'noBreed') &&
    breedsInSeason(sim, slot, sim.tick) &&
    popRoom(sim, slot) &&
    b.crowdInPatch(slot, b.store.x[slot] ?? 0, b.store.y[slot] ?? 0) < BREEDING_CROWD
  );
}

/** The nearest same-species partner who could mate now (06 section 6.1 partner gates), or -1. */
function mateTarget(sim: Sim, slot: number): number {
  const s = sim.beings.store;
  const sp = s.species[slot] ?? 0;
  return sim.beings.nearest(
    slot,
    (o) => s.species[o] === sp && s.female[o] !== s.female[slot] && isAdult(sim, o) && canMate(sim, o) && bearerRoom(sim, o),
    ROUND6.partnerRadius,
  );
}

/** Nearest hunter within the flee radius, or -1 (07 section 3.6 `flee`). */
function fleeFrom(sim: Sim, slot: number): number {
  const b = sim.beings;
  const rt = b.runtime[b.store.species[slot] ?? 0];
  if (!rt) return -1;
  return b.nearest(slot, (o) => rt.hunters.includes(b.store.species[o] ?? -1), ROUND6.fleeRadius);
}

/** Nearest same-species Being that is not asleep, within the partner radius, or -1 (chat, herd). */
function partnerFor(sim: Sim, slot: number): number {
  const s = sim.beings.store;
  const sp = s.species[slot] ?? 0;
  return sim.beings.nearest(slot, (o) => s.species[o] === sp && !isAsleep(sim, o), ROUND6.partnerRadius);
}

/** Herd member to follow (07 section 3.6 `herd_follow`): the nearest same-species Being, when it is beyond the herd gap. */
function herdTarget(sim: Sim, slot: number): number {
  const b = sim.beings;
  const s = b.store;
  if (!herds(sim, slot, b.species(s.species[slot] ?? 0).herding)) return -1;
  const near = partnerFor(sim, slot);
  if (near < 0) return -1;
  const gap = Math.max(Math.abs((s.x[near] ?? 0) - (s.x[slot] ?? 0)), Math.abs((s.y[near] ?? 0) - (s.y[slot] ?? 0)));
  return gap > ROUND6.herdGap ? near : -1;
}

/**
 * Prey within hunt range that the Being may take. Flesh eaters (diet flesh, or the `flesh_gut` trait); omni eaters
 * only with no food underfoot. A `kin_eater` may also take its own species (18b DIE). Range doubles with `keen_nose`.
 */
function huntTarget(sim: Sim, slot: number): number {
  const b = sim.beings;
  const s = b.store;
  const def = b.species(s.species[slot] ?? 0);
  const flesh = def.diet === 'flesh' || eatsFlesh(sim, slot);
  const omniHunt = def.diet === 'omni' && foodAt(sim, (s.y[slot] ?? 0) * sim.realm.side + (s.x[slot] ?? 0), def.diet) === 0;
  if (!(flesh || omniHunt)) return -1;
  const rt = b.runtime[s.species[slot] ?? 0];
  if (!rt) return -1;
  const kin = eatsKin(sim, slot);
  const range = TUNING.huntRadius * foodRangeMult(sim, slot);
  return b.nearest(
    slot,
    (o) =>
      (rt.prey.includes(s.species[o] ?? -1) || (kin && s.species[o] === s.species[slot])) &&
      SIZE_RANK[SPECIES[s.species[o] ?? 0]?.size ?? 'T'] <= SIZE_RANK[def.size],
    range,
  );
}

/** The nearest flora tile of a diet within the forage radius (row-major order), or -1. */
function findFood(sim: Sim, slot: number, diet: SpeciesDef['diet']): number {
  const s = sim.beings.store;
  const realm = sim.realm;
  const r = Math.round(TUNING.forageRadius * foodRangeMult(sim, slot));
  const x0 = s.x[slot] ?? 0;
  const y0 = s.y[slot] ?? 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (x < 0 || y < 0 || x >= realm.side || y >= realm.side) continue;
      if (foodAt(sim, y * realm.side + x, diet) > 0) return y * realm.side + x;
    }
  }
  return -1;
}

/** Grazing or nectar (06 section 2.2): eat the flora underfoot, or step toward the nearest flora in range. */
function forage(sim: Sim, slot: number, diet: SpeciesDef['diet']): boolean {
  const s = sim.beings.store;
  const realm = sim.realm;
  const here = (s.y[slot] ?? 0) * realm.side + (s.x[slot] ?? 0);
  const food = foodAt(sim, here, diet);
  if (food > 0) {
    s.fuel[slot] = Math.min(100, (s.fuel[slot] ?? 0) + food);
    if (diet === 'grass' || diet === 'omni') {
      grazeFlora(sim, here);
      // Grazers leave dung behind for the manure collector (flora.ts dropManure; placed on the grazed tile or the nearest free one).
      if (sim.rng('manure').next() < GRAZE_MANURE_CHANCE) dropManure(sim, s.x[slot] ?? 0, s.y[slot] ?? 0);
    }
    setNext(sim, slot, 4);
    return false;
  }
  const found = findFood(sim, slot, diet);
  if (found < 0) return false;
  stepToward(sim, slot, found % realm.side, Math.floor(found / realm.side));
  setNext(sim, slot, 2);
  return true;
}

/** Whether a food source of this diet is underfoot or in forage range (eligibility for the eat decisions). */
function canForage(sim: Sim, slot: number, diet: SpeciesDef['diet']): boolean {
  const s = sim.beings.store;
  const here = (s.y[slot] ?? 0) * sim.realm.side + (s.x[slot] ?? 0);
  return foodAt(sim, here, diet) > 0 || findFood(sim, slot, diet) >= 0;
}

/** Whether the Being is hungry (06 section 2.1): needs food and fuel at or below half. */
function hungryOf(sim: Sim, slot: number): boolean {
  const b = sim.beings;
  const def = b.species(b.store.species[slot] ?? 0);
  return needsFood(def) && (b.store.fuel[slot] ?? 0) <= HUNGRY_AT;
}

/** Relation of Being `a` towards Being `o` (07 section 9.4), with the hunger the caller decides. */
function relationOf(sim: Sim, a: number, o: number, hungry: boolean): Relation {
  const b = sim.beings;
  const s = b.store;
  const fa = b.runtime[s.species[a] ?? 0]?.faction;
  const fo = b.runtime[s.species[o] ?? 0]?.faction;
  if (!fa || !fo) return 'I';
  return relation(fa, fo, hungry);
}

/**
 * An aggro entry the Being can act on now (07 section 10.1): a living attacker in chase range, to which the Being's
 * relation is hostile or neutral (a neutral Being fights back, 07 section 9.4 note 1). Hunger does not matter here:
 * an attacker in the aggro set counts as hostile (07 section 9.4). Returns the slot or -1.
 */
function engagedTarget(sim: Sim, slot: number): number {
  for (const o of aggroFoes(sim, slot)) {
    if (tileGap(sim, slot, o) > ROUND8.chaseRange) continue;
    const rel = relationOf(sim, slot, o, true);
    if (rel === 'H' || rel === 'N') return o;
  }
  return -1;
}

/**
 * A new fight target from a search (07 section 8): a hostile Being in sight, if the start roll passes (25% times the
 * trait scale). Runs only when a search is due, and then schedules the next. Returns the slot or -1.
 */
function startTarget(sim: Sim, slot: number): number {
  if (!searchDue(sim, slot)) return -1;
  scheduleSearch(sim, slot);
  const hungry = hungryOf(sim, slot);
  const found = findEnemy(sim, slot, (o) => relationOf(sim, slot, o, hungry) === 'H');
  if (found < 0) return -1;
  const roll = sim.rng('beings').next();
  return roll < ROUND8.fightStartChance * fightStartScale(sim, slot) ? found : -1;
}

/**
 * One blow (07 section 10, 08 section 2.3). Damage is might times the strike scale, less the victim's plating, at least
 * 1. The victim is hurt, angry at the attacker, and may reflect damage or counter-strike once. A kill credits the
 * attacker and gives it `killed_foe`.
 */
function strike(sim: Sim, attacker: number, victim: number, fixed = 0): void {
  const b = sim.beings;
  const s = b.store;
  // `fixed` > 0 replaces the computed damage (the brawl stop blow does 1, 08 section 2.5).
  const hit = fixed > 0 ? fixed : Math.max(1, Math.floor((s.mightA[attacker] ?? 1) * strikeScale(sim, attacker) * (1 - (s.platingA[victim] ?? 0) / 100)));
  b.stats.blows++;
  s.vit[victim] = (s.vit[victim] ?? 0) - hit;
  if ((s.vit[victim] ?? 0) <= 0) {
    killBeing(sim, victim, 'combat', attacker);
    addMood(sim, attacker, 'killed_foe');
    return;
  }
  addMood(sim, victim, 'injured');
  if (beingHas(sim, attacker, 'venom_gland')) sim.effects.add(victim, 'venomed', sim.tick);
  addAggro(sim, victim, attacker);
  const back = reflectDamage(sim, victim);
  if (back > 0) {
    s.vit[attacker] = (s.vit[attacker] ?? 0) - back;
    if ((s.vit[attacker] ?? 0) <= 0) {
      killBeing(sim, attacker, 'combat', victim);
      return;
    }
  }
  const counter = counterChance(sim, victim);
  if (counter > 0 && sim.rng('beings').next() < counter) {
    const riposte = Math.max(1, Math.floor((s.mightA[victim] ?? 1) * (1 - (s.platingA[attacker] ?? 0) / 100)));
    s.vit[attacker] = (s.vit[attacker] ?? 0) - riposte;
    if ((s.vit[attacker] ?? 0) <= 0) killBeing(sim, attacker, 'combat', victim);
  }
}

/** Whether a Being is Folk (07 section 9.4 `folk` faction). */
function isFolk(sim: Sim, slot: number): boolean {
  const b = sim.beings;
  return b.species(b.store.species[slot] ?? 0).folk;
}

/**
 * One blow of a Folk-on-Folk fight, with the brawl rule (08 section 2.5, default stop chance). Once the victim is under half
 * its vitality, a roll may end the brawl: the blow does 1 damage, the victim is dazed and bested, and the grudge between the
 * two ends on both sides. Returns true while the fight goes on. The same-dominion and enemy-dominion chances are not
 * modelled (no dominion on a Being), so the default applies to every Folk pair.
 */
function brawlBlow(sim: Sim, attacker: number, victim: number): boolean {
  const s = sim.beings.store;
  const low = (s.vit[victim] ?? 0) * 2 < (s.maxVit[victim] ?? 0);
  if (low && sim.rng('beings').next() < ROUND8.brawlStopChance) {
    strike(sim, attacker, victim, 1);
    if (s.alive[victim] === 1) {
      sim.effects.add(victim, 'dazed', sim.tick);
      addMood(sim, victim, 'bested_in_fight');
      dropAggro(sim, victim, attacker);
    }
    dropAggro(sim, attacker, victim);
    return false;
  }
  strike(sim, attacker, victim);
  return s.alive[victim] === 1 && s.alive[attacker] === 1;
}

/** Mating (06 section 6.3): a pregnancy for the bearer, with its gestation, litter and fuel cost (06 section 6.4). */
function beginPregnancy(sim: Sim, bearer: number, brood: number | null, anySex: boolean): void {
  const s = sim.beings.store;
  if (!anySex && !s.female[bearer]) return;
  if (s.expecting[bearer]) return;
  const def = sim.beings.species(s.species[bearer] ?? 0);
  s.expecting[bearer] = 1;
  s.expectUntil[bearer] = sim.tick + Math.round((s.gestationA[bearer] ?? def.gestationMonths) * MONTH_TICKS);
  s.brood[bearer] = brood ?? litterRoll(sim, Math.round(s.broodA[bearer] ?? def.litter));
  s.fuel[bearer] = Math.max(0, (s.fuel[bearer] ?? 0) - BIRTH_FUEL);
}

/**
 * Split birth (06 section 6.3, `birth_clonal`): the parent and a clone each take half of its vitality, endurance, mood
 * and fuel. The clone is a baby beside the parent, linked to it. Nothing happens without a free tile.
 */
function splitBirth(sim: Sim, slot: number): void {
  const b = sim.beings;
  const s = b.store;
  const tile = freeNeighbour(sim, s.x[slot] ?? 0, s.y[slot] ?? 0);
  if (!tile) return;
  const vit = Math.floor((s.vit[slot] ?? 0) / 2);
  const endurance = Math.floor((s.endurance[slot] ?? 0) / 2);
  const mood = Math.trunc((s.mood[slot] ?? 0) / 2);
  const fuel = Math.floor((s.fuel[slot] ?? 0) / 2);
  s.vit[slot] = vit;
  s.endurance[slot] = endurance;
  s.mood[slot] = mood;
  s.fuel[slot] = fuel;
  s.lull[slot] = sim.tick + LULL;
  spawnCopy(sim, slot, tile.x, tile.y, { vit, endurance, mood, fuel, baby: true, link: true, birth: true, reborn: false });
}

/**
 * Spore birth (06 section 6.3, `birth_spore`): 3 to 9 babies at once, each landing within three tiles of the parent.
 * The parent pays the birth fuel and takes a lull.
 */
function sporeBirth(sim: Sim, slot: number): void {
  const b = sim.beings;
  const s = b.store;
  const rng = sim.rng('beings');
  const n = ROUND8.sporeMin + rng.int(ROUND8.sporeMax - ROUND8.sporeMin + 1);
  const r = ROUND8.sporeRadius;
  const species = s.species[slot] ?? 0;
  s.lull[slot] = sim.tick + LULL;
  s.fuel[slot] = Math.max(0, (s.fuel[slot] ?? 0) - BIRTH_FUEL);
  for (let k = 0; k < n && b.store.size < WORLD_CAP; k++) {
    const x = (s.x[slot] ?? 0) + rng.int(2 * r + 1) - r;
    const y = (s.y[slot] ?? 0) + rng.int(2 * r + 1) - r;
    spawnBeing(sim, species, x, y, false, slot);
  }
}

/**
 * The fight task (07 section 10, 08 section 2.3), shared by the `fight` and `brawl` decisions. Takes the target from an
 * engaged aggro entry or from this decision's search. A blow between two Folk goes through the brawl rule.
 */
function fightStep(sim: Sim, slot: number): boolean {
  const b = sim.beings;
  const s = b.store;
  let target = engagedTarget(sim, slot);
  if (target < 0) {
    // A fresh target from this decision's search (eligibility wrote it); it becomes a grudge for the chase.
    target = b.scratch[slot] ?? -1;
    b.scratch[slot] = -1;
    if (target < 0) return false;
    addAggro(sim, slot, target, ROUND8.grudgeTicks);
  }
  if (s.alive[target] !== 1) return false;
  if (tileGap(sim, slot, target) > 1) {
    stepToward(sim, slot, s.x[target] ?? 0, s.y[target] ?? 0);
    setNext(sim, slot, 2);
    return true;
  }
  if (isFolk(sim, slot) && isFolk(sim, target)) {
    const going = brawlBlow(sim, slot, target);
    setNext(sim, slot, ROUND8.fightBeat);
    return going;
  }
  strike(sim, slot, target);
  setNext(sim, slot, ROUND8.fightBeat);
  return s.alive[target] === 1 && s.alive[slot] === 1;
}

/** The decision tasks of the beast layer (07 section 5, beast subset). Each returns true while the task continues. */
const TASKS: Record<string, TaskFn> = {
  wander: (sim, slot) => {
    const rng = sim.rng('beings');
    wander(sim, slot, rng.int(8));
    if (roamsFar(sim, slot)) wander(sim, slot, rng.int(8));
    setNext(sim, slot, 4 + rng.int(6));
    return false;
  },
  pause5: (sim, slot) => {
    setNext(sim, slot, ROUND6.pauseTicks);
    return false;
  },
  idle_nap: (sim, slot) => {
    beginSleep(sim, slot, 'nap');
    setNext(sim, slot, 1);
    return false;
  },
  polyphasic: (sim, slot) => {
    beginSleep(sim, slot, 'poly');
    setNext(sim, slot, 1);
    return false;
  },
  monophasic: (sim, slot) => {
    beginSleep(sim, slot, 'mono');
    setNext(sim, slot, 1);
    return false;
  },
  herd_follow: (sim, slot) => {
    const target = herdTarget(sim, slot);
    if (target < 0) return false;
    const s = sim.beings.store;
    stepToward(sim, slot, s.x[target] ?? 0, s.y[target] ?? 0);
    setNext(sim, slot, 2);
    return true;
  },
  chat: (sim, slot) => {
    const partner = partnerFor(sim, slot);
    if (partner < 0) return false;
    const s = sim.beings.store;
    const gap = Math.max(Math.abs((s.x[partner] ?? 0) - (s.x[slot] ?? 0)), Math.abs((s.y[partner] ?? 0) - (s.y[slot] ?? 0)));
    if (gap > 2) {
      stepToward(sim, slot, s.x[partner] ?? 0, s.y[partner] ?? 0);
      setNext(sim, slot, 2);
      return true;
    }
    // Conversation outcome (06 section 4.3, simplified to one round): 70% good, 30% bad, for both.
    const event = sim.rng('beings').next() < 0.7 ? 'talked_well' : 'talked_badly';
    addMood(sim, slot, event);
    addMood(sim, partner, event);
    setNext(sim, slot, 20);
    return false;
  },
  flee: (sim, slot) => {
    const hunter = fleeFrom(sim, slot);
    if (hunter < 0) return false;
    const s = sim.beings.store;
    const x = s.x[slot] ?? 0;
    const y = s.y[slot] ?? 0;
    stepToward(sim, slot, x + Math.sign(x - (s.x[hunter] ?? 0)) * 3, y + Math.sign(y - (s.y[hunter] ?? 0)) * 3);
    setNext(sim, slot, 2);
    return true;
  },
  fight: fightStep,
  brawl: fightStep,
  eat_grass: (sim, slot) => forage(sim, slot, 'grass'),
  eat_nectar: (sim, slot) => forage(sim, slot, 'nectar'),
  eat_hunt: (sim, slot) => {
    const prey = huntTarget(sim, slot);
    if (prey < 0) return false;
    const s = sim.beings.store;
    const adjacent = Math.abs((s.x[prey] ?? 0) - (s.x[slot] ?? 0)) <= 1 && Math.abs((s.y[prey] ?? 0) - (s.y[slot] ?? 0)) <= 1;
    setNext(sim, slot, 3);
    if (!adjacent) {
      stepToward(sim, slot, s.x[prey] ?? 0, s.y[prey] ?? 0);
      return true;
    }
    // Strike through combat.predate: claw swing when ready, then the bite via applyDamage (06 section 2.2). Fuel gains the damage dealt.
    const hit = predate(sim.combatContext(), slot, prey);
    if (hit.killed) {
      s.fuel[slot] = 100;
      return false;
    }
    // A bitten Being that lives turns on its attacker (07 section 10.4); a neutral one then fights back.
    // `venom_gland` (18b ELM): the bite applies `venomed` (08 section 2 status, periodic damage).
    if (beingHas(sim, slot, 'venom_gland')) sim.effects.add(prey, 'venomed', sim.tick);
    addAggro(sim, prey, slot);
    s.fuel[slot] = Math.min(100, (s.fuel[slot] ?? 0) + hit.dealt);
    return true;
  },
  mate: (sim, slot) => {
    const b = sim.beings;
    const s = b.store;
    const tick = sim.tick;
    const mode = modeOf(sim, slot);
    setNext(sim, slot, 3);
    // Asexual modes (06 section 6.3): no partner is needed.
    if (mode === 'split') {
      splitBirth(sim, slot);
      return false;
    }
    if (mode === 'spore') {
      sporeBirth(sim, slot);
      s.lull[slot] = tick + LULL;
      return false;
    }
    if (mode === 'bud' || mode === 'self') {
      beginPregnancy(sim, slot, mode === 'bud' ? 1 : null, true);
      s.lull[slot] = tick + LULL;
      return false;
    }
    // Sexual pairing (06 section 6.1): the bearer is pregnant for its gestation and carries a litter (06 section 6.4).
    const partner = mateTarget(sim, slot);
    if (partner < 0) return false;
    const adjacent = Math.abs((s.x[partner] ?? 0) - (s.x[slot] ?? 0)) <= 1 && Math.abs((s.y[partner] ?? 0) - (s.y[slot] ?? 0)) <= 1;
    if (!adjacent) {
      stepToward(sim, slot, s.x[partner] ?? 0, s.y[partner] ?? 0);
      return true;
    }
    const bearer = s.female[slot] ? slot : partner;
    beginPregnancy(sim, bearer, null, false);
    s.lull[slot] = tick + LULL;
    s.lull[partner] = tick + LULL;
    return false;
  },
};

/** Runs one step of a decision's task. */
function runTask(sim: Sim, slot: number, k: number): boolean {
  const id = DECISION_ROWS[k]?.id ?? '';
  const task = TASKS[id];
  return task ? task(sim, slot) : false;
}

/**
 * Eligibility of a decision beyond its flags (07 section 3.3 preconditions). The `fight` check may run a search and
 * leaves its target in `scratch` for the task.
 */
function eligible(sim: Sim, slot: number, id: string, fleeing: boolean): boolean {
  const b = sim.beings;
  const s = b.store;
  const def = b.species(s.species[slot] ?? 0);
  switch (id) {
    case 'flee':
      return fleeing;
    case 'fight': {
      if (fleeing) return false;
      if (engagedTarget(sim, slot) >= 0) return true;
      const target = startTarget(sim, slot);
      b.scratch[slot] = target;
      return target >= 0;
    }
    case 'brawl': {
      // Folk only. It runs only when the fight row found no hostile (its scratch is empty), on a small roll per decision.
      if (fleeing || !isFolk(sim, slot) || b.scratch[slot] !== -1) return false;
      if (sim.rng('beings').next() >= ROUND8.brawlStartChance * fightStartScale(sim, slot)) return false;
      const target = findEnemy(sim, slot, (o) => o !== slot && s.alive[o] === 1 && isFolk(sim, o));
      b.scratch[slot] = target;
      return target >= 0;
    }
    case 'herd_follow':
      return herdTarget(sim, slot) >= 0;
    case 'chat':
      return partnerFor(sim, slot) >= 0;
    case 'eat_grass':
      return (def.diet === 'grass' || def.diet === 'omni') && canForage(sim, slot, 'grass');
    case 'eat_nectar':
      return def.diet === 'nectar' && canForage(sim, slot, 'nectar');
    case 'eat_hunt':
      return huntTarget(sim, slot) >= 0;
    case 'mate':
      return mayBreed(sim, slot) && (modeOf(sim, slot) !== 'live' || mateTarget(sim, slot) >= 0);
    default:
      return true;
  }
}

/**
 * One decision for a being (07 sections 3 and 4). Three layers run in order: the override (a flight from a hunter, or
 * an engaged fight, takes over any running task except its own kind), the running task, and the decision layer
 * (brain.ts) picking a new task by tier and softmax weight among the eligible decisions.
 */
function decide(sim: Sim, slot: number): void {
  const b = sim.beings;
  const s = b.store;
  const tick = sim.tick;
  const rt = b.runtime[s.species[slot] ?? 0];
  if (!rt) return;
  const hungry = hungryOf(sim, slot);
  const fleeing = fleeFrom(sim, slot) >= 0 && fleeAllowed(sim, slot);
  const fightIdx = DECISION_INDEX.get('fight') ?? -1;
  b.scratch[slot] = -1;

  // Override layer (07 sections 4.2 and 10.1): a flight ends any task but flee; an engaged fight takes over any task
  // but fight and flee. A task that continues is then run as is.
  let current = b.task[slot] ?? -1;
  if (current >= 0) {
    const id = DECISION_ROWS[current]?.id;
    if (fleeing && id !== 'flee') current = -1;
    else if (!fleeing && id !== 'flee' && id !== 'fight' && fightIdx >= 0 && engagedTarget(sim, slot) >= 0) current = fightIdx;
  }
  if (current < 0 && !fleeing && fightIdx >= 0 && engagedTarget(sim, slot) >= 0) current = fightIdx;
  if (current >= 0) {
    b.task[slot] = current;
    if (!runTask(sim, slot, current)) b.task[slot] = -1;
    return;
  }
  b.task[slot] = -1;

  // Decision layer (07 sections 3.3 to 3.5): candidates, tiers and the softmax pick.
  const ctx: CandidateContext = {
    tick,
    cooldownOf: (k) => b.cooldown[slot * DECISIONS + k] ?? 0,
    flagsOk: (row) =>
      !(row.flags.includes('onlyHungry') && !hungry) &&
      !(row.flags.includes('onlySafe') && fleeing) &&
      !(row.flags.includes('onlyAdult') && !isAdult(sim, slot)),
    eligible: (row) => eligible(sim, slot, row.id, fleeing),
    // Reproduction weight: 2 under the living-children cap, else 0.1 (07 section 3.4).
    weight: (row) => (row.id === 'mate' && (s.childCount[slot] ?? 0) >= Math.ceil(s.litterA[slot] ?? 0) ? 0.1 : row.weight),
  };
  const pick = chooseDecision(DECISION_ROWS, sim.rng('beings'), ctx);
  if (!pick) {
    setNext(sim, slot, EMPTY_PAUSE);
    return;
  }
  const row = DECISION_ROWS[pick.k];
  if (!row) return;
  b.cooldown[slot * DECISIONS + pick.k] = tick + row.cooldown;
  b.task[slot] = pick.k;
  if (!runTask(sim, slot, pick.k)) b.task[slot] = -1;
}

/** Ticks that fall on the Being's own birthday (06 section 3.4): the yearly pass for the venerable caste. */
function birthday(sim: Sim, slot: number): boolean {
  const s = sim.beings.store;
  return ((sim.tick - (s.born[slot] ?? 0)) % YEAR + YEAR) % YEAR === 0;
}

/**
 * Per-tick being update (02 section 4 step 6): fuel and starvation, regeneration, natural death, births from
 * pregnancies, movement budget, and decisions when due. Round 8 adds the trait life hooks (mending, stumbling,
 * pregnancy stasis, the venerable caste) before the death roll.
 */
/**
 * Hunter kill rule (09 section 8 hunter; beings hook only). A hamlet with a larder and at least HUNT_MIN_FOLK folk keeps one
 * hunter: the first adult folk of its parcels in store order. The hunter strikes the first non-kin being, not folk and
 * at least HUNT_MIN_YEARS old, within HUNT_RADIUS, through combat.predate. A kill adds meat to the hamlet store (up to its cap).
 * Runs every HUNT_PERIOD ticks and draws no randomness.
 */
function hunterStep(sim: Sim): void {
  if (sim.tick % HUNT_PERIOD !== 0) return;
  const s = sim.beings.store;
  const perAxis = sim.realm.side / PARCEL;
  const parcelOf = (slot: number): number => Math.floor((s.y[slot] ?? 0) / PARCEL) * perAxis + Math.floor((s.x[slot] ?? 0) / PARCEL);
  for (const h of hamletsOf(sim)) {
    if (h.folk < HUNT_MIN_FOLK || !h.buildings.some((bl) => bl.def.id === 'larder')) continue;
    let hunter = -1;
    for (let k = 0; k < s.size && hunter < 0; k++) {
      const slot = s.at(k);
      if (s.alive[slot] === 1 && s.baby[slot] === 0 && h.parcels.has(parcelOf(slot)) && sim.beings.species(s.species[slot] ?? 0).folk) hunter = slot;
    }
    if (hunter < 0) continue;
    const hx = s.x[hunter] ?? 0;
    const hy = s.y[hunter] ?? 0;
    let prey = -1;
    for (let k = 0; k < s.size && prey < 0; k++) {
      const o = s.at(k);
      if (o === hunter || s.alive[o] !== 1 || s.species[o] === s.species[hunter]) continue;
      if (sim.beings.species(s.species[o] ?? 0).folk) continue;
      if (sim.tick - (s.born[o] ?? 0) < HUNT_MIN_YEARS * YEAR_TICKS) continue;
      if (Math.max(Math.abs((s.x[o] ?? 0) - hx), Math.abs((s.y[o] ?? 0) - hy)) <= HUNT_RADIUS) prey = o;
    }
    if (prey < 0) continue;
    const hit = predate(sim.combatContext(), hunter, prey);
    const cap = foodCapacity(h);
    if (hit.killed && h.food < cap) h.food = Math.min(h.food + MEAT_FOOD, cap);
  }
}

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
  b.countStrains();
  hunterStep(sim);

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
      addMood(sim, slot, 'grew_up');
    }

    // Trait life hooks (18b). `mendflesh` heals a share every ten seconds, unless the Being is hungry.
    if (tick % ROUND8.mendTicks === 0 && mends(sim, slot) && (!feeds || (s.fuel[slot] ?? 0) >= HUNGRY_AT) && rng.next() < ROUND8.mendChance) {
      const heal = Math.max(1, Math.floor((s.maxVit[slot] ?? 0) * ROUND8.mendFraction));
      s.vit[slot] = Math.min(s.maxVit[slot] ?? 0, (s.vit[slot] ?? 0) + heal);
    }
    // `jittery` stumbles once a Month with a small chance (18b FLW; the stun is the `dazed` status).
    if (tick % MONTH_TICKS === 0 && jittery(sim, slot) && rng.next() < ROUND8.jitterChance) sim.effects.add(slot, 'dazed', tick);
    // `gestation_stasis` holds a pregnancy still while the bearer is hungry (18b GST).
    if (s.expecting[slot] && pregnancyPausesWhenHungry(sim, slot) && (s.fuel[slot] ?? 0) <= HUNGRY_AT) {
      s.expectUntil[slot] = (s.expectUntil[slot] ?? 0) + 1;
    }
    // Venerable caste (18a 3.3): an aged adult may be venerable on a birthday, once.
    if (s.baby[slot] !== 1 && (s.spanA[slot] ?? 0) > 0 && birthday(sim, slot)) {
      const age = (tick - (s.born[slot] ?? 0)) / YEAR;
      if (age > 0.7 * (s.spanA[slot] ?? 0) && rollVenerable(sim, slot)) refreshStats(sim, slot);
    }

    // Fuel pass (06 section 2.1): metabolism is taken first; at 0 the hunger rule starves the Being by 5% of
    // max vitality, otherwise endurance regains 1. A sleeping `energy_saver` Being is skipped.
    if (fuelPass && feeds && !(isAsleep(sim, slot) && strainHas(sim, slot, 'energy_saver'))) {
      s.fuel[slot] = Math.max(0, (s.fuel[slot] ?? 0) - (s.metabolismA[slot] ?? 1));
      if ((s.fuel[slot] ?? 0) === 0) {
        if (hungerRule) {
          s.vit[slot] = (s.vit[slot] ?? 0) - Math.max(1, Math.floor((s.maxVit[slot] ?? 0) * 0.05));
          addMood(sim, slot, 'starving');
          if ((s.vit[slot] ?? 0) <= 0) {
            killBeing(sim, slot, 'starved');
            continue;
          }
        }
      } else {
        s.endurance[slot] = Math.min(def.endurance, (s.endurance[slot] ?? 0) + 1);
      }
    }
    if (regen && (!feeds || (s.fuel[slot] ?? 0) >= HUNGRY_AT) && (s.vit[slot] ?? 0) < (s.maxVit[slot] ?? 0)) {
      s.vit[slot] = (s.vit[slot] ?? 0) + 1;
    }

    // Span 0 never dies of age (05 section 1, 06 section 3.5). `evergreen` is not rolled (18b VIT).
    const span = s.spanA[slot] ?? 0;
    if (deathRoll && agingRule && span > 0 && !evergreen(sim, slot)) {
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
      let born = 0;
      for (let n = 0; n < brood && b.store.size < WORLD_CAP; n++) {
        if (spawnBeing(sim, s.species[slot] ?? 0, (s.x[slot] ?? 0) + rng.int(5) - 2, (s.y[slot] ?? 0) + rng.int(5) - 2, false, slot) >= 0) born++;
      }
      if (born > 0) addMood(sim, slot, 'child_born');
    }

    if (tick % BOND_CHECK === 0) bondCheck(sim, slot);
    if (sleepCheck(sim, slot)) continue;
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
