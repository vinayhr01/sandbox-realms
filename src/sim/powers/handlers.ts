/**
 * Power and calamity handlers: maps a power id (src/content/powers.ts) or a rolled calamity id
 * (src/sim/calamity.ts) onto existing sim actions. Terrain brushes use the brush and ground code,
 * spawns use spawnBeing, blasts use explode and fire uses startFire. Powers whose handler is a UI
 * action (pause, speed, windows, rules toggles) or a system not built yet return false.
 */
import type { Sim } from '../sim.ts';
import { SPECIES, SPECIES_BY_ID } from '../../content/beasts.ts';
import { ground, groundId } from '../../content/grounds.ts';
import { POWER_BY_ID, type PowerDef } from '../../content/powers.ts';
import { applyStroke, brushOffsets, clampRadius } from '../brush.ts';
import { CALAMITY_BY_ID, calamityRoll } from '../calamity.ts';
import { spawnBeing } from '../beings/system.ts';
import { explode } from '../explosions.ts';
import { startFire } from '../terrain/fire.ts';

/** Beings placed by one beings calamity (a herd arriving at a tile). */
const CALAMITY_HERD = 6;
/** Tile draws tried before a random placement gives up. */
const PLACE_TRIES = 32;

function tileXY(sim: Sim, i: number): [number, number] {
  const side = sim.realm.side;
  return [i % side, Math.floor(i / side)];
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
    const blast: Record<string, [number, number]> = { whirlwind: [2, 15], tremor: [3, 25], skyfall: [4, 60] };
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

/**
 * One calamity roll (02 section 8.1) followed by its effect. Called by the behaviour timer in
 * Sim.runBehaviours every 80 sim-seconds. Returns the calamity id that fired, or null.
 */
export function rollAndRunCalamity(sim: Sim): string | null {
  const id = calamityRoll({
    rng: sim.rng('calamity'),
    tick: sim.tick,
    age: sim.currentAge,
    isOn: (rule) => sim.rules.isOn(rule),
    cooldowns: sim.calamityCooldowns,
    // The sim has no hamlet registry yet (settlements are not wired), so hamlet gates see zero.
    hamlets: 0,
    beings: sim.beings.store.size,
    // Lineage caps need a species-to-calamity map that does not exist yet, so no cap applies.
    liveCount: () => 0,
  });
  if (id === null) return null;
  runCalamity(sim, id);
  return id;
}

/** Applies one power at tile (x,y). Returns true when its handler ran; UI-only and unbuilt handlers return false. */
export function executePower(sim: Sim, def: PowerDef, x: number, y: number): boolean {
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
      return spawnBeing(sim, species, x, y, true) >= 0;
    }
    case 'bomb':
    case 'bolt': {
      if (!inBounds) return false;
      return blastAt(sim, x, y, Number(p.radius ?? 3), Number(p.damage ?? 30), def.handler === 'bolt' ? 'Other' : 'Explosion');
    }
    case 'calamity':
      return runCalamity(sim, String(p.calamity));
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
