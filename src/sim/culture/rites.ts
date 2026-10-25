/**
 * Creed rites (11 section 3, spells and rites close 14): the world effect of each rite that the sim can run. A rite is a
 * dominion intrigue (dominions/intrigue.ts riteOk and resolveIntrigues); its gate and effect are read here through the
 * RiteHooks the dominion adapter builds (dominions/adapter.ts riteHooksOf). Rites with no sim hook are `built: false` in
 * content/rites.ts and never run. Target hamlets and tiles are drawn from the `rites` stream, and only when a rite runs.
 *
 * The spec's "soldiers" (wardRite, leadenRite) are read as the Folk of the dominion or hamlet: the sim keeps no soldier
 * list. Delays (thunderRite's staggered bolts), the lifetime of the clouds, and the worldTransform post step are not modelled
 * (DECISIONS.md "Spells and rites close 14").
 */
import type { Sim } from '../sim.ts';
import { PARCEL } from '../../shared/constants.ts';
import { RITE_TABLE, type RiteKind } from '../../content/rites.ts';
import { BOMB_PROFILE_BY_ID } from '../../content/powers.ts';
import { speciesIndex } from '../../content/beasts.ts';
import { RITUALS_RULE } from '../rules.ts';
import { dominionOwnerOf, dominionsOfSim, ownerOfHamlet, UNOWNED } from '../dominions/adapter.ts';
import { hamletsOf } from '../settlements/adapter.ts';
import { centreOf } from '../settlements/custom-rules.ts';
import { spawnBeing } from '../beings/system.ts';
import { startQuake } from '../terrain/quake.ts';
import { meteorImpact } from '../terrain/meteor.ts';
import { detonateBomb } from '../powers/handlers.ts';
import { MAX_CLOUDS, type Cloud } from '../weather.ts';
import { tenetsOfGroup } from './culture.ts';

/** The dominion relation a rite reads for an enemy hamlet (dominions/types.ts Relation, as RelationMatrix.get gives it). */
export interface RiteEnv {
  relationOf(a: number, b: number): 'peace' | 'tension' | 'war';
}

type Hamlet = ReturnType<typeof hamletsOf>[number];

/** Share of citizens of an enemy hamlet that a dreadMistRite frenzies (11 section 3). */
const DREAD_CHANCE = 0.8;
/** Share of the rite draws that pick the caster's own hamlet for pitRite (11 section 3: 6.66%). */
const PIT_OWN_CHANCE = 1 / 15;
/** Speed of a rite cloud in tiles per tick, and ticks between its drops (TUNE; the lifetime is not modelled). */
const RITE_CLOUD_SPEED = 0.2;
const RITE_CLOUD_DROP = 20;
/** Bolts of thunderRite beyond the first, and the radius they fall in (11 section 3: 5-12 within 10 tiles). */
const THUNDER_RADIUS = 10;

/** Parcel index of a tile's parcel, for a realm of `side` tiles. */
function parcelOf(side: number, x: number, y: number): number {
  const perAxis = side / PARCEL;
  return Math.floor(y / PARCEL) * perAxis + Math.floor(x / PARCEL);
}

/** The hamlets of the realm that the owner function gives to `owner` (hamlets.ts parcels), or the others when `mine` is false. */
function hamletsOwnedBy(sim: Sim, d: number, mine: boolean): Hamlet[] {
  const owner = dominionOwnerOf(sim);
  if (!owner) return [];
  return hamletsOf(sim).filter((h) => {
    const o = ownerOfHamlet(h.parcels, owner);
    return o !== UNOWNED && (o === d) === mine;
  });
}

/** Enemy hamlets of dominion `d`: held by a dominion it is not at peace with (11 section 3 pickEnemyHamlet, reduced). */
function enemyHamlets(sim: Sim, env: RiteEnv, d: number): Hamlet[] {
  const owner = dominionOwnerOf(sim);
  if (!owner) return [];
  return hamletsOf(sim).filter((h) => {
    const o = ownerOfHamlet(h.parcels, owner);
    return o !== UNOWNED && o !== d && env.relationOf(d, o) !== 'peace';
  });
}

/** Parcel ids of a dominion (dominions/adapter.ts dominionsOfSim), as a list in id order. */
function parcelsOfDominion(sim: Sim, d: number): number[] {
  const dom = dominionsOfSim(sim).find((x) => x.id === d);
  return dom ? [...dom.parcels].sort((a, b) => a - b) : [];
}

/** A random tile inside one parcel of a list (stream `rites`). */
function tileInParcels(sim: Sim, parcels: readonly number[]): { x: number; y: number } | null {
  if (parcels.length === 0) return null;
  const rng = sim.rng('rites');
  const perAxis = sim.realm.side / PARCEL;
  const p = parcels[rng.int(parcels.length)] ?? 0;
  return { x: (p % perAxis) * PARCEL + rng.int(PARCEL), y: Math.floor(p / perAxis) * PARCEL + rng.int(PARCEL) };
}

/** Folk living on any of the parcels (the citizens of a hamlet or dominion). Draws no rng. */
function folkOnParcels(sim: Sim, parcels: ReadonlySet<number>): number[] {
  const s = sim.beings.store;
  const out: number[] = [];
  for (let k = 0; k < s.size; k++) {
    const slot = s.at(k);
    if (!sim.beings.species(s.species[slot] ?? 0).folk) continue;
    if (parcels.has(parcelOf(sim.realm.side, s.x[slot] ?? 0, s.y[slot] ?? 0))) out.push(slot);
  }
  return out;
}

/** Adds a rite cloud over the tile (the weather list is capped at MAX_CLOUDS). Draws no rng. */
function addCloud(sim: Sim, type: string, x: number, y: number): boolean {
  if (sim.weather.clouds.length >= MAX_CLOUDS) return false;
  const cloud: Cloud = { type, x, y, speed: RITE_CLOUD_SPEED, age: 0, dropTimer: 0, dropInterval: RITE_CLOUD_DROP };
  sim.weather.clouds.push(cloud);
  return true;
}

/** Spawns `n` Beings of a species at tiles drawn from the parcel list; returns how many were placed. */
function summon(sim: Sim, species: string, n: number, parcels: readonly number[]): number {
  const idx = speciesIndex(species);
  let placed = 0;
  for (let k = 0; k < n; k++) {
    const t = tileInParcels(sim, parcels);
    if (t && spawnBeing(sim, idx, t.x, t.y, true) >= 0) placed++;
  }
  return placed;
}

/** The rite's target hamlet for a rite that acts on one, or null. pitRite may pick the caster's own (6.66%). */
function targetHamlet(sim: Sim, env: RiteEnv, kind: RiteKind, d: number): Hamlet | null {
  const own = hamletsOwnedBy(sim, d, true);
  const enemy = enemyHamlets(sim, env, d);
  const rule = RITE_TABLE[kind].target;
  if (rule === 'ownHamlet') return own[0] ?? null;
  if (kind === 'pitRite' && own.length > 0 && sim.rng('rites').next() < PIT_OWN_CHANCE) return own[0] ?? null;
  if (enemy.length === 0) return null;
  return enemy[sim.rng('rites').int(enemy.length)] ?? null;
}

/**
 * Whether a rite may be proposed by dominion `d` (RiteHooks.allowed): the rite is built, its creed holds the rite's tenet
 * (11 section 4.2), the `rituals` rule is on, and the rite has a target. Reads only; draws no rng.
 */
export function riteAllowed(sim: Sim, env: RiteEnv, kind: RiteKind, d: number): boolean {
  if (!RITE_TABLE[kind].built) return false;
  if (!sim.rules.isOn(RITUALS_RULE)) return false;
  if (!tenetsOfGroup(sim.culture, d).includes(kind)) return false;
  const target = RITE_TABLE[kind].target;
  if (target === 'ownDominion') return parcelsOfDominion(sim, d).length > 0;
  if (target === 'ownHamlet') return hamletsOwnedBy(sim, d, true).length > 0;
  if (kind === 'pitRite' && hamletsOwnedBy(sim, d, true).length > 0) return true;
  return enemyHamlets(sim, env, d).length > 0;
}

/**
 * Runs a rite's world effect for dominion `d` (RiteHooks.apply). Returns false when nothing landed (no target, or the effect
 * was refused). Draws from the `rites` stream and the sim's own streams as the effect needs.
 */
export function applyRite(sim: Sim, env: RiteEnv, kind: RiteKind, d: number): boolean {
  if (!RITE_TABLE[kind].built) return false;
  const rng = sim.rng('rites');
  const bolt = BOMB_PROFILE_BY_ID.get('bolt_medium');
  if (kind === 'dawnHostRite') return summon(sim, 'aegiswing', 3 + rng.int(5), parcelsOfDominion(sim, d)) > 0;
  if (kind === 'boneRite') return summon(sim, 'boneshambler', 6 + rng.int(8), parcelsOfDominion(sim, d)) > 0;
  if (kind === 'wardRite') {
    const parcels = new Set(parcelsOfDominion(sim, d));
    const folk = folkOnParcels(sim, parcels);
    for (const f of folk) sim.effects.add(f, 'warded', sim.tick);
    return folk.length > 0;
  }
  const h = targetHamlet(sim, env, kind, d);
  if (!h) return false;
  const perAxis = sim.realm.side / PARCEL;
  const c = centreOf(h.parcels, perAxis);
  const hamletParcels = [...h.parcels].sort((a, b) => a - b);
  switch (kind) {
    case 'rendRite':
      return startQuake(sim, c.tx, c.ty, 'rite');
    case 'starfallRite': {
      const n = 3 + rng.int(5);
      let hit = 0;
      for (let k = 0; k < n; k++) {
        const t = tileInParcels(sim, hamletParcels);
        if (!t) continue;
        meteorImpact(sim, t.x, t.y, 'skyrock_small');
        hit++;
      }
      return hit > 0;
    }
    case 'thunderRite': {
      if (!bolt) return false;
      detonateBomb(sim, bolt, c.tx, c.ty, false);
      const more = 5 + rng.int(8);
      for (let k = 0; k < more; k++) {
        const x = c.tx + rng.int(2 * THUNDER_RADIUS + 1) - THUNDER_RADIUS;
        const y = c.ty + rng.int(2 * THUNDER_RADIUS + 1) - THUNDER_RADIUS;
        if (sim.realm.inBounds(x, y)) detonateBomb(sim, bolt, x, y, false);
      }
      return true;
    }
    case 'galeRite':
    case 'cinderRite': {
      // Lightning clouds (cloud_storm) for the gale, fire clouds (cloud_wrath, which drops fire) for the cinder.
      const type = kind === 'galeRite' ? 'cloud_storm' : 'cloud_wrath';
      const n = kind === 'galeRite' ? 5 + rng.int(11) : 3 + rng.int(3);
      let made = 0;
      for (let k = 0; k < n; k++) {
        const x = c.tx + rng.int(2 * PARCEL + 1) - PARCEL;
        const y = c.ty + rng.int(2 * PARCEL + 1) - PARCEL;
        if (addCloud(sim, type, x, y)) made++;
      }
      return made > 0;
    }
    case 'pitRite':
      return summon(sim, 'magmaling', 5 + rng.int(6), hamletParcels) > 0;
    case 'vigorFeast': {
      const folk = folkOnParcels(sim, h.parcels);
      for (const f of folk) sim.effects.add(f, 'spirited', sim.tick);
      return folk.length > 0;
    }
    case 'dreadMistRite': {
      const folk = folkOnParcels(sim, h.parcels);
      let n = 0;
      for (const f of folk) {
        if (rng.next() < DREAD_CHANCE && sim.effects.add(f, 'frenzy', sim.tick)) n++;
      }
      return n > 0;
    }
    case 'leadenRite': {
      const folk = folkOnParcels(sim, h.parcels);
      for (const f of folk) sim.effects.add(f, 'sluggish', sim.tick);
      return folk.length > 0;
    }
    default:
      return false;
  }
}
