/**
 * Power and calamity handlers: maps a power id (src/content/powers.ts) or a rolled calamity id
 * (src/sim/calamity.ts) onto existing sim actions. Terrain brushes use the brush and ground code,
 * spawns use spawnBeing, blasts use explode and fire uses startFire. Powers whose handler is a UI
 * action (pause, speed, windows, rules toggles) or a system not built yet return false.
 */
import type { Sim } from '../sim.ts';
import { SPECIES, SPECIES_BY_ID } from '../../content/beasts.ts';
import { ground, groundId } from '../../content/grounds.ts';
import { BOMB_PROFILE_BY_ID, POWER_BY_ID, type BombProfile, type PowerDef } from '../../content/powers.ts';
import { applyStroke, brushOffsets, clampRadius } from '../brush.ts';
import { CALAMITY_BY_ID, calamityRoll } from '../calamity.ts';
import { spawnBeing, spawnFolk } from '../beings/system.ts';
import { hamletsOf, structuresOf } from '../settlements/adapter.ts';
import { placeStructure } from '../settlements/landmarks.ts';
import { explode } from '../explosions.ts';
import { applyDamage } from '../combat.ts';
import { placeDevice } from '../devices.ts';
import { scarStage, startFire } from '../terrain/fire.ts';
import { meteorImpact } from '../terrain/meteor.ts';
import { startQuake } from '../terrain/quake.ts';
import { creepHubAt, geyserAt, heatAt, igniteAt, plantFlora, quenchAt, rainOn, seedBiome, snowOn, volcanoAt } from './terrain-powers.ts';
import { blessAt, loreAt } from './rites.ts';
import {
  cleanseDrop,
  foundlingAt,
  itemRainDrop,
  lootDrop,
  moodDrop,
  purifyDrop,
  randomTraitDrop,
  slumberDrop,
  statusDrop,
  surgeDrop,
  traitDrop,
  unweaveDrop,
  wakeAt,
} from './favour.ts';

/** Beings placed by one beings calamity (a herd arriving at a tile). */
const CALAMITY_HERD = 6;
/** Tile draws tried before a random placement gives up. */
const PLACE_TRIES = 32;

function tileXY(sim: Sim, i: number): [number, number] {
  const side = sim.realm.side;
  return [i % side, Math.floor(i / side)];
}

/** Tile index of (x,y), which the caller has checked is on the realm. */
function tileAt(sim: Sim, x: number, y: number): number {
  return y * sim.realm.side + x;
}

/** Random walkable land tile drawn from the calamity stream, or -1. */
function randomLandTile(sim: Sim): number {
  const rng = sim.rng('calamity');
  for (let k = 0; k < PLACE_TRIES; k++) {
    const i = rng.int(sim.realm.tileCount);
    const kind = ground(sim.realm.ground[i] ?? 0);
    if (kind.layer === 'land' && kind.damages === 0) return i;
  }
  return -1;
}

/**
 * Explodes at (x,y). Returns true when the blast ran. explode() returns 0 both for a blast that hit
 * nothing and for one the guard refused, so the guard level tells them apart.
 */
function blastAt(sim: Sim, x: number, y: number, radius: number, damage: number, type: 'Other' | 'Explosion'): boolean {
  const before = sim.guard.level;
  explode(sim.explosionContext(), x, y, radius, damage, type, -1);
  return sim.guard.level > before;
}

/**
 * Detonates a bomb profile at (x,y) (12 section 8.6, 04 section 8.2). Returns false when the guard
 * refuses. Beings in the radius take the profile's damage once each, at full strength (no falloff),
 * and are dazed when the profile forces. Terrain: cover and scar on every land or water-free tile,
 * a sink for radius 2 and up, fire by the profile's rule, and the ground changes of the profile.
 * Urchin shrapnel are detonated after the main blast on random tiles of its radius (stream `bombs`).
 */
export function detonateBomb(sim: Sim, prof: BombProfile, x: number, y: number, withShrapnel: boolean): boolean {
  if (!sim.guard.tryAcquire()) return false;
  const realm = sim.realm;
  const s = sim.beings.store;
  const r = prof.radius;
  const rng = sim.rng('bombs');

  const hit: number[] = [];
  for (let k = 0; k < s.size; k++) {
    const slot = s.at(k);
    if (Math.hypot((s.x[slot] ?? 0) - x, (s.y[slot] ?? 0) - y) <= r) hit.push(slot);
  }
  const ctx = sim.combatContext();
  for (const slot of hit) {
    if (prof.damage > 0) applyDamage(ctx, slot, prof.damage, prof.type, false);
    if (prof.force && s.alive[slot] === 1) sim.effects.add(slot, 'dazed', sim.tick);
  }

  for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) {
    for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
      if (!realm.inBounds(xx, yy)) continue;
      const d = Math.hypot(xx - x, yy - y);
      if (d > r) continue;
      const i = yy * realm.side + xx;
      const falloff = 1 - d / (r + 1);
      if (prof.voidCore > 0 && d <= prof.voidCore) {
        realm.setGround(i, groundId('deepmere'));
        realm.setCover(i, 0);
        continue;
      }
      const kind = ground(realm.ground[i] ?? 0);
      if (prof.tidal) {
        if (kind.layer === 'land') realm.setGround(i, groundId('shoal'));
        realm.setCover(i, 0);
        continue;
      }
      if (kind.layer === 'water') continue;
      realm.setCover(i, 0);
      realm.setScar(i, scarStage(rng));
      if (r >= 2) {
        const sink = Math.floor((prof.damage / 10) * falloff);
        if (sink > 0) realm.setElevation(i, (realm.elevation[i] ?? 0) - sink);
      }
      if (prof.fire === 'all') startFire(sim, i, true);
      else if (prof.fire === 'random' && rng.next() < falloff * 0.5) startFire(sim, i, false);
    }
  }

  const shard = BOMB_PROFILE_BY_ID.get('shrapnel');
  if (withShrapnel && shard) {
    for (let k = 0; k < prof.shrapnel; k++) {
      const tx = x + rng.int(2 * r + 1) - r;
      const ty = y + rng.int(2 * r + 1) - r;
      if (realm.inBounds(tx, ty)) detonateBomb(sim, shard, tx, ty, false);
    }
  }
  return true;
}

/** Meteor impact at (x,y). Returns true when the guard let it run (meteorImpact itself places mineral nodes). */
function meteorAt(sim: Sim, x: number, y: number, profile: 'skyrock' | 'skyrock_small'): boolean {
  const before = sim.guard.level;
  meteorImpact(sim, x, y, profile);
  return sim.guard.level > before;
}

/** Runs one calamity's effect at a random place. Nature calamities burn or blast; beings calamities place a herd. */
export function runCalamity(sim: Sim, id: string): boolean {
  const def = CALAMITY_BY_ID.get(id);
  if (!def) return false;
  const rng = sim.rng('calamity');
  if (def.category === 'nature') {
    const i = randomLandTile(sim);
    if (i < 0) return false;
    if (id === 'heat_spell') {
      // Several sparks, since a single ignition on bare ground rarely spreads.
      let lit = false;
      for (let k = 0; k < 4; k++) {
        const t = randomLandTile(sim);
        if (t >= 0 && startFire(sim, t, true)) lit = true;
      }
      return lit;
    }
    const [x, y] = tileXY(sim, i);
    // Skyfall is a small meteor and tremor a small earthquake (02 section 8.2).
    if (id === 'skyfall') return meteorAt(sim, x, y, 'skyrock_small');
    if (id === 'tremor') return startQuake(sim, x, y, 'small');
    const blast: Record<string, [number, number]> = { whirlwind: [2, 15] };
    const [radius, damage] = blast[id] ?? [2, 15];
    return blastAt(sim, x, y, radius, damage, 'Explosion');
  }
  const centre = randomLandTile(sim);
  if (centre < 0) return false;
  const [cx, cy] = tileXY(sim, centre);
  const species = rng.int(SPECIES.length);
  let placed = 0;
  for (let k = 0; k < CALAMITY_HERD; k++) {
    const x = cx + rng.int(5) - 2;
    const y = cy + rng.int(5) - 2;
    if (spawnBeing(sim, species, x, y, true) >= 0) placed++;
  }
  return placed > 0;
}

/** Inputs to one calamity roll (02 section 8.1), with the live hamlet and being counts. */
export function calamityInputs(sim: Sim): Parameters<typeof calamityRoll>[0] {
  return {
    rng: sim.rng('calamity'),
    tick: sim.tick,
    age: sim.currentAge,
    isOn: (rule) => sim.rules.isOn(rule),
    cooldowns: sim.calamityCooldowns,
    hamlets: hamletsOf(sim).length,
    beings: sim.beings.store.size,
    // Lineage caps need a species-to-calamity map that does not exist yet, so no cap applies.
    liveCount: () => 0,
  };
}

/**
 * One calamity roll (02 section 8.1) followed by its effect. Called by the behaviour timer in
 * Sim.runBehaviours every 80 sim-seconds. Returns the calamity id that fired, or null.
 */
export function rollAndRunCalamity(sim: Sim): string | null {
  const id = calamityRoll(calamityInputs(sim));
  if (id === null) return null;
  runCalamity(sim, id);
  return id;
}

/** Applies one power at tile (x,y). Returns true when its handler ran; UI-only and unbuilt handlers return false. */
export function executePower(sim: Sim, def: PowerDef, x: number, y: number): boolean {
  // Soft gate (12 section 8): every rule in `requires` must be on, or the power does nothing. Ritual
  // powers (favour_bless) need `rituals` (02 section 9).
  if (!def.requires.every((rule) => sim.rules.isOn(rule))) return false;
  const inBounds = sim.realm.inBounds(x, y);
  const p = def.params;
  switch (def.handler) {
    case 'terraform_raise':
    case 'terraform_lower': {
      if (!inBounds) return false;
      applyStroke(sim.realm, def.handler === 'terraform_raise' ? 'raise' : 'lower', 'circle', clampRadius(Number(p.radius ?? 4)), x, y, x, y, true);
      return true;
    }
    case 'paint_ground': {
      if (!inBounds) return false;
      const gid = groundId(String(p.ground));
      const realm = sim.realm;
      for (const { dx, dy } of brushOffsets('circle', clampRadius(Number(p.radius ?? 4)))) {
        const tx = x + dx;
        const ty = y + dy;
        if (realm.inBounds(tx, ty)) realm.setGround(ty * realm.side + tx, gid);
      }
      return true;
    }
    case 'spawn_being': {
      const species = SPECIES_BY_ID.get(String(p.species));
      if (species === undefined || !inBounds) return false;
      // A Folk spawner places a founder with its lineage's starting traits (18a section 1.2).
      const placed = sim.beings.species(species).folk ? spawnFolk(sim, species, x, y) : spawnBeing(sim, species, x, y, true);
      return placed >= 0;
    }
    case 'bomb':
    case 'bolt': {
      if (!inBounds) return false;
      // Device bombs place a device ground that triggers later (04 section 8.4) instead of detonating now.
      if (p.device !== undefined) return placeDevice(sim, String(p.device), x, y);
      const prof = BOMB_PROFILE_BY_ID.get(String(p.profile));
      return prof !== undefined && detonateBomb(sim, prof, x, y, true);
    }
    case 'seed_biome':
      return inBounds && seedBiome(sim, tileAt(sim, x, y), String(p.biome ?? ''));
    case 'plant_flora':
      return inBounds && plantFlora(sim, tileAt(sim, x, y), String(p.flora ?? ''));
    case 'drop_rain':
      return inBounds && rainOn(sim, tileAt(sim, x, y));
    case 'drop_freeze':
      return inBounds && snowOn(sim, tileAt(sim, x, y));
    case 'start_fire':
      return inBounds && igniteAt(sim, tileAt(sim, x, y));
    case 'quench':
      return inBounds && quenchAt(sim, tileAt(sim, x, y));
    case 'add_heat':
      return inBounds && heatAt(sim, tileAt(sim, x, y), Number(p.amount ?? 0));
    case 'start_volcano':
      return inBounds && volcanoAt(sim, x, y, Number(p.small ?? 0) === 1);
    case 'start_geyser':
      return inBounds && geyserAt(sim, x, y, p.kind === 'acid' ? 'acid' : 'water');
    case 'place_creep_hub':
      return inBounds && creepHubAt(sim, tileAt(sim, x, y), String(p.hub ?? ''));
    case 'place_structure': {
      // Landmark or beacon pillar on the tapped tile (18e 2.2). Refused before the first settlements step (no list yet).
      const list = structuresOf(sim);
      return inBounds && list !== null && placeStructure(sim, list, String(p.structure ?? ''), tileAt(sim, x, y));
    }
    case 'calamity':
      return runCalamity(sim, String(p.calamity));
    case 'bless':
      // Ran even when no being is in range, like a brush over empty ground (12 section 10).
      if (!inBounds) return false;
      blessAt(sim, x, y, Number(p.radius ?? 3), String(p.status ?? 'warded'));
      return true;
    case 'lore':
      if (!inBounds) return false;
      loreAt(sim, x, y, Number(p.radius ?? 4));
      return true;
    // Favour drops (12 section 8.7): effects land on the beings on the tapped tile (see favour.ts).
    case 'favour_status':
      return inBounds && statusDrop(sim, x, y, String(p.status ?? ''), Number(p.fall ?? 0));
    case 'favour_surge':
      return inBounds && surgeDrop(sim, x, y, Number(p.fall ?? 0));
    case 'favour_mood':
      return inBounds && moodDrop(sim, x, y, String(p.event ?? ''), Number(p.extra ?? 0), Number(p.fall ?? 0));
    case 'favour_trait':
      return inBounds && traitDrop(sim, x, y, String(p.trait ?? ''), Number(p.fall ?? 0));
    case 'favour_trait_random':
      return inBounds && randomTraitDrop(sim, x, y, p.polarity === 'bad' ? 'bad' : 'good', Number(p.chance ?? 0));
    case 'favour_sleep':
      return inBounds && slumberDrop(sim, x, y, Number(p.fall ?? 0));
    case 'favour_unweave':
      return inBounds && unweaveDrop(sim, x, y, Number(p.fall ?? 0));
    case 'favour_cleanse':
      return inBounds && cleanseDrop(sim, x, y, Number(p.fall ?? 0));
    case 'favour_purify':
      return inBounds && purifyDrop(sim, x, y);
    case 'favour_foundling':
      return inBounds && foundlingAt(sim, x, y);
    case 'favour_wake':
      return inBounds && wakeAt(sim, x, y);
    case 'favour_items':
      return inBounds && itemRainDrop(sim, x, y, Number(p.fall ?? 0));
    case 'favour_loot':
      return inBounds && lootDrop(sim, x, y, Number(p.fall ?? 0));
    default:
      return false;
  }
}

/** Applies a power by id at (x,y). Unknown ids return false. */
export function usePowerById(sim: Sim, id: string, x: number, y: number): boolean {
  const def = POWER_BY_ID.get(id);
  if (!def) return false;
  return executePower(sim, def, x, y);
}
