import { SPECIES, speciesIndex, type SpeciesDef } from '../../content/beasts.ts';
import { ground } from '../../content/grounds.ts';
import { FLORA_BY_ID, grazeFlora } from '../flora.ts';
import type { Realm } from '../realm.ts';
import type { Sim } from '../sim.ts';
import { BeingStore } from './store.ts';
import { TUNING } from './tuning.ts';

export type { BeingStore };

/** Ticks between fuel passes (06 section 2.1: 100 passes fill a 100-point bar at metabolism 1). */
const FUEL_PASS = 300;
/** Ticks between natural-death rolls (06 section 3.5). */
const DEATH_ROLL = 20;
/** Ticks between vitality regeneration steps when fed. */
const REGEN = 60;
/** Mating lull after a birth, in ticks (06 section 6.1). */
const LULL = 1800;
/** Fuel at or below which a being is hungry (06 section 2.1). */
const HUNGRY_AT = 50;
/** Cap on live beings (06 section 8, TUNE; the quality tier caps the array). */
export const WORLD_CAP = 4096;
/** Spatial bucket side in tiles. */
const BUCKET = 8;
/** Beasts breed only with fewer than this many other beings in their 16x16 patch (06 section 6.1). */
const BREEDING_CROWD = 6;
/** Ticks per simulated Year (02 section 1). */
const YEAR = 1200;

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
  births: number;
  deaths: number;
  starved: number;
  eaten: number;
  aged: number;
}

/** Per-species derived values (06 section 3.1). */
interface SpeciesRuntime {
  def: SpeciesDef;
  adultYears: number;
  hunters: number[];
  prey: number[];
}

/**
 * Beings subsystem: the store, a spatial bucket grid, and the life cycle (fuel, regeneration,
 * ageing and death, decisions and movement, mating and births). One instance per Sim.
 */
export class Beings {
  readonly store = new BeingStore();
  readonly stats: BeingStats = { births: 0, deaths: 0, starved: 0, eaten: 0, aged: 0 };
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
      adultYears: Math.max(1, Math.min(16, Math.pow(def.span, 0.55) * 1.1)),
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

/** Spends one movement unit (17 pace: pace/20 tiles per tick accumulates). */
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
  if (diet === 'grass') return TUNING.grazeGain;
  if (diet === 'nectar') return code === (FLORA_BY_ID.get('fieldflower') ?? -2) + 1 ? TUNING.nectarGain : 0;
  return 0;
}

/** Litter size: first baby always, extras with probability 0.5 * 0.85^i (06 section 6.4). */
function litterRoll(sim: Sim, max: number): number {
  const rng = sim.rng('beings');
  let brood = 1;
  for (let i = 0; i < max - 1; i++) {
    if (rng.next() < 0.5 * Math.pow(0.85, i)) brood++;
  }
  return brood;
}

/** Removes a being, counting the cause. */
export function killBeing(sim: Sim, slot: number, cause: 'eaten' | 'starved' | 'age' | 'combat'): void {
  const b = sim.beings;
  if (b.store.alive[slot] !== 1) return;
  b.store.kill(slot);
  sim.effects.clear(slot);
  b.stats.deaths++;
  if (cause === 'eaten') b.stats.eaten++;
  if (cause === 'starved') b.stats.starved++;
  if (cause === 'age') b.stats.aged++;
}

/** Spawns a being at (x,y); returns its slot or -1 (store full, or the tile is not walkable). */
export function spawnBeing(sim: Sim, speciesIdx: number, x: number, y: number, adult: boolean): number {
  const realm = sim.realm;
  if (x < 0 || y < 0 || x >= realm.side || y >= realm.side) return -1;
  if (!walkable(realm, y * realm.side + x)) return -1;
  const def = sim.beings.species(speciesIdx);
  const female = sim.rng('beings').next() < 0.5 ? 1 : 0;
  const vit = adult ? def.vitality : Math.max(1, Math.floor(def.vitality / 2));
  // Spawned adults start at their adult age (06 section 3.1 ageBonusYears), so they can breed at once.
  const adultAge = Math.ceil(sim.beings.runtime[speciesIdx]?.adultYears ?? 1) * YEAR;
  const born = adult ? sim.tick - adultAge : sim.tick;
  const slot = sim.beings.store.spawn(speciesIdx, x, y, born, def.vitality, adult ? 100 : 25, female);
  if (slot < 0) return -1;
  sim.beings.store.vit[slot] = vit;
  sim.beings.stats.births++;
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
  const adult = (tick - (s.born[slot] ?? 0)) / YEAR >= rt.adultYears;
  const hungry = (s.fuel[slot] ?? 0) <= TUNING.hungryAt;

  // Flee the nearest hunter within four tiles.
  const hunter = b.nearest(slot, (o) => rt.hunters.includes(s.species[o] ?? -1), 4);
  if (hunter >= 0) {
    const x = s.x[slot] ?? 0;
    const y = s.y[slot] ?? 0;
    stepToward(sim, slot, x + Math.sign(x - (s.x[hunter] ?? 0)) * 3, y + Math.sign(y - (s.y[hunter] ?? 0)) * 3);
    s.nextDecision[slot] = tick + 2;
    return;
  }

  if (hungry && def.diet === 'flesh') {
    const prey = b.nearest(slot, (o) => rt.prey.includes(s.species[o] ?? -1), TUNING.huntRadius);
    if (prey >= 0) {
      const adjacent = Math.abs((s.x[prey] ?? 0) - (s.x[slot] ?? 0)) <= 1 && Math.abs((s.y[prey] ?? 0) - (s.y[slot] ?? 0)) <= 1;
      if (adjacent) {
        s.vit[prey] = (s.vit[prey] ?? 0) - def.might;
        if ((s.vit[prey] ?? 0) <= 0) {
          killBeing(sim, prey, 'eaten');
          s.fuel[slot] = 100;
        } else {
          s.fuel[slot] = Math.min(100, (s.fuel[slot] ?? 0) + def.might);
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
      if (def.diet === 'grass') grazeFlora(sim, here);
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

  // Mating: adult, fed, not in a lull, not already expecting, and the rule allows births.
  const crowded = b.crowdInPatch(slot, s.x[slot] ?? 0, s.y[slot] ?? 0) >= BREEDING_CROWD;
  if (adult && !crowded && (s.fuel[slot] ?? 0) >= TUNING.matingFuel && tick >= (s.lull[slot] ?? 0) && !(s.expecting[slot] ?? 0) && sim.rules.isOn('beast_births') && !sim.effects.flag(slot, 'noBreed')) {
    const sp = s.species[slot] ?? 0;
    const mate = b.nearest(
      slot,
      (o) =>
        s.species[o] === sp &&
        s.female[o] !== s.female[slot] &&
        (tick - (s.born[o] ?? 0)) / YEAR >= rt.adultYears &&
        tick >= (s.lull[o] ?? 0) &&
        (s.fuel[o] ?? 0) >= TUNING.matingFuel,
      8,
    );
    if (mate >= 0) {
      const adjacent = Math.abs((s.x[mate] ?? 0) - (s.x[slot] ?? 0)) <= 1 && Math.abs((s.y[mate] ?? 0) - (s.y[slot] ?? 0)) <= 1;
      if (adjacent) {
        const bearer = s.female[slot] ? slot : mate;
        if (s.female[bearer] && !(s.expecting[bearer] ?? 0)) {
          s.expecting[bearer] = 1;
          s.expectUntil[bearer] = tick + def.gestationMonths * 100;
          s.brood[bearer] = litterRoll(sim, def.litter);
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
    s.moveAcc[slot] = Math.min(2, (s.moveAcc[slot] ?? 0) + (def.pace * sim.effects.multiplier(slot, 'speed')) / 20);

    if (fuelPass) {
      if ((s.fuel[slot] ?? 0) > 0) {
        s.fuel[slot] = Math.max(0, (s.fuel[slot] ?? 0) - (def.diet === 'flesh' ? TUNING.predatorMetabolism : 1));
      } else if (hungerRule) {
        s.vit[slot] = (s.vit[slot] ?? 0) - Math.max(1, Math.floor((s.maxVit[slot] ?? 0) * 0.05));
        if ((s.vit[slot] ?? 0) <= 0) {
          killBeing(sim, slot, 'starved');
          continue;
        }
      }
    }
    if (regen && (s.fuel[slot] ?? 0) >= HUNGRY_AT && (s.vit[slot] ?? 0) < (s.maxVit[slot] ?? 0)) {
      s.vit[slot] = (s.vit[slot] ?? 0) + 1;
    }

    if (deathRoll && agingRule) {
      const age = (tick - (s.born[slot] ?? 0)) / YEAR;
      if (age > def.span) {
        const x = (age - def.span) / def.span;
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
        spawnBeing(sim, s.species[slot] ?? 0, (s.x[slot] ?? 0) + rng.int(5) - 2, (s.y[slot] ?? 0) + rng.int(5) - 2, false);
      }
    }

    if (tick >= (s.nextDecision[slot] ?? 0)) decide(sim, slot);
  }
}

/** Starting beasts (03 section 8.3, reduced): small groups placed on suitable biome tiles. */
export function seedStartingBeasts(sim: Sim, groups: number): number {
  const realm = sim.realm;
  const rng = sim.rng('start');
  let placed = 0;
  for (let g = 0; g < groups; g++) {
    const x0 = rng.int(realm.side);
    const y0 = rng.int(realm.side);
    const i = y0 * realm.side + x0;
    const species = rng.int(SPECIES.length);
    const def = SPECIES[species];
    const biome = sim.biomeAt(i);
    if (!def || !biome || !def.biomes.includes(biome.id)) continue;
    const size = 2 + rng.int(3);
    for (let n = 0; n < size; n++) {
      if (spawnBeing(sim, species, x0 + rng.int(5) - 2, y0 + rng.int(5) - 2, true) >= 0) placed++;
    }
  }
  return placed;
}

